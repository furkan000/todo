#!/usr/bin/env bash
# Start the app automatically when this machine boots, on port 3111.
#
# Installs a systemd *user* service, so no root is needed. Undo it with
# ./autostart-uninstall.sh
#
#   ./autostart-install.sh                 localhost only (default)
#   ./autostart-install.sh --lan           reachable from other devices
#   ./autostart-install.sh --port 8080     a different port
set -euo pipefail

APP_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
SERVICE="todo-app"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/$SERVICE.service"
PORT=3111
HOST=127.0.0.1

while [ $# -gt 0 ]; do
  case "$1" in
    --lan)  HOST=0.0.0.0 ;;
    --host) HOST="$2"; shift ;;
    --port) PORT="$2"; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

# --- checks -----------------------------------------------------------------
command -v systemctl >/dev/null || { echo "This machine does not use systemd; see the README for alternatives." >&2; exit 1; }
PYTHON="$(command -v python3 || true)"
[ -n "$PYTHON" ] || { echo "python3 not found — it serves the files." >&2; exit 1; }
[ -f "$APP_DIR/index.html" ] || { echo "index.html not found in $APP_DIR" >&2; exit 1; }

if (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q "[:.]$PORT[[:space:]]"; then
  if ! systemctl --user is-active --quiet "$SERVICE"; then
    echo "Warning: something is already listening on port $PORT." >&2
    echo "         Use --port to pick another one if this fails." >&2
  fi
fi

# --- the unit ---------------------------------------------------------------
mkdir -p "$UNIT_DIR"
cat > "$UNIT" <<UNIT_EOF
[Unit]
Description=Plain Text Todo (static server on port $PORT)
Documentation=file://$APP_DIR/README.md
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$PYTHON -m http.server $PORT --bind $HOST --directory $APP_DIR
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
UNIT_EOF

systemctl --user daemon-reload
systemctl --user enable --now "$SERVICE.service" >/dev/null

# Without lingering, user services only run while you are logged in.
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo no)" != "yes" ]; then
  if loginctl enable-linger "$USER" 2>/dev/null; then
    echo "Enabled lingering so it starts at boot without you logging in."
  else
    echo "Note: could not enable lingering (needs admin rights)."
    echo "      The app will start when you log in, rather than at boot."
    echo "      To fix:  sudo loginctl enable-linger $USER"
  fi
fi

sleep 1
if systemctl --user is-active --quiet "$SERVICE"; then
  echo
  echo "Running: http://${HOST/0.0.0.0/$(hostname -I 2>/dev/null | awk '{print $1}')}:$PORT/"
  echo "It will come back automatically after a reboot."
  echo
  echo "  status:     systemctl --user status $SERVICE"
  echo "  stop now:   systemctl --user stop $SERVICE"
  echo "  remove:     $APP_DIR/autostart-uninstall.sh"
else
  echo "The service did not start. Logs:" >&2
  systemctl --user status "$SERVICE" --no-pager || true
  exit 1
fi
