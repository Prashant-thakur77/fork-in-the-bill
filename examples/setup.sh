#!/usr/bin/env bash
# Create what examples 01, 02 and 04 to 08 share on the self-hosted Flagsmith, once:
# the flag agent_routing (control policy), its keyed variant lanes_v1, the kill switch
# routing_kill, the four metrics and a running 50/50 experiment.
#
#   examples/setup.sh
#
# Safe to run again: `forkbill init` reuses what exists, and a running experiment is kept.
# It shares selfhost/.state/experiment.json with selfhost/demo.sh, so either script can go first.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=common.sh
source "$HERE/common.sh"

P="$ROOT/flagsmith/policies"
INIT=(init --control "$P/control.json" --variant "lanes_v1=$P/lanes_v1.json"
  --metrics "$ROOT/flagsmith/metrics.json" --ids-out "$STATE/ids.json")
if [ -f "$STATE/experiment.json" ]; then
  forkbill "${INIT[@]}" >/dev/null
else
  forkbill "${INIT[@]}" --hypothesis-file "$HERE/hypothesis.md" \
    --experiment-name "examples (simulated traffic, not study data)" --start >/dev/null
  jq '.experiment' "$STATE/ids.json" >"$STATE/experiment.json"
fi
EXP_ID=$(jq -r .id "$STATE/experiment.json")
STATUS=$(fs_api GET "api/v1/environments/$ENV_KEY/experiments/$EXP_ID/" | jq -r .status)
[ "$STATUS" = running ] || die "experiment $EXP_ID is $STATUS, not running: tear the instance down and bootstrap again"
echo "experiment $EXP_ID on agent_routing is running (control against lanes_v1)"
