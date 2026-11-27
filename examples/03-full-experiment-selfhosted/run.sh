#!/usr/bin/env bash
# The whole method on self-hosted Flagsmith, with simulated tasks and no model key:
# create the flag, variant, kill switch, metrics and experiment; start it; run 200 identities;
# pull Flagsmith's results; end the experiment with a rollout decision; read the flag afterwards.
#
#   examples/03-full-experiment-selfhosted/run.sh
#   FLAG=ex03_routing_b KILL_FLAG=ex03_kill_b examples/03-full-experiment-selfhosted/run.sh   # a second run
#
# It uses its own flag (ex03_routing) so that ending its experiment leaves the experiment on
# agent_routing, which the other examples share, running.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../common.sh
source "$HERE/../common.sh"

FLAG=${FLAG:-ex03_routing}
KILL_FLAG=${KILL_FLAG:-ex03_kill}
N=${N:-200}
P="$ROOT/flagsmith/policies"
WORK="$HERE/work"
rm -rf "$WORK"
mkdir -p "$WORK"
# Flagsmith's raw responses are kept here (examples/capture.sh points it at output/).
SAVE=${EXAMPLE_OUTPUT_DIR:-$WORK}

echo "== 1. forkbill init: flag $FLAG, variant lanes_v1, kill switch $KILL_FLAG, four metrics, experiment (started)"
forkbill init --flag "$FLAG" --kill-flag "$KILL_FLAG" \
  --control "$P/control.json" --variant "lanes_v1=$P/lanes_v1.json" \
  --metrics "$ROOT/flagsmith/metrics.json" \
  --hypothesis-file "$EXAMPLES/hypothesis.md" \
  --experiment-name "example 03: full loop (simulated traffic, not study data)" \
  --start --ids-out "$WORK/ids.json"
EXP_ID=$(jq -r .experiment.id "$WORK/ids.json")
EXP="api/v1/environments/$ENV_KEY/experiments/$EXP_ID"

echo "== 2. the experiment as Flagsmith stores it"
fs_api GET "$EXP/" | jq '{id, name, status, hypothesis, started_at, ended_at, rollout_decision,
  rollout_percentage: .experiment_rollout.rollout_percentage,
  variant_split: .experiment_rollout.multivariate_feature_state_values,
  metrics: [.metrics[] | {metric_name, aggregation, direction, expected_direction}]}'
echo "the flag while the experiment runs:"
fs flag get "$FLAG" --json \
  | jq -c '{feature, enabled, own_value: (.value | fromjson | .policy), segment_overrides, variants: [.variants[] | {key, weight}]}'

echo "== 3. forkbill demo: $N simulated identities (ex03:0000 to ex03:$(printf '%04d' $((N - 1)))) through the Python SDK"
mark=$(event_mark)
forkbill demo --n "$N" --prefix ex03 --flag "$FLAG" --kill-flag "$KILL_FLAG" "${SDK_URLS[@]}" --out "$WORK/run"
sent=$(($(jq -s 'map(select(.exposed)) | length' "$WORK/run/tasks.jsonl") + $(wc -l <"$WORK/run/events.jsonl")))
expect_events "$mark" ex03: "$sent"

echo "== 4. refresh exposures and results (Flagsmith computes them in its task processor)"
for what in exposures results; do
  reply=$("$FS_BIN" api "$EXP/$what/refresh/" -X POST -i)
  echo "$what refresh: $(head -1 <<<"$reply" | tr -d '\r')"
done
for _ in $(seq 1 60); do
  RES=$(fs_api GET "$EXP/results/")
  [ "$(jq -r '.results.as_of // empty' <<<"$RES")" != "" ] && break
  sleep 2
done
echo "== 5. Flagsmith's exposures"
fs_api GET "$EXP/exposures/" | tee "$SAVE/flagsmith-exposures.json" | jq -c '.'
echo "== 6. Flagsmith's results (time series left out here; the full response is saved as ${SAVE#"$ROOT"/}/flagsmith-results.json)"
printf '%s\n' "$RES" | jq '.' >"$SAVE/flagsmith-results.json"
jq 'del(.results.payload.exposures_timeseries) | .results.payload.metrics |= map(del(.conversions_timeseries))' <<<"$RES"

echo "== 7. the same results as a table (metric ids from step 1)"
jq -r --slurpfile ids "$WORK/ids.json" '
  ($ids[0].ids.metrics | to_entries | map({key: (.value | tostring), value: .key}) | from_entries) as $name
  | ["metric", "control n", "control mean", "lanes_v1 n", "lanes_v1 mean", "lift", "95% interval", "chance_to_win"],
    (.results.payload.metrics[]
     | [$name[.metric_id | tostring],
        .variants.control.n, (.variants.control.sum / .variants.control.n * 10000 | round / 10000),
        .variants.lanes_v1.n, (.variants.lanes_v1.sum / .variants.lanes_v1.n * 10000 | round / 10000),
        (.inference.lanes_v1.lift * 1000 | round / 1000),
        "[\(.inference.lanes_v1.ci_low * 1000 | round / 1000), \(.inference.lanes_v1.ci_high * 1000 | round / 1000)]",
        (.inference.lanes_v1.chance_to_win * 1000 | round / 1000)])
  | @tsv' <<<"$RES" | column -t -s $'\t'

echo "== 8. decision rule (fixed before the run, see README.md)"
COST_ID=$(jq -r .ids.metrics.task_cost "$WORK/ids.json")
SOLVED_ID=$(jq -r .ids.metrics.task_solved "$WORK/ids.json")
ctw() { jq -r --argjson id "$1" '.results.payload.metrics[] | select(.metric_id == $id) | .inference.lanes_v1.chance_to_win // "null"' <<<"$RES"; }
COST_CTW=$(ctw "$COST_ID")
SOLVED_CTW=$(ctw "$SOLVED_ID")
if jq -en --argjson c "$COST_CTW" --argjson s "$SOLVED_CTW" '$c != null and $s != null and $c >= 0.95 and $s >= 0.05' >/dev/null; then
  DECISION=lanes_v1
else
  DECISION=control
fi
echo "task_cost chance_to_win $COST_CTW (needs >= 0.95), task_solved chance_to_win $SOLVED_CTW (needs >= 0.05): roll out $DECISION"

echo "== 9. end the experiment with that rollout decision"
# The Admin API takes rollout_decision=control, or rollout_decision=variant with the id of the
# variant to roll out (rollout_variant). A variant's key is not accepted here.
if [ "$DECISION" = control ]; then
  COMPLETE=(-F rollout_decision=control)
else
  COMPLETE=(-F rollout_decision=variant -F "rollout_variant=$(jq -r --arg f "$FLAG" --arg k "$DECISION" '.ids.variants[$f][$k]' "$WORK/ids.json")")
fi
echo "flagsmith api <experiment>/complete/ -X POST ${COMPLETE[*]}"
"$FS_BIN" api "$EXP/complete/" -X POST "${COMPLETE[@]}" \
  | jq '{id, name, status, started_at, ended_at, rollout_decision, rollout_variant}'

echo "== 10. the flag afterwards"
fs flag get "$FLAG" --json \
  | jq '{feature, enabled, own_value: (.value | fromjson | .policy), segment_overrides, variants: [.variants[] | {key, weight}]}'
echo "five new identities, read with the SDK the same way as in step 3:"
forkbill demo --n 5 --prefix ex03-after --flag "$FLAG" --kill-flag "$KILL_FLAG" "${SDK_URLS[@]}" --out "$WORK/after" >/dev/null
jq -r '[.identity, "policy=" + .policy.policy, "delegate=" + .policy.delegate.model, "variant=" + (.variant | tostring), "flag_source=" + .flag_source, "exposed=" + (.exposed | tostring)] | join("  ")' "$WORK/after/tasks.jsonl"
