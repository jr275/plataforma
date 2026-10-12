# ADR-011: Fonte de verdade do esquema do banco

**Status:** ACCEPTED como direção de trabalho (autorizado pelo dono do produto na Fase 2, 2026-10-11; atestação confirmada pelo dono do produto no chat em 2026-10-12): SQL escrito à mão e versionado é a autoridade do esquema; Drizzle é só a camada tipada de acesso. A implementação da pipeline de migrations de produto continua pendente.

## Contexto

- ADR-007: TypeScript no produto, Python em análise e medição; o contrato entre os dois é o Postgres, e um lado não chama o outro por código.
- Regra 2 do `CLAUDE.md`: toda tabela do data plane tem `tenant_id`, RLS e teste de isolamento rodando como papel sem superusuário.
- `menlo/docs/dev-setup.md` (PROPOSTA) descreve `packages/db/` como "esquema Drizzle e cliente" **e** `db/migrations/` como "SQL versionado": duas fontes possíveis.
- `menlo/docs/menlo-os/09-tecnologias.md` recomenda "Drizzle ORM (ou Prisma): migrações e consultas tipadas".
- O histórico documentado (migrações 0.1 a 0.5) é SQL escrito à mão, aplicado com `psql`, com testes em SQL. Os arquivos não foram encontrados (ver `docs/audits/FOUNDATION_AUDIT.md`).
- Estado atual: `packages/db/src/schema.ts` é `export {}`; não há migrations.

## Opções

**A. Drizzle é dono do esquema e gera as migrations (`drizzle-kit generate`).**
- Prós: tipos e esquema nascem juntos; um fluxo só para TypeScript.
- Contras: RLS, `CREATE POLICY`, `security_invoker` em views, funções, extensões e papéis exigem SQL manual dentro das migrations geradas, o que reintroduz SQL à mão sem revisão dedicada. O Python precisaria confiar em artefatos gerados por uma ferramenta TypeScript, tornando-a autoridade de um contrato que ele também consome.

**B. SQL escrito à mão é a autoridade; Drizzle é a camada tipada de acesso.**
- Prós: RLS, papéis, views e funções são revisáveis como SQL puro (o ponto mais sensível de segurança); o mesmo arquivo é aplicado por TypeScript, Python e CI; segue a prática já documentada e o ADR-007 (o banco é o contrato).
- Contras: tipos Drizzle podem divergir do banco; exige uma checagem de deriva e disciplina de revisão.

**C. Prisma ou outro ORM.** Sem evidência de necessidade; amplia a superfície sem resolver RLS. Não recomendado.

## Recomendação: B

- Migrations SQL numeradas em `db/migrations/`, aplicadas por um único runner (a definir: `psql` em script versionado ou uma ferramenta de migração SQL pura), como **dono do esquema**.
- Drizzle em `packages/db` descreve as tabelas para consulta tipada. Ele **não** gera migrations: `drizzle.config.ts` não deve ser usado com `generate`/`migrate`. Os tipos vêm de `drizzle-kit pull` (introspecção) ou de declaração manual, e uma checagem de deriva compara o resultado com o banco migrado.
- Python lê e escreve nas mesmas tabelas; nenhuma definição de esquema em Python.
- Toda migration que cria tabela do data plane traz `tenant_id`, RLS e o teste de isolamento no mesmo PR.

## Fluxo de migration

1. Autor escreve `NNNN_descricao.sql` em `db/migrations/` (convenção e regras em `db/migrations/README.md`) e o teste correspondente.
2. CI cria um Postgres 16 descartável, aplica todas as migrations em ordem como dono do esquema, roda os testes de RLS conectando como `menlo_app` (não superusuário, sem `BYPASSRLS`).
3. A checagem de deriva compara o esquema Drizzle com o banco migrado.
4. Migrations já aplicadas em ambiente compartilhado nunca são editadas; correção vira nova migration.

## Requisitos dos testes de RLS

- Dois tenants com dados; conexão como papel sem superusuário; leitura e escrita cruzada devem falhar ou retornar zero linhas.
- Views usam `security_invoker` (PostgreSQL 15+).
- Teste negativo: o mesmo teste como superusuário não prova nada e não conta.

## Consequências

- Um só fluxo de mudança de esquema; Drizzle não compete com o SQL.
- Custo: manter os tipos sincronizados com a checagem de deriva.
- Rollback: migrations são para frente; reverter dados exige migration compensatória ou restauração.

## Suposições em aberto

- Se a opção A for preferida por produtividade, o dono do produto precisa aceitar SQL manual dentro das migrations geradas e uma revisão de segurança específica para RLS.
- Escolha do runner de migrations (`psql` + script vs. ferramenta SQL pura): não decidida.
- Papel da aplicação: **`menlo_app`** mantido por compatibilidade com a documentação (decidido na Fase 2). Renomear só se houver conflito concreto.

## Evidência de implementação (Fase 2)

- O harness em `db/test-fixtures/rls/` (comando `pnpm test:rls`) usa exatamente este modelo: SQL à mão aplicado como dono do esquema, testes conectando como `menlo_app`. Ele é uma fixture de teste e **não** é migration de produto.
- **Inconsistência do scaffold, corrigida na Fase 3:** os scripts `generate` e `migrate` do `drizzle-kit` (em `packages/db/package.json`) e o `drizzle.config.ts` (com `out: "./drizzle"`) foram removidos. Nada no código os usava; o Drizzle continua em uso apenas como camada tipada (`drizzle-orm/neon-http` em `packages/db/src/index.ts` e `schema.ts` para as declarações de tabelas).
- **O que permanece:** `drizzle-kit` segue como `devDependency` porque a introspecção (`drizzle-kit pull`) e a checagem de deriva descritas acima ainda são candidatas, sem decisão. Se forem descartadas, remover a dependência. Sem `drizzle.config.*`, os comandos de geração não rodam por acidente.
- **Aplicação da decisão:** `pnpm check:consistency` (`scripts/check-consistency.sh`, também no CI) falha se aparecer um `drizzle.config.*`, um histórico `drizzle/meta`, ou qualquer `drizzle-kit generate|migrate|push|up|drop` em `package.json`, `turbo.json`, `.github/` ou `scripts/`.
- **Runner implementado na Fase 4:** `scripts/db-migrate.sh` (Bash + `psql`, sem dependência nova), com ledger `plataforma_migrations.ledger`, checksum SHA-256 dos bytes exatos, lock de aconselhamento e uma transação por migration. Contrato completo em `db/migrations/README.md`; testes em `scripts/test-migrations.sh`.
- **Ainda pendente:** papel de migração e acesso a banco remoto em produção (nenhum definido). `db/migrations/` está vazio de propósito; nenhum esquema de produto existe.

## Esclarecimento (Fase 6, conflito documentado com o ADR-013)

O Fluxo de migration acima diz que as migrations são aplicadas "como dono do esquema". Esse texto é ambíguo e, tomado ao pé da letra, leva a um executor que também é dono do ledger, o que permite reescrever o histórico (achado 1 da Fase 5). A resolução adotada na Fase 6 (ADR-013): o **executor** é dono dos objetos de produto; o ledger e a tabela de lock pertencem ao **administrador**; o executor só tem `SELECT, INSERT` no ledger. A decisão do ADR-011 (SQL à mão como autoridade, Drizzle só tipa o acesso) não muda.
