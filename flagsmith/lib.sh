# shellcheck shell=bash
# Helpers shared by the flagsmith/ and selfhost/ scripts. Sourced, not executed.
#
# Credentials stay with the Flagsmith CLI v2: its `flagsmith login` session, or a master key in
# FLAGSMITH_API_KEY (Cloud) / FLAGSMITH_API_KEY_<host>_<port> (self-hosted). Nothing here prints
# a key. On any CLI failure the CLI's exact error text is printed and the script stops.

FS_BIN=${FLAGSMITH_BIN:-flagsmith}
export FLAGSMITH_NO_INPUT=1

die() { printf '%s\n' "$*" >&2; exit 1; }

need() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || die "missing command: $c"
  done
}

# fs ARGS...  Run the CLI. Prints stdout; on failure prints Flagsmith's error and exits.
fs() {
  local err out rc=0
  err=$(mktemp)
  out=$("$FS_BIN" "$@" 2>"$err") || rc=$?
  if [ "$rc" -ne 0 ]; then
    {
      printf 'Flagsmith error from "flagsmith %s %s" (exit %s):\n' "${1:-}" "${2:-}" "$rc"
      cat "$err"
      [ -n "$out" ] && printf '%s\n' "$out"
    } >&2
    rm -f "$err"
    exit "$rc"
  fi
  rm -f "$err"
  printf '%s' "$out"
}

# fs_maybe ARGS...  Like fs, but a "not found" error returns 3 with no output.
fs_maybe() {
  local err out rc=0
  err=$(mktemp)
  out=$("$FS_BIN" "$@" 2>"$err") || rc=$?
  if [ "$rc" -ne 0 ]; then
    if grep -q 'not found' "$err"; then
      rm -f "$err"
      return 3
    fi
    {
      printf 'Flagsmith error from "flagsmith %s %s" (exit %s):\n' "${1:-}" "${2:-}" "$rc"
      cat "$err"
      [ -n "$out" ] && printf '%s\n' "$out"
    } >&2
    rm -f "$err"
    exit "$rc"
  fi
  rm -f "$err"
  printf '%s' "$out"
}

# fs_api METHOD PATH [JSON_BODY]
fs_api() {
  if [ $# -ge 3 ]; then
    printf '%s' "$3" | fs api "$2" -X "$1" --input -
  else
    fs api "$2" -X "$1"
  fi
}

# The bound environment's client-side key (from FLAGSMITH_ENVIRONMENT or flagsmith.json).
env_key() {
  if [ -n "${FLAGSMITH_ENVIRONMENT:-}" ]; then
    printf '%s' "$FLAGSMITH_ENVIRONMENT"
    return
  fi
  local cfg key
  cfg=$(fs config --json)
  key=$(jq -r '.environment.value // empty' <<<"$cfg")
  [ -n "$key" ] || die "no environment bound: run \`flagsmith init --project <p> --environment <key>\` first"
  printf '%s' "$key"
}

# policy_json DIR NAME  Compact JSON of DIR/NAME.json (the exact flag value string).
policy_json() {
  local f="$1/$2.json"
  [ -f "$f" ] || die "policy file not found: $f"
  jq -ce 'select(.schema == 1 and (.policy | type == "string"))' "$f" >/dev/null \
    || die "$f is not a schema-1 routing policy"
  jq -c . "$f"
}

# preflight_literals ENV_KEY METRICS_JSON
# Stops unless every aggregation/direction/expected_direction literal in METRICS_JSON is offered
# by this instance's OPTIONS response.
preflight_literals() {
  local env="$1" metrics="$2" mopts eopts bad
  mopts=$(fs_api OPTIONS "api/v1/environments/$env/experiment-metrics/")
  eopts=$(fs_api OPTIONS "api/v1/environments/$env/experiments/")
  bad=$(jq -n --argjson m "$mopts" --argjson e "$eopts" --slurpfile spec "$metrics" '
    def choices(x): [x.choices[]?.value];
    {
      aggregation: choices($m.actions.POST.aggregation),
      direction: choices($m.actions.POST.direction),
      expected_direction: choices($e.actions.POST.metrics.child.children.expected_direction)
    } as $offered
    | [ $spec[0].metrics[] as $x
        | ("aggregation", "direction", "expected_direction") as $f
        | select(($offered[$f] | length) == 0 or ($offered[$f] | index($x[$f])) == null)
        | "\($x.name): \($f)=\($x[$f]) not offered (offered: \($offered[$f] | join(", ")))" ]
    | .[]')
  if [ -n "$bad" ]; then
    printf 'Flagsmith does not accept these metric literals:\n%s\n' "$bad" >&2
    exit 1
  fi
}

# render_experiment TEMPLATE IDS_JSON POLICIES_DIR HYPOTHESIS_FILE
# Fills '@' placeholders (rules in kit/forkbill/experiment.py) and drops "$..." keys.
render_experiment() {
  local template="$1" ids="$2" pdir="$3" hfile="$4" hyp policies="{}" name
  hyp=$(extract_hypothesis "$hfile")
  for name in $(jq -r '.. | strings | select(startswith("@policy:")) | sub("^@policy:"; "")' "$template" | sort -u); do
    policies=$(jq -c --arg n "$name" --arg v "$(policy_json "$pdir" "$name")" '. + {($n): $v}' <<<"$policies")
  done
  jq -e --slurpfile ids "$ids" --argjson pol "$policies" --arg hyp "$hyp" '
    def resolve:
      if startswith("@feature_id:") then $ids[0].features[ltrimstr("@feature_id:")]
      elif startswith("@variant_id:") then
        (ltrimstr("@variant_id:") | split(":")) as $p | $ids[0].variants[$p[0]][$p[1]]
      elif startswith("@metric_id:") then $ids[0].metrics[ltrimstr("@metric_id:")]
      elif startswith("@policy:") then $pol[ltrimstr("@policy:")]
      elif . == "@hypothesis" then $hyp
      elif startswith("@") then error("unknown placeholder \(.)")
      else . end
      | if . == null then error("placeholder has no id in ids.json") else . end;
    walk(if type == "object" then with_entries(select(.key | startswith("$") | not))
         elif type == "string" then resolve else . end)' "$template" \
    || die "could not render $template (missing ids? run setup.sh first)"
}

# extract_hypothesis FILE  Text between <!-- hypothesis:start --> and <!-- hypothesis:end -->.
extract_hypothesis() {
  local f="$1" text
  [ -f "$f" ] || die "hypothesis file not found: $f"
  if grep -q '<!-- hypothesis:start -->' "$f" && grep -q '<!-- hypothesis:end -->' "$f"; then
    text=$(sed -n '/<!-- hypothesis:start -->/,/<!-- hypothesis:end -->/p' "$f" \
      | sed '1s/.*<!-- hypothesis:start -->//; $s/<!-- hypothesis:end -->.*//')
  else
    die "$f has no <!-- hypothesis:start --> ... <!-- hypothesis:end --> block"
  fi
  text=$(printf '%s' "$text" | sed -e '/./,$!d' | sed -e ':a' -e '/^\n*$/{$d;N;ba' -e '}')
  [ -n "$text" ] || die "hypothesis block in $f is empty"
  printf '%s' "$text"
}

# require_auth  Stop with a clear message unless the CLI has usable Admin API credentials.
# CLI v2 accepts `flagsmith login` or a Master API key; legacy user auth tokens are rejected.
require_auth() {
  local err rc=0
  err=$(mktemp)
  "$FS_BIN" auth status >/dev/null 2>"$err" || rc=$?
  if [ "$rc" -ne 0 ]; then
    {
      echo "Flagsmith CLI is not authenticated for ${FLAGSMITH_API_URL:-https://api.flagsmith.com}:"
      cat "$err"
      echo "Run \`flagsmith login\`, or export a Master API key (FLAGSMITH_API_KEY for Cloud,"
      echo "FLAGSMITH_API_KEY_<host>_<port> for a self-hosted URL). User auth tokens are not accepted."
    } >&2
    rm -f "$err"
    exit 1
  fi
  rm -f "$err"
}

# norm_json JSON  Canonical form for comparing two JSON documents (sorted keys; numbers
# normalised, since jq keeps literals such as 0.60 as written).
norm_json() {
  jq -cS 'walk(if type == "number" then . + 0 else . end)' <<<"$1"
}

# same_json A B  True when the two JSON texts are the same document.
same_json() { [ "$(norm_json "$1")" = "$(norm_json "$2")" ]; }
