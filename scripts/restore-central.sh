#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${CENTRAL_TRONSOFTOS_APP_DIR:-/opt/central-tronsoftos/app}"
ENV_FILE="${CENTRAL_TRONSOFTOS_ENV_FILE:-/etc/central-tronsoftos/central.env}"
SERVICE_NAME="${CENTRAL_TRONSOFTOS_SERVICE:-central-tronsoftos}"
ARCHIVE="${1:-}"

fail() { printf '[central-restore] ERRO: %s\n' "$*" >&2; exit 1; }
log() { printf '[central-restore] %s\n' "$*" >&2; }

[[ -n "$ARCHIVE" ]] || fail "Informe o arquivo .tar.gz do backup."
[[ -f "$ARCHIVE" ]] || fail "Backup nao encontrado: $ARCHIVE"

tmp_dir="$(mktemp -d)"
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT

tar -C "$tmp_dir" -xzf "$ARCHIVE"
backup_root="$(find "$tmp_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[[ -n "$backup_root" ]] || fail "Backup vazio ou invalido."

log "Parando servico $SERVICE_NAME"
systemctl stop "$SERVICE_NAME" 2>/dev/null || true

if [[ -f "$backup_root/config/central.env" ]]; then
  log "Restaurando $ENV_FILE"
  install -d -m 750 "$(dirname "$ENV_FILE")"
  install -m 640 "$backup_root/config/central.env" "$ENV_FILE"
fi

if [[ -f "$backup_root/config/${SERVICE_NAME}.service" ]]; then
  log "Restaurando systemd"
  install -m 644 "$backup_root/config/${SERVICE_NAME}.service" "/etc/systemd/system/${SERVICE_NAME}.service"
  systemctl daemon-reload
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

if [[ -f "$backup_root/db/postgres.sql" ]]; then
  [[ -n "${DATABASE_URL:-}" ]] || fail "Backup possui PostgreSQL, mas DATABASE_URL nao esta configurado em $ENV_FILE."
  command -v psql >/dev/null 2>&1 || fail "psql nao encontrado."
  log "Restaurando PostgreSQL"
  psql "$DATABASE_URL" < "$backup_root/db/postgres.sql"
elif [[ -f "$backup_root/db/central-db.json" ]]; then
  log "Restaurando JSON local"
  install -d -m 750 "$APP_DIR/data"
  install -m 640 "$backup_root/db/central-db.json" "$APP_DIR/data/central-db.json"
fi

if [[ -f "$backup_root/config/cloudflared.tar.gz" ]]; then
  log "Restaurando /etc/cloudflared"
  tar -C /etc -xzf "$backup_root/config/cloudflared.tar.gz"
fi

log "Reiniciando servico $SERVICE_NAME"
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
systemctl restart "$SERVICE_NAME"
systemctl status "$SERVICE_NAME" --no-pager || true

log "Restauracao concluida."
