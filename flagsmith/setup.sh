#!/usr/bin/env bash
# Idempotent Flagsmith setup for the real experiment, through the Flagsmith CLI v2.
#
#   flagsmith/setup.sh [variant-key ...]      (default: lanes_v1)
#
# Creates, or checks if they already exist with the same definition:
#   - `agent_routing`, multivariate, enabled, value = policies/control.json
#   - one keyed variant per argument, value = policies/<key>.json, weight 0
#   - `routing_kill`, boolean, off
#   - the metrics in metrics.json
# and writes the ids to flagsmith/ids.json. It does not create or start an experiment
# (create_experiment.sh / start_experiment.sh do that).
#
# Needs: `flagsmith login` (or a master key in the environment) and `flagsmith init` in the repo
# root, plus jq. Never prints a key; stops with Flagsmith's exact error on any failure.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$HERE/lib.sh"
need "$FS_BIN" jq
require_auth

FLAG=${FLAG:-agent_routing}
KILL_FLAG=${KILL_FLAG:-routing_kill}
POLICIES=${POLICIES:-$HERE/policies}
METRICS=${METRICS:-$HERE/metrics.json}
IDS_OUT=${IDS_OUT:-$HERE/ids.json}
VARIANTS=("$@")
[ ${#VARIANTS[@]} -gt 0 ] || VARIANTS=(lanes_v1)

ENV=$(env_key)
echo "== preflight: metric literals offered by this instance"
preflight_literals "$ENV" "$METRICS"
echo "ok"

echo "== warehouse"
WH=$(fs_api GET "api/v1/environments/$ENV/warehouse-connections/")
WH=$(jq -c 'if type == "array" then . else .results end | map({warehouse_type, status, name})' <<<"$WH")
if [ "$WH" = "[]" ]; then
  echo "warning: no warehouse connection on this environment; results need one (Cloud: managed warehouse)"
else
  echo "$WH"
fi


echo "== flag $FLAG"
CONTROL=$(policy_json "$POLICIES" control)
rc=0
FEATURE=$(fs_maybe feature get "$FLAG" --json) || rc=$?
[ "$rc" -eq 0 ] || [ "$rc" -eq 3 ] || exit "$rc"
if [ "$rc" -eq 3 ]; then
  fs feature create "$FLAG" --value "$CONTROL" --enabled \
    --description "Routing policy JSON for the agent's main and delegate lanes" >/dev/null
  FEATURE=$(fs feature get "$FLAG" --json)
  echo "created"
else
  same_json "$(jq -r '.default_value' <<<"$FEATURE")" "$CONTROL" \
    || die "$FLAG exists with a value different from policies/control.json; refusing to change it"
  echo "exists with the control value"
fi

for KEY in "${VARIANTS[@]}"; do
  VALUE=$(policy_json "$POLICIES" "$KEY")
  LIST=$(fs feature variant list "$FLAG" --json)
  HAVE=$(jq -c --arg k "$KEY" '[.[] | select(.key == $k)][0] // empty' <<<"$LIST")
  if [ -z "$HAVE" ]; then
    fs feature variant add "$FLAG" --value "$VALUE" --key "$KEY" --weight 0 >/dev/null
    echo "variant $KEY: created"
  else
    same_json "$(jq -r '.value' <<<"$HAVE")" "$VALUE" \
      || die "variant $KEY of $FLAG exists with a value different from policies/$KEY.json"
    echo "variant $KEY: exists with the same value"
  fi
done

echo "== flag $KILL_FLAG"
if fs_maybe feature get "$KILL_FLAG" --json >/dev/null; then
  echo "exists (state left as it is)"
else
  fs feature create "$KILL_FLAG" \
    --description "On: every task runs the control policy and records no exposure" >/dev/null
  echo "created, off"
fi
KILL=$(fs feature get "$KILL_FLAG" --json)

echo "== metrics"
EXISTING=$(fs_api GET "api/v1/environments/$ENV/experiment-metrics/?page_size=999")
EXISTING=$(jq -c 'if type == "array" then . else .results end' <<<"$EXISTING")
METRIC_IDS='{}'
while IFS= read -r SPEC; do
  NAME=$(jq -r .name <<<"$SPEC")
  BODY=$(jq -c '{name, description: (.description // ""), aggregation, direction,
                 definition: {version: 1, event}}' <<<"$SPEC")
  HAVE=$(jq -c --arg n "$NAME" '[.[] | select(.name == $n)][0] // empty' <<<"$EXISTING")
  if [ -z "$HAVE" ]; then
    ID=$(fs_api POST "api/v1/environments/$ENV/experiment-metrics/" "$BODY" | jq -r .id)
    echo "$NAME: created ($ID)"
  else
    MATCH=$(jq -n --argjson a "$HAVE" --argjson b "$BODY" \
      '$a.aggregation == $b.aggregation and $a.direction == $b.direction
       and $a.definition.event == $b.definition.event')
    [ "$MATCH" = true ] || die "metric $NAME exists with a different definition: $(jq -c '{aggregation, direction, definition}' <<<"$HAVE")"
    ID=$(jq -r .id <<<"$HAVE")
    echo "$NAME: exists ($ID)"
  fi
  METRIC_IDS=$(jq -c --arg n "$NAME" --argjson id "$ID" '. + {($n): $id}' <<<"$METRIC_IDS")
done < <(jq -c '.metrics[]' "$METRICS")

LIST=$(fs feature variant list "$FLAG" --json)
jq -n \
  --arg flag "$FLAG" --arg kill "$KILL_FLAG" \
  --argjson feature "$FEATURE" --argjson killf "$KILL" --argjson variants "$LIST" \
  --argjson metrics "$METRIC_IDS" --arg api "${FLAGSMITH_API_URL:-https://api.flagsmith.com}" \
  '{api_url: $api,
    features: {($flag): $feature.id, ($kill): $killf.id},
    variants: {($flag): ($variants | map(select(.key != null) | {(.key): .id}) | add // {})},
    metrics: $metrics}' >"$IDS_OUT"
echo "== ids written to ${IDS_OUT#"$PWD"/}"
cat "$IDS_OUT"
