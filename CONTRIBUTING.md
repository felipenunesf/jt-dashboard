# Contributing

Este é um projeto proprietário de uso interno (Felipe → JT Advocacia Médica),
mas segue convenções de open source pra manter o código sustentável.

## Fluxo de trabalho

1. **Sempre trabalhe em uma branch** a partir de `main`:

   ```bash
   git checkout -b feat/nome-da-mudanca
   ```

2. **Commits seguem [Conventional Commits](https://www.conventionalcommits.org/)**:
   - `feat:` nova funcionalidade
   - `fix:` correção de bug
   - `chore:` mudanças que não afetam código de produção
   - `docs:` só documentação
   - `refactor:` refatoração sem mudança de comportamento
   - `perf:` performance
   - `test:` testes
   - `ci:` CI/CD

   Exemplos:

   ```
   feat(worker): add CompleteRegistration event on qualifier match
   fix(web): escape bcrypt $ in env file
   chore: bump deps
   ```

   O commitlint vai bloquear commits fora desse padrão.

3. **Antes de commitar**, o pre-commit hook (Husky) roda automaticamente:
   - `pnpm typecheck` em todos os packages
   - `pnpm lint` (ESLint)
   - `pnpm format:check` (Prettier)

   Se algo falhar, o commit é abortado.

4. **Push pra branch + abre PR**:

   ```bash
   git push -u origin feat/nome-da-mudanca
   gh pr create
   ```

5. **GitHub Actions roda CI** (typecheck + lint) automaticamente.

6. **Merge no `main`** dispara o release workflow:
   - Builda imagens Docker do `web` e `worker`
   - Push pro GitHub Container Registry (`ghcr.io`)
   - Watchtower no servidor detecta a nova imagem em ≤30s e atualiza
     os containers automaticamente

## Padrões de código

### TypeScript

- **Strict mode** sempre. `noUncheckedIndexedAccess` ativo.
- **Sem `any`**. Use `unknown` + zod parse para validar boundaries externos.
- **Sem comentários óbvios**. Comentários só onde a intenção não é evidente.
- **Funções pequenas e nomeadas**. Cada função tem um propósito claro.

### Banco de dados

- **Nunca editar migrations já aplicadas**. Sempre gerar nova migration:
  ```bash
  pnpm db:generate
  pnpm db:migrate
  ```
- **Schema é a fonte da verdade** (`packages/db/src/schema.ts`). Drizzle gera
  o SQL a partir dele.

### Segredos

- **Nunca** commitar `.env`, credenciais, tokens.
- **Nunca** logar tokens completos. Use `redactToken()` ou `.slice(0, 7)`.
- **Nunca** colocar credenciais em mensagens de erro.

### Estrutura de pastas

- `apps/web/` — Next.js App Router. Server Components fazem SQL direto.
- `apps/worker/` — Fastify routes em `routes/`, lógica pesada em `workers/`,
  clientes HTTP em `services/`, helpers em `lib/`.
- `packages/db/` — schema único, sem split.
- `packages/shared/` — só tipos e schemas zod.

## Setup do ambiente local

Ver [`docs/SETUP.md`](docs/SETUP.md).

## Testes

Atualmente o projeto **não tem testes automatizados**. A validação é feita via:

1. `pnpm typecheck` — pega 80% dos bugs
2. ESLint — pega o resto
3. Smoke tests manuais com `curl` (documentados em RUNBOOK.md)
4. Validação visual no dashboard

Quando necessário, adicionar Vitest + supertest para o worker e Playwright
para o web.

## Dúvidas

Consulte:

- [`CLAUDE.md`](CLAUDE.md) — instruções pro Claude Code (também úteis pra humanos)
- [`PROGRESS.md`](PROGRESS.md) — estado vivo do projeto
- [`docs/`](docs/) — arquitetura, deploy, runbook
