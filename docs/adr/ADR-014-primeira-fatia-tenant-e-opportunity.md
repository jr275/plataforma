# ADR-014: Primeira fatia do esquema de produto (`tenant` e `opportunity`)

**Status:** PARCIALMENTE ACEITO (2026-10-12). O dono do produto escolheu `opportunity` como primeira tabela e respondeu "aprovado" no chat (2026-10-12) às decisões 1 a 3 da seção final (escopo, colunas e valores em inglês no banco; a tela não é ligada ao banco nesta fatia). As decisões 4 (banco do produto) e 5 (ADR de autenticação) **seguem em aberto**. Implementação (fatia testada só em cluster descartável): migrations `0001_tenant` e `0002_opportunity`, funções de `packages/api/src/opportunities.ts`, `pnpm test:schema`.

**Ajuste na implementação (seção 2):** o gate de segurança (C8) exige `tenant_id` e a política canônica em toda tabela acessível à aplicação, e `tenant` tem `id` no lugar de `tenant_id`. Em vez de abrir uma exceção, a aplicação **não recebe nenhum privilégio** sobre `plataforma.tenant` (fica sem RLS, porque `FORCE` quebraria as verificações de chave estrangeira, que rodam com o dono da tabela). É mais restritivo que a proposta original (que dava `SELECT` da própria linha) e nenhuma função desta fatia precisa ler `tenant`. Se o produto precisar mostrar o nome do tenant, isso entra em uma fatia própria.

## Contexto

- O `withTenant` (`packages/api`) isola o contexto de tenant, mas nenhum chamador de produção existe, e `db/migrations/` está vazio de propósito (ADR-011, ADR-013).
- A interface (`apps/web`) usa fixtures demonstrativas (`apps/web/src/data/demo`). `opportunity` é o conceito que ela mais exibe. Fatores ficam separados e nunca somados (regra 5, ADR-002).
- `docs/proposals/NEW_SCHEMA_BASELINE.md` prevê `tenant` antes de `opportunity` e lista `opportunity` entre as tabelas com `tenant_id` e RLS. Esta ADR escolhe o **menor** recorte que permite uma fatia ponta a ponta testada.
- ADR-013 (itens 1 a 3, aprovados): papéis `plataforma_admin`, `plataforma_migrator` e `menlo_app`; opção A endurecida; **migrations nunca semeiam dados de tenant**.

## Decisão proposta

### 1. Escopo da fatia
Duas migrations, só para frente, no esquema `plataforma`: `0001_tenant` e `0002_opportunity`. Nada de `entity`, `claim`, `evidence`, `source`, `surface`: ficam para fatias seguintes, quando uma tela precisar delas. `opportunity` não terá chave estrangeira para tabelas que ainda não existem; os vínculos com entidades, fontes e conhecimento (hoje ids de fixture) entram quando essas tabelas entrarem.

### 2. `plataforma.tenant`
`id uuid` (chave primária, sem default: o id vem da operação administrativa), `slug text` único, `name text`, `created_at timestamptz`. RLS habilitada e **forçada**; a aplicação só enxerga a própria linha (`id = plataforma.current_tenant_id()`) e só tem `SELECT`. Criar tenant é operação administrativa fora do runtime (ADR-013, item 3).

### 3. `plataforma.opportunity`
| Coluna | Tipo e regra |
| --- | --- |
| `id` | `uuid`, chave primária, `gen_random_uuid()` |
| `tenant_id` | `uuid NOT NULL`, chave estrangeira para `tenant(id)` |
| `title`, `summary`, `next_action` | `text NOT NULL` (limites de tamanho por `CHECK`) |
| `kind` | `CHECK` em `page`, `cluster`, `faq`, `comparison` |
| `intent` | `CHECK` em `informational`, `comparison`, `transactional` |
| `demand`, `competition`, `evidence` | `CHECK` em `high`, `medium`, `low` (**fatores separados; não existe coluna de nota ou pontuação**) |
| `status` | `CHECK` em `candidate`, `in_review`, `ready`, `blocked`, `dismissed` |
| `rank` | `integer NOT NULL` (ordem editorial, não é nota) |
| `rationale`, `gaps` | `text[] NOT NULL DEFAULT '{}'` |
| `created_at`, `updated_at` | `timestamptz NOT NULL` |

Único `(tenant_id, id)` (para chaves estrangeiras compostas futuras) e índice `(tenant_id, rank)`. Valores em inglês no banco; a interface os traduz.

### 4. RLS e privilégios
`ENABLE` e `FORCE ROW LEVEL SECURITY`; uma política `tenant_isolation` para `menlo_app` com `USING` e `WITH CHECK` por `tenant_id = plataforma.current_tenant_id()`. `menlo_app` recebe `SELECT`, `INSERT` e `UPDATE` (sem `DELETE`: descartar é mudar o `status`). Nada para `PUBLIC`, nenhum default privilege, e as migrations passam pelo gate de segurança existente (`db/checks/security_gate.sql`).

### 5. API (`packages/api`)
Funções tipadas que **só** executam dentro de `withTenant`: listar, obter por id e alterar o `status` de oportunidades. Sem SQL na camada de tela (regra 4). Os tipos do Drizzle em `packages/db` descrevem o acesso e não geram migration (ADR-011).

### 6. Dados e testes
- Migrations sem dados de tenant. Os testes semeiam dois tenants como superusuário do cluster **descartável**, como a fixture de RLS faz hoje.
- Testes no PostgreSQL 16 descartável (e na CI): com `app.tenant_id = A` não lê nem escreve linhas de B; sem `app.tenant_id` retorna zero linhas; `INSERT` com `tenant_id` de outro tenant é rejeitado; `UPDATE` não move linha entre tenants; verificação de catálogo (toda tabela concedida à aplicação tem `tenant_id`, RLS forçada e política); teste estático de que não existe coluna de nota composta.
- A interface **não** é ligada ao banco nesta fatia: não há banco de produto acessível nem autenticação. `apps/web/src/data/source.ts` continua sendo o ponto de troca.

### 7. Autenticação (entrada do dono, não decisão de integração)
O dono indicou **Supabase** como provedor de login (chat, 2026-10-12). Isso **não** aprova o detalhe da integração, que precisa de uma ADR própria. Pontos em aberto: o banco do produto continua Neon (CLAUDE.md) ou passa a ser o Postgres do Supabase; como o JWT verificado vira `VerifiedIdentity`; onde mora a associação usuário↔tenant (`tenant_member`) e quem a administra. Até lá, `devIdentity` segue restrita a desenvolvimento.

## Alternativas rejeitadas
- **Começar por `entity` e `claim`:** maior, e nenhuma tela as consome primeiro.
- **Nota composta de prioridade:** proibida (regra 5, ADR-002).
- **Estados e níveis em português no banco:** mistura apresentação com dado; a tradução fica na interface.
- **`DELETE` para descartar:** perde histórico; `status = dismissed` basta.

## Consequências
- A primeira fatia exercita ADR-011/013, o runner, o gate, o `withTenant` e a CI de ponta a ponta.
- A tela continua em fixtures até haver banco acessível e autenticação.
- Vínculos de oportunidade com entidades, fontes e conhecimento ficam para depois.

## Decisões necessárias do dono do produto
1. Aprovar (ou ajustar) o escopo, as colunas e os valores dos `CHECK` acima.
2. Aprovar valores de domínio em inglês no banco.
3. Confirmar que a fatia **não** liga a tela ao banco agora.
4. Banco do produto: Neon (como no CLAUDE.md) ou Postgres do Supabase.
5. Autorizar uma ADR separada de autenticação com Supabase.
