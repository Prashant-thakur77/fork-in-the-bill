#!/usr/bin/env bash
# The routing decision through OpenFeature (Flagsmith's provider) against the self-hosted Flagsmith.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../common.sh
source "$HERE/../common.sh"
ensure_experiment
"$PYTHON" -c 'import openfeature_flagsmith' 2>/dev/null \
  || die "the OpenFeature provider is not installed: run \`uv sync --extra openfeature\` in the repository root"

"$PYTHON" - <<'PY'
from importlib.metadata import version
print("openfeature-sdk", version("openfeature-sdk"), "| openfeature-provider-flagsmith",
      version("openfeature-provider-flagsmith"), "| flagsmith", version("flagsmith"))
PY
mark=$(event_mark)
out=$(mktemp)
"$PYTHON" "$HERE/openfeature_example.py" "$(jq -r .id "$STATE/experiment.json")" | tee "$out"
expect_events "$mark" ex05: "$(sent_total "$out")"
rm -f "$out"
