# Auto-Deploy Pipeline

Documentação do fluxo CI/CD do JT Dashboard.

## Visão geral

```
   ┌─────────────────┐
   │  git push main  │
   └────────┬────────┘
            ▼
   ┌─────────────────┐
   │  GitHub Actions │
   │   (release.yml) │
   │                 │
   │  1. Checkout    │
   │  2. Buildx      │
   │  3. Login GHCR  │
   │  4. Build x2    │
   │  5. Push GHCR   │
   └────────┬────────┘
            ▼
   ┌─────────────────┐
   │   ghcr.io       │
   │  jt-dash-web    │
   │  jt-dash-worker │
   └────────┬────────┘
            ▼ pull a cada 30s
   ┌─────────────────┐
   │   Watchtower    │
   │  (no Hetzner)   │
   └────────┬────────┘
            ▼ docker pull + restart
   ┌─────────────────┐
   │  jt-web         │
   │  jt-worker      │
   │  (atualizados)  │
   └─────────────────┘
```

## Setup inicial (uma vez)

### 1. GitHub Personal Access Token (PAT) — só pra Watchtower

Watchtower precisa de credenciais pra pular imagens privadas do GHCR.

```bash
# 1. Vá em https://github.com/settings/tokens?type=beta
# 2. Generate new token → Fine-grained
# 3. Repository access: jt-dashboard
# 4. Permissions → Repository → Packages: Read-only
# 5. Copie o token (ghp_xxx)
```

No servidor (Hetzner via SSH):

```bash
# Criar config Docker autenticado pra GHCR
mkdir -p ~/.docker
echo '{
  "auths": {
    "ghcr.io": {
      "auth": "'$(echo -n "felipenunesfraga:ghp_SEU_TOKEN" | base64)'"
    }
  }
}' > ~/.docker/config.json
chmod 600 ~/.docker/config.json
```

> **Importante**: o `docker-compose.prod.yml` monta `~/.docker/config.json`
> dentro do container Watchtower. Se você usar outro path, ajuste a variável
> `DOCKER_CONFIG`.

### 2. GitHub Actions — usa GITHUB_TOKEN automático

Não precisa criar nada. O workflow `release.yml` usa o `${{ secrets.GITHUB_TOKEN }}`
fornecido automaticamente pelo Actions com escopo `packages: write`. Já está
configurado.

### 3. Visibilidade do package no GHCR

Por padrão, packages publicados pelo Actions ficam **privados**. Pra Watchtower
puxar (com PAT autenticado), está OK. Se quiser deixar público:

1. Vai em <https://github.com/users/felipenunesfraga/packages>
2. Click no package `jt-dashboard-web` → Package settings → Change visibility → Public
3. Repete pro `jt-dashboard-worker`

Recomendação: **manter privado** (informações internas).

## Como funciona

### Push pra `main`

Quando você faz `git push origin main` (ou merge de PR):

1. **GitHub Actions dispara `release.yml`**
2. **Build paralelo das 2 imagens** (matrix com `web` e `worker`)
3. **Cache de layers via GHA** (`type=gha,scope=web|worker`) — primeiras builds
   levam 5-8 min, builds incrementais 1-2 min
4. **Tags geradas automaticamente**:
   - `latest` (sempre)
   - `sha-abc1234` (commit hash curto)
   - `20260407-153045` (timestamp UTC)
5. **Push pro GHCR** com todas as tags

### Watchtower no servidor

A cada 30s, Watchtower:

1. Lista containers com label `com.centurylinklabs.watchtower.enable=true`
2. Pra cada um, faz `docker pull` e compara digest
3. Se mudou:
   - Pull da nova imagem
   - Stop do container atual
   - Start com a nova imagem (mesmas envs/volumes/networks)
   - Cleanup das imagens antigas (`WATCHTOWER_CLEANUP=true`)
4. Rolling restart (`WATCHTOWER_ROLLING_RESTART`) garante que web/worker não
   reiniciam ao mesmo tempo

**Tempo total push → produção**: ~2-5 min na maioria dos casos.

## Verificar status

### Ver builds em andamento

<https://github.com/felipenunesfraga/jt-dashboard/actions>

### Ver imagens publicadas

<https://github.com/felipenunesfraga/jt-dashboard/pkgs/container/jt-dashboard-web>

### Ver logs do Watchtower

```bash
docker logs jt-watchtower --tail 50
```

Linhas típicas em update:

```
Found new ghcr.io/felipenunesfraga/jt-dashboard-web:latest image
Stopping /jt-web (...)
Creating /jt-web
Removing image ghcr.io/felipenunesfraga/jt-dashboard-web:<old>
```

### Ver versão atualmente rodando

```bash
docker inspect jt-web --format '{{.Image}}'
docker inspect jt-worker --format '{{.Image}}'
```

## Rollback

Se uma versão deu problema, rollback é fácil — basta especificar uma tag
antiga em vez de `latest`.

```bash
# No .env do servidor:
IMAGE_TAG=sha-abc1234   # commit anterior
```

Ou diretamente:

```bash
docker pull ghcr.io/felipenunesfraga/jt-dashboard-web:sha-abc1234
docker compose -f docker-compose.prod.yml up -d --no-deps web
```

E **desabilitar Watchtower temporariamente** pra ele não voltar pra `latest`:

```bash
docker stop jt-watchtower
```

Quando estiver corrigido, fazer commit + push, GHA builda nova `latest`,
e religar o Watchtower:

```bash
docker start jt-watchtower
```

## Pulando deploys

Se quiser commitar mudança que **não deve disparar deploy** (ex: docs, README):

- Os caminhos `**.md`, `docs/**`, `LICENSE`, `CLAUDE.md`, `PROGRESS.md`
  estão em `paths-ignore` no `release.yml` — não disparam.
- Pra forçar skip em outros casos: `git commit -m "feat: ... [skip ci]"`

## Workflow manual

Pra forçar build sem fazer commit (ex: re-build pra debug):

1. Vá em <https://github.com/felipenunesfraga/jt-dashboard/actions/workflows/release.yml>
2. Click "Run workflow" → branch `main` → Run

## Troubleshooting

### Build falha em "permission denied" ao push GHCR

O `GITHUB_TOKEN` precisa de permissão `packages: write`. Já está no workflow.
Se ainda assim falhar:

1. Repo Settings → Actions → General → Workflow permissions
2. Marca "Read and write permissions"
3. Save

### Watchtower não está atualizando

```bash
# Verificar se está rodando
docker ps | grep watchtower

# Verificar logs
docker logs jt-watchtower --tail 100

# Causas comuns:
# 1. ~/.docker/config.json não foi montado → verificar volume no compose
# 2. PAT expirou ou foi revogado → gerar novo e atualizar config.json
# 3. Containers não têm a label `watchtower.enable=true` → verificar compose
```

### CI passa mas Release falha

Verificar se o token tem permissão `packages: write`. CI só faz typecheck
(não precisa de write), Release precisa.
