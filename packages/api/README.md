# @plataforma/api

Ponto único de acesso a dados com contexto de tenant (ADR-013, opção A endurecida). Nenhuma tela lê o banco direto (regra 4 do `CLAUDE.md`).

```ts
import { devIdentity, withTenant } from "@plataforma/api";

// identity vem de um autenticador; o tenant nunca vem do cliente sem passar pela identidade.
await withTenant(pool, identity, tenantId, (db) => db.query("SELECT ... FROM ..."));
```

`withTenant` valida o tenant, confere que a identidade verificada pertence a ele (antes de abrir conexão), abre uma transação, define `app.tenant_id` só para ela, recusa conexões de superusuário ou com `BYPASSRLS` e confirma ou desfaz. É o único arquivo autorizado a definir o contexto (`tenant-context.ts`); um teste estático barra qualquer outro.

**Limites (não esconder):** o RLS só aplica o valor de `app.tenant_id`; SQL arbitrário dentro da função ainda troca de tenant (limitação L1, coberta por um teste que a documenta). Ainda não há provedor de login: `devIdentity` é só desenvolvimento e recusa rodar em produção. Sem tabelas de produto: os testes de banco usam a fixture do harness de RLS.

Testes: `pnpm --filter @plataforma/api test` (unitários e estáticos, sem banco) e `pnpm test:api` (contra um PostgreSQL 16 descartável, como `menlo_app`).
