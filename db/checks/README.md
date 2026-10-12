# Verificações de catálogo e do modelo de papéis

| Arquivo | O que é | Quem o usa |
| --- | --- | --- |
| `security_gate.sql` | **Fonte única** das verificações de segurança do catálogo: uma consulta que devolve `(ord, ok, line)` | o **gate transacional** do runner (dentro da transação de cada migration) e `scripts/check-catalog.sh` |
| `role_model.sql` | verificação (somente leitura) do modelo de papéis do ADR-013: administrador, executor, aplicação | `scripts/db-bootstrap.sh` |

## `security_gate.sql` (gate transacional e `pnpm check:catalog`)

Inspeciona o **catálogo real** do PostgreSQL; não confia em comentários nem em configuração declarada. Todas as relações de catálogo são qualificadas com `pg_catalog.` e o chamador fixa `search_path = pg_catalog, pg_temp`: uma tabela temporária chamada `pg_class` ou uma função com o nome de `has_table_privilege` criada por uma migration **não** consegue fazer o gate ler dados falsos (testado em `scripts/test-gate.sh`). Falha fechada: papel inexistente ou invariante que não pode ser verificada vira `not ok`.

```bash
pnpm check:catalog --socket-dir /abs/socket --port 5432 --dbname NOME --user QUALQUER_PAPEL \
  [--app-role menlo_app] [--ledger-schema plataforma_migrations] [--global-allow esquema.tabela,...] [--executor-role PAPEL]
```

(Qualquer papel pode rodá-lo: só lê catálogos; inclusive o próprio `menlo_app`, como verificação de inicialização. Só socket Unix; variáveis `PG*` são ignoradas.)

| Verificação | O que exige |
| --- | --- |
| C1 | o papel da aplicação existe |
| C2 | sem superusuário, `BYPASSRLS`, `CREATEROLE`, `CREATEDB` nem `REPLICATION` |
| C3 / C4 | não é membro de outro papel; não é dono de relação, função, esquema nem banco |
| C5 | sem `CREATE` em esquema nem no banco, e sem `TEMP` |
| C6 | nenhum `ALTER DEFAULT PRIVILEGES` em favor da aplicação nem de `PUBLIC` |
| C7 | esquema, relações e funções de `plataforma_migrations` inacessíveis à aplicação |
| C8 | toda tabela **acessível à aplicação** (por privilégio de tabela **ou de coluna**): ou é do tenant (`tenant_id uuid NOT NULL`, RLS ligado **e forçado**, ao menos uma política permissiva para a aplicação e **toda** política permissiva na **forma canônica** abaixo; sem `TRUNCATE`/`REFERENCES`/`TRIGGER`), ou está na lista de tabelas globais aprovadas (somente leitura para a aplicação). Tabelas que a aplicação não alcança não são avaliadas (não se impõe `tenant_id` a tabelas internas). Entradas obsoletas da lista são erro. Sem tabelas acessíveis, a verificação é vacuosa e diz isso: o estado inicial vazio **não** é falha |
| C9 | nenhuma função `SECURITY DEFINER` executável pela aplicação |
| C10 | views acessíveis usam `security_invoker`; views materializadas acessíveis não são permitidas |
| C11 | nenhuma **tabela estrangeira** acessível (o RLS não se aplica a tabelas estrangeiras) |
| C12 | nenhuma **regra** (`CREATE RULE`) em relação acessível, exceto o `_RETURN` implícito das views |
| C13 | nenhum **gatilho** cuja função seja `SECURITY DEFINER` em relação acessível (gatilhos `SECURITY INVOKER` são legítimos e aceitos) |
| C14 | nenhum **parâmetro de papel ou de banco** (`pg_db_role_setting`) que escolha o contexto de tenant (`app.*`), `row_security`, `session_replication_role` ou `role` para a aplicação |
| G1, G2 | o executor não tem atributos privilegiados e não é membro de nenhum papel (sem herança, sem alvos de `SET ROLE`) |
| G3, G7, G8 | o executor não é dono nem altera o ledger (só `SELECT`/`INSERT`); gatilhos append-only ativos; objetos de metadados não pertencem ao executor nem à aplicação |
| G4, G5, G6 | `PUBLIC` sem `CONNECT`/`CREATE`/`TEMP` no banco e sem privilégios em esquemas, tabelas, views e sequências fora dos esquemas do sistema; a aplicação sem `UPDATE` (setval) em sequências |

G1, G2, G3, G7 e G8 só rodam quando há executor (`--executor-role`; o runner informa o papel que o executa).

### Forma canônica da política de tenant (e o que ela estabelece)

Citar `tenant_id` **não** prova isolamento. A partir da Fase 9, a expressão `USING` (e `WITH CHECK`, para `INSERT`/`UPDATE`/`ALL`) de toda política permissiva alcançável pela aplicação precisa ser, **na representação do catálogo**, exatamente uma destas:

1. `(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`;
2. `(tenant_id = (current_setting('app.tenant_id'::text, true))::uuid)` (um contexto vazio vira erro, falha fechada);
3. `(tenant_id = <esquema>.current_tenant_id())`, desde que exista no esquema uma função `current_tenant_id()` sem argumentos, `SQL`, `STABLE`, `SECURITY INVOKER`, sem configuração própria, que não pertença à aplicação e cujo corpo (normalizado: sem espaços, minúsculas) seja `select nullif(current_setting('app.tenant_id', true), '')::uuid`. Corpos com literais entre aspas de dólar não são aceitos (o corpo comparado é o texto armazenado).

Qualquer outra forma (`OR`, `AND`, `IS NOT NULL`, `tenant_id = tenant_id`, comparação com outra expressão, função com outro corpo) é rejeitada. **Trade-offs:** é uma convenção de esquema estrita, não um validador de SQL arbitrário; políticas legítimas mais ricas (por exemplo, filtros extras) exigirão estender a convenção por decisão explícita, e a função auxiliar é verificada pelo texto do corpo, não pelo comportamento.

**Três coisas diferentes, que não devem ser confundidas:**

| Propriedade | Quem a estabelece |
| --- | --- |
| Configuração do RLS (ligado, forçado) | este gate (catálogo) |
| **Forma** da política (compara `tenant_id` com a configuração de sessão e só isso) | este gate (catálogo, forma canônica) |
| **Isolamento comportamental** entre tenants (dois tenants, leitura e escrita) | testes de comportamento (`pnpm test:rls`, `GATE-P2`); **não** o gate |
| **Identidade autenticada** do tenant | a futura camada de API; `app.tenant_id` livremente definível **não** é identidade |

### Categorias avaliadas e excluídas (Fase 9)

| Categoria | Relevante sob o modelo de papéis? | Decisão |
| --- | --- | --- |
| Grants por **coluna** | sim (o executor, dono, pode concedê-los) | **coberto**: C8, C7, G5 e a lista de tabelas globais usam `has_any_column_privilege` |
| Tabelas **estrangeiras** | só com FDW e servidor concedidos ao executor (o executor não cria extensões) | **coberto** como defesa: C11 |
| **Regras** (`pg_rewrite`) | sim (o dono as cria) | **coberto**: C12 (sem regras fora de `_RETURN` em relações alcançáveis) |
| **Gatilhos** | sim | **coberto só o que tem semântica entendida**: C13 (`SECURITY DEFINER`); gatilhos `SECURITY INVOKER` são legítimos e não são rejeitados |
| **Parâmetros de papel/banco** | só administrador/superusuário os define | **coberto** como detecção: C14 (`app.*`, `row_security`, `session_replication_role`, `role`) |
| **Large objects** | não há uso planejado | **excluído**: sem política definida |
| Event triggers, publicações, assinaturas | exigem superusuário | **excluídos**: fora do que o executor pode criar |
| Tabelas herdadas/particionadas | partições são tabelas (`relkind r`) e entram em C8 | já cobertas |

### Limites (o que isto NÃO prova)

- Verifica o **estado** do catálogo. **Não** prova isolamento entre tenants (isso é o teste comportamental de RLS) e **não** autentica tenant algum: `app.tenant_id` livremente definível continua não sendo identidade autenticada.
- A checagem de política é uma convenção de **forma** (ver acima), não uma prova de isolamento nem de que a função auxiliar se comporta como o texto sugere.
- `FORCE ROW LEVEL SECURITY` **não** protege contra o dono da tabela, que pode desligar o RLS por DDL. O gate **detecta** o estado resultante antes do `COMMIT` e desfaz a migration; **não** protege contra um administrador ou superusuário que possa alterar o gate, o runner, o ledger ou a configuração do banco.
- Funções `SECURITY INVOKER` executáveis por `PUBLIC` (o padrão do PostgreSQL) não são sinalizadas; só as `SECURITY DEFINER` alcançáveis pela aplicação.

## `role_model.sql` (bootstrap)

R1 a R9: os três papéis existem e são distintos; atributos reais (login, sem superusuário/`CREATEDB`/`CREATEROLE`/`REPLICATION`/`BYPASSRLS`); nenhuma associação a papéis; PostgreSQL 16; o administrador é dono do banco; `PUBLIC` sem `CONNECT`/`CREATE`/`TEMP`; a aplicação só com `CONNECT`; o executor com `CONNECT`, `CREATE` e `TEMP`; esquema `public` fechado; metadados de migration do administrador; privilégios exatos do executor (USAGE no esquema, `SELECT`+`INSERT` no ledger, `UPDATE` em `run_lock`) e nada para a aplicação e `PUBLIC`; gatilhos ativos.

Testes: `pnpm test:security` (verificador contra a fixture e 30 mutações), `pnpm test:bootstrap` (papéis reais e sabotagens) e `pnpm test:gate` (o gate dentro da transação do runner).
