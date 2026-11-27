# forkbill-mcp

An MCP server that puts an agent's model routing behind a Flagsmith experiment. The agent asks
the server which models to use for a task, Flagsmith picks the arm, the agent reports how the
task ended, and anyone can later re-derive the arm offline from a saved environment document.

It is the [Fork in the Bill](https://forkbill.prashantthakur.dev) experiment loop as tools: that
project ran a pre-registered A/B test on a coding agent's routing (planning on a large model,
grunt work on a small one) and measured dollars per solved task. This server lets any agent that
speaks MCP run the same kind of test on its own routing. All of the logic comes from the
[`forkbill`](https://www.npmjs.com/package/forkbill) kit; the server adds the MCP surface and
checks that Flagsmith accepted what was sent.

The server never chooses an arm. If Flagsmith cannot serve a valid policy, the tool returns
Flagsmith's error and no models.

## Run it

Node 22 or later. The server speaks MCP over stdio, so an MCP client starts it:

```json
{
  "mcpServers": {
    "forkbill": {
      "command": "npx",
      "args": ["-y", "forkbill-mcp"],
      "env": {
        "FLAGSMITH_SERVER_KEY": "<your environment key>"
      }
    }
  }
}
```

That block works in any MCP client that reads the usual `mcpServers` configuration. Keep the key
in the client's configuration or secret store, not in a file you commit.

Flagsmith needs four things before the first task: a multivariate flag whose value is a routing
policy (`agent_routing`), a keyed variant per arm, the four metrics, and a running experiment on
the flag. The repository's `forkbill init` command creates all of them from policy files; see
[Use the kit on your own agent](https://github.com/Prashant-thakur77/fork-in-the-bill#use-the-kit-on-your-own-agent).
A boolean flag named `routing_kill` is the kill switch.

## Tools

| Tool | What it does | Talks to Flagsmith |
|---|---|---|
| `get_routing_policy` | Returns the routing policy for one task and records the exposure. | yes |
| `report_outcome` | Sends the task's cost, solve, turns and seconds as metric events. | yes |
| `get_kill_switch` | Reads the kill switch flag. | yes, one read |
| `explain_assignment` | Re-derives an identity's arm from a saved environment document and shows the working. | no |
| `price_usage` | Turns token counts into dollars with the pricing table. | no |

### get_routing_policy

Input: `identity` (one per task), optional `traits`, optional `fallback_policy`.

The server reads the kill switch, then calls the SDK's `getExperimentFlag` for the routing flag,
which records the exposure when the identity is enrolled in a running experiment. The exposure is
flushed at once. The result has the policy (model, token limit and effort for the `main` and
`delegate` lanes, the per-task caps for turns, dollars and seconds, and `prompt_variant`), the
`variant` key, `from_experiment`, and `exposure_recorded`, which is true only when Flagsmith's
events API accepted the exposure. `source` says how the policy was chosen: `experiment`, `flag`
(no experiment enrols this identity), `kill_switch` or `fail_closed`.

It is an error, with Flagsmith's own message in it, when the kill switch or the flag cannot be
read, when the flag's value is not a valid policy, and when the exposure was not accepted. No
policy comes back in those cases. The one exception is `fallback_policy`: pass a complete policy
and the server returns it for an unreadable or invalid flag and for the kill switch, marked
`source: "fail_closed"` with the reason in `fail_reason`. Without it, the kill switch serves the
flag's own environment value, which is the control arm.

A second call for the same identity in one session returns the first answer and does not ask
Flagsmith again, so a task cannot be exposed twice or change arm.

### report_outcome

Input: `identity`, `cost_usd`, `solved`, `turns`, `seconds`, optional
`exposure_recorded_elsewhere`.

Sends `task_cost`, `task_turns` and `task_seconds` for every task and `task_solved` (value 1)
only when `solved` is true, each flushed before the next, with the same identifier as the
exposure. These are the events the study's harness sends. Report unsolved and capped tasks too:
leaving them out makes an arm look cheaper than it is.

Nothing is sent for an identity that was not exposed (kill switch on, no running experiment), and
the result says so. A second report for the same identity is refused, because it would count the
task twice. If the server restarted between the two calls it no longer knows about the exposure;
set `exposure_recorded_elsewhere` to true to send anyway. The result lists the events Flagsmith
accepted and the call is an error if any was refused.

### get_kill_switch

No input. Reads `routing_kill` at environment level and returns `enabled`. When the switch is on,
`get_routing_policy` serves the control policy and records no exposure, so tasks keep running but
stay out of the experiment's data.

### explain_assignment

Input: `identity`, and either `environment_document_path` or `environment_document` (the JSON
that `flagsmith environment document` prints), plus optional `flag`, `traits` and
`expected_variant`.

Flagsmith buckets by hashing, so the arm an identity gets is fixed by the environment document.
The tool recomputes it the way `integrity/verify_assignment.py` does and prints each step: the
hashing key, the md5 of every segment check, the remainder mod 9999, the percentage, the feature
state chosen, the md5 of the split and the range it lands in. It then evaluates the same document
with Flagsmith's own engine (the SDK in offline mode) and reports whether the two agree. With
`expected_variant`, or when the identity was assigned in this session, it also says whether that
matches.

It needs no key and makes no request. The environment key inside the document is never printed;
hash inputs show `<api_key>` in its place. The md5 recomputation covers percentage-split
segments, which is what an experiment rollout uses. For a document with other segment rules the
working is left out and the engine's answer is reported.

### price_usage

Input: `calls`, a list of token counts (`input_tokens`, `output_tokens`, `cache_write_5m_tokens`,
`cache_write_1h_tokens`, `cache_read_tokens`), each with a `model` or a `lane`; optional
`identity`.

Returns dollars per call, per lane and in total, rounded to six places as `task_cost` is. With
`identity`, a call that names only a lane is priced with that task's policy, and the total is
compared with the policy's `usd_per_task` cap. Prices are flat per-token rates; a higher tier that
a provider charges above some prompt length is not applied.

## Resources and prompt

| URI | Contents |
|---|---|
| `forkbill://pricing` | The pricing table in use, its source and the date it was checked. |
| `forkbill://config` | Mode, API hosts, flag names and whether exposures are recorded. The key shows as set or not set. |
| `forkbill://routing-policy` | The policy format field by field, with an example. |

The prompt `route_behind_experiment` (arguments `agent` and `identity_scheme`, both optional)
gives an agent the whole loop as instructions: one identity per task, the policy before the first
model call, the outcome after the last, and what to do when Flagsmith fails.

## Environment variables

Configuration is by environment variable only. The names are the ones the rest of the kit uses.

| Variable | Meaning | Default |
|---|---|---|
| `FLAGSMITH_SERVER_KEY` | Flagsmith environment key. `FLAGSMITH_ENVIRONMENT_KEY` is read if this is not set. The local modes need a server-side key (`ser.`). | none |
| `FLAGSMITH_SDK_API_URL` | SDK API base of a self-hosted Flagsmith, ending in `/api/v1/`. `FLAGSMITH_API_URL_SDK` is read too. | Flagsmith Cloud |
| `FLAGSMITH_EVENTS_API_URL` | Events API base, ending in `/api/`. Required whenever the line above is set. | Flagsmith Cloud |
| `FLAGSMITH_EDGE_API_URL` | Edge Proxy SDK base, for the `edge` and `edge-local` modes. | none |
| `FORKBILL_MODE` | `remote`, `local`, `edge` or `edge-local`. | `remote` |
| `FORKBILL_FLAG` | Name of the routing flag. | `agent_routing` |
| `FORKBILL_KILL_FLAG` | Name of the kill switch flag. `none` turns the check off. | `routing_kill` |
| `FORKBILL_PRICING_FILE` | Path of a pricing table to use in place of the built-in one. | built-in |
| `FORKBILL_REQUEST_TIMEOUT_SECONDS` | Timeout of a flag read. | 10 |
| `FORKBILL_RETRIES` | Retries of a flag read after a network error. | 3 |
| `FORKBILL_LOG_LEVEL` | `debug`, `info`, `warn`, `error` or `silent`. | `warn` |

Logs go to stderr as JSON lines. The key is never logged and is stripped from every tool result
and error before it leaves the server.

With no key set, the server still starts: `explain_assignment` and `price_usage` work, and the
other three tools return an error that names the variable to set.

A pricing table is JSON shaped like this, in US dollars per million tokens:

```json
{
  "checked_on": "2026-11-27",
  "models": {
    "<model id>": { "input": 2.0, "output": 10.0, "cache_write_5m": 2.5, "cache_write_1h": 4.0, "cache_read": 0.1 }
  }
}
```

### Evaluation modes

| Mode | Flags come from | Exposure recorded |
|---|---|---|
| `remote` | the core API, one identity request per read | yes |
| `local` | the environment document, evaluated in the server process | yes |
| `edge` | an Edge Proxy's identity endpoint | no |
| `edge-local` | the Edge Proxy's copy of the environment document, evaluated in process | yes |

An Edge Proxy identity response carries no variant and no experiment, so in `edge` mode the right
value is served but nothing is exposed and `report_outcome` sends nothing. Use `edge-local` to
run an experiment through a proxy. Events always go to the core API.

## A worked example

One task, start to finish. The output below is from the server running against the test
suite's local stand-in for Flagsmith, with some of the JSON trimmed.

The agent asks for the policy:

```text
get_routing_policy {"identity": "task:0002", "traits": {"repo": "acme/widgets", "language": "go"}}
```

```json
{
  "identity": "task:0002",
  "flag": "agent_routing",
  "variant": "lanes_v1",
  "source": "experiment",
  "from_experiment": true,
  "exposure_recorded": true,
  "policy": {
    "policy": "lanes_v1",
    "schema": 1,
    "main": { "model": "claude-sonnet-5-5", "max_tokens": 8000, "cache": true, "effort": "medium" },
    "delegate": { "model": "claude-haiku-5-5", "max_tokens": 2048, "max_context_tokens": 24000, "effort": "low" },
    "caps": { "turns": 40, "usd_per_task": 0.6, "seconds": 1200 },
    "prompt_variant": "delegate_v1"
  },
  "fail_reason": null,
  "reused": false,
  "note": "Run the task with these models and caps, then call report_outcome once with the same identity."
}
```

It runs the task with those two models, counting tokens per lane, and prices them:

```text
price_usage {"identity": "task:0002", "calls": [
  {"lane": "main", "input_tokens": 20000, "output_tokens": 2000},
  {"lane": "delegate", "input_tokens": 150000, "output_tokens": 6000}]}
```

```json
{
  "calls": [
    { "lane": "main", "model": "claude-sonnet-5-5", "tokens": 22000, "usd": 0.06 },
    { "lane": "delegate", "model": "claude-haiku-5-5", "tokens": 156000, "usd": 0.018 }
  ],
  "total_tokens": 178000,
  "total_usd": 0.078,
  "cap_usd": 0.6,
  "over_budget": false
}
```

When the task ends it reports the outcome:

```text
report_outcome {"identity": "task:0002", "cost_usd": 0.078, "solved": true, "turns": 5, "seconds": 61.5}
```

```json
{
  "identity": "task:0002",
  "variant": "lanes_v1",
  "events": [
    { "event": "task_cost", "value": 0.078 },
    { "event": "task_solved", "value": 1 },
    { "event": "task_turns", "value": 5 },
    { "event": "task_seconds", "value": 61.5 }
  ],
  "delivered": true,
  "note": "Flagsmith accepted 4 events for variant lanes_v1."
}
```

Later, someone checks the assignment against the saved environment document:

```text
explain_assignment {"identity": "task:0002", "environment_document_path": "kit/ts/test/fixtures/environment.json"}
```

```text
agent_routing for identity task:0002
1. Hashing key: <api_key>_task:0002 (the environment key, an underscore, the identity).
2. Segment experiment-1-rollout (7001): md5("7001,<api_key>_task:0002") = d81ced072a3f61c08058fa520d713015; as an integer mod 9999 = 4484; 4484 / 9998 x 100 = 44.8490; <= 60, inside the segment.
3. Feature state used: the override from segment experiment-1-rollout, id 9002, enabled, experiment 1 "fixture experiment", in_experiment true.
4. Split: md5("9002,<api_key>_task:0002") = c9f94df4b39dfb8ed396747f3b529d26; as an integer mod 9999 = 658; 658 / 9998 x 100 = 6.5813.
5. Ranges in variant id order: lanes_v1 [0, 30), lanes_v2 [30, 60), control [60, 100). 6.5813 falls in lanes_v1.
Variant: lanes_v1.
Flagsmith's engine: variant lanes_v1 (SPLIT; weight=30). The two agree.
This session was served lanes_v1 for the identity: matches.
```

And when Flagsmith is down, the next task gets an error instead of a guess:

```text
get_routing_policy {"identity": "task:0003"}

Flagsmith did not serve a routing policy for "task:0003": kill switch "routing_kill" unreadable:
getIdentityFlags failed and no default flag handler was provided: Invalid request made to
Flagsmith API. Response status code: 503. No arm was chosen and no policy was substituted. Fix
the cause and call again, or pass fallback_policy to say what to run when Flagsmith is unavailable.
```

## Self-hosted Flagsmith

The repository's [`selfhost/`](https://github.com/Prashant-thakur77/fork-in-the-bill/tree/main/selfhost)
folder brings up open-source Flagsmith with Experimentation on `127.0.0.1:8000` from a
docker-compose file and creates the flag, the variant, the kill switch, the metrics and a running
experiment:

```sh
selfhost/bootstrap.sh   # compose up, environment, keys, warehouse
selfhost/demo.sh        # forkbill init + start the experiment
```

`bootstrap.sh` writes `selfhost/.state/credentials.env` with `FLAGSMITH_SERVER_KEY`,
`FLAGSMITH_SDK_API_URL` and `FLAGSMITH_EVENTS_API_URL`, the names this server reads. Start the
server with that file loaded:

```sh
set -a; source selfhost/.state/credentials.env; set +a
npx -y forkbill-mcp
```

or put the same three values in the client's configuration:

```json
{
  "mcpServers": {
    "forkbill": {
      "command": "npx",
      "args": ["-y", "forkbill-mcp"],
      "env": {
        "FLAGSMITH_SERVER_KEY": "<server-side key from credentials.env>",
        "FLAGSMITH_SDK_API_URL": "http://localhost:8000/api/v1/",
        "FLAGSMITH_EVENTS_API_URL": "http://localhost:8000/api/"
      }
    }
  }
}
```

The server refuses to start talking to Flagsmith if the SDK URL is set without the events URL.
The SDK would otherwise send exposures and events to Flagsmith Cloud's events API while reading
flags from yours. For the Edge Proxy (`selfhost/demo.sh all` starts one on port 8001), add
`FORKBILL_MODE=edge-local` and `FLAGSMITH_EDGE_API_URL=http://localhost:8001/api/v1/`.

To check an assignment, save the document with `flagsmith environment document > env.json` and
pass its path to `explain_assignment`.

This path was run on 2026-11-27 against the `selfhost/` instance (Flagsmith 2.295.2), with the
built server on stdio: 8 identities in `remote` mode and 8 in `local` mode. Flagsmith stored 16
exposures and 56 task events, which is every one the server reported as accepted, and
`explain_assignment` re-derived the arm Flagsmith had served for all 16 from the instance's
environment document.

## Use it as a library

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createForkbillServer } from "forkbill-mcp";

const app = createForkbillServer({ env: process.env });
await app.server.connect(new StdioServerTransport());
```

`createForkbillServer` also takes a `fetch`, which is how the tests put a fake Flagsmith under
the real SDK.

## Develop and test

The package lives in `kit/mcp` of the repository, in an npm workspace with the kit:

```sh
cd kit
npm ci
npm run build --workspace forkbill   # the server imports the built kit
npm test --workspace forkbill-mcp
```

The tests never reach a real Flagsmith. The unit tests run every tool through the MCP protocol
in process, with the real `@flagsmith/nodejs` client and a fake HTTP layer underneath, and fail
if a request goes anywhere else. The end-to-end test starts the built server over stdio and
points it at a fake HTTP server on `127.0.0.1`. The bucketing tests compare against values written
by the Python implementation (`kit/ts/test/fixtures/make_fixtures.py`), and one test re-derives
every arm recorded in the repository's committed experiment run from its saved snapshot.

## Licence

MIT.
