# Security Policy

## Reporting a Vulnerability

Encontrou um problema de segurança? **Não abra issue pública.**

Envie um email pra: `felipe@junqueiraeteixeira.adv.br` com:

- Descrição do problema
- Passos pra reproduzir
- Impacto potencial

Resposta esperada em até 72h.

## Escopo

Este repositório contém o código do JT Dashboard (Meta Ads + WhatsApp + GHL).
Vulnerabilidades em dependências de terceiros devem ser reportadas ao projeto upstream.

## Boas práticas de segurança seguidas

- Segredos **nunca** são commitados (`.env*` no `.gitignore`)
- Tokens são redigidos em logs (`redactToken()` em `apps/worker/src/services/meta-marketing.ts`)
- Webhooks externos validam assinatura/secret quando aplicável
- Auth single-user via bcrypt + Auth.js v5
- HTTPS obrigatório em produção (Traefik/NPM)
- Backup diário do Postgres com retenção de 14 dias

## Variáveis sensíveis (NUNCA commitar)

- `META_SYSTEM_USER_TOKEN`
- `ADMIN_PASSWORD_HASH`
- `AUTH_SECRET`
- `GHL_PRIVATE_TOKEN`
- `ZAPI_INSTANCES`
- `POSTGRES_PASSWORD`
- `WHATSAPP_WEBHOOK_SECRET`
- `GHL_WEBHOOK_SECRET`
