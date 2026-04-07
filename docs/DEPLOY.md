# Deploy — JT Dashboard

Deploy do JT Dashboard no Portainer do servidor Hetzner.

> Pipeline detalhado: [`AUTO_DEPLOY.md`](AUTO_DEPLOY.md)
> Operação dia a dia: [`RUNBOOK.md`](RUNBOOK.md)

## Pré-requisitos do servidor

- Docker 24+ instalado
- Portainer rodando
- **Traefik** na rede `traefik_public` com cert resolver `letsencrypt` (
  para HTTPS automático)
- Pelo menos 2GB de RAM livre, 10GB de disco
- DNS configurado na Hostinger:
  - `dashboard.junqueiraeteixeira.adv.br` A → IP Hetzner
  - `webhooks.junqueiraeteixeira.adv.br` A → IP Hetzner
- **Acesso SSH** ao servidor pra fazer setup inicial do Watchtower

## Primeiro deploy

### 1. Preparar GHCR auth no servidor (uma vez só)

Watchtower precisa autenticar pra puxar imagens privadas:

```bash
# SSH no servidor Hetzner
ssh root@<HETZNER_VPS_IP>

# Criar Personal Access Token no GitHub:
# https://github.com/settings/tokens?type=beta
# Repository access: jt-dashboard
# Permissions → Repository → Packages: Read-only
# Copia o token (ghp_xxx)

# Criar config Docker autenticado
mkdir -p ~/.docker
TOKEN="ghp_SEU_TOKEN"
USER="felipenunesfraga"
echo "{
  \"auths\": {
    \"ghcr.io\": {
      \"auth\": \"$(echo -n "$USER:$TOKEN" | base64)\"
    }
  }
}" > ~/.docker/config.json
chmod 600 ~/.docker/config.json
```

### 2. Gerar credenciais

**Hash da senha admin** (rodar na sua máquina local):
```bash
node apps/web/scripts/hash-password.mjs "sua_senha_real_aqui"
# Copia a saída — usaremos no Portainer
```

**AUTH_SECRET**:
```bash
openssl rand -base64 48
```

### 3. Criar Stack no Portainer

1. Acesse `https://<PORTAINER_URL>`
2. Vá em **Stacks** → **Add stack**
3. Nome: `jt-dashboard`
4. Build method: **Repository**
5. Repository URL: `https://github.com/felipenunesfraga/jt-dashboard`
6. Reference: `refs/heads/main`
7. Compose path: `docker-compose.prod.yml`
8. **Authentication**: marcar e usar PAT do GitHub (mesmo do Watchtower) se
   o repo for privado
9. Em **Environment variables**, colar:

```env
GITHUB_REPOSITORY=felipenunesfraga/jt-dashboard
IMAGE_TAG=latest

POSTGRES_PASSWORD=cole_senha_forte_aqui_min_20_chars

ADMIN_EMAIL=felipe@jt.local
ADMIN_PASSWORD_HASH=$$2a$$10$$cole_o_hash_aqui_com_$$_escapados
AUTH_SECRET=cole_o_resultado_do_openssl_aqui

META_SYSTEM_USER_TOKEN=EAAxxxxxxxxxx
META_ACCOUNTS=[{"account_id":"act_1096702648134272","name":"CA03","pixel_ids":["1545838446017240"]},{"account_id":"act_345426295001979","name":"CA02","pixel_ids":["1545838446017240"]}]
META_API_VERSION=v22.0
META_TEST_EVENT_CODE=
META_CAPI_DRY_RUN=false

ZAPI_INSTANCES=
WHATSAPP_WEBHOOK_SECRET=
GHL_PRIVATE_TOKEN=
GHL_LOCATION_ID=
GHL_WEBHOOK_SECRET=

BACKUP_RETENTION_DAYS=14
```

> **Importante**: `$` no bcrypt hash precisa ser escapado como `$$` no
> compose. Senha `<DEV_PASSWORD>` vira `$$2a$$10$$REDACTED...`.

10. **Deploy the stack**

### 4. Aplicar migrations (uma vez)

```bash
ssh root@<HETZNER_VPS_IP>
docker exec -it jt-worker pnpm --filter @jt/db migrate
```

### 5. Verificar saúde

```bash
curl https://webhooks.junqueiraeteixeira.adv.br/health | jq
curl https://dashboard.junqueiraeteixeira.adv.br/api/health | jq
```

Esperado:
```json
{
  "status": "ok",
  "checks": {
    "db": { "ok": true, "latency_ms": 2 },
    "redis": { "ok": true, "latency_ms": 1 }
  }
}
```

### 6. Forçar primeiro sync Meta

```bash
docker exec -it jt-worker sh -c \
  'wget -qO- --post-data="{}" --header="Content-Type: application/json" http://localhost:4000/internal/sync-meta'
```

Aguarda 1-3 min e verifica no dashboard.

### 7. Acessar o dashboard

<https://dashboard.junqueiraeteixeira.adv.br>

Login: o que você definiu em `ADMIN_EMAIL` + senha que gerou o hash.

## Atualizações posteriores

**100% automáticas** depois do setup inicial:

```bash
# Na sua máquina local
git add .
git commit -m "feat: nova funcionalidade"
git push origin main
```

GitHub Actions builda → push pra GHCR → Watchtower atualiza em ~30s.

Ver progresso em <https://github.com/felipenunesfraga/jt-dashboard/actions>.

## Configurar webhooks externos (quando Z-API/GHL estiverem prontos)

### Z-API

No painel Z-API, configure o webhook de mensagens recebidas:
- URL: `https://webhooks.junqueiraeteixeira.adv.br/webhooks/whatsapp/instance-1`
- (Substitua `instance-1` pelo nome de cada instância)

Se setou `WHATSAPP_WEBHOOK_SECRET`, adicione header:
- `X-JT-Webhook-Token: <mesmo valor do env>`

### GHL

No GHL Workflows:
1. Trigger: "Pipeline Stage Changed"
2. Action: "Webhook"
3. URL: `https://webhooks.junqueiraeteixeira.adv.br/webhooks/ghl`
4. Method: POST
5. Headers: `X-JT-Webhook-Token: <secret>` (se configurado)

## Backups

Diários às 03:00 BRT em `/opt/jt-dashboard/backups/`. Retenção 14 dias.

Forçar manual:
```bash
docker exec -it jt-backup /usr/local/bin/backup.sh
```

Restore:
```bash
gunzip -c backups/jt_dashboard_20260407-060000.sql.gz | \
  docker exec -i jt-postgres psql -U jt -d jt_dashboard
```

## Troubleshooting

Ver [`RUNBOOK.md`](RUNBOOK.md#troubleshooting).
