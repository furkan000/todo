#!/usr/bin/env bash
# Start the app in the background on port 3111, with the server keeping the data.
# Open http://localhost:3111/<name> once it is up.
#
# If the autostart service is installed it is started through systemd, so the
# two never fight over the port; otherwise scripts/serve.sh runs detached.
set -euo pipefail
APP_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"

if systemctl --user cat todo-app >/dev/null 2>&1; then
  systemctl --user start todo-app
  echo "Running (systemd): http://localhost:3111/<name>"
elif (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q "[:.]3111[[:space:]]"; then
  echo "Something is already listening on port 3111." >&2
  exit 1
else
  nohup "$APP_DIR/scripts/serve.sh" > /dev/null 2>&1 &
  echo "Running (pid $!): http://localhost:3111/<name>"
fi
