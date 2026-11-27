SHELL := /bin/bash
.DEFAULT_GOAL := help
UV ?= uv
TF ?= terraform
INFRA_DIR := infra
SEED ?= 20261127
CONCURRENCY ?= 4
REDIS_IMAGE := redis:8.12.0-alpine@sha256:5af80107c1eeecb484a2269b80a26d12bfa6521787da4663bd9f19f60a163483
ENV := set -a; [ -f .env ] && . ./.env; set +a;

.PHONY: help setup check test lint services-up services-down pools validate flagsmith-setup smoke \
        dryrun pilot power exp1 rollout exp2 analyse docs verify board-seed infra-up infra-down infra-ssh flags-drift

help: ## List targets
	@grep -E '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-16s %s\n", $$1, $$2}'

setup: ## Install Python and Node dependencies
	$(UV) sync --group dev
	cd board/web && npm ci
	cd board/worker && npm ci
	cd kit && npm ci

lint: ## ruff + pyright
	$(UV) run ruff check .
	$(UV) run ruff format --check .
	$(UV) run pyright

test: ## Unit tests (no network, no spend)
	$(UV) run pytest -q -m "not docker"

check: lint test ## Everything CI runs for Python, plus the consistency gate
	$(UV) run python -m analysis.check_consistency

services-up: ## Local Redis for the task queue, plus the telemetry stack
	docker run -d --name fib-redis -p 127.0.0.1:6379:6379 $(REDIS_IMAGE) >/dev/null 2>&1 || docker start fib-redis
	docker compose -f otel/docker-compose.yml up -d

services-down: ## Stop local services
	-docker rm -f fib-redis
	docker compose -f otel/docker-compose.yml down

pools: ## Select disjoint task pools (seeded)
	$(UV) run python -m tasks.select_tasks --seed $(SEED)

validate: ## Validate pool images and gold patches (POOL=pilot)
	$(UV) run python -m tasks.validate --pool $(POOL) --concurrency $(CONCURRENCY)

flagsmith-setup: ## Create flags, keyed variant and metrics with the Flagsmith CLI
	$(ENV) bash flagsmith/setup.sh lanes_v1

smoke: ## Flagsmith smoke test (throwaway flag and experiment)
	$(ENV) bash flagsmith/smoke_test.sh

dryrun: ## Two tasks per arm outside any experiment (spends a little)
	$(ENV) $(UV) run python -m runner.worker run --exp dryrun-control --pool tasks/pools/pilot.jsonl.gz --force-policy control --limit 2 --concurrency 2 --phase-budget dryrun
	$(ENV) $(UV) run python -m runner.worker run --exp dryrun-lanes_v1 --pool tasks/pools/pilot.jsonl.gz --force-policy lanes_v1 --limit 2 --concurrency 2 --phase-budget dryrun

pilot: ## Pilot: every pilot task under both policies, outside the experiment
	$(ENV) $(UV) run python -m runner.worker run --exp pilot-control --pool tasks/pools/pilot.jsonl.gz --force-policy control --concurrency $(CONCURRENCY) --phase-budget pilot
	$(ENV) $(UV) run python -m runner.worker run --exp pilot-lanes_v1 --pool tasks/pools/pilot.jsonl.gz --force-policy lanes_v1 --concurrency $(CONCURRENCY) --phase-budget pilot

power: ## Choose N and the margin m from pilot data
	$(UV) run python -m analysis.power --runs runs --pilot pilot

exp1: ## Main run of experiment 1 (Flagsmith assigns every task)
	$(ENV) $(UV) run python -m runner.worker run --exp exp1 --pool tasks/pools/exp1.jsonl.gz --concurrency $(CONCURRENCY) --prune-images

rollout: ## Fresh batch after the winner is rolled out on the same flag
	$(ENV) $(UV) run python -m runner.worker run --exp rollout --pool tasks/pools/rollout.jsonl.gz --concurrency $(CONCURRENCY) --prune-images

exp2: ## Main run of experiment 2
	$(ENV) $(UV) run python -m runner.worker run --exp exp2 --pool tasks/pools/exp2.jsonl.gz --concurrency $(CONCURRENCY) --prune-images

analyse: ## Reproduce every published number from the run logs
	$(UV) run python -m analysis.analyse --runs runs --out analysis/out
	$(UV) run python -m analysis.charts
	$(UV) run python -m analysis.check_consistency

docs: ## Fill the paper and deck from numbers.json, then build docs/paper.pdf and docs/deck.pdf
	$(UV) run python -m analysis.render_docs --no-regenerate
	cd docs/build && npm ci --no-audit --no-fund && npx playwright install chromium && node build.mjs
	$(UV) run python -m analysis.check_consistency

verify: ## Re-check the hash-chained ledgers and print the Merkle roots
	for d in runs/*/; do [ -f "$$d/ledger.jsonl" ] && $(UV) run python -m integrity.verify_ledger "$$d"; done
	for d in runs/*/; do [ -d "$$d/env" ] && $(UV) run python -m integrity.verify_assignment --run "$$d" --out /dev/null >/dev/null && echo "$$d assignments match Flagsmith engine"; done

board-seed: ## Write final numbers into the board's static seed
	cd board/web && npm run seed -- ../../analysis/out/numbers.json

flags-drift: ## Read-only plan of the live Flagsmith flags against infra/flagsmith (LEDGER=runs/<exp>/ledger.jsonl to record)
	bash infra/flagsmith/drift.sh $(if $(LEDGER),--ledger $(LEDGER))

infra-up: ## Create the EC2 runner (billable)
	@test -f $(INFRA_DIR)/terraform.tfvars || { echo "copy infra/terraform.tfvars.example to infra/terraform.tfvars first"; exit 1; }
	$(TF) -chdir=$(INFRA_DIR) init -input=false
	$(TF) -chdir=$(INFRA_DIR) apply -input=false

infra-down: ## Destroy the runner and its volume
	$(TF) -chdir=$(INFRA_DIR) destroy -input=false

infra-ssh: ## SSH in with Grafana (3000) and ClickHouse (8123) forwarded
	ssh -o StrictHostKeyChecking=accept-new -L 3000:127.0.0.1:3000 -L 8123:127.0.0.1:8123 ubuntu@$$($(TF) -chdir=$(INFRA_DIR) output -raw public_ip)
