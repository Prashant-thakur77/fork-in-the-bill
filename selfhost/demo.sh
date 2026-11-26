#!/usr/bin/env bash
# Kit portability demo on the self-hosted Flagsmith from bootstrap.sh.
#
#   selfhost/demo.sh
#
# A deterministic fake agent loop (no model calls, illustrative prices, no money) run through the
# kit, entirely separate from the real study: different Flagsmith instance, identities prefixed
# `kitdemo:`, results never copied into runs/ or analysis/.
#
# 1. `forkbill init`: flag agent_routing (control policy), variant lanes_v1 with key, routing_kill,
#    the four metrics, and an experiment with the demo hypothesis, started;
# 2. `forkbill demo`: DEMO_N identities get the flag through the Python SDK (exposures) and send
#    task_cost / task_solved / task_turns / task_seconds to the self-hosted events endpoint;
# 3. exposures and results refresh, then the results payload is printed.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
# shellcheck source=../flagsmith/lib.sh
source "$ROOT/flagsmith/lib.sh"
need jq "$FS_BIN"

STATE="$HERE/.state"
[ -f "$STATE/credentials.env" ] || die "run selfhost/bootstrap.sh first"
set -a
# shellcheck disable=SC1091
source "$STATE/credentials.env"
if [ -f "$HERE/.env" ]; then
  # shellcheck disable=SC1091
  source "$HERE/.env"
fi
set +a
require_auth
ENV=$(env_key)
DEMO_N=${DEMO_N:-120}
PYTHON=${PYTHON:-$ROOT/.venv/bin/python}
if command -v forkbill >/dev/null 2>&1; then
  FORKBILL=(forkbill)
else
  FORKBILL=(env "PYTHONPATH=$ROOT/kit${PYTHONPATH:+:$PYTHONPATH}" "$PYTHON" -m forkbill.cli)
fi
P="$ROOT/flagsmith/policies"

echo "== forkbill init"
INIT_ARGS=(init --control "$P/control.json" --variant "lanes_v1=$P/lanes_v1.json"
  --metrics "$ROOT/flagsmith/metrics.json" --ids-out "$STATE/ids.json")
if [ -f "$STATE/experiment.json" ]; then
  "${FORKBILL[@]}" "${INIT_ARGS[@]}" >/dev/null
  echo "reusing experiment $(jq -r .id "$STATE/experiment.json")"
else
  "${FORKBILL[@]}" "${INIT_ARGS[@]}" --hypothesis-file "$HERE/demo-hypothesis.md" \
    --experiment-name "kit portability demo (fake loop, not study data)" --start
  jq '.experiment' "$STATE/ids.json" >"$STATE/experiment.json"
fi
EXP_ID=$(jq -r .id "$STATE/experiment.json")

echo "== forkbill demo: $DEMO_N identities through the Python SDK"
"${FORKBILL[@]}" demo --n "$DEMO_N" --prefix kitdemo \
  --api-url "$FLAGSMITH_SDK_API_URL" --events-api-url "$FLAGSMITH_EVENTS_API_URL" \
  --out "$STATE/demo-run"

echo "== stored events (warehouse connection counters)"
fs_api GET "api/v1/environments/$ENV/warehouse-connections/" \
  | jq -c '.[] | {name, status, total_events_received, unique_events_count, last_event_received_at}'

echo "== refresh exposures and results"
for what in exposures results; do
  if out=$("$FS_BIN" api "api/v1/environments/$ENV/experiments/$EXP_ID/$what/refresh/" -X POST -i 2>&1); then
    head -1 <<<"$out"
  else
    printf '%s refresh refused (one refresh per 5 minutes):\n%s\n' "$what" "$out"
  fi
done
for _ in $(seq 1 30); do
  RES=$(fs_api GET "api/v1/environments/$ENV/experiments/$EXP_ID/results/")
  [ "$(jq -r '.results.as_of // empty' <<<"$RES")" != "" ] && break
  sleep 2
done
echo "== exposures"
fs_api GET "api/v1/environments/$ENV/experiments/$EXP_ID/exposures/" | jq -c '.'
echo "== results"
jq '.' <<<"$RES"
