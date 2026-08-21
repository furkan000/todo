#!/usr/bin/env bash
# Serve the app as static files. The systemd unit runs this, and it is fine to
# run by hand: ./serve.sh   (Ctrl+C to stop)
#
#   PORT=8080 ./serve.sh        different port
#   HOST=0.0.0.0 ./serve.sh     reachable from other devices on your network
set -euo pipefail

APP_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PORT="${PORT:-3111}"
HOST="${HOST:-127.0.0.1}"

if ! command -v python3 >/dev/null; then
  echo "serve.sh: python3 not found" >&2
  exit 1
fi

echo "Plain Text Todo -> http://${HOST}:${PORT}/"
exec python3 -m http.server "$PORT" --bind "$HOST" --directory "$APP_DIR"
