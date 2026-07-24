#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${CENTRAL_TRONSOFTOS_SERVICE:-central-tronsoftos}"
APP_USER="${CENTRAL_TRONSOFTOS_USER:-central-tronsoftos}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="/usr/local/sbin/central-tronsoftos-backup"
RESTORE_SCRIPT="/usr/local/sbin/central-tronsoftos-restore"

fail() { printf '[central-backup-install] ERRO: %s\n' "$*" >&2; exit 1; }
log() { printf '[central-backup-install] %s\n' "$*" >&2; }

[[ "$(id -u)" -eq 0 ]] || fail "Execute como root ou via sudo."

install -m 750 "$SOURCE_DIR/backup-central.sh" "$BACKUP_SCRIPT"
install -m 750 "$SOURCE_DIR/restore-central.sh" "$RESTORE_SCRIPT"
install -d -m 750 /var/backups/central-tronsoftos

cat > "/etc/systemd/system/${SERVICE_NAME}-backup.service" <<EOF
[Unit]
Description=Backup Central TronSoftOS
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$BACKUP_SCRIPT run
EOF

cat > "/etc/systemd/system/${SERVICE_NAME}-backup.timer" <<EOF
[Unit]
Description=Backup diario Central TronSoftOS

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

if id "$APP_USER" >/dev/null 2>&1; then
  cat > "/etc/sudoers.d/${SERVICE_NAME}-backup" <<EOF
$APP_USER ALL=(root) NOPASSWD: $BACKUP_SCRIPT, $BACKUP_SCRIPT run, $BACKUP_SCRIPT status-json, $BACKUP_SCRIPT status
EOF
  chmod 440 "/etc/sudoers.d/${SERVICE_NAME}-backup"
fi

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}-backup.timer"

log "Backup automatico instalado."
printf 'Servico: %s-backup.service\n' "$SERVICE_NAME"
printf 'Timer: %s-backup.timer\n' "$SERVICE_NAME"
printf 'Manual: sudo %s run\n' "$BACKUP_SCRIPT"
printf 'Restaurar: sudo %s /var/backups/central-tronsoftos/central-YYYYmmdd-HHMMSS.tar.gz\n' "$RESTORE_SCRIPT"
