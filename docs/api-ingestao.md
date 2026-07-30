# API de Ingestao TronSoftOS

Esta API recebe a identificacao da instalacao TronSoftOS, atualizacoes de saude e alertas/notificacoes.

## Subir servidor local

```bash
npm run dev
```

No PowerShell, se `npm.ps1` estiver bloqueado pela politica de execucao:

```bash
node src/server.js
```

Endereco padrao:

```text
http://localhost:3080
```

## Fluxo oficial de pareamento

1. A revenda cadastra o cliente na Central.
2. A Central gera um token de pareamento.
3. O tecnico abre o TronSoftOS do cliente em Manutencao > Ajustes > Central TronSoftOS.
4. O tecnico informa a URL `https://central.tronsoft.app.br` e cola o token.
5. O TronSoftOS valida o token na Central e recebe um token interno de instalacao.
6. A partir dai, o TronSoftOS envia heartbeats e alertas automaticamente.

## Cadastrar cliente e gerar token

`POST /api/admin/clients`

```json
{
  "reseller": {
    "name": "Alpha Sistemas",
    "document": "00000000000100"
  },
  "customer": {
    "name": "Mercado Sol Nascente",
    "document": "11111111000199",
    "city": "Sao Paulo",
    "state": "SP"
  }
}
```

Resposta:

```json
{
  "client": {
    "id": "id-do-cliente",
    "name": "Mercado Sol Nascente"
  },
  "pairingToken": {
    "token": "cts_token_de_pareamento"
  }
}
```

Esse `pairingToken.token` e o valor que o tecnico informa no frontend do TronSoftOS.

## Validar token pelo TronSoftOS

`POST /api/tronsoftos/pair`

Usado pelo backend do TronSoftOS depois que o tecnico informa o token na guia Manutencao.

```json
{
  "pairingToken": "cts_token_de_pareamento",
  "installationId": "cliente-001-matriz",
  "environment": {
    "name": "Matriz"
  },
  "tronsoftos": {
    "version": "2026.7.0",
    "build": "1250",
    "channel": "stable"
  },
  "database": {
    "engine": "Firebird",
    "version": "2.5",
    "schemaVersion": "2026.07.001"
  },
  "host": {
    "hostname": "srv-mercado-01",
    "os": "Linux 6.x",
    "ip": "192.168.0.10"
  }
}
```

Resposta:

```json
{
  "ok": true,
  "installationId": "cliente-001-matriz",
  "installationToken": "token-da-instalacao",
  "clientId": "id-do-cliente",
  "status": "online"
}
```

O TronSoftOS guarda o `installationToken` para chamadas futuras.

## Autenticar Google Drive pela Central

Esse fluxo substitui a configuracao manual do `rclone config`. A Central faz o OAuth Google, guarda o refresh token por instalacao e entrega ao TronSoftOS um `rclone.conf` pronto para uso.

Todas as chamadas do TronSoftOS usam:

```text
x-installation-token: token-da-instalacao
```

### Consultar status

`GET /api/tronsoftos/oauth/google/status`

Resposta:

```json
{
  "configured": true,
  "connected": false,
  "installationId": "cliente-001-matriz",
  "account": null,
  "redirectUri": "https://central.tronsoft.app.br/api/oauth/google/callback",
  "scopes": ["https://www.googleapis.com/auth/drive.file"]
}
```

### Iniciar autenticacao

`POST /api/tronsoftos/oauth/google/start`

```json
{
  "remote": "gdrive",
  "path": "tronsoftos/backups"
}
```

Resposta:

```json
{
  "provider": "google",
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "state": "estado-temporario",
  "expiresAt": "2026-07-14T12:15:00.000Z",
  "redirectUri": "https://central.tronsoft.app.br/api/oauth/google/callback"
}
```

O TronSoftOS deve abrir `authUrl` no navegador. Ao finalizar, o Google chama:

```text
GET /api/oauth/google/callback
```

### Obter configuracao pronta

Depois da autorizacao, o TronSoftOS chama:

`POST /api/tronsoftos/oauth/google/token`

Resposta:

```json
{
  "connected": true,
  "account": {
    "provider": "google",
    "accountEmail": "cliente@gmail.com",
    "remote": "gdrive",
    "path": "tronsoftos/backups"
  },
  "token": {
    "access_token": "ya29...",
    "refresh_token": "1//...",
    "token_type": "Bearer",
    "expiry": "2026-07-14T13:00:00.000Z"
  },
  "rclone": {
    "remote": "gdrive",
    "path": "tronsoftos/backups",
    "configContent": "[gdrive]\ntype = drive\nscope = drive\n..."
  }
}
```

O TronSoftOS grava `rclone.configContent` no caminho local do `rclone.conf`, salva `remote/path` e habilita os backups sem pedir que o tecnico rode o fluxo manual do rclone.

## Identificar instalacao legado

`POST /api/tronsoftos/identify`

Fluxo antigo em que o TronSoftOS se apresenta criando cliente automaticamente. O fluxo recomendado agora e o pareamento com token gerado na Central.

```json
{
  "installationId": "cliente-001-matriz",
  "reseller": {
    "name": "Alpha Sistemas",
    "document": "00000000000100"
  },
  "customer": {
    "name": "Mercado Sol Nascente",
    "document": "11111111000199",
    "city": "Sao Paulo",
    "state": "SP"
  },
  "environment": {
    "name": "Matriz"
  },
  "tronsoftos": {
    "version": "2026.7.0",
    "build": "1250",
    "channel": "stable"
  },
  "database": {
    "engine": "PostgreSQL",
    "version": "16.3",
    "schemaVersion": "2026.07.001",
    "sizeMb": 842
  },
  "host": {
    "hostname": "srv-mercado-01",
    "os": "Windows Server 2022",
    "ip": "192.168.0.10"
  }
}
```

Resposta:

```json
{
  "installationId": "cliente-001-matriz",
  "installationToken": "token-gerado",
  "clientId": "id-do-cliente",
  "resellerId": "id-da-revenda",
  "status": "online"
}
```

Guarde o `installationToken` no TronSoftOS para chamadas futuras.

## Enviar heartbeat

`POST /api/tronsoftos/heartbeat`

Headers:

```text
x-installation-token: token-gerado
```

Payload:

```json
{
  "status": "online",
  "tronsoftos": {
    "version": "2026.7.1"
  },
  "database": {
    "engine": "PostgreSQL",
    "version": "16.3",
    "schemaVersion": "2026.07.002"
  },
  "services": {
    "platform": "linux-docker",
    "apps": [
      {
        "name": "troncomanda",
        "status": "online",
        "containers": [
          {
            "name": "troncomanda_web",
            "status": "running",
            "image": "ghcr.io/tronsoft-solucoes/tron-comanda:main",
            "version": "main"
          }
        ]
      }
    ],
    "containers": [
      {
        "name": "wsl:Ubuntu",
        "status": "running",
        "image": "WSL",
        "imageTag": "2"
      }
    ]
  }
}
```

## Enviar alerta/notificacao

`POST /api/tronsoftos/alerts`

Headers:

```text
x-installation-token: token-gerado
```

Payload:

```json
{
  "severity": "critical",
  "title": "Backup nao executado",
  "message": "O ultimo backup valido tem mais de 24 horas.",
  "code": "BACKUP_STALE",
  "details": {
    "lastBackupAt": "2026-07-02T08:00:00.000Z"
  }
}
```

Se preferir chamar o mesmo fluxo como notificacao, tambem existe:

```text
POST /api/tronsoftos/notifications
```

## Consultas da Central

- `GET /health`
- `GET /api/dashboard`
- `GET /api/clients`
- `GET /api/installations`
- `GET /api/alerts`
