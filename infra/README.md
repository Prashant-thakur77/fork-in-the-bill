# infra

Terraform for the single EC2 runner that executes the experiment: one spot (or on-demand) instance in the default VPC, SSH from one CIDR only, a gp3 root volume for task images, and an AWS Budgets alert. No IAM roles or users are created. Every resource carries `Project=fork-in-the-bill`.

Nothing here runs automatically. `make infra-up` creates billable resources, so run it only after the spend is approved.

## What gets created

| Resource | Notes |
|---|---|
| `aws_security_group.runner` | Ingress: TCP 22 from `operator_cidr` only. Egress: all (package mirrors, registries, model and Flagsmith APIs). |
| `aws_key_pair.operator` | From `ssh_public_key`. |
| `aws_instance.runner` | Ubuntu 24.04, `m7i.4xlarge` by default, one-time spot (`use_spot = true`) that terminates on interruption, IMDSv2 only, encrypted gp3 root volume (400 GiB by default). |
| `aws_budgets_budget.monthly` | Monthly cost budget at `budget_usd`, email at 80% forecast and 100% actual. |

The budget covers the whole AWS account, not just these resources: filtering by the `Project` tag would only work once that tag is activated as a cost allocation tag, and an account-wide cap is the safer guard. Model spend is billed by the model provider, not AWS, and is capped separately by `BUDGET_USD_TOTAL` (see `docs/interfaces.md`).

## Why m7i.4xlarge

16 vCPU and 64 GiB. The runner keeps about 8 task containers going at once; SWE-bench-Live test suites are CPU-bound (builds, pytest, cargo), so each container gets about 2 vCPU and 6 GiB, with a few GiB left for Redis, ClickHouse and the collector. `r7i.2xlarge` has the same memory at a lower price but only 8 vCPU, which would leave 1 vCPU per container and stretch wall-clock time (and spot exposure) for the same work. `m6i.4xlarge` is a fine fallback if `m7i` spot capacity is short.

## Cost estimate (us-east-1, checked 2026-11-27)

| Item | Rate |
|---|---|
| m7i.4xlarge on-demand | $0.8064 / hour |
| m7i.4xlarge spot (current regional price) | about $0.39 / hour (it moves) |
| gp3 400 GiB, 3000 IOPS, 125 MiB/s | about $32 / month ($0.08 per GiB-month), about $0.04 / hour while it exists |

Sources: the public price files behind the AWS pricing pages, <https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/US%20East%20(N.%20Virginia)/Linux/index.json> (on-demand) and <https://website.spot.ec2.aws.a2z.com/spot.js> (spot). These are estimates; check <https://aws.amazon.com/ec2/pricing/on-demand/> and <https://aws.amazon.com/ec2/spot/pricing/> before applying.

For the planned study (about 250 tasks, 8 at a time, roughly 10 minutes each) the experiment itself needs about 5 to 6 instance-hours. With setup, task validation, the pilot and slack, 24 to 48 hours of uptime comes to about $10 to $20 on spot or $20 to $40 on-demand, plus the volume. Run `make infra-down` between sessions; the volume is deleted with the instance.

The root volume holds Docker images. 250 distinct task images can exceed 400 GiB if all are kept, so the runner should remove each task image after use (or raise `root_volume_gb`).

## Use

```sh
cp infra/terraform.tfvars.example infra/terraform.tfvars   # gitignored; fill it in
make infra-up        # terraform init + apply
make infra-ssh       # SSH with Grafana (3000) and ClickHouse (8123) forwarded to localhost
make infra-down      # terraform destroy
```

`terraform.tfvars` and state files are gitignored. AWS credentials come from the usual environment or profile; nothing in this directory stores them.

Set `use_spot = false` and re-apply to move to on-demand when spot capacity is unavailable or interruptions keep cutting runs short. The runner's Redis leases make interrupted tasks resumable either way.

## Boot

`cloud-init.yaml` (rendered with `templatefile`) installs Docker Engine from Docker's apt repository, uv (release tarball, SHA-256 checked), and git; starts Redis in a container on `127.0.0.1:6379`; clones `repo_url` at `repo_ref` into `/home/ubuntu/fork-in-the-bill`; brings up `otel/docker-compose.yml` (OTel Collector on `127.0.0.1:4318`, ClickHouse, Grafana); runs `uv sync --frozen`; and pre-pulls `prepull_images`. Progress goes to `/var/log/fib-bootstrap.log`, and `/var/lib/fib/bootstrap-done` appears when it finishes.

`repo_url` must be cloneable without credentials. For a private repository, leave the clone to an SSH session with agent forwarding (`ssh -A`) rather than putting a token in user data, which is readable from instance metadata.

## Checks

```sh
cd infra
terraform fmt -check
terraform init -backend=false
terraform validate
```
