#!/usr/bin/env bash
# Run one example and save what it printed as its committed output.
#
#   examples/capture.sh 01-python-quickstart [arguments for its run.sh]
#   OUT=run-with-edge-proxy.txt examples/capture.sh 09-compare-modes remote local edge edge-local
#   examples/capture.sh --as examples/output/bootstrap.txt selfhost/bootstrap.sh
#
# stdout and stderr go to <example>/output/run.txt (or $OUT, or the file after --as) through a
# filter that replaces every secret of the self-hosted instance with <redacted>: the keys and
# the admin password in selfhost/.state/credentials.env, the secrets in selfhost/.env, the
# environment's client-side key and anything shaped like a server-side key. Nothing else is
# changed. An example that writes other files (a transcript, Flagsmith's raw results) puts them
# in the same output directory; they are not filtered, so the run fails if one holds a secret.
set -uo pipefail
EXAMPLES=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$EXAMPLES/.." && pwd)
if [ "${1:-}" = "--as" ]; then
  OUT_FILE=$(realpath -m "${2:?usage: capture.sh --as <output file> <command> [arguments]}")
  shift 2
  CMD=("$@")
  NAME="${CMD[*]}"
else
  NAME=${1:?usage: capture.sh <example directory> [arguments]}
  shift
  DIR="$EXAMPLES/${NAME%/}"
  [ -x "$DIR/run.sh" ] || { echo "no $DIR/run.sh" >&2; exit 1; }
  OUT_FILE="$DIR/output/${OUT:-run.txt}"
  CMD=("$DIR/run.sh" "$@")
fi
export EXAMPLE_OUTPUT_DIR
EXAMPLE_OUTPUT_DIR=$(dirname "$OUT_FILE")
mkdir -p "$EXAMPLE_OUTPUT_DIR"

# secrets.py filter        copy stdin to stdout with every secret replaced
# secrets.py scan FILE...  exit 1 if any file holds a secret
secrets() {
  python3 -c '
import json, pathlib, re, sys
root = pathlib.Path(sys.argv[1])
found = set()
for name in ("selfhost/.state/credentials.env", "selfhost/.env", "selfhost/.state/edge.env"):
    path = root / name
    if not path.exists():
        continue
    for line in path.read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep and not key.startswith("#") and any(w in key for w in ("KEY", "PASSWORD", "SECRET", "TOKEN")):
            found.add(value.strip())
            found.update(re.findall(r"[A-Za-z0-9.]{20,}", value))  # keys inside a JSON value
config = root / "selfhost/.state/flagsmith.json"
if config.exists():
    # the client-side environment key the CLI is bound to
    environment = json.loads(config.read_text()).get("environment")
    if isinstance(environment, str):
        found.add(environment)
found = sorted((s for s in found if len(s) >= 8), key=len, reverse=True)
server_key = re.compile(r"ser\.[A-Za-z0-9]{8,}")
if sys.argv[2] == "filter":
    for line in sys.stdin:
        for s in found:
            line = line.replace(s, "<redacted>")
        sys.stdout.write(server_key.sub("<redacted>", line))
        sys.stdout.flush()
else:
    bad = 0
    for f in sys.argv[3:]:
        text = pathlib.Path(f).read_text(errors="replace")
        if any(s in text for s in found) or server_key.search(text):
            print(f"capture.sh: {f} holds a secret of the self-hosted instance", file=sys.stderr)
            bad = 1
    sys.exit(bad)
' "$ROOT" "$@"
}

start=$(date +%s)
"${CMD[@]}" 2>&1 | secrets filter | tee "$OUT_FILE"
rc=${PIPESTATUS[0]}
mapfile -t files < <(find "$EXAMPLE_OUTPUT_DIR" -maxdepth 1 -type f ! -name '*.png')
secrets scan "${files[@]}" || rc=1
echo "capture.sh: $NAME exited $rc after $(($(date +%s) - start)) s; output in ${OUT_FILE#"$ROOT"/}" >&2
exit "$rc"
