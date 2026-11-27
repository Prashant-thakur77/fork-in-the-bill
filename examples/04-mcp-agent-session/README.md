# 04: an agent session over MCP

An agent that speaks MCP can run the loop through tools, with no Flagsmith SDK in its own code.
Here the published server, `npx -y forkbill-mcp@0.1.0`, is started as a child process and driven
over stdio by [`client.mjs`](client.mjs), a client with no dependencies that writes every
JSON-RPC message it sends or receives to a transcript.

## Run it

```sh
selfhost/bootstrap.sh                    # once, see ../README.md
examples/04-mcp-agent-session/run.sh     # 4 seconds, or about 18 the first time npx downloads the package
```

The server gets three settings from `selfhost/.state/credentials.env` and nothing else:
`FLAGSMITH_SERVER_KEY`, `FLAGSMITH_SDK_API_URL` and `FLAGSMITH_EVENTS_API_URL`. An MCP host
would carry the same three in its `mcpServers` entry
([`kit/mcp/README.md`](../../kit/mcp/README.md#self-hosted-flagsmith)).

## The session

The transcript, [`output/transcript.jsonl`](output/transcript.jsonl), has 17 messages: eight
requests, their eight replies and one notification.

| # | Request | What came back |
|---|---|---|
| 1 | `initialize` | `forkbill-mcp` 0.1.0, protocol 2025-06-18, and the server's instructions for an agent |
| 2 | `tools/list` | `get_routing_policy`, `report_outcome`, `get_kill_switch`, `explain_assignment`, `price_usage`, each with its input and output schema |
| 3 | `get_kill_switch` | `routing_kill` exists and is off |
| 4 | `get_routing_policy` for `ex04:task-0001` | variant `control`, `source: experiment`, `exposure_recorded: true`, and the policy: both lanes on `claude-sonnet-5-5` |
| 5 | `price_usage` with tokens per lane | $0.42 of the policy's $0.60 cap |
| 6 | `report_outcome` | `delivered: true` for `task_cost`, `task_solved`, `task_turns` and `task_seconds` |
| 7 | `explain_assignment` with a saved environment document | the md5 working, Flagsmith's engine's answer, and whether they match what this session was served |
| 8 | `resources/read forkbill://config` | mode, API hosts and flag names; the key shows as `set (server-side)` |

Request 7 makes no network call. `run.sh` saves the document first with
`flagsmith environment document`, and the server recomputes the arm from it. From
[`output/run.txt`](output/run.txt):

```text
1. Hashing key: <api_key>_ex04:task-0001 (the environment key, an underscore, the identity).
2. Segment experiment-2-rollout (2): md5("2,<api_key>_ex04:task-0001") = 8d7466115713ff3de53e907e7a3c7467; as an integer mod 9999 = 7919; 7919 / 9998 x 100 = 79.2058; <= 100, inside the segment.
3. Feature state used: the override from segment experiment-2-rollout, id 6, enabled, experiment 2 "examples (simulated traffic, not study data)", in_experiment true.
4. Split: md5("6,<api_key>_ex04:task-0001") = 53e507d6f892fcd30e7cdc00740997b5; as an integer mod 9999 = 6969; 6969 / 9998 x 100 = 69.7039.
5. Ranges in variant id order: lanes_v1 [0, 50), control [50, 100). 69.7039 falls in control.
Variant: control.
Flagsmith's engine: variant control (TARGETING_MATCH; segment=experiment-2-rollout). The two agree.
This session was served control for the identity: matches.
```

`run.sh` then counts what Flagsmith stored for the identity: five rows, the exposure from
request 4 and the four events from request 6.

The server never prints the environment key. In the working it appears as `<api_key>`, and the
transcript was scanned for the instance's keys before it was committed. The environment
document itself holds the client-side key, so it stays in `work/`, which is gitignored.

## What is simulated

The agent's work. No model is called: the token counts in request 5 and the outcome in request
6 (solved, 5 turns, 61.5 seconds) are fixed numbers in `client.mjs`. The price is the server's
bundled table applied to those tokens.
