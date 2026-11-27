#!/usr/bin/env bash
# Check offline that every task ran the arm Flagsmith's hashing gives it.
#
# 1. run 40 simulated identities through the experiment and keep what Flagsmith served;
# 2. save the environment document;
# 3. re-derive each arm from the document alone, in Python (integrity/verify_assignment.py,
#    which uses Flagsmith's own flag-engine) and in TypeScript (the kit's explainAssignment);
# 4. do it again with a wrong environment key in the document and watch both checks fail.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../common.sh
source "$HERE/../common.sh"
need node npm
export NPM_CONFIG_UPDATE_NOTIFIER=false
ensure_experiment

N=${N:-40}
cd "$HERE"
RUN=work/run # relative, so the output has no machine-specific paths
rm -rf work
mkdir -p "$RUN/env"
echo "== npm ci (forkbill comes from the npm registry)"
npm ci --no-audit --no-fund --loglevel=error

echo "== 1. $N simulated identities through the experiment (remote evaluation: Flagsmith's API picks each arm)"
forkbill demo --n "$N" --prefix ex07 "${SDK_URLS[@]}" --out "$RUN" >/dev/null
echo "recorded in tasks.jsonl: $(jq -r .variant "$RUN/tasks.jsonl" | sort | uniq -c | awk '{printf "%s %s  ", $2, $1}')"

echo "== 2. flagsmith environment document > env/000-start.json"
fs environment document >"$RUN/env/000-start.json"
# What the document says about the flag, without the environment key.
jq -c '.project.segments[] | select(any(.feature_states[]; .feature.name == "agent_routing"))
  | {segment: .name, rule: [.rules[] | .. | objects | select(.operator?) | {operator, value}],
     split: [.feature_states[] | select(.feature.name == "agent_routing") | .multivariate_feature_state_values[]
             | {(.multivariate_feature_option.key // "?"): .percentage_allocation}] | add}' "$RUN/env/000-start.json"

echo "== 3a. Python: python -m integrity.verify_assignment --run <run>  (Flagsmith's flag-engine)"
"$PYTHON" -m integrity.verify_assignment --run "$RUN" --out "$RUN/assignment.json" \
  | jq '{flag_engine_version, flagsmith_sdk_version, records, checked, matched, match_rate, recorded_counts, expected_counts, mismatched: (.mismatched | length), independent_check: {agree: .independent_check.agree, disagree: (.independent_check.disagree | length)}, ok}'

echo "== 3b. TypeScript: explainAssignment from the published forkbill package"
node verify.ts "$RUN"

echo "== 4. the same checks against a document with the wrong environment key"
# The key is part of every hash input (<key>_<identity>), so a document from another environment
# buckets the same identities differently.
jq '.api_key = "wrong" + (.api_key | .[5:])' "$RUN/env/000-start.json" >"work/wrong-key.json"
set +e
"$PYTHON" -m integrity.verify_assignment --run "$RUN" --env "work/wrong-key.json" --out "work/wrong-key-report.json" >/dev/null
PY_RC=$?
set -e
jq '{checked, matched, match_rate, recorded_counts, expected_counts, mismatched: (.mismatched | length), first_mismatch: .mismatched[0], ok}' "work/wrong-key-report.json"
echo "python exit code: $PY_RC"
set +e
node verify.ts "$RUN" "work/wrong-key.json"
TS_RC=$?
set -e
echo "node exit code: $TS_RC"
[ "$PY_RC" -eq 1 ] && [ "$TS_RC" -eq 1 ] || die "the wrong key was not caught"
echo "both checks caught the wrong key"
