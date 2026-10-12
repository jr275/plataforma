# Plataforma

Plataforma multi-tenant de SEO programático, GEO e base de conhecimento. A RE/MAX é o primeiro cliente (piloto). A documentação de produto está no repositório `menlo` (`docs/menlo-os/`), fonte de verdade (ADR-008). Decisões de arquitetura: `docs/adr/`.

Stack: pnpm + Turborepo, TypeScript, Next.js (App Router), Tailwind + shadcn/ui, Drizzle, Zod, Neon Postgres. O Python (motor de oportunidades, Search Console) fica fora deste repo por enquanto e conversa com o produto só pelo Postgres (ADR-007). Não reescrever o Python.

Verificar: `pnpm check:consistency`, `pnpm turbo typecheck lint build` e, para a segurança de tenant, `pnpm test:rls`, `pnpm test:migrations`, `pnpm test:security`, `pnpm test:bootstrap`, `pnpm test:gate`, `pnpm test:hardening` e `pnpm test:api` (PostgreSQL 16 descartável local; ver `db/test-fixtures/rls/README.md`, `db/migrations/README.md` e `db/checks/README.md`).

## Regras inegociáveis

1. Fatos nunca são gerados por LLM. Número em texto só existe como token `{{fact:id}}` ligado a um fato com fonte, confiança e validade.
2. Toda tabela do data plane tem `tenant_id` e política RLS; o mesmo PR traz o teste de isolamento entre dois tenants, rodando como papel sem superusuário.
3. Todo passo de workflow é idempotente.
4. Nenhuma tela lê o banco direto; só funções tipadas de `packages/api`.
5. Nada é publicado indexável sem passar no Quality Gate. Cada gate grava o próprio resultado; nunca há nota composta. Ambientes de teste saem com `noindex`.
6. Decisão de arquitetura nova vira um ADR curto em `docs/adr/` antes do código.
7. Dados pessoais de clientes nunca entram no grafo público nem em prompts.
8. Nunca usar a Google Indexing API para imóveis; indexação é por sitemaps e IndexNow.
9. Antes da primeira onda de publicação, a saúde do índice do domínio (URLs 2xx canônicas / URLs rastreadas) deve ser pelo menos 95%.
10. Núcleo genérico: nada de RE/MAX, imóvel ou corretor fora de `packs/real-estate`.

@AGENTS.md
