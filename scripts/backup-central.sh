#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${CENTRAL_TRONSOFTOS_APP_DIR:-/opt/central-tronsoftos/app}"
ENV_FILE="${CENTRAL_TRONSOFTOS_ENV_FILE:-/etc/central-tronsoftos/central.env}"
SERVICE_NAME="${CENTRAL_TRONSOFTOS_SERVICE:-central-tronsoftos}"
BACKUP_DIR="${CENTRAL_TRONSOFTOS_BACKUP_DIR:-/var/backups/central-tronsoftos}"
RETENTION_DAYS="${CENTRAL_TRONSOFTOS_BACKUP_RETENTION_DAYS:-30}"
RCLONE_REMOTE="${CENTRAL_TRONSOFTOS_BACKUP_RCLONE_REMOTE:-}"
MODE="${1:-run}"

log() { printf '[central-backup] %s\n' "$*" >&2; }
fail() { printf '[central-backup] ERRO: %s\n' "$*" >&2; exit 1; }

json_escape() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  printf '%s' "$value"
}

load_env() {
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  fi
}

latest_status() {
  local status_file="$BACKUP_DIR/latest.json"
  if [[ -f "$status_file" ]]; then
    cat "$status_file"
  else
    printf '{"ok":false,"message":"Nenhum backup registrado.","backupDir":"%s"}\n' "$(json_escape "$BACKUP_DIR")"
  fi
}

if [[ "$MODE" == "status" || "$MODE" == "status-json" ]]; then
  latest_status
  exit 0
fi

[[ "$MODE" == "run" || "$MODE" == "backup" ]] || fail "Modo invalido: $MODE"

load_env

timestamp="$(date -u +%Y%m%d-%H%M%S)"
created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
work_dir="$BACKUP_DIR/.work/central-$timestamp"
archive="$BACKUP_DIR/central-$timestamp.tar.gz"
status_file="$BACKUP_DIR/latest.json"
remote_status="not_configured"
remote_error=""

mkdir -p "$work_dir"
chmod 700 "$BACKUP_DIR" "$BACKUP_DIR/.work" "$work_dir" 2>/dev/null || true

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

log "Criando backup em $archive"

mkdir -p "$work_dir/config" "$work_dir/db" "$work_dir/meta"
printf '%s\n' "$created_at" > "$work_dir/meta/created_at.txt"
printf '%s\n' "$APP_DIR" > "$work_dir/meta/app_dir.txt"
printf '%s\n' "$ENV_FILE" > "$work_dir/meta/env_file.txt"

if [[ -f "$ENV_FILE" ]]; then
  cp -a "$ENV_FILE" "$work_dir/config/central.env"
fi

if [[ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]]; then
  cp -a "/etc/systemd/system/${SERVICE_NAME}.service" "$work_dir/config/${SERVICE_NAME}.service"
fi

if [[ -d /etc/cloudflared ]]; then
  tar -C /etc -czf "$work_dir/config/cloudflared.tar.gz" cloudflared
fi

if [[ -f "/etc/nginx/sites-available/${SERVICE_NAME}" ]]; then
  cp -a "/etc/nginx/sites-available/${SERVICE_NAME}" "$work_dir/config/nginx-${SERVICE_NAME}"
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
  command -v pg_dump >/dev/null 2>&1 || fail "pg_dump nao encontrado."
  log "Exportando PostgreSQL"
  pg_dump --clean --if-exists "$DATABASE_URL" > "$work_dir/db/postgres.sql"
  printf 'postgres\n' > "$work_dir/meta/storage_driver.txt"
elif [[ -f "$APP_DIR/data/central-db.json" ]]; then
  log "Copiando banco JSON local"
  cp -a "$APP_DIR/data/central-db.json" "$work_dir/db/central-db.json"
  printf 'json\n' > "$work_dir/meta/storage_driver.txt"
else
  printf 'unknown\n' > "$work_dir/meta/storage_driver.txt"
  log "Nenhum DATABASE_URL ou central-db.json encontrado; backup tera apenas configuracoes."
fi

tar -C "$BACKUP_DIR/.work" -czf "$archive" "central-$timestamp"
chmod 600 "$archive"

sha256="$(sha256sum "$archive" | awk '{print $1}')"
size_bytes="$(stat -c '%s' "$archive")"

if [[ -n "$RCLONE_REMOTE" ]]; then
  if command -v rclone >/dev/null 2>&1; then
    log "Enviando copia remota para $RCLONE_REMOTE"
    if rclone copy "$archive" "$RCLONE_REMOTE"; then
      remote_status="success"
    else
      remote_status="failed"
      remote_error="Falha no rclone copy para $RCLONE_REMOTE"
    fi
  else
    remote_status="failed"
    remote_error="rclone nao encontrado"
  fi
fi

cat > "$status_file" <<EOF
{
  "ok": true,
  "createdAt": "$(json_escape "$created_at")",
  "file": "$(json_escape "$archive")",
  "fileName": "$(json_escape "$(basename "$archive")")",
  "sizeBytes": $size_bytes,
  "sha256": "$(json_escape "$sha256")",
  "backupDir": "$(json_escape "$BACKUP_DIR")",
  "storage": "$(json_escape "$(cat "$work_dir/meta/storage_driver.txt")")",
  "remoteStatus": "$(json_escape "$remote_status")",
  "remote": "$(json_escape "$RCLONE_REMOTE")",
  "remoteError": "$(json_escape "$remote_error")"
}
EOF
chmod 640 "$status_file" 2>/dev/null || true

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'central-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

log "Backup concluido: $archive"
latest_status
