#!/usr/bin/env bash
# Kit portability demo on the self-hosted Flagsmith from bootstrap.sh.
#
#   selfhost/demo.sh                 # remote evaluation only
#   selfhost/demo.sh all             # remote, local, edge and edge-local
#   selfhost/demo.sh remote local    # any subset of the modes, in order
#
# A deterministic fake agent loop (no model calls, illustrative prices, no money) run through the
# kit, entirely separate from the real study: different Flagsmith instance, identities prefixed
# `kitdemo`, results never copied into runs/ or analysis/.
#
# Modes (see kit/forkbill/client.py):
#   remote      flags from the core API (POST /api/v1/identities/)
#   local       flags evaluated in process from the environment document (server-side key)
#   edge        flags from the Edge Proxy (compose profile `edge`, POST /api/v1/identities/)
#   edge-local  flags evaluated in process from the Edge Proxy's copy of the environment document
# Events always go to the core API. The edge modes start the `edge-proxy` service.
#
# 1. `forkbill init`: flag agent_routing (control policy), variant lanes_v1 with key, routing_kill,
#    the four metrics, and an experiment with the demo hypothesis, started;
# 2. with more than one mode, `forkbill compare` reads the flag for the same DEMO_COMPARE_N
#    identities in every mode (no exposures, no events) and stops unless every mode agrees;
# 3. `forkbill demo` per mode: DEMO_N identities (prefix `kitdemo` for remote, `kitdemo-<mode>`
#    otherwise) get the flag through the Python SDK and send task_cost / task_solved / task_turns /
#    task_seconds to the self-hosted events endpoint; the stored event count is printed after each;
# 4. exposures and results refresh, then the results payload is printed.
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
DEMO_COMPARE_N=${DEMO_COMPARE_N:-200}
ALL_MODES=(remote local edge edge-local)
if [ "$#" -eq 0 ]; then
  MODES=(remote)
elif [ "$*" = all ]; then
  MODES=("${ALL_MODES[@]}")
else
  MODES=("$@")
fi
for m in "${MODES[@]}"; do
  case " ${ALL_MODES[*]} " in *" $m "*) ;; *) die "unknown mode $m (expected: ${ALL_MODES[*]} or all)" ;; esac
done
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

URLS=(--api-url "$FLAGSMITH_SDK_API_URL" --events-api-url "$FLAGSMITH_EVENTS_API_URL")
if [[ " ${MODES[*]} " == *" edge"* ]]; then
  EDGE_URL=${FLAGSMITH_EDGE_API_URL:-http://localhost:${EDGE_PROXY_PORT:-8001}/api/v1/}
  [ -f "$STATE/edge.env" ] || die "no $STATE/edge.env: rerun selfhost/bootstrap.sh"
  echo "== Edge Proxy (compose profile edge)"
  docker compose -f "$HERE/docker-compose.yml" --env-file "$HERE/.env" --profile edge up -d --quiet-pull edge-proxy
  printf 'waiting for %sproxy/health/readiness ' "${EDGE_URL%api/v1/}"
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "${EDGE_URL%api/v1/}proxy/health/readiness" 2>/dev/null; then break; fi
    printf '.'
    sleep 2
  done
  curl -fsS -o /dev/null "${EDGE_URL%api/v1/}proxy/health/readiness" || die " Edge Proxy not ready; see: docker compose -f selfhost/docker-compose.yml --profile edge logs edge-proxy"
  echo " ready"
  # The proxy polls every 5 s; give it one poll to pick up the experiment created above.
  sleep 6
  URLS+=(--edge-url "$EDGE_URL")
fi

stored_events() {
  fs_api GET "api/v1/environments/$ENV/warehouse-connections/" | jq -r '.[0].total_events_received // 0'
}

if [ "${#MODES[@]}" -gt 1 ]; then
  echo "== forkbill compare: the same $DEMO_COMPARE_N identities in ${MODES[*]} (no exposures, no events)"
  COMPARE_ARGS=()
  for m in "${MODES[@]}"; do COMPARE_ARGS+=(--mode "$m"); done
  "${FORKBILL[@]}" compare "${COMPARE_ARGS[@]}" --n "$DEMO_COMPARE_N" --prefix kitdemo-compare "${URLS[@]}" \
    | tee "$STATE/compare.json" | jq -c '{identities, all_agree, modes: (.modes | map_values({by_variant, by_policy, in_experiment, same_policy_as_baseline, same_variant_as_baseline, variant_compared}))}'
fi

total=$(stored_events)
for m in "${MODES[@]}"; do
  prefix=kitdemo
  [ "$m" = remote ] || prefix="kitdemo-$m"
  echo "== forkbill demo --mode $m: $DEMO_N identities ($prefix:*) through the Python SDK"
  "${FORKBILL[@]}" demo --mode "$m" --n "$DEMO_N" --prefix "$prefix" "${URLS[@]}" --out "$STATE/demo-$m"
  # What the kit sent: one exposure per exposed task, plus every task event it logged.
  sent=$(( $(jq -s 'map(select(.exposed)) | length' "$STATE/demo-$m/tasks.jsonl") + $(wc -l <"$STATE/demo-$m/events.jsonl") ))
  expected=$((total + sent))
  # The counter is updated as events are written and can trail (or read stale) for a moment.
  for _ in $(seq 1 15); do
    stored=$(stored_events)
    [ "$stored" -ge "$expected" ] && break
    sleep 2
  done
  echo "events sent by the kit: $sent; stored events: $total -> $stored (+$((stored - total)))"
  total=$stored
done

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
