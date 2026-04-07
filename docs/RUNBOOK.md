# Runbook — JT Dashboard

Procedimentos operacionais para o dia a dia.

## Health checks

```bash
# Saúde completa (worker)
curl https://webhooks.jt.com.br/health | jq

# Saúde rápida (liveness, sem tocar DB)
curl https://webhooks.jt.com.br/health/live

# Saúde do web
curl https://dashboard.jt.com.br/api/health | jq
```

**Status possíveis**:

- `ok`: tudo funcionando
- `degraded`: DB e Redis OK, mas alguma métrica preocupante
  (sync Meta atrasado >90min, capi events failed >10/24h, ou webhook
  parado >10min). HTTP 200 ainda.
- `down`: DB ou Redis fora do ar. HTTP 503.

## Métricas principais (no `/health` do worker)

| Métrica                            | Significado                                 | Alerta se                         |
| ---------------------------------- | ------------------------------------------- | --------------------------------- |
| `last_meta_sync_age_minutes`       | Quando rodou o último sync Meta             | > 90 (cron deveria ser horário)   |
| `pending_capi_events`              | Eventos CAPI ainda na fila                  | > 50 (acúmulo, worker engasgado?) |
| `failed_capi_events_24h`           | Eventos CAPI que falharam definitivamente   | > 10 (token vencido? bug?)        |
| `unprocessed_webhooks`             | Webhooks recebidos mas não processados      | > 20                              |
| `unprocessed_webhooks_age_minutes` | Idade do webhook mais antigo não processado | > 10                              |

Recomendado: configurar **UptimeRobot** (free) pra fazer GET em `/health` a cada
5 min e alertar por email se ficar `degraded` ou `down` por >2 checks.

## Tarefas comuns

### Forçar sync Meta manual

```bash
docker exec -it jt-worker sh -c \
  'curl -X POST http://localhost:4000/internal/sync-meta -d "{}"'
```

### Reaplicar migrations Drizzle

```bash
docker exec -it jt-worker pnpm --filter @jt/db migrate
```

### Trocar a senha do admin

```bash
# Em qualquer máquina com Node:
node apps/web/scripts/hash-password.mjs "nova_senha"

# Atualizar no .env.production e reiniciar o web:
docker compose -f docker-compose.prod.yml up -d --no-deps --build web
```

> **Lembrar**: escapar `$` como `$$` no compose/env.

### Atualizar frase-padrão de qualificação/compra

```sql
-- Conectar no Postgres
docker exec -it jt-postgres psql -U jt -d jt_dashboard

-- Atualizar
UPDATE settings
SET value = '"Nova frase aqui"'::jsonb, updated_at = NOW()
WHERE key = 'qualifier_phrase';

UPDATE settings
SET value = '"Nova frase de compra"'::jsonb, updated_at = NOW()
WHERE key = 'purchase_phrase';
```

Cache do worker tem TTL de 60s — vai pegar a nova frase automaticamente.

### Atualizar valor padrão de compra

```sql
UPDATE settings
SET value = '7500'::jsonb, updated_at = NOW()
WHERE key = 'default_purchase_value';
```

### Configurar Stage IDs do GHL

Quando o token GHL estiver setado, descobrir os IDs:

```bash
# Listar pipelines da location (precisa criar endpoint admin pra isso)
docker exec -it jt-worker sh -c 'cd apps/worker && tsx -e "
import { GhlClient } from \"./src/services/ghl.js\";
const c = new GhlClient({ privateToken: process.env.GHL_PRIVATE_TOKEN, locationId: process.env.GHL_LOCATION_ID });
const pipelines = await c.listPipelines();
console.log(JSON.stringify(pipelines, null, 2));
"'
```

Aí atualizar:

```sql
UPDATE settings
SET value = '{"qualified_stage_id": "<id_real>", "closed_stage_id": "<id_real>"}'::jsonb,
    updated_at = NOW()
WHERE key = 'ghl_stage_map';
```

### Reprocessar webhooks parados

Se algum webhook ficou em `webhook_inbox` sem `processed_at`, dá pra
reenfileirar manualmente:

```sql
-- Lista os parados
SELECT id, source, received_at, error
FROM webhook_inbox
WHERE processed_at IS NULL
ORDER BY received_at;

-- Limpar `error` se foi um erro transiente que já foi corrigido
UPDATE webhook_inbox SET error = NULL WHERE id IN (1,2,3);
```

E reenfileirar via Redis (BullMQ não tem CLI fácil, melhor reiniciar o worker
pra ele pegar o que ainda estiver pendente — mas BullMQ NÃO reprocessa
webhook_inbox automaticamente. Solução manual: chamar a função `processWaWebhook`
ou `processGhlWebhook` direto via tsx).

### Inspecionar leads de um anúncio específico

```sql
SELECT
  l.id, l.source, l.name, l.phone, l.email, l.status,
  l.attribution_method, l.qualified_at, l.purchased_at, l.purchase_value
FROM leads l
WHERE l.ad_id = '<ad_id>'
ORDER BY l.first_seen_at DESC;
```

### Inspecionar histórico de eventos CAPI

```sql
SELECT
  c.event_name, c.status, c.attempts, c.last_error,
  c.sent_at, l.name AS lead_name
FROM capi_events c
LEFT JOIN leads l ON l.id = c.lead_id
WHERE c.created_at > NOW() - INTERVAL '1 day'
ORDER BY c.created_at DESC
LIMIT 50;
```

### Forçar reenvio de um evento CAPI específico

CAPI events são dedupados por `event_id`. Pra forçar reenvio, deletar o row:

```sql
DELETE FROM capi_events WHERE event_id = '<sha256>';
```

E disparar manualmente via tsx no worker:

```bash
docker exec -it jt-worker sh -c 'cd apps/worker && tsx -e "
import { sendCapiEvent } from \"./src/workers/send-capi-event.js\";
import { workerEnvSchema, parseEnv } from \"@jt/shared\";
const env = parseEnv(workerEnvSchema);
const result = await sendCapiEvent(
  { leadId: \"<lead_id>\", eventName: \"Lead\", triggerId: \"manual_$(date +%s)\" },
  { metaToken: env.META_SYSTEM_USER_TOKEN!, metaAccounts: env.META_ACCOUNTS, metaApiVersion: env.META_API_VERSION }
);
console.log(result);
"'
```

## Backups

### Localização

Host server: `/opt/jt-dashboard/backups/jt_dashboard_<timestamp>.sql.gz`

### Backup manual

```bash
docker exec -it jt-backup /usr/local/bin/backup.sh
```

### Restaurar de um backup

```bash
# Listar backups disponíveis
ls -lh /opt/jt-dashboard/backups/

# Restaurar (sobrescreve dados atuais!)
gunzip -c /opt/jt-dashboard/backups/jt_dashboard_20260406-060000.sql.gz | \
  docker exec -i jt-postgres psql -U jt -d jt_dashboard
```

> **Atenção**: o restore zera o estado atual. Considere primeiro fazer um
> backup do estado corrente.

### Backup off-site (recomendado mas não automatizado)

Sincronizar `./backups/` com S3/Google Drive/Dropbox via cron host. Ex:

```bash
# Crontab do host (não do container)
0 4 * * * aws s3 sync /opt/jt-dashboard/backups/ s3://jt-backups/ --delete
```

## Atualização do código (deploy de nova versão)

```bash
cd /opt/jt-dashboard
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker exec -it jt-worker pnpm --filter @jt/db migrate
docker logs jt-worker --tail 20
docker logs jt-web --tail 20
```

## Rotação de token Meta

Se o System User Token for revogado/comprometido:

1. Gerar novo token no Meta Business Manager → Users → System Users
2. Atualizar `META_SYSTEM_USER_TOKEN` no `.env.production`
3. Restart só o worker:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --no-deps --build worker
   ```
4. Verificar:
   ```bash
   curl https://webhooks.jt.com.br/health | jq .checks
   curl -X POST https://webhooks.jt.com.br/internal/sync-meta -d '{}'
   ```

## Liberar um lead pra reenviar Contact

Se um lead foi criado mas o evento `Contact` falhou e precisa ser reenviado:

```sql
-- Verificar status
SELECT event_name, status, last_error FROM capi_events WHERE lead_id = '<id>';

-- Deletar o evento failed
DELETE FROM capi_events WHERE lead_id = '<id>' AND event_name = 'Contact' AND status = 'failed';
```

E reenviar manualmente (ver "Forçar reenvio" acima).

## Limpar dados de teste

```sql
-- Limpa leads de teste por padrão de telefone
DELETE FROM capi_events WHERE lead_id IN (SELECT id FROM leads WHERE phone LIKE '5511999%');
DELETE FROM messages WHERE wa_message_id LIKE 'wamid.TEST_%';
DELETE FROM leads WHERE phone LIKE '5511999%';
DELETE FROM webhook_inbox WHERE source='zapi' AND received_at > NOW() - INTERVAL '1 hour';
```

## Logs

```bash
# Worker (mais verbose)
docker logs -f jt-worker

# Web
docker logs -f jt-web

# Postgres
docker logs -f jt-postgres

# Backup
docker logs -f jt-backup
```

Filtro útil pra ver só erros:

```bash
docker logs jt-worker 2>&1 | grep -E '(ERROR|FATAL|fail)' | tail -50
```
