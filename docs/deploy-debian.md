# Deploy em Debian via SSH

Este guia instala a Central TronSoftOS como servico `systemd` em um servidor Debian.

## O que ja existe

- Frontend simples servido pelo proprio Node em `/`.
- API de ingestao em `/api/tronsoftos/*`.
- Persistencia em PostgreSQL quando `DATABASE_URL` esta configurado.
- Fallback local em JSON dentro de `data/central-db.json` apenas para desenvolvimento.

Importante: no Debian, o instalador configura PostgreSQL por padrao. O JSON nao deve ser usado para producao.

## Requisitos

- Debian com acesso SSH.
- Node.js 20 ou superior.
- PostgreSQL local ou `DATABASE_URL` de um PostgreSQL existente.
- Usuario Linux dedicado para rodar a aplicacao.
- Porta liberada no firewall, ou Nginx fazendo proxy.

## Instalacao automatica

No servidor Debian 13:

```bash
sudo apt-get update
sudo apt-get install -y git
git clone URL_DO_REPOSITORIO central-tronsoftos
cd central-tronsoftos
bash install.sh
```

Padroes do instalador:

- app em `/opt/central-tronsoftos/app`;
- usuario de servico `central-tronsoftos`;
- ambiente em `/etc/central-tronsoftos/central.env`;
- servico `central-tronsoftos.service`;
- PostgreSQL local com banco `central_tronsoftos`;
- porta `3080`;
- dominio `central.tronsoft.app.br`;
- opcionalmente instala `cloudflared` e registra o servico do Tunnel.
- solicita ou gera senha inicial para o admin TronSoft.

Instalacao sem perguntas:

```bash
CENTRAL_TRONSOFTOS_SETUP_NGINX=yes \
CENTRAL_TRONSOFTOS_SETUP_POSTGRES=yes \
CENTRAL_TRONSOFTOS_ADMIN_EMAIL=suporte@tronsoft.com.br \
CENTRAL_TRONSOFTOS_DOMAIN=central.tronsoft.app.br \
CENTRAL_TRONSOFTOS_PORT=3080 \
bash install.sh
```

Instalacao com Cloudflare Tunnel por token:

```bash
CENTRAL_TRONSOFTOS_SETUP_NGINX=no \
CENTRAL_TRONSOFTOS_SETUP_POSTGRES=yes \
CENTRAL_TRONSOFTOS_SETUP_CLOUDFLARED=yes \
CENTRAL_TRONSOFTOS_ADMIN_EMAIL=suporte@tronsoft.com.br \
CENTRAL_TRONSOFTOS_CLOUDFLARED_TOKEN='COLE_O_TOKEN_DO_TUNNEL_AQUI' \
bash install.sh
```

Para evitar deixar o token no historico do shell, rode sem a variavel `CENTRAL_TRONSOFTOS_CLOUDFLARED_TOKEN`; o instalador vai pedir o token em modo oculto:

```bash
CENTRAL_TRONSOFTOS_SETUP_NGINX=no \
CENTRAL_TRONSOFTOS_SETUP_POSTGRES=yes \
CENTRAL_TRONSOFTOS_SETUP_CLOUDFLARED=yes \
CENTRAL_TRONSOFTOS_ADMIN_EMAIL=suporte@tronsoft.com.br \
bash install.sh
```

Se o SSH nao deixar colar o token no prompt, use arquivo temporario:

```bash
nano /root/cloudflare-token.txt
chmod 600 /root/cloudflare-token.txt

CENTRAL_TRONSOFTOS_SETUP_NGINX=no \
CENTRAL_TRONSOFTOS_SETUP_POSTGRES=yes \
CENTRAL_TRONSOFTOS_SETUP_CLOUDFLARED=yes \
CENTRAL_TRONSOFTOS_CLOUDFLARED_TOKEN_FILE=/root/cloudflare-token.txt \
CENTRAL_TRONSOFTOS_ADMIN_EMAIL=suporte@tronsoft.com.br \
bash install.sh

rm -f /root/cloudflare-token.txt
```

Usando um PostgreSQL externo:

```bash
CENTRAL_TRONSOFTOS_DATABASE_URL='postgresql://usuario:senha@host:5432/banco' \
CENTRAL_TRONSOFTOS_SETUP_POSTGRES=no \
bash install.sh
```

Comandos uteis:

```bash
sudo systemctl status central-tronsoftos
sudo journalctl -u central-tronsoftos -f
sudo systemctl status cloudflared
sudo journalctl -u cloudflared -f
curl http://127.0.0.1:3080/health
```

O `/health` deve indicar o storage ativo:

```json
{
  "storage": {
    "driver": "postgres"
  }
}
```

## Cloudflare Tunnel

Se voce ja usa Cloudflare Tunnel para `central.tronsoft.app.br`, o tunnel deve apontar direto para:

```text
http://127.0.0.1:3080
```

Nesse caso, responda `n` quando o instalador perguntar sobre Nginx, e responda `s` quando ele perguntar sobre `cloudflared`. Tambem pode rodar sem perguntas:

```bash
CENTRAL_TRONSOFTOS_SETUP_NGINX=no \
CENTRAL_TRONSOFTOS_SETUP_POSTGRES=yes \
CENTRAL_TRONSOFTOS_SETUP_CLOUDFLARED=yes \
bash install.sh
```

Se preferir usar Nginx como intermediario local, deixe o instalador configurar Nginx e aponte o tunnel para:

```text
http://127.0.0.1:80
```

## Instalacao manual

## 1. Acessar o servidor

```bash
ssh usuario@ip-do-servidor
```

## 2. Instalar Node.js e PostgreSQL

Se o Node.js ainda nao estiver instalado, instale uma versao LTS recente. Exemplo usando NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo apt-get install -y postgresql postgresql-client
node --version
```

## 3. Criar usuario da aplicacao

```bash
sudo adduser --system --group --home /opt/central-tronsoftos central-tronsoftos
```

## 4. Enviar o projeto para o servidor

No seu computador, dentro da pasta do projeto:

```bash
scp -r . usuario@ip-do-servidor:/tmp/central-tronsoftos
```

No servidor:

```bash
sudo mkdir -p /opt/central-tronsoftos/app
sudo cp -r /tmp/central-tronsoftos/* /opt/central-tronsoftos/app/
sudo chown -R central-tronsoftos:central-tronsoftos /opt/central-tronsoftos
```

## 5. Criar arquivo de ambiente

```bash
sudo cp /opt/central-tronsoftos/app/.env.example /opt/central-tronsoftos/app/.env
sudo nano /opt/central-tronsoftos/app/.env
```

Conteudo inicial:

```text
PORT=3080
DATABASE_URL=postgresql://central_tronsoftos:senha@127.0.0.1:5432/central_tronsoftos
CENTRAL_ADMIN_EMAIL=suporte@tronsoft.com.br
CENTRAL_ADMIN_PASSWORD=senha-forte
```

## 6. Criar servico systemd

```bash
sudo nano /etc/systemd/system/central-tronsoftos.service
```

Conteudo:

```ini
[Unit]
Description=Central TronSoftOS
After=network.target

[Service]
Type=simple
User=central-tronsoftos
Group=central-tronsoftos
WorkingDirectory=/opt/central-tronsoftos/app
EnvironmentFile=/opt/central-tronsoftos/app/.env
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Ativar:

```bash
sudo systemctl daemon-reload
sudo systemctl enable central-tronsoftos
sudo systemctl start central-tronsoftos
sudo systemctl status central-tronsoftos
```

## 7. Testar localmente no servidor

```bash
curl http://localhost:3080/health
```

Resposta esperada:

```json
{
  "ok": true,
  "service": "central-tronsoftos"
}
```

## 8. Expor com Nginx

Instalar:

```bash
sudo apt-get install -y nginx
```

Criar site:

```bash
sudo nano /etc/nginx/sites-available/central-tronsoftos
```

Conteudo:

```nginx
server {
    listen 80;
    server_name central.seudominio.com.br;

    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Ativar:

```bash
sudo ln -s /etc/nginx/sites-available/central-tronsoftos /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 9. HTTPS

Depois do DNS apontar para o servidor, use Certbot:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d central.seudominio.com.br
```

## Rotas principais

- Frontend: `http://servidor:3080/`
- Saude: `GET /health`
- Identificacao: `POST /api/tronsoftos/identify`
- Heartbeat: `POST /api/tronsoftos/heartbeat`
- Alertas: `POST /api/tronsoftos/alerts`

## Backup e restauracao

O `install.sh` instala:

- `/usr/local/sbin/central-tronsoftos-backup`
- `/usr/local/sbin/central-tronsoftos-restore`
- `central-tronsoftos-backup.service`
- `central-tronsoftos-backup.timer`

Verificar timer:

```bash
sudo systemctl status central-tronsoftos-backup.timer
sudo systemctl list-timers central-tronsoftos-backup.timer
```

Executar backup manual:

```bash
sudo /usr/local/sbin/central-tronsoftos-backup run
```

Arquivos locais:

```bash
sudo ls -lh /var/backups/central-tronsoftos
sudo cat /var/backups/central-tronsoftos/latest.json
```

Restaurar em outro Debian:

```bash
sudo /usr/local/sbin/central-tronsoftos-restore /var/backups/central-tronsoftos/central-YYYYmmdd-HHMMSS.tar.gz
```

Para copia remota via `rclone`, configure em `/etc/central-tronsoftos/central.env`:

```env
CENTRAL_TRONSOFTOS_BACKUP_RCLONE_REMOTE=gdrive:central-tronsoftos
CENTRAL_TRONSOFTOS_BACKUP_RETENTION_DAYS=30
```

## Observacoes para piloto

- Confira se o backup diario esta ativo antes de cadastrar clientes reais.
- Mantenha a porta `3080` fechada externamente se estiver usando Nginx.
- Use HTTPS antes de enviar tokens de instalacao pela internet.
- Teste restauracao em outro Debian antes de producao.
