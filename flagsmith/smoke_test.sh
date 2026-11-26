#!/usr/bin/env bash
# End-to-end smoke test of Flagsmith Experimentation, with a throwaway flag.
#
#   flagsmith/smoke_test.sh
#
# Creates (or reuses) flag `fib_smoke` with a keyed variant `treatment`, metric `fib_smoke_value`,
# an experiment on the flag, starts it, then has 3 identities get the flag through the Python SDK
# (recording exposures) and send one `fib_smoke_value` event each. Finally it asks for an
# exposures and a results refresh and prints both responses. Results stay in "collecting data"
# until each variation has 50 identities and 5 conversions; this test checks the plumbing.
#
# Env: FLAGSMITH_SERVER_KEY (server-side SDK key; falls back to the bound client key),
#      FLAGSMITH_SDK_API_URL (e.g. http://localhost:8000/api/v1/ when self-hosted),
#      FLAGSMITH_EVENTS_API_URL (e.g. http://localhost:8000/api/ when self-hosted),
#      PYTHON (default .venv/bin/python).
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
# shellcheck source=lib.sh
source "$HERE/lib.sh"
need "$FS_BIN" jq
require_auth

FLAG=${SMOKE_FLAG:-fib_smoke}
METRIC=${SMOKE_METRIC:-fib_smoke_value}
PYTHON=${PYTHON:-$ROOT/.venv/bin/python}
ENV=$(env_key)

echo "== flag $FLAG with keyed variant"
if ! fs_maybe feature get "$FLAG" --json >/dev/null; then
  fs feature create "$FLAG" --value control-value --enabled --description "Smoke test, safe to delete" >/dev/null
fi
LIST=$(fs feature variant list "$FLAG" --json)
if [ -z "$(jq -c '.[] | select(.key == "treatment")' <<<"$LIST")" ]; then
  fs feature variant add "$FLAG" --value treatment-value --key treatment --weight 0 >/dev/null
  LIST=$(fs feature variant list "$FLAG" --json)
fi
FEATURE_ID=$(fs feature get "$FLAG" --json | jq -r .id)
VARIANT_ID=$(jq -r '.[] | select(.key == "treatment") | .id' <<<"$LIST")
echo "feature $FEATURE_ID, variant treatment $VARIANT_ID"

echo "== metric $METRIC"
METRICS=$(fs_api GET "api/v1/environments/$ENV/experiment-metrics/?page_size=999")
METRIC_ID=$(jq -r --arg n "$METRIC" '(if type == "array" then . else .results end)[] | select(.name == $n) | .id' <<<"$METRICS" | head -1)
if [ -z "$METRIC_ID" ]; then
  BODY=$(jq -nc --arg n "$METRIC" '{name: $n, description: "Smoke test, safe to delete",
    aggregation: "mean", direction: "down", definition: {version: 1, event: $n}}')
  METRIC_ID=$(fs_api POST "api/v1/environments/$ENV/experiment-metrics/" "$BODY" | jq -r .id)
fi
echo "metric $METRIC_ID"

echo "== experiment"
EXPS=$(fs_api GET "api/v1/environments/$ENV/experiments/?page_size=999")
EXP=$(jq -c --argjson f "$FEATURE_ID" '[(if type == "array" then . else .results end)[]
  | select((.feature | if type == "object" then .id else . end) == $f and (.status == "created" or .status == "running"))][0] // empty' <<<"$EXPS")
if [ -z "$EXP" ]; then
  BODY=$(jq -nc --argjson f "$FEATURE_ID" --argjson m "$METRIC_ID" --argjson v "$VARIANT_ID" '{
    feature: $f, name: "fib smoke test",
    hypothesis: "Smoke test: exposures and events reach the results API.",
    metrics: [{metric: $m, expected_direction: "decrease"}],
    experiment_rollout: {enabled: true, rollout_percentage: 100,
      feature_state_value: {type: "string", value: "control-value"},
      multivariate_feature_state_values: [{multivariate_feature_option: $v, percentage_allocation: 50}]}}')
  EXP=$(fs_api POST "api/v1/environments/$ENV/experiments/" "$BODY")
fi
EXP_ID=$(jq -r .id <<<"$EXP")
if [ "$(jq -r .status <<<"$EXP")" = created ]; then
  fs_api POST "api/v1/environments/$ENV/experiments/$EXP_ID/start/" >/dev/null
fi
echo "experiment $EXP_ID running"

echo "== 3 identities: exposure + event via the Python SDK"
SDK_KEY=${FLAGSMITH_SERVER_KEY:-$ENV} \
SMOKE_FLAG="$FLAG" SMOKE_METRIC="$METRIC" "$PYTHON" -I - <<'PY'
import os, time
from flagsmith import Flagsmith
from flagsmith.analytics import EventProcessorConfig

cfg = EventProcessorConfig(events_api_url=os.environ["FLAGSMITH_EVENTS_API_URL"]) \
    if os.environ.get("FLAGSMITH_EVENTS_API_URL") else EventProcessorConfig()
kwargs = {"api_url": os.environ["FLAGSMITH_SDK_API_URL"]} if os.environ.get("FLAGSMITH_SDK_API_URL") else {}
fs = Flagsmith(environment_key=os.environ["SDK_KEY"], enable_events=True, event_processor_config=cfg, **kwargs)
stamp = int(time.time())
for i in range(3):
    ident = f"smoke:{stamp}:{i}"
    flag = fs.get_experiment_flag(os.environ["SMOKE_FLAG"], identifier=ident)
    fs.flush_events()
    fs.track_event(os.environ["SMOKE_METRIC"], identifier=ident, value=1.5 + i)
    fs.flush_events()
    exp = getattr(flag, "experiment", None)
    print(f"{ident}: variant={flag.variant} in_experiment={getattr(exp, 'in_experiment', None)}")
fs.close(10)
PY

echo "== refresh (Flagsmith allows one refresh per 5 minutes; a refusal is printed, not fatal)"
for what in exposures results; do
  if out=$("$FS_BIN" api "api/v1/environments/$ENV/experiments/$EXP_ID/$what/refresh/" -X POST -i 2>&1); then
    head -1 <<<"$out"
  else
    printf '%s refresh refused:\n%s\n' "$what" "$out"
  fi
done
echo "waiting 20s for the task processor"
sleep 20
echo "== exposures"
fs_api GET "api/v1/environments/$ENV/experiments/$EXP_ID/exposures/" | jq .
echo "== results"
fs_api GET "api/v1/environments/$ENV/experiments/$EXP_ID/results/" | jq .

cat <<EOT

Cleanup when done (the flag is locked while the experiment runs):
  flagsmith api api/v1/environments/<env>/experiments/$EXP_ID/complete/ -X POST -F rollout_decision=control
  flagsmith feature delete $FLAG --yes
  flagsmith api api/v1/environments/<env>/experiment-metrics/$METRIC_ID/ -X DELETE
EOT
