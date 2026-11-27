#!/usr/bin/env bash
# TypeScript quickstart against the self-hosted Flagsmith: installs the published `forkbill`
# package from the npm registry, type-checks the example and runs 8 simulated tasks.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../common.sh
source "$HERE/../common.sh"
need node npm
export NPM_CONFIG_UPDATE_NOTIFIER=false
ensure_experiment

cd "$HERE"
echo "== npm ci (packages come from the npm registry, not from this repository)"
npm ci --no-audit --no-fund --loglevel=error
echo "forkbill $(jq -r .version node_modules/forkbill/package.json) from $(jq -r '.packages["node_modules/forkbill"].resolved' package-lock.json)"
echo "@flagsmith/nodejs $(jq -r .version node_modules/@flagsmith/nodejs/package.json), node $(node --version)"
echo "== tsc --noEmit"
npx --no-install tsc --noEmit && echo "no type errors"

echo "== node quickstart.ts"
mark=$(event_mark)
out=$(mktemp)
node quickstart.ts | tee "$out"
expect_events "$mark" ex02: "$(sent_total "$out")"
rm -f "$out"
