# JT Dashboard

> Dashboard de atribuição Meta Ads + WhatsApp + GHL para a JT Advocacia Médica.
> Unifica o funil de tráfego pago, classifica leads qualificados/compras por
> mensagens-padrão, e fecha o loop de atribuição enviando eventos de conversão
> de volta ao Meta via Conversions API.

[![CI](https://github.com/felipenunesfraga/jt-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/felipenunesfraga/jt-dashboard/actions/workflows/ci.yml)
[![Release](https://github.com/felipenunesfraga/jt-dashboard/actions/workflows/release.yml/badge.svg)](https://github.com/felipenunesfraga/jt-dashboard/actions/workflows/release.yml)

---

## Visão geral

Sistema single-tenant que substitui ferramentas como Tintim com lógica
proprietária específica para a JT Advocacia Médica. Composto por:

- **`web`** — Dashboard Next.js 15 com auth single-user, KPIs em tempo
  quase-real, funil visual e drill-down por anúncio
- **`worker`** — Backend Fastify + BullMQ que sincroniza Meta Marketing
  API horariamente, processa webhooks de WhatsApp (Z-API) e Go High Level,
  classifica mensagens e dispara eventos CAPI
- **`@jt/db`** — Schema Drizzle compartilhado (7 tabelas Postgres)
- **`@jt/shared`** — Tipos e schemas zod compartilhados

```
┌────────────────────────────────────────────────────────────┐
│  Meta Ads ──pull──▶ jt-worker ──push──▶ Meta CAPI          │
│                         ▲                                  │
│                         │                                  │
│              ┌──────────┴──────────┐                       │
│         POST /webhooks         POST /webhooks              │
│        /whatsapp/:i               /ghl                     │
│              ▲                       ▲                     │
│           Z-API                    GHL                     │
│                                                            │
│  jt-web ◀── SQL ── PostgreSQL ──── Redis ──◀── BullMQ      │
└────────────────────────────────────────────────────────────┘
```

Detalhes em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Requisitos

- **Node.js** ≥ 24 (ver `.nvmrc`)
- **pnpm** ≥ 10 (`corepack enable && corepack prepare pnpm@10.33.0 --activate`)
- **PostgreSQL** ≥ 14 (recomendado 16)
- **Redis** ≥ 7

## Setup local

```bash
# 1. Clonar e instalar
git clone https://github.com/felipenunesfraga/jt-dashboard.git
cd jt-dashboard
pnpm install

# 2. Subir Postgres + Redis (Homebrew no Mac)
brew services start postgresql@16
brew services start redis
createdb jt_dashboard

# 3. Configurar .env
cp .env.example .env
nano .env  # preencher META_SYSTEM_USER_TOKEN, ADMIN_PASSWORD_HASH, etc.

# 4. Aplicar migrations
pnpm db:generate  # opcional, só se mudou schema
pnpm db:migrate

# 5. Rodar dev (web + worker em paralelo)
pnpm dev
```

- Dashboard: <http://localhost:3000>
- Worker: <http://localhost:4000>
- Health: <http://localhost:4000/health>

Mais detalhes em [`docs/SETUP.md`](docs/SETUP.md).

## Stack

| Camada      | Tecnologia                                                  |
| ----------- | ----------------------------------------------------------- |
| Monorepo    | pnpm workspaces                                             |
| Linguagem   | TypeScript estrito                                          |
| Web         | Next.js 15 App Router · Tailwind v4 · Recharts · Auth.js v5 |
| Worker      | Fastify · BullMQ · Pino                                     |
| DB          | PostgreSQL 16 · Drizzle ORM                                 |
| Cache/Queue | Redis 7                                                     |
| CI/CD       | GitHub Actions · GHCR · Watchtower                          |
| Deploy      | Docker Compose · Portainer                                  |

## Scripts

```bash
pnpm dev               # web + worker em paralelo (watch)
pnpm build             # build de tudo (Next.js + types)
pnpm typecheck         # tsc --noEmit em todos os packages
pnpm lint              # ESLint
pnpm format            # Prettier write

pnpm db:generate       # gera nova migration a partir do schema
pnpm db:migrate        # aplica migrations
pnpm db:studio         # GUI Drizzle
```

## Deploy

Auto-deploy via GitHub Actions + Watchtower:

1. Push para `main` →
2. GitHub Actions builda imagens Docker e dá push para `ghcr.io` →
3. Watchtower no servidor detecta nova imagem (em ≤30s) →
4. Containers atualizados com zero downtime

Setup completo em [`docs/AUTO_DEPLOY.md`](docs/AUTO_DEPLOY.md) e
[`docs/DEPLOY.md`](docs/DEPLOY.md).

Operação dia a dia em [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## Estrutura

```
.
├── apps/
│   ├── web/                    Next.js 15 dashboard
│   └── worker/                 Fastify + BullMQ
├── packages/
│   ├── db/                     Drizzle schema + client
│   └── shared/                 Tipos e env zod schemas
├── scripts/
│   └── backup.sh               pg_dump diário
├── docs/
│   ├── ARCHITECTURE.md         Visão de alto nível
│   ├── SETUP.md                Setup local
│   ├── DEPLOY.md               Deploy em produção
│   ├── AUTO_DEPLOY.md          Pipeline CI/CD
│   └── RUNBOOK.md              Operação dia a dia
├── .github/
│   ├── workflows/
│   │   ├── ci.yml              Typecheck + lint
│   │   └── release.yml         Build + push GHCR
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE.md
├── Dockerfile.web
├── Dockerfile.worker
├── docker-compose.prod.yml
├── CLAUDE.md                   Instruções pro Claude Code
├── PROGRESS.md                 Estado vivo do projeto
└── README.md
```

## Segurança

- Tokens e credenciais **nunca** são commitados ou logados — todos vivem em
  variáveis de ambiente. Helper `redactToken()` no worker mascara tokens em
  logs por defesa em profundidade.
- Auth single-user via bcrypt hash em variável de ambiente
- Webhooks externos (Z-API, GHL) podem usar `X-JT-Webhook-Token` opcional
- Todas as PII (telefone, email, nome) são hasheadas SHA256 antes de irem ao
  Meta CAPI conforme spec do Meta

## Licença

Proprietary — Felipe Nunes Fraga / JT Advocacia Médica. Uso restrito.
Ver [`LICENSE`](LICENSE).
