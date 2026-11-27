#!/usr/bin/env bash
# The same identities in more than one evaluation mode: do they get the same arm?
#
#   examples/09-compare-modes/run.sh                             # remote and local
#   examples/09-compare-modes/run.sh remote local edge edge-local   # also through an Edge Proxy
#
# `forkbill compare` reads the flag for 200 identities in each mode with get_identity_flags
# (no exposure, no event) and exits 1 unless every mode agrees. Then 20 simulated tasks run
# under local evaluation, to show the exposures still reach Flagsmith when no identity request
# does.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../common.sh
source "$HERE/../common.sh"
ensure_experiment

if [ "$#" -eq 0 ]; then MODES=(remote local); else MODES=("$@"); fi
URLS=("${SDK_URLS[@]}")
if [[ " ${MODES[*]} " == *" edge"* ]]; then
  need docker curl
  EDGE_URL=${FLAGSMITH_EDGE_API_URL:?rerun selfhost/bootstrap.sh to get FLAGSMITH_EDGE_API_URL}
  echo "== Edge Proxy (compose profile edge)"
  docker compose -f "$ROOT/selfhost/docker-compose.yml" --env-file "$ROOT/selfhost/.env" --profile edge up -d --quiet-pull edge-proxy >/dev/null 2>&1
  for _ in $(seq 1 60); do
    curl -fsS -o /dev/null "${EDGE_URL%api/v1/}proxy/health/readiness" 2>/dev/null && break
    sleep 2
  done
  curl -fsS -o /dev/null "${EDGE_URL%api/v1/}proxy/health/readiness" || die "Edge Proxy not ready"
  sleep 6 # the proxy polls the environment document every 5 s
  echo "Edge Proxy ready"
  URLS+=(--edge-url "$EDGE_URL")
fi

WORK="$HERE/work"
rm -rf "$WORK"
mkdir -p "$WORK"
ARGS=()
for m in "${MODES[@]}"; do ARGS+=(--mode "$m"); done

echo "== forkbill compare: 200 identities (ex09-compare:0000 to 0199) in ${MODES[*]}"
mark=$(event_mark)
forkbill compare "${ARGS[@]}" --n 200 --prefix ex09-compare "${URLS[@]}" | tee "$WORK/compare.json" \
  | jq '{identities, baseline, all_agree, first_disagreements, modes: (.modes | map_values({by_policy, by_variant, in_experiment, errors, same_policy_as_baseline, same_variant_as_baseline, variant_compared}))}'
expect_events "$mark" ex09-compare: 0

echo "== forkbill demo --mode local: 20 simulated identities, flags evaluated in process"
mark=$(event_mark)
forkbill demo --mode local --n 20 --prefix ex09-local "${URLS[@]}" --out "$WORK/local"
sent=$(($(jq -s 'map(select(.exposed)) | length' "$WORK/local/tasks.jsonl") + $(wc -l <"$WORK/local/events.jsonl")))
expect_events "$mark" ex09-local: "$sent"

echo "== identities Flagsmith's API has seen, by prefix (Admin API identity search)"
for prefix in ex09-compare ex09-local; do
  count=$(fs_api GET "api/v1/environments/$ENV_KEY/identities/?q=$prefix:&page_size=1" | jq -r .count)
  echo "$prefix: $count"
done
