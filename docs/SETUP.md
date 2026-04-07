# Setup local

Como rodar o JT Dashboard no seu computador.

## Pré-requisitos

- macOS, Linux ou WSL2
- Node.js 24+ (`nvm install` se tiver `.nvmrc`)
- pnpm 10+ (`corepack enable && corepack prepare pnpm@10.33.0 --activate`)
- PostgreSQL 16+ (Homebrew, Docker, ou nativo)
- Redis 7+

## Setup

```bash
# 1. Instalar deps Postgres + Redis (Mac)
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis

# 2. Criar database
createdb jt_dashboard

# 3. Clonar e instalar
git clone https://github.com/felipenunesfraga/jt-dashboard.git
cd jt-dashboard
pnpm install

# 4. Configurar .env
cp .env.example .env
```

Editar `.env`:

```bash
DATABASE_URL=postgres://SEU_USUARIO@localhost:5432/jt_dashboard
REDIS_URL=redis://localhost:6379
ADMIN_EMAIL=felipe@jt.local
ADMIN_PASSWORD_HASH=\$2a\$10\$...   # gerar com hash-password.mjs
AUTH_SECRET=qualquer_string_aleatoria_min_32_chars
META_SYSTEM_USER_TOKEN=EAA...
META_ACCOUNTS=[{"account_id":"act_xxx","name":"CA01","pixel_ids":["123"]}]
META_CAPI_DRY_RUN=true   # importante em dev
LOG_LEVEL=debug
```

> **Atenção**: o `$` do bcrypt precisa ser escapado como `\$` no `.env`
> (senão o dotenv parser interpreta como variável).

```bash
# 5. Gerar hash da senha admin (use sua senha, NÃO commitar)
node apps/web/scripts/hash-password.mjs "minha_senha_aqui"
# Cola o resultado em ADMIN_PASSWORD_HASH (lembre do \$ escape)

# 6. Aplicar migrations
pnpm db:migrate

# 7. Subir tudo
pnpm dev
```

- Dashboard: <http://localhost:3000>
- Worker health: <http://localhost:4000/health>

## Comandos úteis

```bash
# Forçar sync Meta agora (não esperar o cron horário)
curl -X POST http://localhost:4000/internal/sync-meta -d '{}'

# Ver dados no Postgres
psql -d jt_dashboard
\dt
SELECT COUNT(*) FROM meta_ads;
SELECT COUNT(*) FROM insights_daily;
```

## Testes manuais (sem credenciais reais de Z-API/GHL)

Os webhooks aceitam payloads simulados. Exemplos completos em
[`docs/RUNBOOK.md`](RUNBOOK.md#testes-manuais-de-webhook).

## Troubleshooting

### "Cannot find module 'pino-pretty'"

```bash
pnpm install
```

### "DATABASE_URL is not set" mesmo tendo `.env`

O dotenv carrega de `.env` na raiz do monorepo. Verifique se o arquivo existe
em `/Users/.../NEW TINTIM/.env` (não em `apps/worker/.env`).

### Hash bcrypt está falhando no login

`$` não escapado. Use `\$2a\$10\$...` no `.env`. Test:
```bash
node -e "console.log(process.env.ADMIN_PASSWORD_HASH?.length)"
# deve imprimir 60
```

### Web não compila

```bash
pnpm --filter @jt/web typecheck
# se reclamar de @jt/db, verificar se packages/db tem o symlink correto
rm -rf node_modules
pnpm install
```
