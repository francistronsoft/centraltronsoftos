#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="${CENTRAL_TRONSOFTOS_REPO_DIR:-/root/centraltronsoftos}"
APP_DIR="${CENTRAL_TRONSOFTOS_APP_DIR:-/opt/central-tronsoftos/app}"
SERVICE_NAME="${CENTRAL_TRONSOFTOS_SERVICE_NAME:-central-tronsoftos}"
APP_USER="${CENTRAL_TRONSOFTOS_USER:-central-tronsoftos}"
APP_GROUP="${CENTRAL_TRONSOFTOS_GROUP:-central-tronsoftos}"
ENV_FILE="${CENTRAL_TRONSOFTOS_ENV_FILE:-/etc/central-tronsoftos/central.env}"
BACKUP_ROOT="${CENTRAL_TRONSOFTOS_BACKUP_DIR:-/var/backups/central-tronsoftos}"
log() { printf '[central-update] %s\n' "$*"; }
[[ -d "$REPO_DIR/.git" ]] || exit 66
[[ -d "$APP_DIR" && "$APP_DIR" != / && "$APP_DIR" == /* ]] || exit 67
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"
cd "$REPO_DIR"
git -c "safe.directory=$REPO_DIR" fetch origin master
git -c "safe.directory=$REPO_DIR" checkout master
git -c "safe.directory=$REPO_DIR" pull --ff-only origin master
commit="$(git -c "safe.directory=$REPO_DIR" rev-parse --short HEAD)"

# Preserve the deployed code before changing runtime configuration or files.
backup_dir="$BACKUP_ROOT/update-$(date +%Y%m%d%H%M%S)-$$"
install -d -m0700 "$backup_dir"
tar --exclude=./node_modules --exclude=./data --exclude=./.git -czf "$backup_dir/application-before.tar.gz" -C "$APP_DIR" .
if [[ -d "/etc/systemd/system/$SERVICE_NAME.service.d" ]]; then
  cp -a "/etc/systemd/system/$SERVICE_NAME.service.d" "$backup_dir/service-dropins"
fi
log "codigo anterior preservado em $backup_dir"

CENTRAL_TRONSOFTOS_APP_DIR="$APP_DIR" CENTRAL_TRONSOFTOS_SERVICE_NAME="$SERVICE_NAME" \
  bash "$REPO_DIR/scripts/configure-node-service.sh"

for directory in src prototype scripts; do
  [[ ! -L "$APP_DIR/$directory" ]] || { echo "Diretorio gerenciado e um link: $directory" >&2; exit 68; }
  rm -rf -- "$APP_DIR/$directory"
  install -d -o "$APP_USER" -g "$APP_GROUP" "$APP_DIR/$directory"
  cp -a "$REPO_DIR/$directory/." "$APP_DIR/$directory/"
  chown -R "$APP_USER:$APP_GROUP" "$APP_DIR/$directory"
done
install -o "$APP_USER" -g "$APP_GROUP" -m0644 "$REPO_DIR/package.json" "$APP_DIR/package.json"
if [[ -f "$REPO_DIR/package-lock.json" ]]; then
  install -o "$APP_USER" -g "$APP_GROUP" -m0644 "$REPO_DIR/package-lock.json" "$APP_DIR/package-lock.json"
fi
if [[ -f "$APP_DIR/scripts/install-backup-service.sh" ]]; then
  CENTRAL_TRONSOFTOS_SERVICE="$SERVICE_NAME" CENTRAL_TRONSOFTOS_USER="$APP_USER" \
  CENTRAL_TRONSOFTOS_APP_DIR="$APP_DIR" CENTRAL_TRONSOFTOS_ENV_FILE="$ENV_FILE" \
    bash "$APP_DIR/scripts/install-backup-service.sh"
fi
cd "$APP_DIR"
if [[ -f package-lock.json ]]; then npm ci --omit=dev; else npm install --omit=dev; fi
chown -R "$APP_USER:$APP_GROUP" "$APP_DIR/node_modules" "$APP_DIR/package-lock.json"

# Do not kill the HTTP request running this update; restart from a separate unit.
log "agendando reinicio do servico $SERVICE_NAME"
if command -v systemd-run >/dev/null 2>&1; then
  systemd-run --unit="$SERVICE_NAME-restart-after-update-$$" --on-active=2s \
    /bin/systemctl restart "$SERVICE_NAME" >/dev/null
else
  nohup sh -c 'sleep 2; systemctl restart "$1"' restart "$SERVICE_NAME" >/dev/null 2>&1 &
fi
log "atualizacao concluida: commit $commit"
