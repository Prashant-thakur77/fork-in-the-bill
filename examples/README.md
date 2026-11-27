# Examples

Nine runnable examples of putting an agent's model routing behind a Flagsmith experiment with
the kit in this repository. Each one was run against a real self-hosted Flagsmith 2.295.2 on
2026-11-27, and what it printed is committed next to it in `output/`.

None of them needs a Flagsmith Cloud account or a model API key, and none spends money.

| # | Example | What it shows | Command | Time | Real output |
|---|---|---|---|---|---|
| 01 | [Python quickstart](01-python-quickstart/README.md) | The Python kit in one file: ask Flagsmith for a task's routing policy, run the task, report the outcome | `examples/01-python-quickstart/run.sh` | 3 s | [run.txt](01-python-quickstart/output/run.txt) |
| 02 | [TypeScript quickstart](02-typescript-quickstart/README.md) | The same loop with `forkbill` 0.1.0 installed from the npm registry | `examples/02-typescript-quickstart/run.sh` | 7 s | [run.txt](02-typescript-quickstart/output/run.txt) |
| 03 | [Full experiment, self-hosted](03-full-experiment-selfhosted/README.md) | The whole method with the kit's CLI: create flag, variant, metrics and experiment, run 200 identities, read Flagsmith's results, end the experiment with a rollout decision | `examples/03-full-experiment-selfhosted/run.sh` | 20 s | [run.txt](03-full-experiment-selfhosted/output/run.txt), [results](03-full-experiment-selfhosted/output/flagsmith-results.json), [screenshot](03-full-experiment-selfhosted/output/flagsmith-experiment-results.png) |
| 04 | [MCP agent session](04-mcp-agent-session/README.md) | `npx -y forkbill-mcp` driven over stdio: list tools, get a policy, report an outcome, read the kill switch, explain the assignment offline | `examples/04-mcp-agent-session/run.sh` | 4 to 18 s | [run.txt](04-mcp-agent-session/output/run.txt), [transcript](04-mcp-agent-session/output/transcript.jsonl) |
| 05 | [OpenFeature](05-openfeature/README.md) | The same decision through the OpenFeature API with Flagsmith's provider | `examples/05-openfeature/run.sh` | 4 s | [run.txt](05-openfeature/output/run.txt) |
| 06 | [Kill switch](06-kill-switch/README.md) | `routing_kill` flipped on and off while a worker runs: tasks in between run control and leave no exposure | `examples/06-kill-switch/run.sh` | 24 s | [run.txt](06-kill-switch/output/run.txt) |
| 07 | [Verify offline](07-verify-offline/README.md) | Every arm re-derived from the environment document in Python and in TypeScript, and a wrong key caught | `examples/07-verify-offline/run.sh` | 6 s | [run.txt](07-verify-offline/output/run.txt) |
| 08 | [Verify a run in CI](08-ci-verify-run/README.md) | The repository's `verify-run` action on the study's committed run, passing and failing | `examples/08-ci-verify-run/run.sh` | 9 s | [run.txt](08-ci-verify-run/output/run.txt) |
| 09 | [Compare evaluation modes](09-compare-modes/README.md) | The same 200 identities get the same arm from the API, from local evaluation and through an Edge Proxy | `examples/09-compare-modes/run.sh` | 9 s (38 s with the proxy) | [run.txt](09-compare-modes/output/run.txt), [with the proxy](09-compare-modes/output/run-with-edge-proxy.txt) |
| | [Task transcripts](transcripts/README.md) | What a real task looks like: planner steps, worker answers, graded patch | none, they are rendered files | | [four tasks](transcripts/README.md) |

Times are wall-clock on a 16-core Linux machine that was also running another job. The
transcripts row is study data from experiment 1 and is not part of the numbered examples.

## Prerequisites

Docker with Compose v2, `jq`, `curl`, `openssl`, Python 3.12 with [uv](https://docs.astral.sh/uv/),
Node 22.18 or later, and the Flagsmith CLI v2. The runs here used Docker 29.10.1, Compose 5.8.0,
Node 22.23.5, Python 3.12.3, uv 0.10.9 and Flagsmith CLI 2.0.0.

```sh
curl -fsSL https://get.flagsmith.com | sh   # Flagsmith CLI v2
uv sync --extra openfeature                 # the kit and the OpenFeature provider
selfhost/bootstrap.sh                       # Flagsmith on 127.0.0.1:8000, about 90 seconds
```

`selfhost/bootstrap.sh` starts open-source Flagsmith with Experimentation on, creates an
environment, its keys and the warehouse connection, and writes them to
`selfhost/.state/credentials.env`. Its output from the run behind these examples is in
[`output/bootstrap.txt`](output/bootstrap.txt). [`selfhost/README.md`](../selfhost/README.md)
has the details, including what to do when port 8000 is taken.

After that, run any example in any order. Examples 01, 02, 04, 05, 06, 07 and 09 share one
running experiment on the flag `agent_routing`, which [`setup.sh`](setup.sh) creates the first
time one of them runs ([its output](output/setup.txt)). Example 03 creates its own flag and
experiment so that ending it does not stop the shared one. Example 08 needs no Flagsmith.

To stop and delete everything:

```sh
docker compose -f selfhost/docker-compose.yml --profile edge down -v && rm -rf selfhost/.state
```

## What is simulated

The tasks. No example calls a model. Where an agent would work on a task, a stand-in produces
token counts, a turn count and a solved or unsolved outcome from a random generator seeded by
the task's identity:

- [`simulated_agent.py`](simulated_agent.py) in examples 05 and 06, the same code inline in
  01, and its TypeScript twin in 02;
- the kit's `forkbill demo` command (a "deterministic fake agent loop", as its first output
  line says) in examples 03, 07 and 09;
- three fixed numbers in example 04's client.

Prices are round illustrative figures. So every dollar amount, solve rate and lift in these
outputs describes the stand-in and says nothing about real routing. The study's real numbers are
in the [main README](../README.md#results).

Everything on the Flagsmith side is real: the flag, the variant, the experiment, the arm each
identity was served, the exposures and events stored, the results Flagsmith computed and the
rollout it applied. Example 08 uses no simulated data at all: it checks the committed run of
experiment 1.

## How the outputs were captured

[`capture.sh`](capture.sh) runs an example and writes its stdout and stderr to `output/run.txt`
through a filter that replaces the instance's secrets with `<redacted>`. No output needed a
replacement: the examples print no keys, and the MCP server and `explainAssignment` show the
environment key as `<api_key>`. Nothing else in an output file was edited.

Each example that sends events ends by counting the rows Flagsmith stored for its identities,
straight from the instance's events table, and stops if the count differs from what it sent.

The two dashboard screenshots in example 03 were taken with
[`screenshots/dashboard.mjs`](screenshots/dashboard.mjs) (Playwright) through an SSH tunnel to
the machine running Flagsmith.
