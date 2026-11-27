#!/usr/bin/env bash
# Run by hand what the verify-run action runs in CI (.github/actions/verify-run/verify.sh), on
# the study's committed run, then on two tampered copies of it to show the step failing.
# Needs no Flagsmith and no key; step 4 downloads the forkbill package from the npm registry.
#
#   examples/08-ci-verify-run/run.sh [run directory]
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
RUN=${1:-runs/exp1}
cd "$ROOT"
# A path relative to the repository root, as a CI job would see it.
WORK="${HERE#"$ROOT"/}/work"
rm -rf "$WORK"
mkdir -p "$WORK"
verify() { RUN_DIRS="$1" bash .github/actions/verify-run/verify.sh; }
# copy_run NAME  The files the two checks read, copied to work/NAME.
copy_run() {
  mkdir -p "$WORK/$1"
  cp -r "$RUN/ledger.jsonl" "$RUN/tasks.jsonl" "$RUN/env" "$WORK/$1/"
}

echo "== 1. the run as committed"
verify "$RUN"
echo "exit code: $?"

echo "== 2. a copy with one recorded arm changed in tasks.jsonl"
copy_run arm-changed
first=$(grep -m1 -n '"flag_source":"experiment"' "$WORK/arm-changed/tasks.jsonl" | cut -d: -f1)
sed -i "${first}s/\"variant\":\"lanes_v1\"/\"variant\":\"swapped\"/; ${first}s/\"variant\":\"control\"/\"variant\":\"lanes_v1\"/; ${first}s/\"variant\":\"swapped\"/\"variant\":\"control\"/" "$WORK/arm-changed/tasks.jsonl"
verify "$WORK/arm-changed"
echo "exit code: $?"

echo "== 3. a copy with one dollar figure changed in the ledger"
copy_run ledger-changed
line=$(grep -m1 -n '"kind":"task_done"' "$WORK/ledger-changed/ledger.jsonl" | cut -d: -f1)
sed -i "${line}s/\"usd\":0\./\"usd\":1./" "$WORK/ledger-changed/ledger.jsonl"
verify "$WORK/ledger-changed"
echo "exit code: $?"

echo "== 4. the assignment check for a repository with no Python: example 07's verify.ts and the forkbill npm package"
(cd "$HERE/../07-verify-offline" && NPM_CONFIG_UPDATE_NOTIFIER=false npm ci --no-audit --no-fund --loglevel=error)
node "$HERE/../07-verify-offline/verify.ts" "$RUN"
echo "exit code: $?"
