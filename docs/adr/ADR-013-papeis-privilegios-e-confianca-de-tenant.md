# ADR-013: Papéis de banco, privilégios de migration e fronteira de confiança do tenant

**Status:** PARCIALMENTE ACEITO (2026-10-12). Os itens 1 a 3 de "Decisões em aberto" foram aprovados pelo dono do produto no chat da sessão de trabalho em 2026-10-12; não há outro registro de aprovação. Os itens 4 a 7 seguem em aberto e o restante do ADR continua PROPOSED (proposto em 2026-10-11). As Fases 6, 7 e 9 implementaram e testaram, **só contra clusters descartáveis**, as correções de ledger, de lock e de catálogo (seção "Implementação e verificação (Fase 6)"), o bootstrap de papéis e o gate de segurança transacional (seção "Implementação e verificação (Fase 7)"). Continua sem papel de produção. Estende o ADR-011 e o runner da Fase 4; os pontos de conflito com texto anterior estão na seção "Conflitos".

## Contexto: o que existe de fato

Verificado nos arquivos e em experimentos num PostgreSQL 16.15 descartável (os experimentos foram ad hoc e **não** estão no repositório; ver "Evidência").

- **Papéis implementados:** só em clusters de teste descartáveis. `rls_bootstrap` (superusuário de bootstrap do cluster, criado pelo `initdb` em `scripts/lib/disposable-pg.sh`), `rls_fixture_owner` e `menlo_app` (`db/test-fixtures/rls/00_roles.sql`) e `mig_test_owner` (criado em `scripts/test-migrations.sh`). **Nenhum papel existe em banco persistente ou remoto**; nenhum foi definido para produção.
- **Conexão no código:** `packages/db/src/index.ts` aceita uma única `databaseUrl` (driver Neon HTTP) e `.env.example` tem só `DATABASE_URL=`. O código não distingue papel de aplicação, de migração ou administrativo.
- **Nomes só em documentação:** `DATABASE_URL_OWNER`, `TEST_DATABASE_URL`, "dono do esquema" e `menlo_app` aparecem nos docs do `menlo` e em `docs/proposals/NEW_SCHEMA_BASELINE.md`; não correspondem a papéis implementados.
- **Runner (`scripts/db-migrate.sh`):** cria `plataforma_migrations.ledger` com o papel que executa; esse papel torna-se dono e pode alterá-lo livremente.
- **Tenant:** a política da fixture confia em `app.tenant_id`, que o próprio `menlo_app` pode definir (teste `L1`).

## Evidência (experimentos em PostgreSQL 16.15 descartável, ad hoc)

| # | Resultado observado |
| --- | --- |
| X1 | Num banco novo, `PUBLIC` tem `CONNECT` e `TEMP`; `menlo_app` cria tabela temporária, lê `pg_roles`, define qualquer variável de sessão (`set_config('app.tenant_id', ...)`). Negados por padrão: criar tabela em `public` (PG15+), ler `pg_authid`, `pg_read_file`, `COPY ... TO PROGRAM`, `lo_import` |
| X2 | `menlo_app` consegue tomar o lock de aconselhamento do runner: com ele seguro, o runner falhou com código 3 (negação de serviço, sem perda de integridade: o runner falha fechado). `REVOKE EXECUTE` de todas as funções `pg_*advisory*` (as encontradas em `pg_catalog`) de `PUBLIC` bloqueou `menlo_app`; o runner voltou a funcionar (código 0) só depois de um `GRANT EXECUTE` mínimo (`pg_advisory_lock(bigint)`, `pg_advisory_unlock(bigint)`) ao papel de migração; sem o `GRANT`, saiu com código 4 |
| X3 | Com o ledger criado e pertencente a outro papel (o executor só com `SELECT, INSERT`), o runner atual falhou com código 1 (`permission denied for schema plataforma_migrations`): ele **exige** poder criar no esquema do ledger, ou seja, ser dono |
| X4 | O papel dono do ledger apaga a última linha sem erro; o runner seguinte **reaplicou a migration** (`applied 0002_insert.sql`, código 0) e a tabela de negócio ficou com 2 linhas: apagar a última linha do ledger **não é detectado**. O dono pode retirar `DELETE` de si mesmo, mas pode reconceder a si mesmo |
| X5 | Com `ALTER DEFAULT PRIVILEGES ... GRANT ... TO menlo_app`, uma tabela criada pela migration **sem RLS** ficou legível pela aplicação (dados de outro tenant expostos). Uma consulta de catálogo (tabelas acessíveis ao app sem `relrowsecurity AND relforcerowsecurity`) a detecta |
| X6 | O papel dono, sob `FORCE ROW LEVEL SECURITY` e sem `BYPASSRLS`, **não consegue inserir** em tabela com RLS (`new row violates row-level security policy`); com `BYPASSRLS` consegue. O dono pode desligar a proteção (`NO FORCE`) sozinho |
| X7 | Login por tenant (`t_a`) só vê os próprios dados e não faz `SET ROLE t_b`. Um login compartilhado que é **membro** dos papéis dos tenants faz `SET ROLE t_b` e lê os dados do B: papéis por tenant só isolam com credenciais separadas |
| X8 | Contexto de sessão (`is_local=false`) persiste entre transações e `DISCARD ALL` o limpa; contexto de transação (`is_local=true`) desaparece no `COMMIT` sem `DISCARD ALL` |

## Taxonomia de papéis (proposta; "implementado" = existe só em cluster de teste)

| Papel (nome proposto) | Estado hoje | Login | Dono de objetos | Cria schema/tabela/função/extensão | Altera papéis / concede | `BYPASSRLS` | Ambiente |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Aplicação** `menlo_app` | implementado só em teste | sim | **nunca** | **não** (nem `TEMP`) | não | **não** | runtime da aplicação |
| **Migração** `plataforma_migrator` | só proposto (análogo de teste: `mig_test_owner`) | sim, só para CI/deploy | **sim**, dos objetos de produto | schemas, tabelas, funções do produto; **extensões não** | não cria papéis; só concede privilégios dos próprios objetos | **não** (padrão) | CI/deploy; nunca no runtime da aplicação |
| **Teste/bootstrap** `rls_bootstrap` (+ `rls_fixture_owner`, `mig_test_owner`) | implementado só em cluster descartável | sim | só do cluster de teste | tudo (superusuário) | sim | sim (superusuário) | **só** clusters descartáveis; nunca em banco persistente |
| **Administrativo** `plataforma_admin` | só proposto | sim, nominal e auditado | **sim**, do ledger e das extensões | papéis, bancos, extensões, ledger | sim | não precisa | operações privilegiadas fora da aplicação (provisionamento, rotação, reparo) |

Papel de carga/análise do Python (`load_gsc.py`): **adiado**; depende do esquema de produto (ver "Conflitos").

## Privilégios

- **`menlo_app`:** `CONNECT`; `USAGE` apenas nos esquemas do produto; `SELECT/INSERT/UPDATE/DELETE` **só** nas tabelas concedidas explicitamente, uma a uma, na mesma migration que cria a tabela; `EXECUTE` só em funções concedidas explicitamente. **Negados:** DDL, `TRUNCATE`, `REFERENCES`, `TRIGGER`, `TEMP`, `SET ROLE`, qualquer acesso a `plataforma_migrations`, funções de lock de aconselhamento, e a ser dono de qualquer objeto. Sem `ALTER DEFAULT PRIVILEGES` a favor dele (X5).
- **`plataforma_migrator`:** `CREATE` nos esquemas do produto; `USAGE` e **apenas `SELECT, INSERT`** em `plataforma_migrations.ledger`; `EXECUTE` em `pg_advisory_lock(bigint)` e `pg_advisory_unlock(bigint)`. Sem superusuário, sem `CREATEROLE`, sem `BYPASSRLS`, sem `UPDATE/DELETE/TRUNCATE` no ledger.
- **`plataforma_admin`:** cria papéis, bancos, extensões, o esquema e a tabela do ledger e seus `GRANT`; aplica os `REVOKE` de `PUBLIC` (`CONNECT`, `TEMP`, funções de lock de aconselhamento).
- **Regra de grant:** toda tabela do data plane concedida ao app tem `tenant_id`, `ENABLE` + `FORCE ROW LEVEL SECURITY` e o teste de isolamento (regra 2). Exceções só numa lista explícita revisada no PR.

## Modelo de execução de migrations

- **Identidade:** o runner executa como `plataforma_migrator`, uma identidade de operador/implantação, **nunca** como `menlo_app` nem como superusuário. Não há mecanismo de elevação de privilégio: se uma migration exigir algo que o migrator não pode (criar extensão, papel), ela é executada por `plataforma_admin` como etapa operacional separada e revisada.
- **Ledger:** criado e pertencente a `plataforma_admin`; o migrator só lê e insere. Isso fecha X4 contra o executor (ele não consegue apagar nem alterar linhas), mas **não** contra o administrador. A adulteração do ledger por quem o possui continua indetectável pelo próprio ledger (X4); a mitigação é separação de privilégios e trilha de auditoria externa, sem inventar mecanismo criptográfico aqui.
- **Mudança no runner (feita na Fase 6, só contra clusters descartáveis):** o modo normal **verifica** o ledger e recusa o executor que o possua ou o possa alterar; `--init-ledger` (administrador) o cria. Ver "Implementação e verificação (Fase 6)".
- **Defaults e grants:** migrations **não** podem usar `ALTER DEFAULT PRIVILEGES` a favor de `menlo_app` nem conceder a `PUBLIC` (X5). O `GRANT` ao app é explícito, por objeto.
- **RLS e o dono (X6):** o migrator, sendo dono sob `FORCE`, não consegue semear dados em tabelas com RLS e pode desfazer o `FORCE`. Política proposta: migrations só de esquema; `BYPASSRLS` **não** é dado ao migrator; reforço de dados passa por uma operação administrativa revisada à parte (decisão pendente). A proteção contra uma migration que enfraqueça o RLS é o teste de catálogo no CI mais a revisão de PR (regra 2).
- **Lock (X2) — proposta original SUBSTITUÍDA na Fase 6:** a proposta era revogar `EXECUTE` das funções de lock de aconselhamento de `PUBLIC`. Isso afeta o banco inteiro e não foi adotado. O runner passou a usar um lock de tabela dedicado e inacessível à aplicação (`plataforma_migrations.run_lock`), sem lock de aconselhamento. Ver "Implementação e verificação (Fase 6)".
- **Falha e recuperação:** como hoje (rollback por transação, sem registro, correção do arquivo e nova execução). Inconsistência de histórico não é corrigida pelo runner; vira reparo manual do administrador.
- **Variáveis de ambiente (proposta de nomes):** `DATABASE_URL` (aplicação), `DATABASE_URL_MIGRATOR` (só CI/deploy) e `DATABASE_URL_ADMIN` (nunca no ambiente da aplicação). Nada disso foi criado nem alterado.

## Fronteira de confiança do tenant

Distinções:

1. **RLS** aplica uma política ao valor de `app.tenant_id` da sessão. Não autentica ninguém.
2. **API autenticada** deriva o tenant da identidade verificada e da associação autorizada do usuário; é o único ponto em que "quem é este usuário e a que tenants ele pertence" é decidido.
3. **Processo comprometido ou SQL arbitrário** sob `menlo_app` pode executar `set_config('app.tenant_id', ...)` e trocar de tenant (X1, `L1`); o banco confia no valor.

| Opção | Propriedades de segurança | Mitiga | Não mitiga | Complexidade | Pool de conexões | Encaixe |
| --- | --- | --- | --- | --- | --- | --- |
| **A. Autorização na aplicação + contexto local à transação** | O tenant vem da API; contexto só com `set_config(..., true)` num único ponto de acesso a dados; RLS como segunda barreira | bug de consulta sem filtro de tenant, vazamento acidental entre requisições | injeção de SQL ou processo comprometido que forja o contexto | baixa | compatível com pool em modo de transação (contexto some no `COMMIT`, X8); em modo de sessão exige `DISCARD ALL` | bom para o início |
| **B. Identidade de tenant imposta pelo banco, não forjável pelo papel de aplicação** | em teoria resolveria a forja | tudo o que A não mitiga | depende do desenho | alta | variável | **diferido**: nada foi verificado aqui; para um login compartilhado, `app.tenant_id` é livremente definível (X1) |
| **C. Papéis ou bancos por tenant** | isolamento imposto pelo banco **se** cada tenant tem credencial própria (X7); com login compartilhado membro de todos os papéis, não isola | forja de contexto, injeção de SQL, vazamento entre tenants | bug que usa a credencial errada; abuso dentro do mesmo tenant | alta: N credenciais, N pools; migrations em N bancos se for banco por tenant | um pool por tenant | **adiado**: serve para poucos tenants de alto valor |
| **D. Função de autorização no banco** | só ajuda se a função valida uma credencial que o app não consegue forjar, o que exige um desenho criptográfico revisado (excluído desta fase); funções `SECURITY DEFINER` ampliam a superfície (caminho de busca, privilégios) | depende do desenho | a mesma forja se a entrada for livre | alta | depende | **diferido**: exige desenho revisado |

**Recomendação inicial: A, endurecida.** Contexto só em transação, um único ponto de acesso (futuro `packages/api`) que recebe o tenant de uma identidade verificada e de uma associação autorizada, nunca de cliente; verificação de que a conexão não é superusuário nem tem `BYPASSRLS` na inicialização; ESLint ou teste que proíba `set_config` e `SET app.` fora do ponto único e qualquer uso de `is_local=false`; `menlo_app` com o mínimo de privilégios (acima); ferramentas de IA sem acesso SQL arbitrário.

**Suposições e limites:** a segurança entre tenants passa a depender do código da API e dos testes; injeção de SQL ou processo comprometido continuam capazes de trocar de tenant.

**O que justificaria um modelo mais forte:** um segundo cliente com exigência contratual ou regulatória de isolamento; qualquer recurso que exponha SQL arbitrário ou ferramentas de IA conectadas ao banco a entrada influenciada por tenant; evidência de bugs de confusão de tenant; poucos tenants de alto valor (viabiliza C). Hoje o piloto tem um único cliente.

## Testes de segurança necessários

**Podem ser feitos agora (fixture descartável, sem esquema de produto) — itens 1 a 6 implementados na Fase 6 (ver a seção seguinte), o 7 continua pendente:**
1. Superfície de privilégios do `menlo_app`: sem `TEMP`, sem `CREATE` em lugar algum, sem `EXECUTE` em funções de lock de aconselhamento, sem `SET ROLE`, sem acesso a `plataforma_migrations` (parte coberta por `T6` e `MIG-N2`).
2. Papel de migração: não é superusuário, não tem `BYPASSRLS` nem `CREATEROLE`; não consegue `UPDATE/DELETE` no ledger (depende da mudança do runner); migrations não deixam grants para `PUBLIC` nem default privileges a favor do app.
3. Lints de catálogo no CI: toda tabela concedida ao app tem RLS forçado e `tenant_id` (X5); todo `SECURITY DEFINER` tem `search_path` fixo e está numa lista permitida; views usam `security_invoker`.
4. Contexto: já coberto `T5`, `T5b`, `T5c`, `T5d`; acrescentar limpeza com `DISCARD ALL` (X8) e duas "requisições" na mesma conexão.
5. Negação de serviço do lock (X2), com e sem o `REVOKE`.
6. Teste que documenta a adulteração da última linha do ledger (X4): falha hoje de propósito até haver mitigação.
7. Verificação de inicialização contra superusuário/`BYPASSRLS` acidental.

**Exigem a camada de autenticação/API ou o esquema de produto:** acesso cruzado de tenants por rota, cabeçalho ou corpo forjado; injeção de SQL com tabelas reais; proteção por views e funções `SECURITY DEFINER` reais; teste de pool real (modo de transação e de sessão) contra o pooler escolhido; propagação do tenant em jobs, workflows e ferramentas de IA; testes por tenant se C for adotado.

**Os testes existentes** (47 de RLS, 6 mutações, 112 de migrations) provam o que declaram sobre **uma tabela de teste e um único papel dono** de migration. Não provam o modelo dividido (migrator versus admin), a revogação das funções de lock, a proteção do ledger contra o executor, nem nada sobre identidade de tenant.

## Implementação e verificação (Fase 6)

Tudo abaixo foi executado **somente em clusters PostgreSQL 16.15 descartáveis**; nenhum banco persistente ou remoto foi usado e nenhum papel de produção foi criado.

**Achados reproduzidos antes de mudar o código (runner anterior):**

| # | Achado | Reprodução |
| --- | --- | --- |
| 1 | apagar a última entrada do ledger faz o runner reaplicar a migration | o executor (dono) apagou a linha; o runner seguinte saiu com 0 e aplicou a migration de novo; a tabela de negócio ficou com 2 linhas |
| 2 | a aplicação toma o lock do runner | com `menlo_app` segurando a chave, o runner saiu com código 3; `pg_locks` é legível pela aplicação e expõe a chave |
| 3 | `ALTER DEFAULT PRIVILEGES` expõe tabela sem RLS | `menlo_app` leu a tabela nova sem RLS (dados de outro tenant) |
| 4 | o dono com `FORCE` altera a configuração de RLS | o dono executou `NO FORCE` e `DISABLE ROW LEVEL SECURITY`; depois a aplicação passou de 0 para 1 linha de outro tenant |

**Correções implementadas e suas suposições de confiança:**

| Achado | Correção | Suposição e limite |
| --- | --- | --- |
| 1 | Ledger e lock pertencem ao **administrador**; o executor só tem `SELECT, INSERT` no ledger e `UPDATE` em `run_lock`; gatilhos append-only (também contra dono e superusuário); o runner recusa executor superusuário, com `BYPASSRLS`, dono ou membro do dono, com privilégio de alteração, ou ledger sem gatilhos; `--init-ledger` separado; `--expect-head N[:SHA256]` e impressão de `ledger head` como evidência independente | O **administrador é confiável**. Um dono privilegiado ou superusuário pode desabilitar os gatilhos e apagar as últimas entradas; isso **não é detectável pelo próprio ledger** (um checksum ou uma cadeia de hashes sobre as linhas restantes não muda isso). Só `--expect-head`, guardado fora do banco, o detecta. Sem ele, o runner reaplica. Nenhuma cadeia de hashes foi adicionada: sem modelo de ameaça aprovado que a exija |
| 2 | Lock de **tabela** (`run_lock`, vazia) em vez de `pg_advisory_lock`; transação por migration com `LOCK TABLE ... EXCLUSIVE`, revalidação do histórico e reconferência **sob o lock** | A aplicação não tem `USAGE` no esquema nem privilégio na tabela. Resíduos: administrador e superusuário podem segurar o lock; uma consulta da aplicação ainda pode bloquear um DDL do executor sobre uma tabela de produto |
| 3 | `db/checks/catalog_security.sql` + `scripts/check-catalog.sh` (C1 a C10), com regra: nada de default privileges a favor da aplicação/`PUBLIC`; `GRANT` explícito por objeto; tabelas do tenant com `tenant_id`, RLS ligado e forçado e política que cita `tenant_id`; tabelas globais só por lista aprovada, somente leitura | Verifica o **estado** do catálogo (heurístico quanto à política); não prova isolamento entre tenants |
| 4 | **Não há correção que impeça o dono** (é uma propriedade do PostgreSQL). Mitigação: a aplicação nunca é dona; o executor não é dono do ledger; a verificação C8 detecta RLS desligado ou não forçado | `FORCE` não protege contra o dono da tabela nem contra o migrator comprometido. Falta rodar C8 como etapa obrigatória do CI e do deploy contra o banco já migrado (não existe esquema de produto) |

**Testes de regressão que agora impõem as correções (versionados):** `scripts/test-migrations.sh` (198 verificações: ledger `L1` a `L10`, lock `K1` a `K5`, mais as de execução, integridade, transacionalidade e concorrência) e `scripts/test-security.sh` (92 verificações: estado correto, achados 3 e 4, 30 mutações de catálogo, tabelas globais, views). Validados plantando 12 defeitos nas cópias descartáveis do runner e das verificações (lock de aconselhamento de volta, executor dono, executor com todos os privilégios, sem gatilhos, sem checagem de gatilho, `--expect-head` ignorado, sem reconferência sob o lock, e cinco verificações de catálogo removidas): todos detectados. Um deles (privilégio sobre o ledger sem `USAGE` no esquema) só foi detectado depois de acrescentar mutações específicas, o que corrigiu uma lacuna da suíte.

**O que continua pendente:** nada disso foi aplicado a um banco de produção; papéis reais, autenticação remota, comportamento do Neon (inclusive se o administrador pode criar o ledger lá), a decisão de dados semeados sob RLS e a execução do CI no GitHub.

## Implementação e verificação (Fase 7)

Tudo foi executado **somente em clusters PostgreSQL 16.15 descartáveis**. Nenhum banco persistente ou remoto foi usado, nenhum papel de produção foi criado e nenhuma credencial foi lida ou alterada.

**Bootstrap de papéis (`scripts/db-bootstrap.sh`, `db/checks/role_model.sql`; `pnpm test:bootstrap`, 89 verificações).** Provisiona e **verifica o estado real** (atributos, associações, donos e privilégios do catálogo, e tentativas reais de cada papel) de:

| Papel | Atributos verificados | Privilégios verificados |
| --- | --- | --- |
| `plataforma_admin` (administrador, dono do banco e do ledger) | login; sem superusuário, `CREATEDB`, `CREATEROLE`, `REPLICATION`, `BYPASSRLS`; sem associações | dono do banco, do ledger, do lock, do esquema de metadados e das funções dos gatilhos; **não** cria papéis |
| `plataforma_migrator` (executor) | idem; sem associações | `CONNECT`, `CREATE` (cria esquemas de produto) e `TEMP` (tabelas temporárias do runner) no banco; `USAGE` no esquema de metadados, `SELECT`+`INSERT` no ledger, `UPDATE` em `run_lock`; **não** apaga nem altera o ledger, **não** cria nem altera papéis, **não** concede associações, **não** entrega a propriedade de objetos à aplicação |
| `menlo_app` (aplicação) | idem; sem associações | só `CONNECT`; sem `CREATE`, sem `TEMP`, nada em `public`, nada nos metadados de migration, sem `SET ROLE` para os outros papéis |
| `PUBLIC` | — | sem `CONNECT`, `CREATE` nem `TEMP` no banco; sem `USAGE` em `public` |

O bootstrap **só** provisiona clusters descartáveis (exige o marcador do cluster de teste, rejeita servidor que escute em rede, exige o superusuário do cluster e PostgreSQL 16, e só cria bancos novos). Os papéis são globais no cluster, por isso o procedimento não serve a um servidor compartilhado; os `REVOKE` de `PUBLIC` (`CONNECT`, `TEMP`, `public`) valem **apenas para o banco recém-criado**. **Implicação para produção (não implementada, não verificada no Neon):** o PostgreSQL entrega `CONNECT` e `TEMP` a `PUBLIC` e `USAGE` em `public` por padrão; um banco real precisa dos mesmos `REVOKE`, aplicados por um procedimento próprio, revisado e com papéis gerenciados. Papéis preexistentes com atributos perigosos são redefinidos; **associações** perigosas preexistentes **não** são removidas em silêncio: a verificação falha. **(Superado na Fase 9: papéis preexistentes fora do modelo agora são RECUSADOS antes de qualquer mudança, nunca redefinidos; ver a seção da Fase 9.)**

**Gate de segurança transacional (`db/checks/security_gate.sql`, fonte única, também usada por `pnpm check:catalog`; `pnpm test:gate`, 237 verificações).** Ordem de execução por migration pendente, numa única transação: `BEGIN`; `LOCK TABLE ... EXCLUSIVE` (lock); revalidação do histórico e reconferência sob o lock; SQL da migration; verificação de que a migration não encerrou a transação; `SET LOCAL search_path = pg_catalog, pg_temp`; **gate**; só então `INSERT` no ledger; `COMMIT`. Antes de qualquer migration roda o **gate de linha de base** (read-only, com `ROLLBACK`). Se qualquer passo falhar, tudo é desfeito: a migration não é registrada nem dada como aplicada antes do `COMMIT`. O gate é obrigatório (exige `--app-role`); só se desliga com `--no-security-gate` explícito (aviso impresso; só para os testes do runner).

Invariantes verificadas no catálogo real (C1 a C10 e G1 a G8, ver `db/checks/README.md`): atributos e fronteiras de privilégio da aplicação; acesso da aplicação ao ledger e ao lock; privilégios de esquema, tabela e sequência; `PUBLIC`; default privileges; donos de objetos protegidos; RLS ligado e forçado e política de tenant em toda tabela alcançável pela aplicação; tabelas globais somente por lista aprovada (somente leitura); views e `SECURITY DEFINER`; associações e herança do executor.

**Desvio de ordem em relação ao pedido, e por quê.** A sequência solicitada (lock; validar; `BEGIN`; executar; gate; ledger; `COMMIT`) pressupõe um lock de sessão. O lock adotado na Fase 6 é de **tabela e de transação** (para que a aplicação não possa interferir), então a transação começa antes do lock: `BEGIN; LOCK; validar; executar; gate; ledger; COMMIT`. A validação inicial, sem lock, só lê e serve para falhar cedo; a validação **sob o lock** é a que autoriza a execução.

**Resultados dos testes (tentativas reais, estado do catálogo antes e depois):**

- Válidas: o estado inicial vazio passa; uma migration de tenant correta é aplicada e registrada (e o `menlo_app` real só vê as linhas do próprio tenant); tabela global aprovada, view `security_invoker`, tabela inalcançável pela aplicação e sequência só com `USAGE` passam.
- Rejeitadas pelo gate (código 1, `not ok - ...`, **não registradas**, catálogo idêntico ao anterior, e **uma versão corrigida da mesma migration é aplicada em seguida**): desligar RLS; remover `FORCE`; remover a política; trocá-la por `USING (true)`; política aberta para `PUBLIC`; `GRANT` a `PUBLIC` em dados ou em esquema; `TRUNCATE`, `CREATE` em esquema ou `UPDATE` em sequência para a aplicação; default privileges para a aplicação e para `PUBLIC`; tabela alcançável sem `tenant_id` ou com tipo errado; tabela alcançável sem RLS; view sem `security_invoker`; view materializada; `SECURITY DEFINER` executável pela aplicação; escrita numa tabela global aprovada.
- Rejeitadas **pelo PostgreSQL** porque o executor não tem autoridade (nada persiste): entregar a propriedade de uma tabela ou do ledger à aplicação, `ALTER ROLE ... BYPASSRLS/SUPERUSER/CREATEROLE`, associações a papéis, apagar linhas do ledger ou o gatilho, `SET LOCAL session_replication_role`. `GRANT` sem autoridade sobre metadados de migration só emite aviso e não concede nada; a migration é inofensiva e o gate confirma que os metadados seguem fechados.
- Operações não transacionais (`CREATE INDEX CONCURRENTLY`, `VACUUM`, `CREATE DATABASE`, `ALTER SYSTEM`): o PostgreSQL as rejeita dentro da transação; **não há fallback sem transação**. Controle de transação explícito é rejeitado antes de conectar.
- Tentativas de enganar o gate por dentro da migration: tabela temporária `pg_class`, funções `has_table_privilege` e `has_schema_privilege` no esquema da migration com `search_path` alterado, e troca das tabelas temporárias do runner: todas rejeitadas. Sem as defesas (`search_path` fixo e referências qualificadas a `pg_catalog`), plantadas em cópias, o gate **é** enganado e os testes falham (verificado).
- Linha de base: um banco que já viola as invariantes (por exemplo, `GRANT` a `PUBLIC` feito por um superusuário) recusa **qualquer** execução, mesmo sem migrations pendentes; reparado, volta a passar. Papel da aplicação inexistente falha fechado.
- Contraste: com `--no-security-gate`, a migration que desliga o RLS **é** aplicada (é isso que o gate impede), e a execução seguinte com o gate recusa o estado resultante.

**Revisão do lock (todas as afirmações abaixo têm teste).** SQL exato de aquisição e de liberação; só `UPDATE` na tabela dá o modo `EXCLUSIVE` (com `SELECT`+`INSERT` o PostgreSQL nega, e `INSERT` sozinho só permitiria `ROW EXCLUSIVE`, que não conflita consigo mesmo); a exclusão mútua foi observada também em SQL puro (o segundo locker espera e estoura o `lock_timeout`, depois obtém o lock quando o primeiro faz `COMMIT`); o runner mantém uma única conexão e transação durante a migration (amostrado em 3 instantes); o lock é liberado após sucesso, falha de SQL, `pg_terminate_backend` e `SIGKILL` do `psql` do runner, e a execução seguinte o obtém de imediato; três runners concorrentes aplicam cada migration exatamente uma vez; a aplicação não obtém nem interfere (negação imediata, não enfileira). Resíduos: administrador e superusuário podem segurar o lock; uma consulta da aplicação ainda pode atrasar um DDL do executor sobre uma tabela de produto.

**Confiança no histórico (`--expect-head`).** O ledger e os testes provam consistência interna, **não** completude: apagar as últimas entradas não é detectável pelo próprio ledger (um checksum ou uma cadeia de hashes sobre as linhas restantes não muda isso), e um dono ou superusuário contorna os gatilhos. `--expect-head N:SHA256` só é evidência independente quando o valor vem de uma fonte confiável **fora do banco mutável** (log do deploy anterior, segredo de ambiente, repositório de configuração); guardá-lo no próprio banco que se quer verificar não protege. Nenhuma cadeia de hashes foi adicionada. O gate **não** protege contra um administrador ou superusuário que possa alterar o gate, o runner, o ledger ou a configuração do banco.

**Identidade de tenant.** Nada disso autentica tenant: o RLS aplica uma política ao `app.tenant_id` da sessão, e o gate verifica que a política existe e cita `tenant_id`. Continua faltando a camada de API que deriva o tenant de identidade verificada e associação autorizada, e os testes de integração listados no ADR (acesso cruzado por rota, injeção de SQL sob o papel da aplicação, pooler real, jobs e ferramentas de IA).

**Pré-requisitos de produção ainda não verificados contra o Neon:** se o administrador gerenciado pode criar o ledger, o lock e os gatilhos, e aplicar os `REVOKE` em `PUBLIC`; como o runner se autentica (TLS, senha, identidade; hoje só socket Unix sem senha); papéis gerenciados e rotação; execução do CI no GitHub; Linux; e o G11.

## Remediação da auditoria (Fase 9): modelo de ameaça e correções

Tudo executado só em clusters PostgreSQL 16.15 descartáveis; nenhum banco persistente ou remoto, nenhum papel ou credencial reais. **Isto não aprova o ADR-013 nem é um runbook de produção.** Os achados F1 a F8 da auditoria da Fase 8 foram **confirmados antes de corrigir** com testes de regressão rodados contra a implementação anterior (88 verificações, 55 falharam: ver a coluna "Confirmado").

### Modelo de ameaça

| Fonte | Garantia |
| --- | --- |
| 1. Código revisado e confiável | suportado |
| 2. SQL inseguro por acidente / sintaxe não suportada | suportado: falha fechada, nada persiste |
| 3. Arquivos malformados | suportado: rejeitados antes de executar |
| 4. Autor malicioso / SQL hostil | **não suportado**: a migration roda com os privilégios do executor; o gate dentro da transação não torna seguro executar SQL hostil sob um papel privilegiado. As correções fecham classes de contorno conhecidas, não prometem isso |
| 5. Administrador ou superusuário comprometido | **fora de escopo** |

### Achados: cenário, causa, correção, teste e suposições

| # | Cenário original (confirmado) | Causa | Correção | Teste de regressão (observa estado) | Suposições e limites |
| --- | --- | --- | --- | --- | --- |
| F1 | metacomando do `psql` depois de SQL na mesma linha era interpretado (saída injetada; controle de erro desligável; `\q`) | a migration entrava no `psql` por `\i` e a varredura só olhava o início da linha | a migration vai como **texto**, num literal entre aspas de dólar dentro de `DO ... EXECUTE`; o `psql` não a interpreta | `HARD-F1a..f` (rejeitada, nada persiste, catálogo idêntico; migrations válidas com `\` e `:nome` em comentários e literais continuam aplicando; vazio, branco, NUL, só comentário, várias instruções dependentes) | a varredura por linha virou aviso antecipado; a proteção é o literal. O marcador de aspas de dólar é derivado do hash e verificado ausente do arquivo |
| F2 | marcadores impressos e `exit 0` bastavam; houve sucesso relatado sem nada confirmado | sucesso inferido da saída | sucesso exige `exit 0` **e** leitura do ledger numa conexão nova (nomes, números e checksums idênticos ao diretório; cada migration reportada uma vez); `ledger head` vem dessa leitura; `applied`/`current` só são impressos depois | `HARD-F1b`, `HARD-F2a` (dublê de `psql` que imprime marcadores e sai 0), `HARD-F2b` (head impresso = head lido) | execuções concorrentes: a atribuição `applied` por runner vem do próprio runner; o estado final é o do banco |
| F3 | um `COMMIT` na mesma linha confirmava o que vinha antes, sem gate e sem ledger (RLS desligado persistia) | detecção heurística por linha + guarda `xid` só detecta depois | transação imposta pelo servidor: `COMMIT`, `END`, `COMMIT AND CHAIN`, `SAVEPOINT`, `START TRANSACTION`, `BEGIN`, `PREPARE TRANSACTION`, procedimento que confirma e comandos fora de transação são recusados; **política: controle de transação não é suportado** | `HARD-F3` (10 formas, mudança insegura + `COMMIT`, procedimento, `CONCURRENTLY`; nada persiste) e `MIG-T5` (a antiga "limitação conhecida" não existe mais) | a guarda `xid` permanece como defesa adicional |
| F4 | `SET` de sessão e objetos temporários vazavam para a próxima migration e para os comandos do runner | uma sessão para toda a execução, sem reset; `search_path` fixado só em volta do gate | `DISCARD ALL` + `search_path` fixo antes de cada migration; a migration roda com o `search_path` padrão; `RESET ALL` antes do gate; função de validação recriada por transação com os dados dentro dela e `search_path` próprio | `HARD-F4` (search_path, `statement_timeout` e tabela temporária não vazam) | migrations devem qualificar nomes; o esquema `public` do banco bootstrapado é fechado |
| F5 | política que só "citava" `tenant_id` (`IS NOT NULL`, `OR true`) passava | regex léxica | **forma canônica** (catálogo): `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid` (com ou sem `nullif`) ou `tenant_id = <esquema>.current_tenant_id()` com função verificada (corpo normalizado, `STABLE`, `SQL`, `SECURITY INVOKER`) | `HARD-F5` (7 rejeições, 3 aceitações) | convenção de **forma**, não prova de isolamento nem de comportamento da função; isolamento = teste comportamental; identidade = futura API |
| F6 | grants por coluna, tabelas estrangeiras, regras, gatilhos `SECURITY DEFINER` e parâmetros de papel passavam | classificação só por privilégio de tabela; categorias não inspecionadas | `has_any_column_privilege` em C7, C8, G5 e na lista global; C11 (estrangeiras), C12 (regras), C13 (gatilhos definer), C14 (parâmetros de papel/banco) | `HARD-F6` (rejeições e o gatilho `SECURITY INVOKER` legítimo aceito) | categorias excluídas e justificativa: `db/checks/README.md` |
| F7 | `--no-security-gate` funcionava contra qualquer socket local | nenhuma prova de alvo descartável | exige marcador com nonce que case com o servidor em execução (`plataforma.disposable_nonce`) e servidor sem rede | `HARD-F7a..d` (nonce errado, formato errado, ausente; execução com gate não depende do marcador) | não protege contra administrador local malicioso |
| F8 | marcador era um arquivo comum; papéis homônimos eram redefinidos; falha deixava banco parcial | marcador sem vínculo; `ALTER ROLE` incondicional; sem limpeza | nonce no marcador e no servidor; papéis preexistentes fora do modelo ou com associações são **recusados antes de qualquer mudança**; falha depois de criar o banco remove o banco e os papéis criados **por esta execução**; `--verify-only` abre conexões read-only | `HARD-F8a/b`, `BOOT-7`, `--verify-only` não altera o catálogo | partes irreversíveis: `DROP` pode falhar (avisado) |

**F9 a F13 (adiados):** mensagens de erro classificadas por texto do stderr (F10: só muda o código 3 versus 1); o `fp()` de `test-hardening.sh` inclui ACL de coluna, regras, gatilhos e parâmetros de papel (F11, tratado só aí, por ser necessário às regressões; o `fp()` de `test-gate.sh` não foi alterado); planted-defects de Fase 7 continuam fora do repositório, mas esta fase os rodou de novo contra o código novo (F12, ver abaixo); actions por SHA e `apt-get` sem versão fixa (F13) **não foram tratados**.

**Validação das regressões:** 10 defeitos plantados em cópias descartáveis do código novo foram detectados (execução como texto removida: 14 falhas; sem `DISCARD ALL`: 1; sem verificação no banco: 4; nonce do runner não conferido: 1; política só léxica: 4; sem colunas: 2; bootstrap com redefinição silenciosa: 1; sem limpeza: 3; sem regras/gatilhos/parâmetros: 7; nonce do bootstrap não conferido: 4). Dois só foram detectados depois de acrescentar casos (nonce bem formado e errado; recusa antecipada versus limpeza).

**Resultado do runner sob este modelo:** é seguro para **código de migration revisado** e fecha as classes de contorno acima; **não** há suporte a um modelo de ameaça mais forte.

## Conflitos com decisões e textos anteriores

| Onde | Conflito | Proposta de resolução |
| --- | --- | --- |
| ADR-011, "Fluxo de migration" | diz que as migrations são aplicadas "como dono do esquema" | esclarecer: o dono dos objetos de produto é o migrator; o dono do ledger é o administrador |
| `db/migrations/README.md` e `scripts/db-migrate.sh` | o runner criava o ledger e o executor era dono dele (X3, X4) | **resolvido na Fase 6**: ver acima |
| ADR-010 e `NEW_SCHEMA_BASELINE.md` §4 (docs do `menlo`) | o carregador Python roda "como dono do esquema" (`DATABASE_URL_OWNER`) | papel próprio de carga com privilégios mínimos nas tabelas que escreve; decidir depois do esquema |
| `docs/proposals/NEW_SCHEMA_BASELINE.md` §4 | "papel de aplicação sem superusuário" sem definir migrator e administrador | usar esta taxonomia (implementada só em ambiente descartável na Fase 7) |
| Fase 7: ordem pedida lock; validar; `BEGIN` | pressupõe lock de sessão; o lock da Fase 6 é de tabela e de transação | `BEGIN; LOCK; validar; executar; gate; ledger; COMMIT` (ver a seção da Fase 7) |

Nenhum texto anterior foi reescrito nesta fase.

## Decisões antes do esquema de produto (itens 1 a 3 aprovados em 2026-10-12; 4 a 7 em aberto)

1. **Aprovado (2026-10-12):** a taxonomia de papéis, os nomes e a separação migrator/administrador, como descritos na seção "Taxonomia de papéis".
2. **Aprovado (2026-10-12):** a opção A (endurecida) como modelo inicial de tenant, com os gatilhos listados em "O que justificaria um modelo mais forte" para migrar para um modelo mais forte. A segurança entre tenants passa a depender do código da API e dos testes; injeção de SQL ou processo comprometido continuam capazes de trocar de tenant.
3. **Aprovado (2026-10-12), sobre como as migrations semeiam dados sob RLS (X6):** migrations nunca semeiam dados de tenant. Dados de referência globais entram por tabela global aprovada (somente leitura para a aplicação); dados de tenant entram por uma operação administrativa separada, fora das migrations.
4. Se o Neon permite revogar o lock de aconselhamento de `PUBLIC` e como o ledger é criado lá; autenticação do runner contra banco remoto (TLS, senha, identidade): nada disso foi verificado nem implementado.
5. Papel do carregador Python.
6. Mudança do runner para não criar o ledger.
7. Pré-requisitos de produção: credenciais reais fora do repositório e rotação, o G11 resolvido, auditoria de uso do papel administrativo, e a primeira execução real do CI (o workflow nunca rodou no GitHub).
