#!/usr/bin/env bash
# Serve the app, and keep its data. Fine to run by hand: scripts/serve.sh
# (Ctrl+C to stop). Open /<name> to keep that name's data on this machine;
# the bare / keeps it in the browser, as before.
#
#   PORT=8080 scripts/serve.sh         different port
#   HOST=0.0.0.0 scripts/serve.sh      reachable from other devices on your network
#   DATA_DIR=/srv/todo scripts/serve.sh   where the data goes (default: data/)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
PORT="${PORT:-3111}"
HOST="${HOST:-127.0.0.1}"

if ! command -v python3 >/dev/null; then
  echo "serve.sh: python3 not found" >&2
  exit 1
fi

exec python3 "$APP_DIR/server/server.py" --host "$HOST" --port "$PORT" \
  --data "${DATA_DIR:-$APP_DIR/data}"
