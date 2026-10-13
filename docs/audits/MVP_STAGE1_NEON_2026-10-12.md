# MVP, etapa 1: infraestrutura e Neon (evidências)

**Data:** 2026-10-12 · **Base:** commit `4b98c56` + alterações locais descritas abaixo (ainda não commitadas) · **Escopo:** só a etapa 1 dos critérios de aceite do MVP. As etapas 2 a 7 **não** foram iniciadas.

## 1. O que foi criado
| Item | Estado |
| --- | --- |
| Projeto Neon `plataforma-dev` (`autumn-art-97369869`), **PostgreSQL 16.15**, região `aws-sa-east-1` (São Paulo), banco `plataforma`, plano Free | criado e conectado |
| Projeto Neon anterior (`misty-haze-25309742`, PostgreSQL 18, Ohio) | **apagado** com autorização do dono, depois de conferir que estava vazio (0 tabelas) |
| Papéis `plataforma_admin`, `plataforma_migrator`, `menlo_app` (ADR-013) | criados por `scripts/neon-bootstrap.sh`; senhas geradas localmente, só em `.env.neon.local` (permissão 600, no `.gitignore`) |
| Migrations `0001_tenant` e `0002_opportunity` | aplicadas ao branch `main` pelo runner, com o gate de segurança ativo |
| Modo remoto do runner e do `check-catalog` (`--remote-conn-env`) | implementado; o modo de socket ficou idêntico |

Arquivos novos ou alterados: `scripts/lib/remote-conn.sh`, `scripts/neon-bootstrap.sh`, `scripts/test-neon.sh`, `scripts/db-migrate.sh`, `scripts/check-catalog.sh`, `packages/api/src/opportunities.product.test.ts`, `docs/runbooks/neon-dev.md`, este documento.

## 2. Critérios da etapa 1
| Critério | Resultado | Evidência |
| --- | --- | --- |
| Projeto PostgreSQL acessível pelo ambiente de desenvolvimento | **Atendido** | `psql` conectou: versão `16.15`, banco `plataforma`; `verify-full` com as raízes do sistema validou o certificado |
| Schema criado exclusivamente por migrations versionadas | **Atendido** | ledger com cabeça `2:f7492cec…`; o bootstrap só cria papéis, restringe o banco e inicializa o ledger |
| Migrations em banco vazio e reaplicadas sem inconsistência | **Atendido** | 1ª execução: `2 aplicada(s)`; 2ª: `0 aplicada(s), 2 já atualizada(s)`; repetido no branch temporário de teste |
| Conexão fora do repositório; nenhum segredo em logs | **Atendido, com ressalva** | `.env.neon.local` ignorado e 600; segredo nunca na linha de comando; teste confirma que a mensagem de falha de autenticação **não** contém a senha. Ressalva: não varri logs de todas as ferramentas externas (CLI do Neon) |
| Entidades principais por identificadores estáveis | **Parcial** | `opportunity.tenant_id` referencia `tenant(id)` (uuid); a rejeição de tenant inexistente foi testada no cluster descartável (`pnpm test:schema`), **não repetida no Neon** |
| Isolamento entre organizações, leitura e escrita | **Atendido** | `scripts/test-neon.sh`: leitura isolada, sem contexto = 0 linhas, `INSERT` cruzado rejeitado, `UPDATE` cruzado sem efeito, mudança de tenant rejeitada, `DELETE` negado, sem acesso à tabela `tenant` e ao ledger; mais as 8 funções de `packages/api` por `withTenant` com TLS |
| Tratamento de falhas de conexão e de migration | **Parcial** | conexão: senha inválida, URI inválido, sem TLS e bypass do gate recusados (testados no Neon). Erro de migration (gate rejeitando uma migration insegura): testado só no cluster descartável (`pnpm test:gate`) |

**Resultado dos testes no Neon:** `22/22` verificações (`NEON TESTS: PASSED`), num branch temporário (cópia do `main`) apagado ao fim. O branch `main` ficou sem dados de teste (0 tenants).

**Regressão dos testes existentes (modo de socket, cluster descartável):** `test:migrations` 213, `test:gate` 237, `test:hardening` 96, `test:bootstrap` 95, `test:security` 93, `test:schema` passando.

## 3. Desvios e limites (fatos)
1. **R3 do modelo de papéis, desvio conhecido do Neon.** No PostgreSQL 16, o papel que cria um papel recebe `ADMIN OPTION` sobre ele, concedido pelo `cloud_admin`, sem `INHERIT` e sem `SET`; o dono do Neon não consegue removê-lo. O bootstrap mantém a verificação R3 estrita e só aceita **exatamente** essas 3 associações (qualquer outra reprova).
2. **O papel dono do Neon (`plataforma_owner`) tem `BYPASSRLS`** e `CREATEROLE`/`CREATEDB`. Ele só serve ao preparo; a aplicação e o executor não o usam.
3. **`menlo_app` pode executar `pg_advisory_lock` no Neon** (`has_function_privilege = true`). O ADR-013 pede que a aplicação **não** tenha esse privilégio (DoS por trava). O `REVOKE` em `pg_catalog` exige ser dono da função; **não foi testado se o Neon permite**. **Risco aceito pelo dono para o ambiente de desenvolvimento** (chat, 2026-10-12); **não** vale para produção e **continua em aberto** para ela.
4. **Seed de tenants:** o executor (`plataforma_migrator`) cria tenants nos testes. Para produção é preciso um procedimento administrativo próprio, fora das migrations (ADR-013, item 3). **Não implementado.**
5. **CI:** os testes do Neon **não** estão no workflow (exigiriam credencial na CI). Rodam localmente com `neon login` e `.env.neon.local`.
6. **Região:** São Paulo escolhida por proximidade; plano Free com histórico de 6 horas.
7. Existe um projeto `keeply` na mesma organização Neon que **não é deste produto** e não foi tocado.

## 4. Pendências
Procedimento administrativo de criação de tenant; `REVOKE` das travas de aconselhamento antes de qualquer produção (risco aceito só em desenvolvimento); rotação de senhas dos papéis; decidir se os testes do Neon entram na CI com segredos protegidos; e as etapas 2 a 7 do MVP.
