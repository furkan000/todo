#!/usr/bin/env bash
# Undo autostart-install.sh: stop the app and stop it starting at boot.
#
#   ./autostart-uninstall.sh                  remove the service
#   ./autostart-uninstall.sh --disable-linger  also stop *any* of your user
#                                              services running while logged out
set -euo pipefail

SERVICE="todo-app"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/$SERVICE.service"
DROP_LINGER=no

while [ $# -gt 0 ]; do
  case "$1" in
    --disable-linger) DROP_LINGER=yes ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

command -v systemctl >/dev/null || { echo "This machine does not use systemd; nothing to undo." >&2; exit 0; }

if [ ! -f "$UNIT" ] && ! systemctl --user list-unit-files "$SERVICE.service" >/dev/null 2>&1; then
  echo "Autostart is not installed — nothing to do."
  exit 0
fi

systemctl --user disable --now "$SERVICE.service" >/dev/null 2>&1 || true
rm -f "$UNIT"
systemctl --user daemon-reload
systemctl --user reset-failed "$SERVICE.service" >/dev/null 2>&1 || true

echo "Stopped, and it will not start at boot any more."

if [ "$DROP_LINGER" = yes ]; then
  if loginctl disable-linger "$USER" 2>/dev/null; then
    echo "Lingering disabled for $USER."
  else
    echo "Could not disable lingering (needs admin rights): sudo loginctl disable-linger $USER" >&2
  fi
else
  echo "Lingering was left as it is — other user services may rely on it."
  echo "Drop it too with: $0 --disable-linger"
fi

echo "You can still run the app by hand: $(dirname "$(readlink -f "$0")")/serve.sh"
