# Central TronSoftOS

Sistema centralizado para revendas monitorarem clientes que utilizam o TronSoftOS.

## Objetivo

A Central TronSoftOS nasce como um sistema separado do TronSoftOS principal. Ela permite que revendas cadastrem clientes, acompanhem ambientes ativos, monitorem saude operacional e recebam alertas de eventos relevantes.

## Componentes iniciais

- **Central Web**: interface para revendas, operadores e administradores.
- **API Central**: camada de negocio, cadastro, permissoes, relatorios e integracoes.
- **Worker de 0auth**: servico separado para rotinas de autenticacao/autorizacao, sincronizacao de credenciais, renovacao de tokens e eventos de identidade.
- **Agentes TronSoftOS**: clientes monitorados enviam sinais de saude, versao, status e eventos.

## Acesso e escopo

- **TronSoft** (`tronsoft_admin`): visualiza todos os clientes/TronSoftOS, filtra por revenda, cadastra clientes proprios ou vinculados a uma revenda.
- **Revenda** (`reseller_user`): visualiza e cadastra apenas clientes vinculados a sua propria revenda.

## Como executar agora

```bash
npm install
npm run dev
```

No PowerShell, se a politica de execucao bloquear o `npm.ps1`, use:

```bash
node src/server.js
```

Depois acesse:

```text
http://localhost:3080
```

## Deploy em Debian

Instalador para Debian 13 via SSH:

```bash
git clone URL_DO_REPOSITORIO central-tronsoftos
cd central-tronsoftos
bash install.sh
```

Com Cloudflare Tunnel por token:

```bash
CENTRAL_TRONSOFTOS_SETUP_NGINX=no \
CENTRAL_TRONSOFTOS_SETUP_CLOUDFLARED=yes \
bash install.sh
```

Se o terminal SSH nao aceitar colar o token, salve em um arquivo temporario e use:

```bash
CENTRAL_TRONSOFTOS_CLOUDFLARED_TOKEN_FILE=/root/cloudflare-token.txt bash install.sh
```

Guia detalhado com `systemd` e Nginx: `docs/deploy-debian.md`.

No Debian, o instalador configura PostgreSQL por padrao e grava `DATABASE_URL` em `/etc/central-tronsoftos/central.env`. Sem `DATABASE_URL`, a Central usa JSON local apenas como fallback de desenvolvimento.

O instalador tambem grava o usuario inicial da TronSoft:

```text
CENTRAL_ADMIN_EMAIL
CENTRAL_ADMIN_PASSWORD
```

## API inicial

A primeira implementacao recebe:

- cadastro de cliente na Central com geracao de token de pareamento;
- validacao do token informado no frontend do TronSoftOS;
- identificacao do cliente que utiliza TronSoftOS;
- versao do TronSoftOS;
- engine, versao e schema do banco usado pelo cliente;
- heartbeats de saude;
- notificacoes e alertas.

Persistencia:

- PostgreSQL no Debian/instalacao real;
- JSON local apenas em desenvolvimento quando `DATABASE_URL` nao estiver configurado.

Contrato detalhado: `docs/api-ingestao.md`.

## Primeiras entidades

- Revenda
- Cliente
- Ambiente TronSoftOS
- Usuario
- Alerta
- Evento de monitoramento
- Credencial/identidade 0auth

## Estrutura do repositorio

```text
docs/
  api-ingestao.md
  arquitetura.md
  modelo-dados.md
  mvp-backlog.md
  visao-produto.md
install.sh
prototype/
  index.html
  styles.css
  app.js
src/
  server.js
  storage.js
```

## Prototipo

Abra `prototype/index.html` no navegador para visualizar o rascunho estatico, ou rode `npm run dev` para abrir a Central consumindo a API local.
