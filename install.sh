#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="central-tronsoftos"
SERVICE_NAME="central-tronsoftos"
APP_USER="${CENTRAL_TRONSOFTOS_USER:-central-tronsoftos}"
APP_GROUP="${CENTRAL_TRONSOFTOS_GROUP:-central-tronsoftos}"
INSTALL_ROOT="${CENTRAL_TRONSOFTOS_INSTALL_ROOT:-/opt/central-tronsoftos}"
APP_DIR="${CENTRAL_TRONSOFTOS_APP_DIR:-$INSTALL_ROOT/app}"
ENV_FILE="${CENTRAL_TRONSOFTOS_ENV_FILE:-/etc/central-tronsoftos/central.env}"
PORT="${CENTRAL_TRONSOFTOS_PORT:-3080}"
DOMAIN="${CENTRAL_TRONSOFTOS_DOMAIN:-central.tronsoft.app.br}"
SETUP_NGINX="${CENTRAL_TRONSOFTOS_SETUP_NGINX:-ask}"
SETUP_CLOUDFLARED="${CENTRAL_TRONSOFTOS_SETUP_CLOUDFLARED:-ask}"
CLOUDFLARED_TOKEN="${CENTRAL_TRONSOFTOS_CLOUDFLARED_TOKEN:-}"
CLOUDFLARED_TOKEN_FILE="${CENTRAL_TRONSOFTOS_CLOUDFLARED_TOKEN_FILE:-}"
SETUP_POSTGRES="${CENTRAL_TRONSOFTOS_SETUP_POSTGRES:-ask}"
POSTGRES_DB="${CENTRAL_TRONSOFTOS_POSTGRES_DB:-central_tronsoftos}"
POSTGRES_USER="${CENTRAL_TRONSOFTOS_POSTGRES_USER:-central_tronsoftos}"
POSTGRES_PASSWORD="${CENTRAL_TRONSOFTOS_POSTGRES_PASSWORD:-}"
DATABASE_URL="${CENTRAL_TRONSOFTOS_DATABASE_URL:-}"
ADMIN_EMAIL="${CENTRAL_TRONSOFTOS_ADMIN_EMAIL:-suporte@tronsoft.com.br}"
ADMIN_PASSWORD="${CENTRAL_TRONSOFTOS_ADMIN_PASSWORD:-}"
INSTALL_NODE="${CENTRAL_TRONSOFTOS_INSTALL_NODE:-ask}"
NODE_MAJOR="${CENTRAL_TRONSOFTOS_NODE_MAJOR:-22}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN=""

log() {
  printf '\n\033[1;36m==>\033[0m %s\n' "$*"
}

warn() {
  printf '\n\033[1;33mAVISO:\033[0m %s\n' "$*"
}

fail() {
  printf '\n\033[1;31mERRO:\033[0m %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Comando obrigatorio nao encontrado: $1"
}

as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

as_postgres() {
  if [[ "$(id -u)" -eq 0 ]]; then
    runuser -u postgres -- "$@"
  else
    sudo -u postgres "$@"
  fi
}

ask_yes_no() {
  local question="$1"
  local default="${2:-n}"
  local answer
  local hint="[s/N]"
  [[ "$default" == "s" ]] && hint="[S/n]"

  if [[ ! -t 0 ]]; then
    [[ "$default" == "s" ]]
    return
  fi

  read -r -p "$question $hint " answer
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[sSyY]$ ]]
}

ask_secret() {
  local question="$1"
  local answer=""

  if [[ ! -t 0 ]]; then
    printf ''
    return
  fi

  read -r -s -p "$question " answer
  printf '\n' >&2
  printf '%s' "$answer"
}

node_major_version() {
  if ! command -v node >/dev/null 2>&1; then
    echo 0
    return
  fi
  node --version | sed -E 's/^v([0-9]+).*/\1/'
}

install_node_from_nodesource() {
  log "Instalando Node.js ${NODE_MAJOR}.x via NodeSource"
  as_root apt-get update
  as_root apt-get install -y ca-certificates curl gnupg
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | as_root bash -
  as_root apt-get install -y nodejs
}

ensure_node() {
  local major
  major="$(node_major_version)"
  if [[ "$major" -ge 20 ]]; then
    log "Node.js encontrado: $(node --version)"
    return
  fi

  case "$INSTALL_NODE" in
    yes|sim|s|true|1)
      install_node_from_nodesource
      ;;
    no|nao|n|false|0)
      fail "Node.js 20+ e obrigatorio. Instale Node.js e rode novamente."
      ;;
    *)
      if ask_yes_no "Node.js 20+ nao foi encontrado. Instalar Node.js ${NODE_MAJOR}.x agora?" "s"; then
        install_node_from_nodesource
      else
        fail "Instalacao interrompida: Node.js 20+ e obrigatorio."
      fi
      ;;
  esac

  major="$(node_major_version)"
  [[ "$major" -ge 20 ]] || fail "Node.js instalado, mas a versao ainda e menor que 20."
}

ensure_curl() {
  if command -v curl >/dev/null 2>&1; then
    return
  fi

  log "Instalando curl"
  as_root apt-get update
  as_root apt-get install -y ca-certificates curl
}

validate_pg_name() {
  local value="$1"
  local label="$2"
  [[ "$value" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || fail "$label invalido para PostgreSQL: $value"
}

sql_literal() {
  local value="$1"
  printf "'%s'" "${value//\'/\'\'}"
}

random_password() {
  node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
}

setup_postgres() {
  validate_pg_name "$POSTGRES_DB" "Nome do banco"
  validate_pg_name "$POSTGRES_USER" "Usuario do banco"

  log "Instalando/configurando PostgreSQL"
  as_root apt-get update
  as_root apt-get install -y postgresql postgresql-client
  as_root systemctl enable postgresql
  as_root systemctl start postgresql

  if [[ -z "$POSTGRES_PASSWORD" ]]; then
    POSTGRES_PASSWORD="$(random_password)"
  fi

  local password_sql
  password_sql="$(sql_literal "$POSTGRES_PASSWORD")"

  as_postgres psql -v ON_ERROR_STOP=1 <<EOF
do \$\$
begin
  if not exists (select 1 from pg_roles where rolname = '$POSTGRES_USER') then
    create role $POSTGRES_USER login password $password_sql;
  else
    alter role $POSTGRES_USER with login password $password_sql;
  end if;
end
\$\$;
EOF

  if ! as_postgres psql -tAc "select 1 from pg_database where datname = '$POSTGRES_DB'" | grep -q 1; then
    as_postgres createdb -O "$POSTGRES_USER" "$POSTGRES_DB"
  fi

  as_postgres psql -v ON_ERROR_STOP=1 -d "$POSTGRES_DB" -c "grant all privileges on database $POSTGRES_DB to $POSTGRES_USER;"
  as_postgres psql -v ON_ERROR_STOP=1 -d "$POSTGRES_DB" -c "grant all on schema public to $POSTGRES_USER;"
  DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}"
}

maybe_setup_postgres() {
  if [[ -n "$DATABASE_URL" ]]; then
    log "DATABASE_URL ja informado; pulando criacao local do PostgreSQL"
    return
  fi

  case "$SETUP_POSTGRES" in
    yes|sim|s|true|1)
      setup_postgres
      ;;
    no|nao|n|false|0)
      warn "PostgreSQL nao sera configurado. A Central usara JSON local se DATABASE_URL ficar vazio."
      ;;
    *)
      if ask_yes_no "Instalar/configurar PostgreSQL local para a Central?" "s"; then
        setup_postgres
      else
        warn "PostgreSQL nao sera configurado. A Central usara JSON local se DATABASE_URL ficar vazio."
      fi
      ;;
  esac
}

ensure_admin_credentials() {
  if [[ -n "$ADMIN_PASSWORD" ]]; then
    return
  fi

  if [[ -t 0 ]]; then
    ADMIN_PASSWORD="$(ask_secret "Senha inicial do admin TronSoft (${ADMIN_EMAIL}):")"
  fi

  if [[ -z "$ADMIN_PASSWORD" ]]; then
    ADMIN_PASSWORD="$(random_password)"
    warn "Senha admin gerada automaticamente. Guarde este valor: $ADMIN_PASSWORD"
  fi
}

ensure_user() {
  if id "$APP_USER" >/dev/null 2>&1; then
    log "Usuario $APP_USER ja existe"
    return
  fi

  log "Criando usuario de servico $APP_USER"
  as_root adduser --system --group --home "$INSTALL_ROOT" "$APP_USER"
}

copy_app() {
  log "Instalando arquivos em $APP_DIR"
  as_root mkdir -p "$APP_DIR" "$APP_DIR/data" "$(dirname "$ENV_FILE")"

  if [[ "$SOURCE_DIR" == "$APP_DIR" ]]; then
    warn "Origem e destino sao iguais; mantendo arquivos atuais."
  else
    local tmp
    tmp="$(mktemp -d)"
    (
      cd "$SOURCE_DIR"
      tar \
        --exclude='./.git' \
        --exclude='./.agents' \
        --exclude='./data/*.json' \
        --exclude='data/*.json' \
        --exclude='./node_modules' \
        --exclude='./dist' \
        --exclude='./build' \
        -cf "$tmp/app.tar" .
    )
    as_root tar -xf "$tmp/app.tar" -C "$APP_DIR"
    rm -rf "$tmp"
  fi

  as_root mkdir -p "$APP_DIR/data"
  as_root chown -R "$APP_USER:$APP_GROUP" "$INSTALL_ROOT"
}

install_app_dependencies() {
  log "Instalando dependencias Node da Central"
  (
    cd "$APP_DIR"
    as_root npm install --omit=dev
  )
  as_root chown -R "$APP_USER:$APP_GROUP" "$INSTALL_ROOT"
}

upsert_env_line() {
  local key="$1"
  local value="$2"
  local escaped
  escaped="${value//\\/\\\\}"
  escaped="${escaped//&/\\&}"

  if as_root test -f "$ENV_FILE" && as_root grep -q "^${key}=" "$ENV_FILE"; then
    as_root sed -i "s#^${key}=.*#${key}=${escaped}#" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" | as_root tee -a "$ENV_FILE" >/dev/null
  fi
}

write_env() {
  log "Configurando $ENV_FILE"
  as_root mkdir -p "$(dirname "$ENV_FILE")"
  as_root touch "$ENV_FILE"
  upsert_env_line "PORT" "$PORT"
  if [[ -n "$DATABASE_URL" ]]; then
    upsert_env_line "DATABASE_URL" "$DATABASE_URL"
  fi
  upsert_env_line "CENTRAL_ADMIN_EMAIL" "$ADMIN_EMAIL"
  upsert_env_line "CENTRAL_ADMIN_PASSWORD" "$ADMIN_PASSWORD"
  as_root chmod 640 "$ENV_FILE"
  as_root chown "root:$APP_GROUP" "$ENV_FILE"
}

write_systemd() {
  NODE_BIN="$(command -v node)"
  log "Configurando systemd"
  as_root tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<EOF
[Unit]
Description=Central TronSoftOS
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN src/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

  as_root systemctl daemon-reload
  as_root systemctl enable "$SERVICE_NAME"
  as_root systemctl restart "$SERVICE_NAME"
}

install_backup_service() {
  if [[ -f "$APP_DIR/scripts/install-backup-service.sh" ]]; then
    log "Configurando backup automatico da Central"
    as_root env \
      CENTRAL_TRONSOFTOS_SERVICE="$SERVICE_NAME" \
      CENTRAL_TRONSOFTOS_USER="$APP_USER" \
      CENTRAL_TRONSOFTOS_APP_DIR="$APP_DIR" \
      CENTRAL_TRONSOFTOS_ENV_FILE="$ENV_FILE" \
      bash "$APP_DIR/scripts/install-backup-service.sh"
  else
    warn "Script de backup nao encontrado em $APP_DIR/scripts/install-backup-service.sh"
  fi
}

setup_nginx() {
  log "Configurando Nginx para $DOMAIN"
  as_root apt-get update
  as_root apt-get install -y nginx

  as_root tee "/etc/nginx/sites-available/${SERVICE_NAME}" >/dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

  as_root ln -sfn "/etc/nginx/sites-available/${SERVICE_NAME}" "/etc/nginx/sites-enabled/${SERVICE_NAME}"
  as_root nginx -t
  as_root systemctl enable nginx
  as_root systemctl reload nginx
}

maybe_setup_nginx() {
  case "$SETUP_NGINX" in
    yes|sim|s|true|1)
      setup_nginx
      ;;
    no|nao|n|false|0)
      log "Pulando Nginx. A Central ficara em http://127.0.0.1:$PORT"
      ;;
    *)
      if ask_yes_no "Configurar Nginx para o dominio $DOMAIN?" "s"; then
        setup_nginx
      else
        log "Pulando Nginx. A Central ficara em http://127.0.0.1:$PORT"
      fi
      ;;
  esac
}

cloudflared_deb_url() {
  local arch
  arch="$(dpkg --print-architecture)"
  case "$arch" in
    amd64)
      printf 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb'
      ;;
    arm64)
      printf 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb'
      ;;
    armhf)
      printf 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm.deb'
      ;;
    *)
      fail "Arquitetura nao suportada automaticamente para cloudflared: $arch"
      ;;
  esac
}

install_cloudflared() {
  if command -v cloudflared >/dev/null 2>&1; then
    log "cloudflared encontrado: $(cloudflared --version | head -n 1)"
    return
  fi

  ensure_curl
  need_cmd dpkg

  local deb
  deb="$(mktemp --suffix=.deb)"
  log "Baixando cloudflared"
  curl -fsSL "$(cloudflared_deb_url)" -o "$deb"
  as_root dpkg -i "$deb" || {
    as_root apt-get install -f -y
    as_root dpkg -i "$deb"
  }
  rm -f "$deb"
}

setup_cloudflared() {
  install_cloudflared

  local token="$CLOUDFLARED_TOKEN"
  if [[ -z "$token" && -n "$CLOUDFLARED_TOKEN_FILE" ]]; then
    [[ -f "$CLOUDFLARED_TOKEN_FILE" ]] || fail "Arquivo do token Cloudflare nao encontrado: $CLOUDFLARED_TOKEN_FILE"
    token="$(tr -d '\r\n\t ' < "$CLOUDFLARED_TOKEN_FILE")"
  fi
  if [[ -z "$token" ]]; then
    printf 'Cole o token do Cloudflare Tunnel e pressione Enter.\n' >&2
    printf 'Dica: se o terminal nao aceitar colar, use CENTRAL_TRONSOFTOS_CLOUDFLARED_TOKEN_FILE.\n' >&2
    token="$(ask_secret "Token:")"
  fi
  [[ -n "$token" ]] || fail "Token do Cloudflare Tunnel nao informado."

  if systemctl list-unit-files cloudflared.service >/dev/null 2>&1; then
    warn "Servico cloudflared ja existe. Vou reiniciar sem reinstalar o token."
    as_root systemctl enable cloudflared
    as_root systemctl restart cloudflared
  else
    log "Instalando servico cloudflared"
    as_root cloudflared service install "$token"
    as_root systemctl enable cloudflared
    as_root systemctl restart cloudflared
  fi

  as_root systemctl is-active --quiet cloudflared || {
    as_root systemctl status cloudflared --no-pager || true
    fail "cloudflared nao ficou ativo."
  }
}

maybe_setup_cloudflared() {
  case "$SETUP_CLOUDFLARED" in
    yes|sim|s|true|1)
      setup_cloudflared
      ;;
    no|nao|n|false|0)
      log "Pulando Cloudflare Tunnel."
      ;;
    *)
      if ask_yes_no "Instalar/configurar cloudflared com token do Tunnel para $DOMAIN?" "s"; then
        setup_cloudflared
      else
        log "Pulando Cloudflare Tunnel."
      fi
      ;;
  esac
}

health_check() {
  log "Validando servico"
  sleep 2
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "http://127.0.0.1:$PORT/health" || {
      as_root systemctl status "$SERVICE_NAME" --no-pager || true
      fail "Health check falhou."
    }
  else
    as_root systemctl is-active --quiet "$SERVICE_NAME" || {
      as_root systemctl status "$SERVICE_NAME" --no-pager || true
      fail "Servico nao esta ativo."
    }
  fi
}

main() {
  [[ -f "$SOURCE_DIR/package.json" ]] || fail "Rode este instalador a partir da pasta clonada da Central TronSoftOS."
  need_cmd tar
  need_cmd sed
  if [[ "$(id -u)" -ne 0 ]]; then
    need_cmd sudo
  fi

  log "Instalador da Central TronSoftOS"
  ensure_node
  maybe_setup_postgres
  ensure_admin_credentials
  ensure_user
  copy_app
  install_app_dependencies
  write_env
  write_systemd
  install_backup_service
  maybe_setup_nginx
  maybe_setup_cloudflared
  health_check

  log "Instalacao concluida"
  printf 'Servico: %s\n' "$SERVICE_NAME"
  printf 'App: %s\n' "$APP_DIR"
  printf 'Env: %s\n' "$ENV_FILE"
  printf 'Local: http://127.0.0.1:%s\n' "$PORT"
  printf 'Dominio/tunnel: http://%s\n' "$DOMAIN"
  printf '\nComandos uteis:\n'
  printf '  sudo systemctl status %s\n' "$SERVICE_NAME"
  printf '  sudo journalctl -u %s -f\n' "$SERVICE_NAME"
  printf '  sudo systemctl status cloudflared\n'
  printf '  sudo journalctl -u cloudflared -f\n'
}

main "$@"
