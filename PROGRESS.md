# PROGRESS — JT Dashboard

> **Última atualização**: 2026-04-07 (Deploy em produção COMPLETO — dashboard no ar em dashboard.junqueiraeteixeira.adv.br, sync Meta rodando hourly)
> **Cliente**: Felipe (consultor de tráfego pago JT Advocacia Médica)
> **Plano completo**: `/Users/felipenunesfraga/.claude/plans/jaunty-wobbling-map.md`

---

## Status geral

| Fase                             | Status      | Notas                                                                             |
| -------------------------------- | ----------- | --------------------------------------------------------------------------------- |
| 0 — Setup monorepo               | ✅ Completa | pnpm + Drizzle + Postgres + Redis local                                           |
| 1 — Sync Meta Marketing API      | ✅ Completa | 160 ads, 144 insights rows, números batem com Ads Manager                         |
| 2 — Dashboard read-only          | ✅ Completa | Login + overview + tabela hierárquica funcionando                                 |
| 3.0 — Spike validação CTWA Z-API | ⏸ Pendente  | Aguarda cliente criar conta Z-API                                                 |
| 3.1 — Webhook WhatsApp           | ✅ Completa | Receiver + worker + classificador testados E2E                                    |
| 4 — Worker CAPI                  | ✅ Completa | 4 eventos (Contact / Lead / CompleteRegistration / Purchase) — modo dry run ativo |
| 5 — Integração GHL               | ✅ Completa | Receiver + worker + builder site CAPI testados E2E (modo sem token)               |
| 6 — Dashboard completo           | ✅ Completa | Funnel chart + filtro origem + drill-down ad + página leads                       |
| 7 — Hardening + Deploy           | ✅ Completa | Health endpoint, pg_dump cron, Dockerfiles, compose Portainer, docs               |
| 8 — Org sênior + Auto-deploy     | ✅ Completa | README, ESLint, Husky, GitHub Actions, GHCR, Shepherd, docs/                      |
| Deploy — Subir em produção       | ✅ Completa | Stack no ar via Swarm + Traefik existente + Shepherd auto-deploy                  |

---

## ✅ Produção no ar

- **Dashboard**: https://dashboard.junqueiraeteixeira.adv.br
- **Webhooks**: https://webhooks.junqueiraeteixeira.adv.br
- **Health**: https://webhooks.junqueiraeteixeira.adv.br/health
- **Infra**: Hetzner VPS (Docker Swarm 29.0.1) + Traefik v2.11.3 (letsencryptresolver) + `network_swarm_public`
- **Services rodando**: postgres, redis, worker, web, shepherd, backup (todos 1/1)
- **Auto-deploy**: push em `main` → GitHub Actions build → GHCR → Shepherd poll 5min → redeploy
- **Sync Meta**: hourly aos :05min (BullMQ repeatable); manual via `POST /internal/sync-meta`
- **Backup**: pg_dump diário 03:00 BRT, retenção 14 dias

## Pendências pós-deploy (não bloqueiam, mas precisam ser feitas)

### Bloqueadores pra funcionalidade completa

- [ ] **Z-API**: criar conta, rodar spike CTWA (Fase 3.0), configurar `ZAPI_INSTANCES` no Portainer
- [ ] **GHL**: gerar Private Integration Token, setar `GHL_PRIVATE_TOKEN` + `GHL_LOCATION_ID`
- [ ] **GHL Stage IDs**: descobrir via API os IDs de "qualificou" e "fechou contrato"
- [ ] **Webhooks externos**: configurar Z-API e GHL pra apontarem pra `webhooks.junqueiraeteixeira.adv.br/webhooks/*`

### Operação / segurança

- [ ] **Senha admin**: já trocada no deploy (não é mais `<DEV_PASSWORD>`) ✅
- [ ] **UptimeRobot**: criar 2 monitors (dashboard + webhooks/health/live), intervalo 5min
- [ ] **Hardening SSH**: fail2ban ou mudar porta padrão no Hetzner (IP foi exposto brevemente no histórico git antes do force-push)
- [ ] **CAPI real**: quando `META_TEST_EVENT_CODE` for pego, já tá `DRY_RUN=false` em prod — primeiro evento vai pro pipeline real

### Nice-to-have

- [ ] Registrar CTWA `onboarding_url` automaticamente em ads CTWA via script
- [ ] Adicionar Grafana ou painel de logs centralizado
- [ ] Alertas no worker pra sync failures (via Sentry ou Slack webhook)

---

## Histórico das fases

### Fase 0 — Setup monorepo ✅

**O que foi feito**:

- pnpm workspace com `apps/web`, `apps/worker`, `packages/db`, `packages/shared`
- TypeScript estrito + Prettier + tsconfig.base.json
- PostgreSQL 16 instalado via Homebrew, Redis também (Redis já tinha)
- Database `jt_dashboard` criado, owner `felipenunesfraga`
- Drizzle config + schema das 7 tabelas + migration aplicada
- Skeleton do worker (Fastify + Pino) e do web (Next.js 15)
- `.env` na raiz, symlink em `apps/web/.env.local`

**Verificação**: `psql -d jt_dashboard -c "\dt"` retorna 7 tabelas. Worker e web sobem com health endpoints OK.

### Fase 1 — Sync Meta Marketing API ✅

**O que foi feito**:

- `apps/worker/src/services/meta-marketing.ts` — cliente HTTP da Marketing API
  (paginação automática, parser de erros, redação de token nos logs)
- `apps/worker/src/workers/sync-meta.ts` — `syncCatalogForAccount` +
  `syncInsightsForAccount` + `runSyncMeta`
- `apps/worker/src/jobs/scheduler.ts` — BullMQ Repeatable a cada hora `5 * * * *`
- Endpoint manual: `POST /internal/sync-meta`
- Schema env validando `META_ACCOUNTS` (JSON parseado por zod) e
  `META_SYSTEM_USER_TOKEN`

**Resultado do primeiro sync** (4 dias com gasto: 03-06/abr):

- 160 ads sincronizados (62 CA03 + 98 CA02), 26 campanhas
- 39 ativos hoje + 121 pausados
- 144 rows de insights (4 dias × ads ativos no período)
- 691 rows skipped (insights de ads DELETED/ARCHIVED — comportamento esperado)
- Top campanhas (últimos 7d): BONIFICAÇÃO (R$ 2.993), FIES (R$ 2.175),
  EQUIPARAÇÃO (R$ 569), SIMPLES NACIONAL (R$ 506) — total R$ 6.245,11
- Pixel resolvido em 41/62 ads CA03, 16/98 ads CA02

**Cliente confirmou**: "Batem, pode continuar"

**Bugs corrigidos durante a fase**:

- `landing_page_views` não é field do `/insights` → veio como `actions[type=landing_page_view]`
- FK violation em `insights_daily.ad_id` → filtra `knownAdIds` antes do batch insert

### Fase 2 — Dashboard read-only ✅

**O que foi feito**:

- Auth.js v5 Credentials Provider, single-user via env (`ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH`)
- Middleware Next.js protege tudo menos `/login` e `/api/auth`
- Layout `(dashboard)` com sidebar (logo JT azul + nav)
- Página overview `/`: 8 KPI cards + filtro de período + AreaChart
- Página `/ads`: tabela hierárquica Campanha→Conjunto→Anúncio com expand/collapse,
  thumbnails dos anúncios, métricas em todos os níveis
- Página `/leads`: placeholder até Fase 6
- Tailwind v4 (sem config — só `globals.css` com `@theme`)
- Recharts pra gráfico de área
- Drizzle queries direto nos Server Components

**Bugs corrigidos**:

- Hash bcrypt no `.env` interpretado como `$XX` variável → escapado com `\$`
- Cliente DB lazy via Proxy (ESM hoist roda `client.ts` antes do `dotenv.config()`)
- Webpack do Next não resolve `.js → .ts` em pacotes workspace → `extensionAlias`
  no `next.config.mjs`

**Credenciais de dev**: `felipe@jt.local` / `<DEV_PASSWORD>` (provisória, trocar com
`node apps/web/scripts/hash-password.mjs "novasenha"`)

### Fase 3.1 — Webhook WhatsApp ✅

**O que foi feito**:

- `apps/worker/src/routes/webhooks-whatsapp.ts` — `POST /webhooks/whatsapp/:instance`
  - Validação opcional de `X-JT-Webhook-Token` (shared secret)
  - Persiste em `webhook_inbox` antes de processar (safety net)
  - Retorna 200 OK rápido (Z-API tem timeout curto)
  - Enfileira BullMQ job
- `apps/worker/src/services/zapi-adapter.ts` — parser TOLERANTE que aceita 3
  formatos (Z-API flat, Z-API aninhado em `data`, Palm Up legacy). Schema único
  `NormalizedMessage` consumido pelo resto do sistema. Quando Z-API expor
  `referral.ctwa_clid` no payload real, o adapter já capta — se não vier, fica
  null e ativa o Plano B (welcome_message_signatures).
- `apps/worker/src/services/classifier.ts` — match das frases-padrão case +
  acento insensitive (NFD + remove combining marks)
- `apps/worker/src/services/settings.ts` — KV editável + `seedDefaultSettings()`
  rodado na inicialização do worker. Cache em memória 60s.
- `apps/worker/src/lib/crypto.ts` — `sha256()`, `normalizePhone()` (E.164 sem +),
  `hashPhone()`
- `apps/worker/src/lib/event-id.ts` — hash determinístico para CAPI dedup
- `apps/worker/src/workers/process-wa-webhook.ts` — pipeline completo:
  normalize → idempotência por `wa_message_id` → upsert lead → insert message
  → classificar → atualizar status

**Cenários testados** (todos green, 5/5):

1. Lead novo + referral CTWA → `attribution_method='ctwa_clid'`, ad_id resolvido
2. Mensagem com frase de qualificação → `qualifier_match`, lead → `qualified`
3. Mensagem com frase de compra → `purchase_match`, lead → `purchased`, R$ 5.000
4. Reenvio do mesmo `wa_message_id` → idempotente (não duplica)
5. Lead novo sem referral → `attribution_method='none'` (atribuição perdida mas registrada)

### Fase 4 — Worker CAPI ✅

**Mapa de eventos definido pelo cliente**:

| Trigger                                         | Eventos disparados                           |
| ----------------------------------------------- | -------------------------------------------- |
| Lead novo (1ª mensagem)                         | `Contact`                                    |
| Frase de qualificação                           | `Lead` + `CompleteRegistration`              |
| Frase de fechamento (sem ter qualificado antes) | `Lead` + `CompleteRegistration` + `Purchase` |
| Frase de fechamento (já qualificado)            | `Purchase`                                   |

**O que foi feito**:

- `apps/worker/src/services/meta-capi.ts` — `buildWhatsappCapiPayload()` +
  `resolveDefaultPixel()`. Resolução de pixel em cascata:
  `meta_ads.pixel_id → META_ACCOUNTS env (fallback) → MissingPixelError`
- `apps/worker/src/workers/send-capi-event.ts` — worker BullMQ
  - `event_id` determinístico via `sha256(eventName:leadId:triggerId)`
  - Dedup checa `capi_events.event_id` antes de enviar
  - Persiste TODA tentativa em `capi_events` (audit trail)
  - Retry exponencial 5x via BullMQ
  - Modo `dryRun` pra desenvolvimento
- `apps/worker/src/workers/process-wa-webhook.ts` — `enqueueCapi()` injetado
  via `setCapiEnqueuer()` (evita circular dep com scheduler). Dispara os
  eventos conforme o mapa acima.
- `apps/worker/src/jobs/scheduler.ts` — adicionada queue `send-capi-event`
  com worker, e wire-up `setCapiEnqueuer` no `start()`

**Modo dry run**: `META_CAPI_DRY_RUN=true` no `.env`. Em dry run, payload é
montado e persistido em `capi_events`, mas **a chamada à API Meta é pulada**.
Trocar para `false` quando tiver `META_TEST_EVENT_CODE` real do Events Manager.

**Cenários testados** (todos green, 5/5):

1. Lead novo → 1 evento `Contact`
2. Qualificou → 2 eventos `Lead` + `CompleteRegistration`
3. Fechou → 1 evento `Purchase`
4. Reenvio mesmo `wa_message_id` → idempotente, sem novos eventos
5. Lead novo + compra direta (pula qualificação) → 4 eventos: `Contact` + `Lead` + `CompleteRegistration` + `Purchase`

**Payload validado** (visto via psql jsonb_pretty):

```json
{
  "data": [{
    "event_name": "Contact",
    "event_time": <epoch_seconds>,
    "event_id": "<sha256>",
    "action_source": "business_messaging",
    "messaging_channel": "whatsapp",
    "event_source_url": "<source_url>",
    "user_data": {
      "ph": "<sha256_phone>",
      "external_id": "<sha256_phone>",
      "ctwa_clid": "<ctwa_clid>",
      "page_id": "<page_id>",
      "fn": "<sha256_first_name>",
      "ln": "<sha256_last_name>"
    }
  }]
}
```

### Fase 5 — Integração GHL ✅

**O que foi feito**:

- `apps/worker/src/services/ghl.ts` — `GhlClient` HTTP (V2 API,
  `services.leadconnectorhq.com`, header `Version: 2021-07-28`).
  Métodos: `getOpportunity`, `getContact`, `listPipelines`. Helpers:
  `extractFbclid`, `extractFbp`, `parseMonetaryValue`, `findCustomFieldValue`
  (busca recursiva por keyword no objeto contato — tolerante à variabilidade
  dos custom fields do GHL).
- `apps/worker/src/services/ghl-adapter.ts` — `normalizeGhlWebhook` parser
  tolerante. Aceita payload com campos no top-level OU envolvidos em
  `{ opportunity: {...} }` / `{ contact: {...} }`. Extrai tudo: opportunityId,
  contactId, pipelineId, stageId, status, monetaryValue, **dados de contato
  inline** (name, email, phone, fbclid, fbp), sourceUrl.
- `apps/worker/src/services/meta-capi.ts` — adicionada `buildSiteCapiPayload`.
  Diferenças vs WhatsApp: `action_source: "website"`, sem `messaging_channel`,
  `user_data` inclui `fbc` (formato `fb.1.<unix_ts>.<fbclid>`) + `fbp` em vez
  de `ctwa_clid`/`page_id`.
- `apps/worker/src/workers/send-capi-event.ts` — escolhe builder pelo
  `lead.source`: `whatsapp` → `buildWhatsappCapiPayload`, `site_ghl` →
  `buildSiteCapiPayload`. Resto do pipeline (event_id, dedup, persist) é igual.
- `apps/worker/src/workers/process-ghl-webhook.ts` — pipeline completo:
  - Normalize → fetch opcional opportunity+contact → upsert lead → mapear stage
  - **Fetch GHL é OPCIONAL**: se `GHL_PRIVATE_TOKEN` não setado OU falha,
    usa só os dados inline do payload do webhook (resiliência)
  - Mapeamento de stage usa `settings.ghl_stage_map.qualified_stage_id` /
    `closed_stage_id` (configuráveis sem redeploy)
  - Mesma lógica de eventos do WhatsApp:
    - Lead novo (1ª opportunity vista) → `Contact`
    - Stage qualified → `Lead` + `CompleteRegistration`
    - Stage closed → `Purchase` (e Lead+CompleteRegistration se ainda não
      tinha qualificado antes)
- `apps/worker/src/routes/webhooks-ghl.ts` — `POST /webhooks/ghl` com
  validação de shared secret opcional, persiste em `webhook_inbox`,
  responde 200 OK rápido, enfileira BullMQ
- Scheduler estendido com `QUEUE_PROCESS_GHL` + worker
- `setGhlCapiEnqueuer` para evitar circular dep com scheduler

**Cenários testados** (todos green, 3/3 — modo sem token, dados inline):

1. Opportunity nova entra → `Contact` enfileirado, lead criado com `attribution_method='fbclid'`, fbclid+fbp+email+phone+nome capturados do payload
2. Stage muda pra qualified → `Lead` + `CompleteRegistration`, lead → `qualified`
3. Stage muda pra closed → `Purchase` com valor `R$ 7.500` (do `monetary_value` do payload, sobrescreveu o default), lead → `purchased`

**Payload site validado** (visto via psql jsonb_pretty):

```json
{
  "data": [{
    "event_name": "Contact",
    "event_time": <epoch_seconds>,
    "event_id": "<sha256>",
    "action_source": "website",
    "event_source_url": "https://jt.com.br/medicos-fies",
    "user_data": {
      "em": "<sha256_email>",
      "ph": "<sha256_phone>",
      "fn": "<sha256_first>",
      "ln": "<sha256_last>",
      "external_id": "<sha256_phone>",
      "fbc": "fb.1.1775519806.fb_clid_test_xyz",
      "fbp": "fb.1.1700000000.1234567890"
    }
  }]
}
```

**Stage IDs de teste** (atualizar com IDs reais quando GHL estiver configurado):

```sql
UPDATE settings SET value = '{"qualified_stage_id": "<ID_REAL>", "closed_stage_id": "<ID_REAL>"}'::jsonb
WHERE key = 'ghl_stage_map';
```

Pra descobrir os IDs reais quando o token estiver setado, vai dar pra usar
`GhlClient.listPipelines(locationId)` — exposto mas ainda sem CLI/UI.

### Fase 6 — Dashboard completo ✅

**O que foi feito**:

- `lib/queries/overview.ts` — `LeadSource` type (`'all' | 'whatsapp' | 'site_ghl'`),
  `QueryFilters` interface, helpers `adDestinationFilter` + `leadSourceFilter`.
  `getOverviewKpis` e `getSpendTimeseries` agora aceitam filtro de origem.
  Nova função `getFunnel` que retorna 5 estágios
  (Impressões → Cliques → Leads → Qualificados → Compras) com `pctOfPrevious`
  calculado.
- `lib/queries/ads.ts` — `getAdsWithMetrics` aceita filtro de origem
  (filtra ads por `destination_type` E leads por `source` simultaneamente).
  Nova função `getAdById(adId, range)` para drill-down.
- `lib/queries/leads.ts` (novo) — `listLeads(filters)` com filtro de período +
  origem + busca por nome/telefone/email. `listLeadsByAd(adId, range)` para
  drill-down. `listMessagesByLead(leadId)` para timeline (não usado ainda
  na UI, mas pronto).
- `lib/parse-params.ts` (novo) — `parseSourceParam` server-safe (separado do
  `filter-bar` que é client component, pra evitar erro de "client function
  called from server").
- `components/funnel-chart.tsx` (novo) — visualização CSS pura com barras
  responsivas + cor verde no último estágio + percentual de conversão por
  etapa em verde/âmbar/cinza dependendo do valor.
- `components/filter-bar.tsx` — adicionado select de origem (Todos / WhatsApp /
  Site) ao lado dos presets de período. Prop `showSourceFilter` opcional.
- `components/lead-status-badge.tsx` (novo) — badge colorido para status de
  lead (Aberto/Qualificado/Comprou/Perdido).
- `components/ads-hierarchy-table.tsx` — linhas de ad agora são `Link` para
  `/ads/[adId]` (drill-down).
- `app/(dashboard)/page.tsx` (overview) — adicionados filtro de origem,
  KPIs com hint de CPL no card "Leads", grid 2/3 com gráfico de gasto +
  funil lado-a-lado.
- `app/(dashboard)/ads/page.tsx` — passa `source` pra query.
- `app/(dashboard)/ads/[adId]/page.tsx` (novo) — página de drill-down: header
  com thumbnail + nome + status + link Instagram, 6 KPIs do ad, tabela de
  leads vinculados (com origem badge, status badge, atribuição, valor, data).
- `app/(dashboard)/leads/page.tsx` — tabela completa de leads com busca
  (form GET via input + hidden inputs preservando filtros), link pro ad de
  origem, 7 colunas (Lead, Origem, Status, Anúncio, Atribuição, Valor, Quando).

**Cenários testados** (todos green):

1. Overview com 7 leads de teste (5 WA + 2 Site) — funil renderiza com
   contagens corretas, KPIs batem
2. Filtro `source=site_ghl` na página `/leads` — só os 2 leads Site aparecem
3. Drill-down `/ads/[ad_id]` — mostra os 5 leads WhatsApp do ad, com status
   badges (Aberto/Qualificado/Comprou)
4. Link "Voltar para anúncios" funciona
5. Filtros de período + origem propagam pelo URL searchParams

**Decisão de design**: ads sem `destination_type` (Bragi/Masterclass que rodam
nas mesmas accounts mas não são CTWA) só aparecem no filtro "Todos". Isso é
intencional — não temos como saber a origem deles. Quando o cliente tiver mais
campanhas, um sync futuro pode tentar resolver via `tracking_specs` ou nome.

**Backfill `destination_type`** (rodado uma vez):

```sql
UPDATE meta_ads SET destination_type = 'whatsapp'
WHERE campaign_name LIKE '%WHATSAPP%' AND destination_type IS NULL;
```

Isso classificou 85 ads automaticamente. Os outros 75 ficaram null (campanhas
que não são CTWA).

### Fase 7 — Hardening + Deploy ✅

**O que foi feito**:

#### Health endpoints

- `apps/worker/src/services/health.ts` (novo) — `getHealthStatus()` faz check
  de DB (latency), Redis ping, e carrega 6 métricas operacionais:
  `last_meta_sync_age_minutes`, `pending_capi_events`, `failed_capi_events_24h`,
  `unprocessed_webhooks`, `unprocessed_webhooks_age_minutes`. Retorna status
  `ok` / `degraded` / `down`. Critérios de degraded:
  - Sync Meta atrasado >90 min
  - Failed CAPI events >10 nas últimas 24h
  - Webhook não processado há >10 min
- Worker agora expõe **2 endpoints**:
  - `GET /health` — completo (200 ok, 503 down)
  - `GET /health/live` — liveness probe rápido (sem tocar DB/Redis)
- Web `GET /api/health` — agora também checa DB e retorna status estruturado

#### Dockerfiles

- `Dockerfile.worker` — single-stage, usa `node:24-alpine` + `pnpm install --frozen-lockfile`,
  usa **tsx em produção** (decisão pragmática: simplifica monorepo, sem
  build step de TS, worker é long-lived sem cold start crítico, +5MB de tsx).
  Healthcheck via `/health/live`.
- `Dockerfile.web` — 3 stages (deps, builder, runner), usa Next.js standalone
  output. `outputFileTracingRoot` no `next.config.mjs` aponta pra raiz do
  monorepo, então o standalone copia `@jt/db` + `@jt/shared` automaticamente.
  Runner roda como user `nextjs` non-root. Healthcheck via `/api/health`.
- `.dockerignore` — exclui `node_modules`, `.next`, `dist`, env files, JSONs
  n8n de referência, materiais visuais, docs.

#### docker-compose.prod.yml

Stack pronta pra Portainer com 5 serviços:

- `postgres` — PostgreSQL 16 com volume persistente
- `redis` — Redis 7 com `maxmemory 256mb` + LRU
- `worker` — JT Worker com healthcheck
- `web` — JT Dashboard com healthcheck
- `backup` — postgres:16-alpine que roda backup diário às 03:00 BRT
- Labels do Traefik configurados pra `dashboard.jt.com.br` e
  `webhooks.jt.com.br` (substituir pelos domínios reais antes do deploy)
- Network `traefik_public` (external) + `jt_internal` (bridge)

#### Backup

- `scripts/backup.sh` — `pg_dump` → gzip → `backups/jt_dashboard_<timestamp>.sql.gz`
- Retenção configurável via `BACKUP_RETENTION_DAYS` (default 14)
- Container `backup` faz loop com `sleep` calculado pra rodar todo dia às 03:00 BRT
- Script de restore documentado em DEPLOY.md e RUNBOOK.md

#### Documentação

- `docs/DEPLOY.md` — guia passo-a-passo do primeiro deploy:
  - Pré-requisitos (Docker, Traefik, DNS)
  - Geração de credenciais (`hash-password.mjs`, `openssl rand`)
  - Como preencher `.env.production`
  - Subir via Portainer ou CLI
  - Aplicar migrations
  - Verificar saúde
  - Forçar primeiro sync
  - Configurar webhooks externos quando Z-API/GHL estiverem prontos
  - Atualizações posteriores
  - Backups e restore
  - Troubleshooting
- `docs/RUNBOOK.md` — operação dia a dia:
  - Health checks e métricas
  - Tabela de alertas (thresholds)
  - Tarefas comuns: forçar sync, reaplicar migrations, trocar senha admin,
    atualizar frase-padrão, configurar Stage IDs GHL, reprocessar webhooks
    parados, inspecionar leads/eventos via SQL
  - Forçar reenvio de evento CAPI específico
  - Backups (local + recomendação off-site)
  - Atualização de versão
  - Rotação de token Meta
  - Limpar dados de teste
  - Logs

#### `.env.production.example`

Template documentado com TODAS as variáveis (obrigatórias + opcionais),
comentários explicando como gerar cada uma e regras (ex: `$` precisa ser
escapado como `$$` no compose).

**Cenário testado**:

- Worker subiu normalmente, `/health/live` retorna 200 instantâneo
- `/health` completo retorna JSON estruturado com checks DB/Redis + métricas
- Status `degraded` corretamente sinalizado quando sync Meta passou de 90 min
- Typecheck do worker e do web ambos passam

**O que NÃO foi feito** (intencional, falta input externo):

- Build dos Dockerfiles em si (precisaria de Docker rodando, e o cliente usa
  Mac do usuário sem Docker — `docker-compose.prod.yml` será buildado no
  Portainer do JT durante deploy)
- Deploy real no servidor (depende do cliente liberar acesso ao Portainer)
- Smoke test em produção

### Fase 8 — Org sênior + Auto-deploy CI/CD ✅

Pedido pelo Felipe pra deixar o repo nível "empresa séria" antes do deploy.

**O que foi feito**:

#### Arquivos profissionais

- `README.md` — descrição, badges, setup, scripts, deploy, segurança, licença
- `LICENSE` — proprietary (Felipe + JT)
- `CONTRIBUTING.md` — fluxo de branch, conventional commits, padrões
- `.editorconfig` — indent, EOL, charset
- `.nvmrc` — Node 24
- `.github/CODEOWNERS` — Felipe owner global

#### Linting + format + hooks

- `eslint.config.mjs` — flat config moderna (ESLint 9):
  - `@typescript-eslint/no-unused-vars` (com pattern `^_`)
  - `consistent-type-imports`
  - `eqeqeq`, `prefer-const`, `no-var`
  - Override pro Next/React + Node scripts
- `commitlint.config.mjs` — `@commitlint/config-conventional`
- `.husky/pre-commit` — roda `lint-staged` (prettier write + eslint)
- `.husky/commit-msg` — roda `commitlint --edit`
- `package.json` — adicionados scripts `lint`, `lint:fix`, `format`,
  `format:check`. Adicionadas devDeps: `@commitlint/*`, `eslint`, `globals`,
  `husky`, `lint-staged`, `typescript-eslint`
- `engines.node` bumpado pra 24

#### GitHub Actions

- `.github/workflows/ci.yml` — typecheck + lint + format:check em PRs e
  pushes pra `main`. Cancela runs concorrentes.
- `.github/workflows/release.yml` — em pushes pra `main` (ignorando docs):
  - Buildx + cache GHA por matriz (web, worker)
  - Login GHCR via `GITHUB_TOKEN`
  - Build + push 2 imagens com tags `latest`, `sha-xxx`, `YYYYMMDD-HHmmss`
  - Permissão `packages: write`

#### Templates GitHub

- `.github/PULL_REQUEST_TEMPLATE.md` — checklist (typecheck, lint, format,
  test manual, atualizar PROGRESS/CLAUDE)
- `.github/ISSUE_TEMPLATE/bug.md` — template estruturado
- `.github/ISSUE_TEMPLATE/feature.md` — template estruturado

#### Watchtower auto-deploy

- `docker-compose.prod.yml` reescrito:
  - Imagens vêm de `ghcr.io/${GITHUB_REPOSITORY}-{web,worker}:${IMAGE_TAG}`
  - Novo serviço `watchtower` (containrrr/watchtower) com:
    - `WATCHTOWER_LABEL_ENABLE=true` (só atualiza containers marcados)
    - `WATCHTOWER_POLL_INTERVAL=30` segundos
    - `WATCHTOWER_ROLLING_RESTART=true` (web e worker não restartam juntos)
    - `WATCHTOWER_CLEANUP=true` (remove imagens antigas)
    - Mount de `~/.docker/config.json` pra autenticar no GHCR
  - Labels `com.centurylinklabs.watchtower.enable=true` no `web` e `worker`
  - Labels `=false` em `postgres`, `redis`, `backup`, `watchtower` (não auto-update)
  - `pull_policy: always` no `web` e `worker`
  - Domínios reais já preenchidos (`dashboard.junqueiraeteixeira.adv.br`,
    `webhooks.junqueiraeteixeira.adv.br`)

#### Documentação técnica

- `docs/ARCHITECTURE.md` — diagrama lógico, fluxos detalhados (sync Meta,
  WhatsApp→CAPI, GHL→CAPI, send-capi-event, dashboard render), 7 tabelas,
  decisões técnicas chave, entradas/saídas externas
- `docs/AUTO_DEPLOY.md` — pipeline CI/CD completa, setup PAT GHCR, como
  funciona Watchtower, rollback, troubleshooting
- `docs/SETUP.md` — setup local detalhado, comandos úteis, troubleshooting
- `docs/DEPLOY.md` reescrito — Portainer Stack via Repository, env vars
  com exemplo concreto, primeiro deploy, atualizações automáticas

#### Atualizações no `CLAUDE.md`

- Lista de documentos vivos atualizada
- Stack table atualizada com CI/CD
- Estrutura completa do repo
- Fluxo de commit + auto-deploy explicado
- Conventional Commits obrigatório
- Gotchas atualizados (incluindo Watchtower)
- Pre-commit hook obrigatório (sem `--no-verify`)
- Lista expandida de segredos a NUNCA expor

**Arquivos criados/modificados**:

```
+ README.md
+ LICENSE
+ CONTRIBUTING.md
+ .editorconfig
+ .nvmrc
+ .github/CODEOWNERS
+ .github/PULL_REQUEST_TEMPLATE.md
+ .github/ISSUE_TEMPLATE/bug.md
+ .github/ISSUE_TEMPLATE/feature.md
+ .github/workflows/ci.yml
+ .github/workflows/release.yml
+ .husky/pre-commit
+ .husky/commit-msg
+ eslint.config.mjs
+ commitlint.config.mjs
+ docs/ARCHITECTURE.md
+ docs/AUTO_DEPLOY.md
+ docs/SETUP.md
M docs/DEPLOY.md (reescrito)
M docker-compose.prod.yml (Watchtower + GHCR images)
M package.json (scripts + devDeps + lint-staged)
M CLAUDE.md (atualizado pra Fase 8)
```

**Pendência da Fase 8**: instalar as novas devDeps (`pnpm install`) — não rodei
porque o usuário pode querer revisar antes. Quando rodar pnpm install, os hooks
do husky são instalados automaticamente pelo script `prepare`.

**Próxima ação concreta**:

```bash
cd "/Users/felipenunesfraga/Desktop/Projetos/NEW TINTIM"
pnpm install
git init
git add .
git commit -m "chore: initial commit"
```

---

## Decisões importantes do cliente

| Decisão              | Valor                                                                        |
| -------------------- | ---------------------------------------------------------------------------- |
| Provider WhatsApp    | **Z-API** (não-oficial, 2 números). Spike CTWA pendente                      |
| Valor de venda       | **Fixo** R$ 5.000 (`settings.default_purchase_value`)                        |
| Multi-account Meta   | **2 accounts**: CA03 (`act_1096702648134272`), CA02 (`act_345426295001979`)  |
| Pixel                | **1 só** pra ambas as accounts: `1545838446017240`                           |
| Auth dashboard       | Single-user, só Felipe (`felipe@jt.local`)                                   |
| Frase qualificação   | "Somos especialistas em cuidar de médicos"                                   |
| Frase fechamento     | "Agradecemos por confiar no JT Advocacia Médica"                             |
| Mapa de eventos CAPI | Contact (lead novo) → Lead+CompleteRegistration (qualif) → Purchase (fechou) |
| n8n                  | **Não usar** — JSONs são só referência                                       |

---

## Pendências externas (cliente precisa entregar)

- [x] **Meta System User Token** (entregue via `.env`)
- [x] **Ad Account IDs** (CA03 + CA02)
- [x] **Pixel ID** (1 só)
- [ ] **Conta Z-API criada** com 2 instâncias (1 por número comercial)
- [ ] **Webhook Z-API apontado** para `https://<dominio>/webhooks/whatsapp/<instance>` (em dev: ngrok)
- [ ] **Test Event Code** do Meta Events Manager (pra testar CAPI sem contaminar produção)
- [ ] **GHL Private Integration Token** com escopos opportunities/contacts/pipelines readonly
- [ ] **GHL Location ID** do JT
- [ ] **GHL Stage IDs** "qualificou" e "fechou contrato" (descobrimos via API)
- [ ] **GHL Webhook configurado** apontando pra `POST /webhooks/ghl`
- [ ] **Domínios DNS** pra `dashboard.*` e `webhooks.*` (decisão de Felipe)
- [ ] **Trocar senha provisória** do dashboard (`<DEV_PASSWORD>`)

---

## Como retomar uma sessão

```bash
# 1. Garantir que Postgres + Redis estão rodando
brew services list | grep -E "postgresql|redis"
# Se não: brew services start postgresql@16 && brew services start redis

# 2. Verificar onde paramos
cat PROGRESS.md  # esse arquivo

# 3. Subir os serviços
cd "/Users/felipenunesfraga/Desktop/Projetos/NEW TINTIM"
pnpm dev          # web + worker em paralelo
# OU:
pnpm --filter @jt/web dev      # só dashboard
pnpm --filter @jt/worker dev   # só worker

# 4. Dashboard
# http://localhost:3000  →  felipe@jt.local / <DEV_PASSWORD>

# 5. Forçar sync Meta manual
curl -X POST http://localhost:4000/internal/sync-meta -H "Content-Type: application/json" -d '{}'

# 6. Testar webhook WhatsApp localmente (payload simulado)
curl -X POST http://localhost:4000/webhooks/whatsapp/jt-instance-1 \
  -H "Content-Type: application/json" \
  -d '{
    "instanceId": "jt-instance-1",
    "messageId": "wamid.E2E_TEST",
    "phone": "5511999999999",
    "fromMe": false,
    "senderName": "Lead Teste",
    "momment": '$(date +%s)'000,
    "type": "text",
    "text": { "message": "Olá" },
    "referral": {
      "ctwa_clid": "test_clid",
      "source_id": "120245766273070063",
      "source_type": "ad",
      "headline": "Converse"
    }
  }'

# 7. Inspecionar DB
psql -d jt_dashboard
# \dt              # listar tabelas
# SELECT * FROM leads;
# SELECT * FROM messages;
# SELECT * FROM capi_events ORDER BY created_at DESC LIMIT 10;
# SELECT * FROM webhook_inbox ORDER BY received_at DESC LIMIT 5;

# 8. Limpar dados de teste
psql -d jt_dashboard -c "
  DELETE FROM capi_events WHERE lead_id IN (SELECT id FROM leads WHERE phone LIKE '5511999%');
  DELETE FROM messages WHERE wa_message_id LIKE 'wamid.E2E%';
  DELETE FROM leads WHERE phone LIKE '5511999%';
  DELETE FROM webhook_inbox WHERE source='zapi' AND received_at > NOW() - INTERVAL '1 hour';
"
```

---

## Arquivos importantes (mapa)

```
apps/worker/src/
├── services/
│   ├── meta-marketing.ts    # cliente Marketing API (insights + creative + tracking_specs)
│   ├── meta-capi.ts         # buildWhatsappCapiPayload + resolveDefaultPixel
│   ├── zapi-adapter.ts      # normalize Z-API webhook → NormalizedMessage
│   ├── classifier.ts        # match frases-padrão + welcome_message
│   └── settings.ts          # KV editável + seed defaults
├── workers/
│   ├── sync-meta.ts         # syncCatalogForAccount + syncInsightsForAccount
│   ├── process-wa-webhook.ts # parse + upsert lead + insert msg + classify + enqueue CAPI
│   └── send-capi-event.ts   # monta payload + envia (ou dry run) + persiste audit
├── routes/
│   └── webhooks-whatsapp.ts # POST /webhooks/whatsapp/:instance
├── jobs/
│   └── scheduler.ts         # 3 queues BullMQ: sync-meta, process-wa, send-capi
├── lib/
│   ├── crypto.ts            # sha256, normalizePhone, hashPhone
│   ├── event-id.ts          # hash determinístico CAPI
│   ├── logger.ts            # Pino
│   └── redis.ts             # ioredis pra BullMQ
├── server.ts                # Fastify build
└── index.ts                 # bootstrap

apps/web/
├── app/
│   ├── (dashboard)/
│   │   ├── layout.tsx       # sidebar
│   │   ├── page.tsx         # overview KPIs + chart
│   │   ├── ads/page.tsx     # tabela hierárquica
│   │   └── leads/page.tsx   # placeholder
│   ├── login/page.tsx       # form login
│   ├── api/auth/[...nextauth]/route.ts
│   ├── api/health/route.ts
│   ├── globals.css          # Tailwind v4 + brand colors
│   └── layout.tsx
├── components/
│   ├── sidebar.tsx
│   ├── kpi-card.tsx
│   ├── filter-bar.tsx
│   ├── timeseries-chart.tsx
│   └── ads-hierarchy-table.tsx
├── lib/
│   ├── auth.ts              # Auth.js config
│   ├── actions.ts           # server actions (logout)
│   ├── format.ts            # BRL, percent, dates BR
│   └── queries/
│       ├── overview.ts      # KPIs + timeseries
│       └── ads.ts           # tabela hierárquica
├── middleware.ts            # auth middleware
└── next.config.mjs          # extensionAlias + serverExternalPackages

packages/db/src/
├── schema.ts                # 7 tabelas Drizzle
├── client.ts                # cliente lazy via Proxy
├── migrate.ts               # script de migration
└── index.ts

packages/shared/src/
├── env.ts                   # baseEnv, webEnv, workerEnv (zod schemas)
└── index.ts

# Deploy / produção
Dockerfile.web              # multi-stage build do dashboard (Next.js standalone)
Dockerfile.worker           # single-stage do worker (tsx em prod)
.dockerignore
docker-compose.prod.yml     # template Portainer Stack (5 serviços)
.env.production.example     # template das variáveis de ambiente
scripts/backup.sh           # pg_dump diário (rodado pelo container `backup`)
docs/
├── DEPLOY.md               # guia primeiro deploy + atualizações
└── RUNBOOK.md              # operação dia a dia (health, alertas, tarefas)
```
