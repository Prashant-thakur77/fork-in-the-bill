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
| `edge-proxy` (profile `edge`, optional) | `flagsmith/edge-proxy:2.24.0` (pinned by digest) | Edge Proxy on `127.0.0.1:8001`, serving flags from a polled copy of the environment document |

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
selfhost/demo.sh all    # the same experiment in the four evaluation modes below
```

If port 8000 is taken on your machine, set `FLAGSMITH_PORT` (and, for the proxy, `EDGE_PROXY_PORT`)
in `selfhost/.env` before the first `bootstrap.sh`.

`bootstrap.sh` writes:

- `selfhost/.env`: random secrets for Postgres, Django and warehouse credentials (gitignored).
- `selfhost/.state/credentials.env` (mode 600): `FLAGSMITH_API_URL`,
  `FLAGSMITH_API_KEY_localhost_8000` (a Master API key, which is what CLI v2 accepts for a
  self-hosted URL; CLI v2 does not accept user auth tokens), the server-side SDK key, the SDK and
  events URLs, and the dashboard admin email and password.
- `selfhost/.state/flagsmith.json`: the CLI's project and environment binding (`flagsmith init`).
- `selfhost/.state/edge.env` (mode 600): `ENVIRONMENT_KEY_PAIRS` for the Edge Proxy, the Demo
  environment's server-side key paired with its client-side key.

`selfhost/.state/` contains a `.gitignore` of `*`, so nothing in it can be committed. The scripts
print where these files are, never what is in them.

To use the instance from a shell, run `set -a; source selfhost/.state/credentials.env; set +a`.
After that, `flagsmith ...`, `flagsmith/setup.sh` and `flagsmith/smoke_test.sh` work against it.
The dashboard is at http://localhost:8000; log in as `admin@forkbill.local` with the password in
the credentials file.

## Evaluation modes: remote, local and Edge Proxy

`forkbill demo --mode MODE` (and `make_client(mode, ...)` in `kit/forkbill/client.py`,
`flagsmithConfig(mode, ...)` in `kit/ts`) runs the same experiment with the flags coming from a
different place. Exposures and task events always go to the core API (`events_api_url`), and
flag analytics, if a caller turns them on, to the core API too (`analytics_url`): the Edge Proxy
serves flags only and has no events or analytics endpoint.

| mode | flags from | key | exposure recorded |
|---|---|---|---|
| `remote` | core API, `POST /api/v1/identities/` per task | any SDK key | yes |
| `local` | environment document, evaluated in process (`enable_local_evaluation=True`) | server-side (`ser.`) | yes |
| `edge` | Edge Proxy, `POST /api/v1/identities/` per task | either key in `ENVIRONMENT_KEY_PAIRS` | **no** |
| `edge-local` | the Edge Proxy's copy of the environment document, evaluated in process | server-side | yes |

Why, from the installed sources:

- **Local evaluation records exposures (Python SDK 6.5.0 and later).** The environment document
  carries `metadata.experiment` on each feature state. The experiment's rollout is a segment
  override (`experiment-1-rollout`, a `PERCENTAGE_SPLIT` on `$.identity.key`) whose feature state
  has `in_experiment: true`, while the base feature state has `in_experiment: false`. SDK 6.5.0+
  (`mappers.py`) copies that metadata onto identity flags, so `get_experiment_flag` sees
  `experiment.in_experiment` and records the exposure exactly as it does remotely. SDK 6.3.0 has
  `get_experiment_flag` but does not copy the metadata, so it records nothing under local
  evaluation. `@flagsmith/nodejs` 9.5.0 also keeps `experiment` on locally evaluated identity flags.
- **The Edge Proxy's identity endpoint drops the experiment.** Edge Proxy 2.24.0
  (`edge_proxy/mappers.py`) answers `POST /api/v1/identities/` with `feature`, `enabled`,
  `feature_state_value` and `reason` only: no `variant`, no `metadata`. The value served is the
  right variant's value, but the SDK cannot tell that the identity is in an experiment, so
  `get_experiment_flag` records no exposure and the kit, which only reports exposed tasks, sends no
  task events. Use `edge` to serve flags, not to run an experiment.
- **`edge-local` keeps the experiment working through the proxy.** The proxy also serves
  `GET /api/v1/environment-document` to a configured server-side key, so the SDK can poll the
  proxy instead of the core API and evaluate locally, with exposures recorded as in `local`.

`selfhost/demo.sh all` starts the `edge-proxy` service, then runs `forkbill compare`, which reads
the flag for the same 200 identities in every mode with `get_identity_flags` (no exposures, no
events) and stops unless all modes serve the same policy, and the same variant key wherever both
modes report one. Then it runs `forkbill demo` once per mode, each with its own identity prefix
so no task is reported twice, and checks the stored event count against what the kit sent.

Tear down (removes the database volume):

```bash
docker compose -f selfhost/docker-compose.yml --profile edge down -v && rm -rf selfhost/.state
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

## Verified run: four evaluation modes (2026-11-27)

Host: Linux, Docker 29.2.1, Compose v5.0.2. Flagsmith image 2.295.2, Edge Proxy 2.24.0 (pulled,
digest above), Python SDK `flagsmith` 6.7.0, Flagsmith CLI v2. Port 8000 was taken by another
process on this host, so `selfhost/.env` set `FLAGSMITH_PORT=8010`; the proxy used the default
8001. Started from an empty volume (`down -v`, `rm -rf selfhost/.state`), then
`selfhost/bootstrap.sh` (65 s) and `selfhost/demo.sh all` (42 s). Keys are left out.

`forkbill compare`, the same 200 identities (`kitdemo-compare:0000` to `0199`) in each mode:

| mode | policy served | variant key reported | `in_experiment` | same policy as remote | same variant as remote |
|---|---|---|---|---|---|
| remote | control 105, lanes_v1 95 | control 105, lanes_v1 95 | 200 | 200 / 200 | 200 / 200 |
| local | control 105, lanes_v1 95 | control 105, lanes_v1 95 | 200 | 200 / 200 | 200 / 200 |
| edge | control 105, lanes_v1 95 | none (200) | 0 | 200 / 200 | not reported |
| edge-local | control 105, lanes_v1 95 | control 105, lanes_v1 95 | 200 | 200 / 200 | 200 / 200 |

`all_agree: true`, no errors. Every mode put every identity in the same arm.

`forkbill demo`, 120 identities per mode with a prefix per mode (fake loop, illustrative prices):

| mode | arms (n, all exposed) | events the kit sent | stored events |
|---|---|---|---|
| remote (`kitdemo:`) | control 67, lanes_v1 53 | 529 | 0 -> 529 |
| local (`kitdemo-local:`) | control 52, lanes_v1 68 | 545 | 529 -> 1074 |
| edge (`kitdemo-edge:`) | 120 served, 0 exposed (`flag_source: flag`) | 0 | 1074 -> 1074 |
| edge-local (`kitdemo-edge-local:`) | control 60, lanes_v1 60 | 539 | 1074 -> 1613 |

"Events the kit sent" is one exposure per exposed task plus the task events in `events.jsonl`;
every one was stored (`total_events_received: 1613`). The Admin API's identity search found 120
`kitdemo:` identities and 200 `kitdemo-compare:` identities (created by the remote reads), and
none for the `local`, `edge` and `edge-local` prefixes: those reads never reached the core API's
identities endpoint, and the Edge Proxy stores nothing.

After one refresh, the exposures endpoint returned `new_identities: {"control": 179, "lanes_v1": 181}`,
which is 67+52+60 and 53+68+60: the three exposing modes, and nothing from `edge`. Results:

| metric | control n / sum | lanes_v1 n / sum | lift | 95% interval | chance_to_win |
|---|---|---|---|---|---|
| task_cost | 179 / 92.1284 | 181 / 61.0987 | -0.344 | [-0.391, -0.298] | 1.000 |
| task_solved | 179 / 65 | 181 / 108 | +0.643 | [0.267, 1.019] | 1.000 |
| task_turns | 179 / 2377 | 181 / 2672 | +0.112 | [0.037, 0.187] | 0.998 |
| task_seconds | 179 / 23084.3 | 181 / 26310.2 | +0.127 | [0.049, 0.205] | 0.999 |

These are fake-loop numbers; they show the three exposing modes feeding one experiment, nothing
about real routing.

## Verified run: OpenFeature (2026-11-27)

Same instance, right after the four-mode run above. `forkbill demo --openfeature` puts the remote
Python SDK client behind an OpenFeature client with `FlagsmithProvider` (`openfeature-sdk` 0.9.0,
`openfeature-provider-flagsmith` 1.0.0); see `kit/forkbill/openfeature.py`. The policy is read
with `get_string_details`, the kill switch with `get_boolean_details`, and the task events are sent
with OpenFeature `track()`, all with `targeting_key` = the task's identity.

**First try, with the provider's `FlagsmithExposureHook`** (`--openfeature-exposure hook`, 40
identities `kitdemo-openfeature:*`): 25 identities resolved to `lanes_v1` and were exposed; the 15
that resolved to `control` were not. On this instance the API answers `POST /identities/` for a
control identity with `"variant": "control"`, `"reason": "TARGETING_MATCH; segment=experiment-1-rollout"`
and `in_experiment: true`, and for a treatment identity with `"reason": "SPLIT; weight=50.0"`. The
hook only records an exposure for reason `SPLIT`, so through the hook an experiment never sees its
control arm. The database got 25 exposures and 25 of each task event, all from `lanes_v1`.

**The kit's default** (`--openfeature-exposure variant`, `--experiment-id 1`, 40 identities
`kitdemo-openfeature-variant:*`): the adapter records the exposure itself with
`track("feature_flag.exposure", ctx, {"flag_key", "variant"})` whenever the routing flag resolved
to a variant. Result:

- arms: control 16, lanes_v1 24, all 40 exposed; the kit sent 183 events (40 exposures + 143 task events);
- stored rows in `experimentation_sdkexperimentationevent`: 40 `$flag_exposure` (value `control` 16,
  `lanes_v1` 24, metadata `{"experiment_id": 1}`), 40 `task_cost`, 23 `task_solved`, 40
  `task_turns`, 40 `task_seconds`; no task event under an identifier without an exposure;
- the variant OpenFeature served matched the native SDK's (local evaluation) for 40 of 40 identities.

After a refresh, the experiment's exposures read `control 195, lanes_v1 231`: the 179 / 181 of
the four-mode run, plus 16 control and 24 lanes_v1 from this run, plus the 25 lanes_v1 from the
hook run and 1 from a single-identity debugging call made while finding this. Exposures without
`experiment_id` metadata (the hook run) were counted too. `total_events_received` went from 1613
to 1920 (118 + 6 + 183). The task_cost readout stayed at lift -0.346 [-0.388, -0.304].

So an experiment run through OpenFeature with this provider should not rely on the exposure hook
alone: its control arm is never exposed. The kit's adapter tracks the exposure explicitly, which
treats any resolved variant as enrolled; that holds for an experiment at 100% rollout, as here.
An identity outside a partial rollout still resolves to variant `control` (the engine's default
bucket), so for a partial rollout use the native `get_experiment_flag` path, which checks
`experiment.in_experiment`.
