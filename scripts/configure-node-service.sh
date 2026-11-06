#!/usr/bin/env bash
set -Eeuo pipefail

# Configure the next service start; deliberately do not restart it here.
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SOURCE_DIR/ensure-node-runtime.sh"
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"
SERVICE_NAME="${CENTRAL_TRONSOFTOS_SERVICE_NAME:-central-tronsoftos}"
APP_DIR="${CENTRAL_TRONSOFTOS_APP_DIR:-/opt/central-tronsoftos/app}"
SYSTEMD_DIR="${CENTRAL_TRONSOFTOS_SYSTEMD_DIR:-/etc/systemd/system}"
[[ "$SERVICE_NAME" =~ ^[A-Za-z0-9_.@-]+$ ]] || exit 64
[[ "$APP_DIR" == /* && "$APP_DIR" != *$'\n'* && "$APP_DIR" != *'"'* && "$APP_DIR" != *'%'* && "$APP_DIR" != *'\\'* ]] || exit 64
ensure_node_runtime
NODE_BIN="$(readlink -f "$(command -v node)")"
node_runtime_supported "$("$NODE_BIN" --version)" || exit 65
DROPIN_DIR="$SYSTEMD_DIR/$SERVICE_NAME.service.d"
install -d -m0755 "$DROPIN_DIR"
TEMP_FILE="$(mktemp "$DROPIN_DIR/.node-runtime.XXXXXX")"
trap 'rm -f -- "$TEMP_FILE"' EXIT
printf '[Service]\nExecStart=\nExecStart="%s" "%s/src/server.js"\n' "$NODE_BIN" "$APP_DIR" > "$TEMP_FILE"
chmod 0644 "$TEMP_FILE"
mv -f -- "$TEMP_FILE" "$DROPIN_DIR/20-secure-node.conf"
systemctl daemon-reload
printf 'Runtime configurado: %s (%s). Reinicio fica a cargo do atualizador.\n' "$NODE_BIN" "$("$NODE_BIN" --version)"
