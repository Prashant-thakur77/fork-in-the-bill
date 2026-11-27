#!/usr/bin/env bash
# One agent session over MCP against the self-hosted Flagsmith: the published `forkbill-mcp`
# server started with npx, driven by client.mjs over stdio. Writes the JSON-RPC transcript to
# work/transcript.jsonl (examples/capture.sh points it at output/).
#
#   examples/04-mcp-agent-session/run.sh
#   MCP_IDENTITY=ex04:task-0002 examples/04-mcp-agent-session/run.sh   # another task
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../common.sh
source "$HERE/../common.sh"
need node npx
ensure_experiment

cd "$HERE"
mkdir -p work
# The document explain_assignment reads. It holds the environment's client-side key, which is an
# input to the bucketing hash, so it stays in work/ (gitignored).
fs environment document >work/environment.json
echo "saved the environment document to work/environment.json ($(jq '.feature_states | length' work/environment.json) feature states)"

mark=$(event_mark)
TRANSCRIPT=${EXAMPLE_OUTPUT_DIR:-$HERE/work}/transcript.jsonl
node client.mjs work/environment.json "$TRANSCRIPT"
# One exposure from get_routing_policy and four events from report_outcome.
expect_events "$mark" "${MCP_IDENTITY:-ex04:task-0001}" 5
echo "transcript: $(wc -l <"$TRANSCRIPT") JSON-RPC messages in ${TRANSCRIPT#"$ROOT"/}"
