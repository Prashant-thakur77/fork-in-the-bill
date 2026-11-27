#!/usr/bin/env bash
# Python quickstart against the self-hosted Flagsmith: 8 simulated tasks through the kit.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../common.sh
source "$HERE/../common.sh"
ensure_experiment

mark=$(event_mark)
out=$(mktemp)
"$PYTHON" "$HERE/quickstart.py" | tee "$out"
expect_events "$mark" ex01: "$(sent_total "$out")"
rm -f "$out"
