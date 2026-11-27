# shellcheck shell=bash
# Sourced by every run.sh under examples/.
#
# Loads the credentials selfhost/bootstrap.sh wrote for the self-hosted Flagsmith and stops
# unless every Flagsmith URL points at that instance. The examples never read the repository's
# .env and never talk to Flagsmith Cloud.
set -euo pipefail

EXAMPLES=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$EXAMPLES/.." && pwd)
# shellcheck source=../flagsmith/lib.sh
source "$ROOT/flagsmith/lib.sh"
need jq docker "$FS_BIN"

STATE=${FORKBILL_STATE:-$ROOT/selfhost/.state}
[ -f "$STATE/credentials.env" ] || die "no $STATE/credentials.env: run selfhost/bootstrap.sh first"

# Keys from the caller's shell must not reach an example; only the self-hosted ones are used.
unset FLAGSMITH_ENVIRONMENT FLAGSMITH_ENVIRONMENT_KEY FLAGSMITH_ENVIRONMENT_API_KEY \
  FLAGSMITH_API_KEY FLAGSMITH_USER_TOKEN FLAGSMITH_API_URL_SDK
set -a
# shellcheck disable=SC1091
source "$STATE/credentials.env"
set +a
for _v in FLAGSMITH_API_URL FLAGSMITH_SDK_API_URL FLAGSMITH_EVENTS_API_URL; do
  [ -n "${!_v:-}" ] || die "$_v is not set in $STATE/credentials.env: rerun selfhost/bootstrap.sh"
  case "${!_v}" in
    *flagsmith.com*) die "$_v points at Flagsmith Cloud; the examples only run against the self-hosted instance" ;;
  esac
done
[ -n "${FLAGSMITH_SERVER_KEY:-}" ] || die "FLAGSMITH_SERVER_KEY is not set in $STATE/credentials.env"
require_auth

PYTHON=${PYTHON:-$ROOT/.venv/bin/python}
[ -x "$PYTHON" ] || die "no $PYTHON: run \`uv sync --extra openfeature\` in the repository root"
# The kit, the repository's own packages (integrity/) and examples/simulated_agent.py.
export PYTHONPATH="$ROOT/kit:$ROOT:$EXAMPLES${PYTHONPATH:+:$PYTHONPATH}"
forkbill() { "$PYTHON" -m forkbill.cli "$@"; }
# shellcheck disable=SC2034  # used by the run.sh that sources this file
SDK_URLS=(--api-url "$FLAGSMITH_SDK_API_URL" --events-api-url "$FLAGSMITH_EVENTS_API_URL")

ENV_KEY=$(env_key)

# flagsmith_sql  Run SQL from stdin against the self-hosted instance's own Postgres database.
flagsmith_sql() {
  docker compose -f "$ROOT/selfhost/docker-compose.yml" --env-file "$ROOT/selfhost/.env" \
    exec -T postgres psql -U postgres -d flagsmith -At -F ' ' -v ON_ERROR_STOP=1 "$@"
}

# event_mark  The id of the newest row in Flagsmith's events table. The warehouse connection's
# total_events_received counter is not used: each API worker caches it for 60 seconds, so two
# reads a few seconds apart can come back in either order.
event_mark() {
  flagsmith_sql <<<'select coalesce(max(id), 0) from experimentation_sdkexperimentationevent'
}

# expect_events MARK PREFIX SENT  Count the events Flagsmith stored after MARK for identities
# that start with PREFIX, print them by event name, and stop unless the total equals SENT.
expect_events() {
  local mark=$1 prefix=$2 sent=$3 rows="" stored=0
  for _ in $(seq 1 20); do
    rows=$(flagsmith_sql -v mark="$mark" -v prefix="$prefix" <<<"select event, count(*) from experimentation_sdkexperimentationevent where id > :mark and identifier like :'prefix' || '%' group by event order by event")
    stored=$(awk '{n += $2} END {print n + 0}' <<<"$rows")
    [ "$stored" -ge "$sent" ] && break
    sleep 1
  done
  echo "events sent: $sent; rows in Flagsmith's events table for $prefix*: $stored ($(awk 'NF {printf "%s%s %s", sep, $1, $2; sep = ", "}' <<<"$rows"))"
  [ "$stored" -eq "$sent" ] || die "Flagsmith stored $stored events, expected $sent"
}

# sent_total FILE  The number an example printed on its "sent to Flagsmith: ... = N" line.
sent_total() {
  sed -n 's/^sent to Flagsmith: .* = \([0-9][0-9]*\)$/\1/p' "$1" | tail -1
}

# ensure_experiment  Create the flag, variant, kill switch, metrics and running experiment the
# examples share, unless they are already there (examples/setup.sh).
ensure_experiment() { "$EXAMPLES/setup.sh" >/dev/null; }
