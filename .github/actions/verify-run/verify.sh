#!/usr/bin/env bash
# Verifies one or more run directories. action.yml calls this; it also runs by hand from a
# clone after `uv sync`:
#
#   RUN_DIRS="runs/exp1 runs/rollout" bash .github/actions/verify-run/verify.sh
#
# For each directory: integrity.verify_ledger recomputes the hash chain and the Merkle root,
# and integrity.verify_assignment recomputes every recorded arm from the first environment
# snapshot in env/. Exits 1 if any directory fails, after checking all of them.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
assignment="${ASSIGNMENT:-auto}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
output="${GITHUB_OUTPUT:-/dev/null}"
py=(uv run --no-sync --project "$root" python)

case "$assignment" in
  auto | true | false) ;;
  *)
    echo "::error::assignment must be auto, true or false, got '$assignment'"
    exit 2
    ;;
esac

# The input is a list of paths or globs, so word splitting and globbing are wanted here.
# shellcheck disable=SC2206
dirs=(${RUN_DIRS:-})
if [ "${#dirs[@]}" -eq 0 ]; then
  echo "::error::run-dir is empty"
  exit 2
fi

{
  echo "### Run verification"
  echo
  echo "| Run directory | Ledger records | task_done | Merkle root | Arms matching the Flagsmith engine |"
  echo "|---|---|---|---|---|"
} >> "$summary"

failed=0
for d in "${dirs[@]}"; do
  d="${d%/}"
  if [ ! -d "$d" ]; then
    echo "::error::$d is not a directory"
    failed=1
    continue
  fi

  ok=1
  report="$("${py[@]}" -m integrity.verify_ledger "$d" --json)" || ok=0
  records="$(jq -r '.records' <<< "$report")"
  task_done="$(jq -r '.task_done_records' <<< "$report")"
  merkle_root="$(jq -r '.merkle_root' <<< "$report")"
  if [ "$ok" -eq 1 ]; then
    echo "$d: records=$records task_done=$task_done merkle_root=$merkle_root"
    echo "merkle-root=$merkle_root" >> "$output"
  else
    jq -r '.errors[]' <<< "$report" | while IFS= read -r err; do echo "::error::$d: $err"; done
    merkle_root="chain broken"
    failed=1
  fi

  arms="not checked"
  if [ "$assignment" = "true" ] || { [ "$assignment" = "auto" ] && [ -d "$d/env" ]; }; then
    ok=1
    report="$("${py[@]}" -m integrity.verify_assignment --run "$d")" || ok=0
    arms="$(jq -er '"\(.matched) of \(.checked)"' <<< "$report" 2> /dev/null || echo "could not be checked")"
    if [ "$ok" -eq 1 ]; then
      echo "$d: $arms recorded arms match the Flagsmith engine"
    elif [ "$arms" = "could not be checked" ]; then
      echo "::error::$d: the assignment check could not run; it needs tasks.jsonl and env/*.json"
      failed=1
    else
      echo "::error::$d: only $arms recorded arms match the Flagsmith engine"
      failed=1
    fi
  fi

  echo "| \`$d\` | $records | $task_done | \`$merkle_root\` | $arms |" >> "$summary"
done

exit "$failed"
