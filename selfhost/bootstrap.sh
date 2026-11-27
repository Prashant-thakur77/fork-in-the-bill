#!/usr/bin/env bash
# Bring up self-hosted Flagsmith with Experimentation and prepare it for the kit demo.
#
#   selfhost/bootstrap.sh
#
# 1. writes selfhost/.env with random secrets if missing;
# 2. `docker compose up -d` and waits for the API;
# 3. first run only: the documented initialisation (ALLOW_ADMIN_INITIATION_VIA_CLI + the image's
#    `flagsmith bootstrap` command) creates the superuser, organisation and project; the admin
#    password is set through the reset link it prints; a Master API key, an environment `Demo`,
#    a server-side SDK key and the "Flagsmith database" warehouse connection are created;
# 4. binds the Flagsmith CLI to the project/environment (selfhost/.state/flagsmith.json).
#
# Keys and the admin password go to selfhost/.state/credentials.env (mode 600, gitignored by
# selfhost/.state/.gitignore). Nothing secret is printed.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
# shellcheck source=../flagsmith/lib.sh
source "$ROOT/flagsmith/lib.sh"
need docker jq curl openssl "$FS_BIN"

STATE="$HERE/.state"
CREDS="$STATE/credentials.env"
mkdir -p "$STATE"
chmod 700 "$STATE"
printf '*\n' >"$STATE/.gitignore"
umask 077

# Add each secret that selfhost/.env does not have yet. The file may already exist with only a
# port or a subnet in it, and compose would then fall back to its fixed local-only defaults.
# An instance that is already initialised keeps what it started with: its database volume was
# created with that password.
touch "$HERE/.env"
add_secret() { # add_secret NAME BYTES
  if [ -f "$CREDS" ] || grep -q "^$1=" "$HERE/.env"; then return 0; fi
  [ ! -s "$HERE/.env" ] || [ -z "$(tail -c1 "$HERE/.env")" ] || echo >>"$HERE/.env"
  echo "$1=$(openssl rand -hex "$2")" >>"$HERE/.env"
  WROTE_SECRETS=1
}
WROTE_SECRETS=0
add_secret POSTGRES_PASSWORD 16
add_secret DJANGO_SECRET_KEY 32
add_secret WAREHOUSE_CREDENTIALS_SECRET 32
if [ "$WROTE_SECRETS" -eq 1 ]; then echo "wrote selfhost/.env with random secrets"; fi
set -a
# shellcheck disable=SC1091
source "$HERE/.env"
set +a
PORT=${FLAGSMITH_PORT:-8000}
API="http://localhost:$PORT"
KEY_VAR="FLAGSMITH_API_KEY_localhost_$PORT"
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@forkbill.local}
compose() { docker compose -f "$HERE/docker-compose.yml" --env-file "$HERE/.env" "$@"; }

echo "== docker compose up"
compose up -d --quiet-pull
printf 'waiting for %s/health/liveness/ ' "$API"
for _ in $(seq 1 90); do
  if curl -fsS -o /dev/null "$API/health/liveness/" 2>/dev/null; then break; fi
  printf '.'
  sleep 2
done
curl -fsS -o /dev/null "$API/health/liveness/" || die " API did not come up; see: docker compose -f selfhost/docker-compose.yml logs flagsmith"
echo " up"

# curl_json METHOD PATH AUTH_HEADER [BODY]  Prints the body; on HTTP >= 400 prints it and stops.
curl_json() {
  local method=$1 path=$2 auth=$3 body=${4:-} out code
  out=$(mktemp)
  if [ -n "$body" ]; then
    code=$(printf '%s' "$body" | curl -sS -o "$out" -w '%{http_code}' -X "$method" \
      -H 'Content-Type: application/json' ${auth:+-H "$auth"} --data-binary @- "$API/$path")
  else
    code=$(curl -sS -o "$out" -w '%{http_code}' -X "$method" ${auth:+-H "$auth"} "$API/$path")
  fi
  if [ "$code" -ge 400 ]; then
    printf 'Flagsmith error from %s /%s (HTTP %s):\n' "$method" "$path" "$code" >&2
    cat "$out" >&2
    echo >&2
    rm -f "$out"
    exit 1
  fi
  cat "$out"
  rm -f "$out"
}

if [ ! -f "$CREDS" ]; then
  echo "== first-run initialisation (flagsmith bootstrap)"
  INIT=$(compose exec -T flagsmith flagsmith bootstrap 2>&1) || { echo "$INIT" >&2; die "flagsmith bootstrap failed"; }
  grep -E '^(Superuser|Organisation|Project) ' <<<"$INIT" || true
  LINK=$(grep -o 'password-reset/confirm/[^ ]*' <<<"$INIT" | tail -1 || true)
  [ -n "$LINK" ] || die "no password reset link: the instance is already initialised but $CREDS is missing. Start over with: docker compose -f selfhost/docker-compose.yml down -v"
  RESET_UID=$(cut -d/ -f3 <<<"$LINK")
  RESET_TOKEN=$(cut -d/ -f4 <<<"$LINK")
  ADMIN_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)
  curl_json POST api/v1/auth/users/reset_password_confirm/ "" "$(jq -nc --arg u "$RESET_UID" \
    --arg t "$RESET_TOKEN" --arg p "$ADMIN_PASSWORD" '{uid: $u, token: $t, new_password: $p, re_new_password: $p}')" >/dev/null
  echo "admin password set"
  TOKEN=$(curl_json POST api/v1/auth/login/ "" "$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" \
    '{email: $e, password: $p}')" | jq -r .key)
  ORG_ID=$(curl_json GET api/v1/organisations/ "Authorization: Token $TOKEN" | jq -r '.results[0].id')
  # The CLI accepts a Master API key, not the user token, so mint one for it.
  MASTER_KEY=$(curl_json POST "api/v1/organisations/$ORG_ID/master-api-keys/" "Authorization: Token $TOKEN" \
    '{"name": "forkbill-selfhost-cli", "is_admin": true}' | jq -r .key)
  curl_json POST api/v1/auth/logout/ "Authorization: Token $TOKEN" >/dev/null 2>&1 || true
  {
    echo "# Self-hosted demo credentials. Local only; never commit."
    echo "FLAGSMITH_API_URL=$API"
    echo "$KEY_VAR=$MASTER_KEY"
    echo "ADMIN_EMAIL=$ADMIN_EMAIL"
    echo "ADMIN_PASSWORD=$ADMIN_PASSWORD"
  } >"$CREDS"
  chmod 600 "$CREDS"
  echo "master API key created"
fi

set -a
# shellcheck disable=SC1090
source "$CREDS"
set +a
# Bind the CLI only once flagsmith.json exists (`flagsmith init` below writes it).
if [ -f "$STATE/flagsmith.json" ]; then
  export FLAGSMITH_CONFIG_PATH="$STATE/flagsmith.json"
else
  unset FLAGSMITH_CONFIG_PATH
fi

echo "== CLI auth"
require_auth
fs auth status
echo
PROJECT_ID=$(fs project list --json | jq -r --arg n "${PROJECT_NAME:-forkbill-selfhost-demo}" '[.[] | select(.name == $n)][0].id // empty')
[ -n "$PROJECT_ID" ] || die "project ${PROJECT_NAME:-forkbill-selfhost-demo} not found"

echo "== environment Demo"
ENVS=$(fs environment list --project "$PROJECT_ID" --json)
if [ -z "$(jq -r '.[] | select(.name == "Demo") | .id' <<<"$ENVS")" ]; then
  fs environment create Demo --project "$PROJECT_ID" --description "Kit portability demo" >/dev/null
  ENVS=$(fs environment list --project "$PROJECT_ID" --json)
  echo "created"
else
  echo "exists"
fi
ENV_KEY=$(jq -r '.[] | select(.name == "Demo") | .api_key' <<<"$ENVS")
(cd "$STATE" && unset FLAGSMITH_CONFIG_PATH && fs init --project "$PROJECT_ID" --environment "$ENV_KEY" --yes >/dev/null)
export FLAGSMITH_CONFIG_PATH="$STATE/flagsmith.json"
echo "CLI bound: $(jq -c '{project, apiUrl}' "$STATE/flagsmith.json")"

if ! grep -q '^FLAGSMITH_SERVER_KEY=' "$CREDS"; then
  SERVER_KEY=$(fs environment key create Demo --name forkbill-demo --json | jq -r .key)
  {
    echo "FLAGSMITH_SERVER_KEY=$SERVER_KEY"
    echo "FLAGSMITH_SDK_API_URL=$API/api/v1/"
    echo "FLAGSMITH_EVENTS_API_URL=$API/api/"
    echo "FLAGSMITH_CONFIG_PATH=$STATE/flagsmith.json"
  } >>"$CREDS"
  echo "server-side SDK key created"
fi

# Edge Proxy key pair (compose profile `edge`): the proxy polls the environment document with the
# server-side key and answers SDKs that send either key. Written on every run, never printed.
SERVER_KEY=$(grep '^FLAGSMITH_SERVER_KEY=' "$CREDS" | cut -d= -f2-)
jq -nc --arg s "$SERVER_KEY" --arg c "$ENV_KEY" '[{server_side_key: $s, client_side_key: $c}]' \
  | { printf 'ENVIRONMENT_KEY_PAIRS='; cat; } >"$STATE/edge.env"
chmod 600 "$STATE/edge.env"
if ! grep -q '^FLAGSMITH_EDGE_API_URL=' "$CREDS"; then
  echo "FLAGSMITH_EDGE_API_URL=http://localhost:${EDGE_PROXY_PORT:-8001}/api/v1/" >>"$CREDS"
fi
echo "Edge Proxy key pair written (start it with: docker compose -f selfhost/docker-compose.yml --profile edge up -d)"

echo "== warehouse: Flagsmith database (Postgres, evaluation only)"
WH=$(fs_api GET "api/v1/environments/$ENV_KEY/warehouse-connections/")
if [ "$(jq 'length' <<<"$WH")" -eq 0 ]; then
  WH=$(fs_api POST "api/v1/environments/$ENV_KEY/warehouse-connections/" \
    '{"warehouse_type": "postgres", "config": {"source": "flagsmith_database"}}' | jq -c '[.]')
fi
jq -c '.[] | {name, warehouse_type, config, status}' <<<"$WH"

cat <<EOT

Self-hosted Flagsmith is up at $API (dashboard: log in as $ADMIN_EMAIL).
Credentials file (keys and admin password, mode 600): ${CREDS#"$ROOT"/}
CLI config (project and client-side environment key):  ${STATE#"$ROOT"/}/flagsmith.json
Use it from a shell:  set -a; source ${CREDS#"$ROOT"/}; set +a
Next: selfhost/demo.sh
Tear down:  docker compose -f selfhost/docker-compose.yml --profile edge down -v && rm -rf selfhost/.state
EOT
