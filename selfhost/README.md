# Self-hosted Flagsmith: kit portability demo

This folder runs open-source Flagsmith with Experimentation turned on, on your own machine, and
runs the `forkbill` kit against it. It shows that the kit works on self-hosted Flagsmith as well
as on Flagsmith Cloud, using the same flag, metrics, experiment, exposures and events.

**This is a portability demo, not study data.** The agent loop here is a deterministic fake: no
model is called, prices are illustrative, and no money is spent. The demo runs on its own local
instance with identities prefixed `kitdemo:`. Its numbers are never copied into `runs/`,
`analysis/` or the README results.

## What runs

`docker-compose.yml` (project name `forkbill-selfhost`):

| Service | Image | Role |
|---|---|---|
| `postgres` | `postgres:15.5-alpine` (pinned by digest) | Flagsmith database, which also stores SDK events |
| `migrate-db` | `docker.flagsmith.com/flagsmith/flagsmith:2.295.2` (pinned by digest) | One-shot migrations |
| `flagsmith` | same image | API and dashboard on `127.0.0.1:8000` |
| `flagsmith-task-processor` | same image | Background tasks (exposure and results refreshes) |

Experimentation settings: `EXPERIMENTATION_ENABLED=true`, `WAREHOUSE_CREDENTIALS_SECRET`
(random, in `selfhost/.env`) and `DATABASE_URL`. First-run setup uses the documented
initialisation: `ALLOW_ADMIN_INITIATION_VIA_CLI=true` with `ADMIN_EMAIL`, `ORGANISATION_NAME` and
`PROJECT_NAME`, run through the image's `flagsmith bootstrap` command.

### Which warehouse, and why

The self-hosting docs page says the repo-root `docker-compose.yml` "runs every experimentation
service, with a local ClickHouse". That was true of the October 2026 version (commit "run
experimentation infra in docker compose", #8752). It is not true now: on 2026-11-06 the file was
changed to "Run experimentation on the Flagsmith Postgres database in docker compose" (#8884). The
current file (fetched 2026-11-27) has no ClickHouse, Kafka, ingestion server or warehouse delivery
service. It only sets `EXPERIMENTATION_ENABLED: 'true'` and lets the API store events in Postgres.

So this demo uses the **"Flagsmith database" warehouse**: a `postgres` warehouse connection with
`config: {"source": "flagsmith_database"}`. The SDKs post events to the API itself:

- SDK `api_url`: `http://localhost:8000/api/v1/`
- SDK events URL: `http://localhost:8000/api/` (the SDK adds `v1/events`)

Flagsmith's docs call this path "evaluation only", because events share the database that serves
flags. That is fine for a demo of a few hundred events. A production self-hosted setup would run
the ingestion server, Kafka and warehouse delivery (github.com/Flagsmith/ingestion-server,
github.com/Flagsmith/warehouse-delivery) into ClickHouse. That stack is not part of this demo.

## Run it

Needs Docker with Compose v2, `jq`, `curl`, `openssl`, the Flagsmith CLI v2
(`curl -fsSL https://get.flagsmith.com | sh`) and the repo's Python venv (`uv sync`).

```bash
selfhost/bootstrap.sh   # bring up, initialise, create env + keys + warehouse, bind the CLI
selfhost/demo.sh        # forkbill init + start experiment, forkbill demo, refresh, print results
```

`bootstrap.sh` writes:

- `selfhost/.env`: random secrets for Postgres, Django and warehouse credentials (gitignored).
- `selfhost/.state/credentials.env` (mode 600): `FLAGSMITH_API_URL`,
  `FLAGSMITH_API_KEY_localhost_8000` (a Master API key, which is what CLI v2 accepts for a
  self-hosted URL; CLI v2 does not accept user auth tokens), the server-side SDK key, the SDK and
  events URLs, and the dashboard admin email and password.
- `selfhost/.state/flagsmith.json`: the CLI's project and environment binding (`flagsmith init`).

`selfhost/.state/` contains a `.gitignore` of `*`, so nothing in it can be committed. The scripts
print where these files are, never what is in them.

To use the instance from a shell, run `set -a; source selfhost/.state/credentials.env; set +a`.
After that, `flagsmith ...`, `flagsmith/setup.sh` and `flagsmith/smoke_test.sh` work against it.
The dashboard is at http://localhost:8000; log in as `admin@forkbill.local` with the password in
the credentials file.

Tear down (removes the database volume):

```bash
docker compose -f selfhost/docker-compose.yml down -v && rm -rf selfhost/.state
```

If Docker reports "all predefined address pools have been fully subnetted", set `SELFHOST_SUBNET`
in `selfhost/.env` to a free range. The compose file uses `10.213.0.0/24` by default, so it does
not need one of Docker's default pools.

## Verified run (2026-11-27)

Host: Linux, Docker 29.2.1, Compose v5.0.2. Flagsmith image 2.295.2, Flagsmith CLI v2.0.0, Python
SDK `flagsmith` 6.7.0, `@flagsmith/nodejs` 9.5.0. Started from an empty volume and torn down
afterwards with `down -v`. Keys and the client-side environment key are left out of the output
below.

### 1. `selfhost/bootstrap.sh`

```text
wrote selfhost/.env with random secrets
== docker compose up
waiting for http://localhost:8000/health/liveness/ ... up
== first-run initialisation (flagsmith bootstrap)
Superuser "admin@forkbill.local" created successfully.
Organisation "Fork in the Bill (self-hosted demo)" created successfully.
Project "forkbill-selfhost-demo" created successfully.
admin password set
master API key created
== CLI auth
Instance            http://localhost:8000
Identity            Master API key
Organisations       Fork in the Bill (self-hosted demo) (1)
Credential source   $FLAGSMITH_API_KEY_localhost_8000
== environment Demo
created
CLI bound: {"project":1,"apiUrl":"http://localhost:8000"}
server-side SDK key created
== warehouse: Flagsmith database (Postgres, evaluation only)
{"name":"Flagsmith database - Demo","warehouse_type":"postgres","config":{"source":"flagsmith_database"},"status":"connected"}
```

About one minute from an empty volume, most of it migrations.

### 2. `selfhost/demo.sh` (DEMO_N=120, about 14 s)

`forkbill init` created the flag, the keyed variant, the kill switch, the four metrics from
`flagsmith/metrics.json` and the experiment, then started it:

```json
{"ids": {"features": {"agent_routing": 1, "routing_kill": 2},
         "variants": {"agent_routing": {"lanes_v1": 1}},
         "metrics": {"task_cost": 1, "task_solved": 2, "task_turns": 3, "task_seconds": 4}},
 "experiment": {"id": 1, "status": "running"}}
```

`forkbill demo` ran 120 identities through the Python SDK (fake loop, illustrative prices):

```text
control:  n 63, exposed 63, cost_mean 0.5017, solve_rate 0.3968, cost_per_solve 1.2643
lanes_v1: n 57, exposed 57, cost_mean 0.3351, solve_rate 0.5789, cost_per_solve 0.5788
```

Events stored by Flagsmith: `total_events_received: 538`. That is exactly 120 exposures plus 418
task events (120 `task_cost` + 58 `task_solved` + 120 `task_turns` + 120 `task_seconds`), so none
were lost.

Both refreshes returned `HTTP/1.1 202 Accepted`. The exposures endpoint returned
`new_identities: {"control": 63, "lanes_v1": 57}`. The results endpoint returned a full Bayesian
readout on the first refresh, with no warehouse delay on this path:

| metric | control n / sum | lanes_v1 n / sum | lift | 95% interval | chance_to_win |
|---|---|---|---|---|---|
| task_cost (mean, down) | 63 / 31.6067 | 57 / 19.1010 | -0.332 | [-0.416, -0.248] | 1.000 |
| task_solved (occurrence, up) | 63 / 25 | 57 / 33 | +0.459 | [-0.095, 1.013] | 0.948 |
| task_turns (mean, informational) | 63 / 817 | 57 / 827 | +0.119 | [-0.016, 0.253] | 0.958 |
| task_seconds (mean, informational) | 63 / 7971.4 | 57 / 8230.7 | +0.141 | [0.005, 0.277] | 0.979 |

Flagsmith's per-arm sums match the kit's own numbers (31.6067 / 63 = 0.5017). `srm_p_value` was
`null`. The response shape is
`{"results": {"as_of", "last_error_at", "refresh_requested_at", "payload": {"metrics": [{"variants", "inference", "metric_id", "conversions_timeseries"}], "srm_p_value", "exposures_timeseries"}, "is_final": false}}`.

### 3. The `flagsmith/` scripts against the same instance

- `flagsmith/setup.sh` on the Demo environment, where `forkbill init` had already created
  everything, reported every object as existing with the same definition and wrote
  `ids.json`. This checks that it is idempotent.
- `FLAG=routing_check KILL_FLAG=routing_check_kill flagsmith/setup.sh lanes_v1 lanes_v2` in a
  fresh environment created the flag, both keyed variants, the kill switch (off) and the four
  metrics (ids 5 to 8).
- `flagsmith/create_experiment.sh` with `experiment-1.json` and a prereg file containing a
  `<!-- hypothesis:start -->` block created experiment 4. The script added `lanes_v2` at 0%,
  because Flagsmith rejects a rollout that leaves out any variant of the flag:
  `["Must include all feature's variants."]`. The stored `hypothesis` equals the prereg block
  word for word. `flagsmith/start_experiment.sh 4` returned `"status": "running"`. A second
  create stopped with Flagsmith's own error:
  `{"detail":"An active experiment already exists for this feature."}` (HTTP 409).
- `flagsmith/smoke_test.sh` created `fib_smoke` with variant key `treatment`, the metric
  `fib_smoke_value` and an experiment, and started it. Three identities went through the Python
  SDK (2 control, 1 treatment, all `in_experiment=True`). Both refreshes returned 202, and the
  results showed `control n 2 sum 5.0`, `treatment n 1 sum 2.5`, `inference: {"treatment": null}`
  (still collecting data, as expected with 3 identities). The cleanup commands it prints
  (`complete` with `rollout_decision=control`, `feature delete`, metric `DELETE`) all succeeded.

### 4. The Node adapter against the same instance

The `kit/ts` build ran 4 identities with the real `@flagsmith/nodejs` client and
`eventProcessorConfig: {maxBuffer: 1}`. All 4 were exposed (2 `lanes_v1`, 2 `control`) and sent 14
task events. The stored count went from 538 to 556, so all 18 events arrived. The Python kit with
`EventProcessorConfig(max_buffer_items=1)` and 4 identities then added exactly 20 (556 to 576).

### Admin API enum literals (from this instance)

These values come from the API's `OPTIONS` responses and were then checked by real `POST`s:

| field | accepted | rejected in tests |
|---|---|---|
| metric `aggregation` | `occurrence`, `count`, `sum`, `mean` | `Mean`, `ratio` (`"\"ratio\" is not a valid choice."`) |
| metric `direction` | `up`, `down`, `informational` | `lower` |
| experiment metric `expected_direction` | `increase`, `decrease`, `not_increase`, `not_decrease` | `informational`, `should_not_decrease` |
| rollout `feature_state_value.type` | `integer`, `string`, `boolean` | (not probed) |
| warehouse `warehouse_type` | `flagsmith`, `snowflake`, `clickhouse`, `databricks`, `postgres` (source) | (not probed) |

Metric `direction` decides how `chance_to_win` is computed: `down` means lower is better. In the
run above, `task_cost` with `direction: down` and a -33% lift got `chance_to_win` 1.0.
`expected_direction` is stored and shown, but it does not enter the statistics in 2.295.2.
`flagsmith/setup.sh` and `forkbill init` check every literal they use against the target
instance's `OPTIONS` before they create anything.
