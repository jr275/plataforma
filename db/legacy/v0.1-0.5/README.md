# LEGADO (migrações 0.1 a 0.5), ainda não adaptado ao runner

> **Estes arquivos não são executados pelo runner de `db/migrations/`.** Eles seguem a numeração antiga (com saltos, porque os testes estavam intercalados) e foram escritos antes da ADR-011 e da ADR-013. Antes de virarem migrations de verdade, precisam: nomes `NNNN_descricao.sql` sem lacunas; rodar com o papel executor (sem superusuário); e o teste de RLS conectar como `menlo_app`. A extensão opcional (PostGIS e pgvector) exige privilégio que o executor não tem e não deve ser migration. O procedimento abaixo, com `psql` e "dono do esquema", vale só para quem for estudar este legado.

# Banco de dados (PostgreSQL 15 ou superior)

A migração 0.5 usa `security_invoker` nas views, que exige PostgreSQL 15+. O isolamento entre clientes é feito por RLS com `menlo.tenant_id`.

## Ordem das migrações (banco novo)
Rode como dono do esquema, nesta ordem:

| Ordem | Arquivo | O que faz |
| --- | --- | --- |
| 1 | `migrations/01_esquema.sql` | Esquema base |
| 2 | `migrations/04_migracao_0.2.sql` | Liga cada padrão de demanda a uma entidade (`demand_pattern.entity_id`) |
| 3 | `migrations/05_migracao_0.3.sql` | Migração 0.3 (ADR-009) |
| 4 | `migrations/07_migracao_0.4.sql` | `page_type` (12 tipos), índice único do Search Console, views da série do piloto |
| 5 | `migrations/09_migracao_0.5_rls.sql` | `security_invoker` nas views e RLS na tabela `tenant` |
| opcional | `migrations/02_extensoes_opcionais.sql` | PostGIS e pgvector; não testado no ambiente de desenvolvimento |

A numeração pula 03, 06, 08 e 10 porque esses arquivos são testes (pasta `tests/`).

## Testes
Todos rodam em transação e desfazem no final. Rode como dono do esquema ou superusuário; o teste de RLS troca sozinho para o papel `menlo_app` (sem superusuário e sem BYPASSRLS).

    psql "$DATABASE_URL" -f db/legacy/v0.1-0.5/tests/03_exemplo_e_teste.sql
    psql "$DATABASE_URL" -f db/legacy/v0.1-0.5/tests/06_teste_0.3.sql   # 5 testes
    psql "$DATABASE_URL" -f db/legacy/v0.1-0.5/tests/08_teste_0.4.sql   # T1 a T4
    psql "$DATABASE_URL" -f db/legacy/v0.1-0.5/tests/10_teste_rls.sql   # 7 verificações; falha em T1 antes da 0.5

## Papéis
- Dono do esquema: aplica migrações, cria clientes (provisionamento) e roda o carregador do Search Console.
- `menlo_app`: papel da aplicação. Não é superusuário, não ignora RLS e não pode inserir, alterar ou apagar em `tenant`.
- Superusuário ignora RLS: nunca use para provar isolamento.

## Regra do repositório
Toda tabela nova do data plane nasce com `tenant_id`, política RLS e o teste de isolamento entre dois tenants no mesmo PR.
