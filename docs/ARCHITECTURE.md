# Architecture

Visão de alto nível do JT Dashboard.

## Contexto

JT Advocacia Médica faz tráfego pago no Meta Ads (CTWA + site). Hoje os dados
ficam fragmentados entre Ads Manager, WhatsApp e GHL. O sistema unifica tudo,
classifica leads automaticamente e fecha o loop de atribuição enviando
conversões de volta pro Meta CAPI.

## Diagrama lógico

```
                  ┌─────────────────┐
                  │   Meta Ads      │
                  │  (Marketing)    │
                  └────────┬────────┘
                           │ pull a cada 1h
                           ▼
┌──────────┐         ┌─────────────┐         ┌──────────┐
│   Z-API  │─webhook─▶  jt-worker  ◀─webhook─│   GHL    │
│ (CTWA)   │         │  (Fastify)  │         │ (site)   │
└──────────┘         └──┬──────────┘         └──────────┘
                        │
                        │ push (Conversions API)
                        ▼
                  ┌─────────────────┐
                  │  Meta CAPI      │
                  │ Contact / Lead  │
                  │ CompleteReg     │
                  │ Purchase        │
                  └─────────────────┘

   ┌──────────┐                     ┌──────────┐
   │  jt-web  │ ───── SQL ────────▶ │ Postgres │
   │ (Next 15)│                     │    16    │
   └──────────┘                     └──────────┘
                                          ▲
                                          │
                                    ┌─────┴────┐
                                    │  Redis 7 │
                                    │  BullMQ  │
                                    └──────────┘
```

## Fluxos principais

### 1. Sync Meta Marketing (horário)

```
BullMQ Repeatable "5 * * * *"
  → sync-meta-catalog: GET /act_X/ads → upsert meta_ads
  → sync-meta-insights: GET /act_X/insights por dia → upsert insights_daily
```

Idempotente. Re-sincroniza sempre o dia atual (gasto muda até fechar).

### 2. WhatsApp → CAPI

```
Z-API → POST /webhooks/whatsapp/:instance
  → INSERT webhook_inbox (raw)
  → 200 OK rápido
  → BullMQ enqueue
  → process-wa-webhook:
      1. ZApiAdapter.normalize
      2. idempotência por wa_message_id
      3. upsert lead (resolve ad_id via referral.ctwa_clid OU welcome_message)
      4. INSERT message
      5. classificar texto (qualifier_phrase / purchase_phrase)
      6. atualizar status do lead
      7. enfileirar CAPI events:
         - Lead novo → Contact
         - qualifier_match → Lead + CompleteRegistration
         - purchase_match → Purchase
```

### 3. GHL → CAPI

```
GHL Workflow → POST /webhooks/ghl
  → INSERT webhook_inbox
  → 200 OK
  → process-ghl-webhook:
      1. normalizeGhlWebhook
      2. (opcional) GHL API fetch enriquece com canônico
      3. upsert lead (source='site_ghl')
      4. mapear stage_id contra settings.ghl_stage_map
      5. enfileirar CAPI:
         - Lead novo → Contact
         - matched qualified_stage → Lead + CompleteRegistration
         - matched closed_stage → Purchase
```

### 4. send-capi-event (worker genérico)

```
Worker recebe { leadId, eventName, triggerId }
  → event_id = sha256(eventName:leadId:triggerId)  ← determinístico
  → checar capi_events.event_id (dedup)
  → carregar lead + ad + pixel
  → builder pelo source: buildWhatsappCapiPayload OR buildSiteCapiPayload
  → POST graph.facebook.com/v22.0/{pixelId}/events
  → persistir capi_events (sent | failed | duplicated)
  → retry exponencial 5x se falhar
```

### 5. Dashboard render

```
GET /  (Server Component)
  → Auth.js middleware checa sessão
  → 4 queries Drizzle paralelas:
      - getOverviewKpis
      - getSpendTimeseries
      - getFunnel
  → render KpiCards + TimeseriesChart + FunnelChart
```

Sem matviews — joins diretos em `meta_ads + insights_daily + leads`.
Volume esperado: centenas a milhares de leads/mês. Postgres responde
sub-segundo.

## Dados — 7 tabelas

| Tabela | Função |
|---|---|
| `meta_ads` | Catálogo Meta denormalizado (campaign/adset/ad em uma row) |
| `insights_daily` | Métricas diárias por ad (spend, impressions, clicks, etc.) |
| `leads` | **Unificada**: source='whatsapp' OR 'site_ghl' |
| `messages` | Mensagens WhatsApp (FK leads) |
| `capi_events` | Audit + dedup de eventos CAPI enviados |
| `webhook_inbox` | Safety net — toda chamada externa antes de processar |
| `settings` | KV editável (frases-padrão, stage map GHL, valor padrão, etc.) |

Schema completo: [`packages/db/src/schema.ts`](../packages/db/src/schema.ts).

## Decisões técnicas chave

| Decisão | Por quê |
|---|---|
| **Postgres em vez de MySQL** | Cliente já tem; JSONB nativo; window functions; matviews disponíveis |
| **Sem matviews** | Volume baixo; joins diretos rendem sub-segundo; menos código |
| **Tabela `leads` unificada** | Mesmo conceito de "lead" pra WA e site; evita 2 tabelas paralelas com SQL duplicado |
| **`meta_ads` denormalizado** | Zero joins no dashboard; trade-off aceito (campaign_name duplica) |
| **`tsx` em runtime no worker** | Worker é long-lived; elimina build TS no monorepo; ~5MB extra aceitável |
| **Next.js standalone com `outputFileTracingRoot`** | Deploy do Next em monorepo sem hacks |
| **BullMQ Redis** | Repeatable jobs garantidos; retry exponencial nativo; queue persistente |
| **Auth.js single-user via env** | Sem tabela `users`; sem complexidade; bcrypt hash em ENV |
| **Watchtower auto-deploy** | Sem SSH, sem webhook complicado; push imagem → atualiza sozinho |

## Entradas / saídas externas

| Direção | Sistema | Como |
|---|---|---|
| ⬇ Pull | Meta Marketing API | System User Token, hourly cron |
| ⬇ Push (webhook) | Z-API (WhatsApp) | `POST /webhooks/whatsapp/:instance` |
| ⬇ Push (webhook) | Go High Level | `POST /webhooks/ghl` |
| ⬆ Push | Meta Conversions API | `POST /v22.0/{pixel_id}/events` |
| ⬇ Read (opcional) | Go High Level API | enriquece dados quando token disponível |
