#!/usr/bin/env bash
# Start a created experiment (turns its rollout on; the flag is locked while it runs).
#
#   flagsmith/start_experiment.sh <experiment-id>
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$HERE/lib.sh"
need "$FS_BIN" jq
require_auth

[ $# -eq 1 ] || die "usage: $0 <experiment-id>"
[[ $1 =~ ^[0-9]+$ ]] || die "experiment id must be a number"
ENV=$(env_key)
fs_api POST "api/v1/environments/$ENV/experiments/$1/start/" | jq '{id, name, status, started_at}'
