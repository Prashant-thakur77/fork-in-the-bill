# Changelog

Notable changes to this project, newest first. Versions are git tags. Result figures are deliberately left out of this file: they live in `analysis/out/numbers.json` and the documents filled from it.

## [Unreleased]

### Added

- TypeScript kit: the bucketing code, offline re-derivation of assignments, a strict failure mode and a shared event sender.
- `forkbill-mcp`, an MCP server with tests. The TypeScript kit package is renamed `forkbill`, and both build in one npm workspace under `kit/`.
- Release workflow (`.github/workflows/release.yml`). On a `v*` tag it re-runs the consistency gate, the registration hash check and the ledger and assignment verification, re-derives `numbers.json` from the run logs and compares it with the committed file, builds the PDFs and the Parquet export, writes `SHA256SUMS`, attests build provenance for every asset and publishes the release. A manual dry run builds everything and publishes nothing.
- Release notes generated from `numbers.json` by `tools/release_notes.py`, using the formatter that fills the README and the paper.
- `tools/compare_numbers.py`, which compares a re-derived `numbers.json` with the committed one, value by value.
- A composite action, `.github/actions/verify-run`, that verifies the ledger and the assignments of a run directory and writes the Merkle root to the job summary. CI and the release workflow use it, and another repository can call it on its own run directory.
- A devcontainer with Python, uv and Node 22, so the verification and the analysis run in a codespace without keys.
- `docs/reproduce.md`, a walk from clone to verified ledgers and re-derived numbers, with the output to expect.
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CITATION.cff`, issue forms for bugs and replication reports, and a pull request template.
- `.editorconfig` and `.gitattributes`. Run logs and lockfiles are marked as generated, and text files check out with LF so the registration hashes hold on every platform.
- CI checks that relative links in the Markdown files resolve (`tools/check_links.py`) and that `prereg/HASHES.txt` verifies.

### Fixed

- `make setup` now installs the optional extras, so `make check` passes straight after it. Without them the type checker could not resolve the OpenFeature imports.
- `docs/interfaces.md` lists the run directory as the runner writes it: snapshots are in `env/`, and `meta.json` has `force_policy`.

## [0.2.0] - 2026-11-27

### Added

- The rollout batch: after End Experiment, the experiment 1 winner became the value of `agent_routing`, and a fresh batch ran on the same flag with no code change. Its records and ledger are in `runs/rollout/`.
- Results by tier (fresh and pre-cutoff tasks) as a secondary analysis, with the fresh-tier solve-rate caveat stated in the README, the paper and the deck.
- Pre-registration of experiment 2 (tag `prereg-exp2`), the `lanes_v2` variant and its dry run records.
- Decision and progress records for the experiment 1 decision, the rollout and the experiment 2 setup.
- Flagsmith dashboard screenshots in the README.
- Site: a split lab, a guess on the worker share, pilot stakes in the rollout preview, roadside props on the section signs, and a replay link when the live numbers cannot be reached.

### Changed

- Power is read at the registered sample size.
- `flagsmith/create_experiment.sh` checks the experiment's control against the environment's value of the flag instead of the project default, because after a rollout the winner is the environment value.
- Site: experiment 1 is read by name, hashes are shown in full, both lanes stay on the road, and the junction vehicles were redrawn.

### Fixed

- Secret scanning allows exactly the client-side environment key inside committed environment snapshots, and decision D28 records why that key is published.
- Site: contrast of the hash step on the why-Flagsmith page, split counts that disappeared, and the phone headline and method stamp layout.

## [0.1.0] - 2026-11-27

### Added

- Agent harness with two lanes: a planner that has no shell and a worker that runs every command, each lane on its own model, with cost accounting and hard spend caps.
- Queue worker that runs, grades and records tasks, with periodic reaping of expired leases.
- Task selection, validation and grading against published task images, with seeded, disjoint pools.
- Flagsmith setup through the CLI: flags, the keyed variant, metrics and the experiment; an exposure event per task; a kill switch; feature health reporting; flags described as Terraform with a drift check.
- Hash-chained run ledger with a Merkle root over completed tasks, environment snapshots during a run, and an offline check that recomputes every assignment with Flagsmith's flag engine.
- Analysis pipeline: Parquet conversion, bootstrap and posterior statistics, power simulation, charts, document rendering from `numbers.json`, and a consistency gate that fails on any stale or bare figure.
- Pilot runs, the pilot report and the power analysis; pre-registration of experiment 1 (tag `prereg-exp1`) and amendment 1 (tag `prereg-exp1-amend1`).
- Experiment 1: run records, environment snapshots, Flagsmith results, analysis and charts. An `exp2b` pool so experiment 2 can reach its planned size.
- The `forkbill` kit for Python and TypeScript, with remote evaluation, local evaluation, Edge Proxy and OpenFeature modes, and a self-hosted Flagsmith demo.
- Live board and site on one domain: a worker with signed ingest, a database and server-sent events, signed Flagsmith webhooks for flag changes, and the prerendered pages.
- README, the experiment 1 paper, the deck, and a PDF builder behind `make docs`.
- Terraform for the runner VM, tracing, CI (lint, types, tests, consistency gate, ledger and assignment verification, secret scanning, board and kit builds) and a manual kit demo workflow.
- MIT licence.

### Fixed

- Flagsmith events are flushed one at a time, so an exposure cannot be dropped.
- JSONL is split on newlines only, so U+0085 in a test name cannot break a record.
- Malformed tool arguments are returned to the model as tool errors.
- The graded patch includes files the agent creates and is measured from the container's starting state.
- Flagsmith results are parsed in the shape the API returns.

[Unreleased]: https://github.com/Prashant-thakur77/fork-in-the-bill/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Prashant-thakur77/fork-in-the-bill/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Prashant-thakur77/fork-in-the-bill/releases/tag/v0.1.0
