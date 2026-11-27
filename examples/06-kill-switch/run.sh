#!/usr/bin/env bash
# Flip the kill switch while a worker is running. worker.py takes one simulated task a second;
# this script turns routing_kill on in Flagsmith a few seconds in and off again a few seconds
# later, then checks what Flagsmith stored.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../common.sh
source "$HERE/../common.sh"
ensure_experiment

TASKS=${TASKS:-18}
WORK="$HERE/work"
mkdir -p "$WORK"
switch() { # switch enable|disable
  fs flag "$1" routing_kill --yes >/dev/null
  echo "$(date -u +%H:%M:%S)  >>> flagsmith flag $1 routing_kill: $(fs flag get routing_kill --json | jq -c '{feature, enabled}')"
}
# Whatever happens, leave the switch off: the other examples share this environment.
trap 'fs flag disable routing_kill --yes >/dev/null 2>&1 || true' EXIT

fs flag disable routing_kill --yes >/dev/null
echo "routing_kill starts $(fs flag get routing_kill --json | jq -r 'if .enabled then "on" else "off" end')"
mark=$(event_mark)

"$PYTHON" "$HERE/worker.py" "$TASKS" "$WORK/summary.json" &
WORKER=$!
sleep $((TASKS / 3))
switch enable
sleep $((TASKS / 3))
switch disable
wait "$WORKER"

echo "== what the worker ran, by where the policy came from"
jq -r 'group_by(.source)[] | "\(.[0].source): \(length) tasks, policies \(map(.policy) | unique | join(", ")), exposures \(map(select(.exposed)) | length), events \(map(.events) | add)"' "$WORK/summary.json"
killed=$(jq '[.[] | select(.source == "kill_switch")] | length' "$WORK/summary.json")
leaked=$(jq '[.[] | select(.source == "kill_switch" and (.exposed or .events > 0 or .policy != "control"))] | length' "$WORK/summary.json")
[ "$killed" -gt 0 ] || die "no task ran while the kill switch was on"
[ "$leaked" -eq 0 ] || die "$leaked kill-switch tasks were exposed, sent events or ran a non-control policy"
echo "$killed tasks ran under the kill switch: all on the control policy, none exposed, no events"
expect_events "$mark" ex06: "$(jq '[.[] | (if .exposed then 1 else 0 end) + .events] | add' "$WORK/summary.json")"
