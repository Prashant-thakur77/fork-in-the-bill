#!/usr/bin/env bash
# Create (not start) an experiment from a template and a pre-registration file.
#
#   flagsmith/create_experiment.sh flagsmith/experiment-1.json prereg/experiment-1.md
#
# The hypothesis is the text between <!-- hypothesis:start --> and <!-- hypothesis:end --> in
# the prereg file, so the experiment's `hypothesis` field matches the hashed prereg word for word.
# Ids come from flagsmith/ids.json (setup.sh). Prints the experiment id and status.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$HERE/lib.sh"
need "$FS_BIN" jq
require_auth

[ $# -eq 2 ] || die "usage: $0 <experiment-N.json> <prereg/experiment-N.md>"
TEMPLATE=$1
PREREG=$2
IDS=${IDS:-$HERE/ids.json}
POLICIES=${POLICIES:-$HERE/policies}
[ -f "$IDS" ] || die "$IDS not found; run flagsmith/setup.sh first"

ENV=$(env_key)
BODY=$(render_experiment "$TEMPLATE" "$IDS" "$POLICIES" "$PREREG")

# The rollout's control value must be the flag's current value: control is the flag's own value.
FLAG_ID=$(jq -r .feature <<<"$BODY")
FLAG_NAME=$(jq -r --argjson id "$FLAG_ID" '.features | to_entries[] | select(.value == $id) | .key' "$IDS")
# the environment value, not the project default: after a rollout the winner is the environment value
CURRENT=$(fs flag get "$FLAG_NAME" --json | jq -r .value)
WANT=$(jq -r .experiment_rollout.feature_state_value.value <<<"$BODY")
same_json "$CURRENT" "$WANT" \
  || die "the template's control value differs from the current value of $FLAG_NAME; check which policy is control"

# Flagsmith requires every variant of the flag in the rollout ("Must include all feature's
# variants."). Variants the template does not name are added at 0% and listed here.
VARIANTS=$(fs feature variant list "$FLAG_NAME" --json)
MISSING=$(jq -c --argjson body "$BODY" '[.[] | select(.id as $id
  | ($body.experiment_rollout.multivariate_feature_state_values | map(.multivariate_feature_option) | index($id)) == null)]' <<<"$VARIANTS")
if [ "$(jq length <<<"$MISSING")" -gt 0 ]; then
  echo "adding variants not in the template at 0%: $(jq -r 'map(.key // .id | tostring) | join(", ")' <<<"$MISSING")"
  BODY=$(jq -c --argjson m "$MISSING" '.experiment_rollout.multivariate_feature_state_values +=
    ($m | map({multivariate_feature_option: .id, percentage_allocation: 0}))' <<<"$BODY")
fi
echo "split: $(jq -c '[.experiment_rollout.multivariate_feature_state_values[] | {option: .multivariate_feature_option, pct: .percentage_allocation}]' <<<"$BODY") (control gets the rest)"

echo "hypothesis ($(wc -c <<<"$(jq -r .hypothesis <<<"$BODY")") bytes) from $PREREG"
CREATED=$(fs_api POST "api/v1/environments/$ENV/experiments/" "$BODY")
jq '{id, name, status, feature}' <<<"$CREATED"
echo "start it with: flagsmith/start_experiment.sh $(jq -r .id <<<"$CREATED")"
