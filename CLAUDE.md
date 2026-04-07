# JT Dashboard — Instruções para o Claude

## O que é

Dashboard de atribuição Meta Ads + WhatsApp + GHL para a JT Advocacia Médica.
Single-tenant, single-user (Felipe), proprietário. Substitui ferramentas como
Tintim com lógica específica do JT.

## Documentos vivos — LEIA AO INICIAR

1. **`README.md`** — visão geral pública
2. **`PROGRESS.md`** — estado vivo. **Leia ao iniciar uma sessão e atualize ao
   completar tarefas significativas.**
3. **`docs/ARCHITECTURE.md`** — diagramas e fluxos de dados
4. **`docs/AUTO_DEPLOY.md`** — pipeline CI/CD (push → produção em ~3 min)
5. **`docs/SETUP.md`** — setup local
6. **`docs/DEPLOY.md`** — primeiro deploy + config Portainer
7. **`docs/RUNBOOK.md`** — operação dia a dia
8. **`/Users/felipenunesfraga/.claude/plans/jaunty-wobbling-map.md`** — plano técnico aprovado
9. **`Jsons n8n teste - api oficial eventos/`** — REFERÊNCIA antiga (Palm Up era o provedor antigo). Não é código rodando.

## Status atual

✅ Todas as 7 fases técnicas completas.
🟡 Em deploy: subindo a stack no Portainer Hetzner (`<PORTAINER_URL>`)

Quem quer ver a tabela completa: `PROGRESS.md`.

## Stack

| Camada      | Tecnologia                                                  |
| ----------- | ----------------------------------------------------------- |
| Monorepo    | pnpm workspaces                                             |
| Linguagem   | TypeScript estrito (`noUncheckedIndexedAccess`)             |
| Web         | Next.js 15 App Router · Tailwind v4 · Recharts · Auth.js v5 |
| Worker      | Fastify · BullMQ · Pino · `tsx` em runtime                  |
| DB          | PostgreSQL 16 + Drizzle ORM                                 |
| Cache/Queue | Redis 7                                                     |
| CI          | GitHub Actions (`ci.yml`) — typecheck + lint + format       |
| Release     | GitHub Actions (`release.yml`) → GHCR → Watchtower          |
| Deploy      | Docker Compose · Portainer · Traefik · Hetzner              |

## Estrutura

```
.
├── apps/
│   ├── web/                    Next.js 15 dashboard
│   └── worker/                 Fastify + BullMQ
├── packages/
│   ├── db/                     Drizzle schema + cliente lazy
│   └── shared/                 Tipos e env zod schemas
├── scripts/
│   └── backup.sh               pg_dump diário
├── docs/
│   ├── ARCHITECTURE.md         Visão alto nível
│   ├── SETUP.md                Setup local
│   ├── DEPLOY.md               Primeiro deploy
│   ├── AUTO_DEPLOY.md          Pipeline CI/CD
│   └── RUNBOOK.md              Operação
├── .github/
│   ├── workflows/
│   │   ├── ci.yml              Typecheck/lint/format em PRs e pushes
│   │   └── release.yml         Build + push GHCR em pushes pra main
│   ├── ISSUE_TEMPLATE/
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── CODEOWNERS
├── .husky/                     pre-commit + commit-msg hooks
├── eslint.config.mjs           ESLint flat config
├── commitlint.config.mjs       conventional commits
├── Dockerfile.web              multi-stage Next standalone
├── Dockerfile.worker           single-stage com tsx
├── docker-compose.prod.yml     stack completa: postgres, redis, web, worker, watchtower, backup
├── .env.production.example     template prod
├── CLAUDE.md                   este arquivo
├── PROGRESS.md                 estado vivo
├── README.md
├── CONTRIBUTING.md
└── LICENSE                     proprietary
```

## Comandos essenciais

```bash
# Setup
brew services start postgresql@16 && brew services start redis
pnpm install
pnpm db:migrate

# Dev
pnpm dev                # web + worker em paralelo
pnpm --filter @jt/web dev
pnpm --filter @jt/worker dev

# Validação (mesmo que CI roda)
pnpm typecheck
pnpm lint
pnpm format:check
pnpm format             # auto-fix

# DB
pnpm db:generate        # gerar nova migration
pnpm db:migrate         # aplicar
pnpm db:studio          # GUI

# Trigger sync Meta manual
curl -X POST http://localhost:4000/internal/sync-meta -d '{}'

# Health
curl http://localhost:4000/health | jq
curl http://localhost:4000/health/live  # liveness rápido sem tocar DB
```

**Dashboard local**: <http://localhost:3000> · `felipe@jt.local` / `<DEV_PASSWORD>` (provisória)

## Fluxo de commit + auto-deploy

```bash
git checkout -b feat/minha-mudanca
# ... edita arquivos ...
git add .
git commit -m "feat(scope): descrição curta"   # husky roda lint+typecheck+format
git push -u origin feat/minha-mudanca
gh pr create
# CI roda, code review, merge
```

**Após merge em `main`** → GitHub Actions → GHCR → Watchtower → produção (~3 min).

### Conventional Commits (obrigatório)

`feat:` `fix:` `docs:` `chore:` `refactor:` `perf:` `test:` `ci:` `build:` `style:` `revert:`

Exemplos:

```
feat(worker): add CompleteRegistration on qualifier match
fix(web): escape bcrypt $ in env
docs: update RUNBOOK with backup restore steps
chore: bump deps
```

`commitlint` bloqueia commits fora desse padrão.

## Gotchas conhecidos

1. **Hash bcrypt no `.env` local**: escapar `$` como `\$`. No `docker-compose`
   (Portainer): escapar como `$$`.
2. **Cliente DB lazy** (`packages/db/src/client.ts`): Proxy lazy porque ESM
   hoist roda imports antes do `dotenv.config()`.
3. **`.env.local` no `apps/web`**: symlink pra `../../.env`. Next só carrega
   variáveis do próprio app.
4. **Imports `.js` em pacotes workspace**: webpack `extensionAlias` no
   `next.config.mjs` mapeia `.js → .ts`.
5. **`META_ACCOUNTS`**: JSON serializado em UMA linha. Validado por zod no
   `workerEnvSchema.transform`.
6. **`META_CAPI_DRY_RUN=true`** em dev. Trocar para `false` em prod
   quando tiver `META_TEST_EVENT_CODE` real OU pra mandar pro pipeline real.
7. **Insights skipados**: sync filtra `effective_status: ACTIVE+PAUSED`.
   Insights de ads `DELETED/ARCHIVED` são pulados (FK violation evitada).
8. **`destination_type` null**: campanhas que não são CTWA (Bragi, Masterclass)
   ficam null e só aparecem no filtro "Todos".
9. **Worker usa `tsx` em runtime**: simplifica monorepo, sem build TS. Aceitável
   porque worker é long-lived.
10. **Auto-deploy Watchtower**: olhar `com.centurylinklabs.watchtower.enable=true`
    nos labels. Postgres/Redis/backup têm `=false` (não devem auto-update).

## Convenções

- **Não criar `.md` sem o usuário pedir**, exceto: `CLAUDE.md`, `PROGRESS.md`,
  `README.md`, `LICENSE`, `CONTRIBUTING.md`, `docs/*` (já existentes).
- **Não comentar código óbvio**. Comentários só onde a intenção não é evidente.
- **Não inventar features**. O plano em `~/.claude/plans/jaunty-wobbling-map.md`
  é a fonte da verdade.
- **Antes de mudar schema**: gerar migration via `pnpm db:generate`, revisar
  o SQL, aplicar com `pnpm db:migrate`. Nunca editar migrations já aplicadas.
- **Testes E2E de webhook**: usar `curl` para `POST /webhooks/...`,
  inspecionar `webhook_inbox`, `leads`, `messages`, `capi_events` no psql.
- **Limpar dados de teste** após cada validação E2E (DELETE WHERE phone LIKE '5511999%').
- **Pre-commit hook obrigatório**: `pnpm typecheck` + `pnpm lint` + `pnpm format:check`.
  Se um falhar, o commit é abortado. Sem `--no-verify`.

## Segredos — REGRA INEGOCIÁVEL

**NUNCA logar, ecoar, retornar em mensagens, ou citar em conversa**:

- `META_SYSTEM_USER_TOKEN`
- `ADMIN_PASSWORD_HASH`
- `AUTH_SECRET`
- `GHL_PRIVATE_TOKEN`
- Tokens Z-API quando o cliente cadastrar
- `POSTGRES_PASSWORD` em produção
- PAT do GitHub (`ghp_xxx`) usado pra GHCR

Use `process.env.X` ou env via zod schema. Worker tem `redactToken()` em
`services/meta-marketing.ts` pra defesa em profundidade. Se for debugar token,
no máximo `.slice(0, 7)`.

## Como retomar uma sessão

1. Leia `PROGRESS.md` (estado vivo)
2. `brew services list | grep -E "postgresql|redis"` (subir se preciso)
3. `pnpm dev` (ou só web/worker conforme tarefa)
4. Continue da próxima fase pendente

## Integração com Felipe

- **Felipe é dev/consultor de tráfego pago**, não é dev fullstack. Ele conhece
  Meta Ads profundamente, mas algumas coisas de DevOps são novas pra ele.
- **Linguagem**: português, direto, sem jargão desnecessário
- **Quando pedir credenciais**: NUNCA pedir pra colar no chat. Sempre orientar
  a colocar em `.env.production` local OU diretamente no Portainer.

## Quando atualizar este arquivo

- Mudar a stack
- Adicionar comando ou convenção nova
- Descobrir gotcha permanente
- Mudar fluxo de deploy

## Quando atualizar `PROGRESS.md`

- Completar uma fase
- Tomar uma decisão importante com o cliente
- Pausar no meio de uma fase (escreve "onde parei")
- Encontrar bug ou fix relevante
