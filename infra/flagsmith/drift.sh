#!/usr/bin/env bash
# Read-only drift check of the live Flagsmith project against infra/flagsmith/*.tf.
#
#   infra/flagsmith/drift.sh [--ledger runs/<exp>/ledger.jsonl]
#
# Runs `terraform init`, adopts the live objects into local state with `terraform import` on a
# fresh checkout (state only), then `terraform plan -detailed-exitcode`. It never applies.
# Prints one JSON line: {"drift": bool, "resources": N, "plan_sha256": "...", "live_versions": bool}.
# Exit 0 = no drift, 2 = drift, anything else = the check itself failed.
#
# The master key is read from .env (FLAGSMITH_API_KEY) and handed to the provider as
# FLAGSMITH_MASTER_API_KEY. No key is printed.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
TF=${TF:-terraform}
FS_BIN=${FLAGSMITH_BIN:-flagsmith}

die() { printf '%s\n' "$*" >&2; exit 1; }

LEDGER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ledger) [ $# -ge 2 ] || die "--ledger needs a path"; LEDGER=$2; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
for c in "$TF" jq sha256sum; do command -v "$c" >/dev/null 2>&1 || die "missing command: $c"; done

# .env: the repo's own, or the main checkout's when this is a git worktree.
ENV_FILE=${ENV_FILE:-$REPO/.env}
if [ ! -f "$ENV_FILE" ]; then
  common=$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
  [ -n "$common" ] && [ -f "$(dirname "$common")/.env" ] && ENV_FILE="$(dirname "$common")/.env"
fi
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE" >/dev/null 2>&1
  set +a
fi
[ -n "${FLAGSMITH_API_KEY:-}" ] || die "FLAGSMITH_API_KEY is not set (looked in ${ENV_FILE})"
export FLAGSMITH_MASTER_API_KEY="$FLAGSMITH_API_KEY"
# Terraform needs none of the server-side SDK keys; keep them out of its environment.
unset FLAGSMITH_ENVIRONMENT_KEY FLAGSMITH_ENVIRONMENT_API_KEY FLAGSMITH_USER_TOKEN
export FLAGSMITH_NO_INPUT=1 TF_IN_AUTOMATION=1 TF_INPUT=0

# Variables: terraform.tfvars if present, else the client key from flagsmith.json and the
# project uuid from a read-only GET.
if [ ! -f "$HERE/terraform.tfvars" ]; then
  if [ -z "${TF_VAR_environment_key:-}" ]; then
    TF_VAR_environment_key=$(jq -r '.environment // empty' "$REPO/flagsmith.json")
    [ -n "$TF_VAR_environment_key" ] || die "no environment key in flagsmith.json"
    export TF_VAR_environment_key
  fi
  if [ -z "${TF_VAR_project_uuid:-}" ]; then
    command -v "$FS_BIN" >/dev/null 2>&1 || die "missing command: $FS_BIN (needed to look up project_uuid)"
    project=$(jq -r '.project' "$REPO/flagsmith.json")
    TF_VAR_project_uuid=$("$FS_BIN" api "api/v1/projects/$project/" | jq -r '.uuid // empty')
    [ -n "$TF_VAR_project_uuid" ] || die "could not read the uuid of project $project"
    export TF_VAR_project_uuid
  fi
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cd "$HERE"

"$TF" init -input=false -lock=false >"$TMP/init.log" 2>&1 || { cat "$TMP/init.log" >&2; exit 1; }

# Fresh checkout: adopt each object named in imports.tf (state only, nothing is written to Flagsmith).
if [ -z "$("$TF" state list 2>/dev/null || true)" ]; then
  env_key=${TF_VAR_environment_key:-$(sed -n 's/^environment_key *= *"\(.*\)"/\1/p' terraform.tfvars)}
  awk '/^import *\{/{to="";id=""} /^ *to *=/{to=$3} /^ *id *=/{sub(/^ *id *= *"/,"");sub(/" *$/,"");id=$0} /^\}/{if(to!="")print to" "id}' imports.tf \
    | while read -r addr id; do
        id=${id//\$\{var.environment_key\}/$env_key}
        echo "importing $addr" >&2
        "$TF" import -input=false -lock=false "$addr" "$id" >"$TMP/import.log" 2>&1 \
          || { cat "$TMP/import.log" >&2; exit 1; }
      done
fi

rc=0
"$TF" plan -detailed-exitcode -refresh=true -lock=false -input=false -no-color -out="$TMP/tfplan" \
  >"$TMP/plan.log" 2>&1 || rc=$?
grep -E '^(Plan:|No changes\.|  # )' "$TMP/plan.log" >&2 || true
if [ "$rc" -ne 0 ] && [ "$rc" -ne 2 ]; then
  cat "$TMP/plan.log" >&2
  exit "$rc"
fi

"$TF" show -json "$TMP/tfplan" >"$TMP/plan.json"
# The hash covers what each resource looks like live and what the plan would do to it, so two
# runs against an unchanged project give the same hash.
CANON=$(jq -cS '[.resource_changes[]? | {address, actions: .change.actions, before: .change.before,
                 after: .change.after, importing: (.change.importing != null)}] | sort_by(.address)' "$TMP/plan.json")
SHA=$(printf '%s' "$CANON" | sha256sum | cut -d' ' -f1)

# With v2 feature versioning every published change gets new feature-state uuids, and the old
# ones stay readable, so a plan alone would keep reading a superseded version. Check that the
# feature states in state are exactly the live ones for each tracked feature (this also catches
# a new segment override or identity-free state added outside the scripts).
LIVE_OK=true
command -v "$FS_BIN" >/dev/null 2>&1 || die "missing command: $FS_BIN (needed for the live-version check)"
while read -r env feature tracked; do
  live=$("$FS_BIN" api "api/v1/features/featurestates/?environment=$env&feature=$feature&page_size=100" \
    | jq -c '[.results[] | select(.identity == null) | .uuid] | sort')
  if [ "$live" != "$tracked" ]; then
    LIVE_OK=false
    echo "feature $feature: live feature states $live, tracked $tracked" >&2
  fi
done < <(jq -r '[.prior_state.values.root_module.resources[]? | select(.type == "flagsmith_feature_state")
           | .values] | group_by([.environment_id, .feature_id])[]
           | "\(.[0].environment_id) \(.[0].feature_id) \(map(.uuid) | sort | tojson)"' "$TMP/plan.json")

SUMMARY=$(jq -c --arg sha "$SHA" --argjson rc "$rc" --argjson live "$LIVE_OK" '
  {drift: ($rc == 2 or ($live | not) or any(.[]; .actions != ["no-op"] or .importing)),
   resources: length, plan_sha256: $sha, live_versions: $live}' <<<"$CANON")
echo "$SUMMARY"

if [ -n "$LEDGER" ]; then
  case "$LEDGER" in /*) ;; *) LEDGER="$REPO/$LEDGER" ;; esac
  (cd "$REPO" && uv run --quiet python - "$LEDGER" "$SUMMARY" <<'PY'
import json
import sys
from pathlib import Path

from harness.schema import LedgerKind
from integrity.ledger import Ledger

payload = {"event": "flags_drift", **json.loads(sys.argv[2])}
rec = Ledger(Path(sys.argv[1])).append(LedgerKind.config, payload)
print(f"ledger: seq {rec.seq} appended to {sys.argv[1]}", file=sys.stderr)
PY
  )
fi

[ "$(jq -r .drift <<<"$SUMMARY")" = true ] && exit 2
exit 0
