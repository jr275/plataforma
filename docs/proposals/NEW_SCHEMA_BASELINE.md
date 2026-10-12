# Proposta: novo esquema-base (baseline) — NÃO IMPLEMENTADA

**Status:** PROPOSTA (2026-10-11). Só vale se os arquivos originais (migrations 0.1 a 0.5 e testes de RLS) continuarem indisponíveis. Não cria tabelas nem migrations.

## 1. É uma implementação nova, não uma recuperação

- As migrations históricas (`01_esquema.sql` … `10_teste_rls.sql`) **não foram encontradas** e **não são recriadas aqui**. Os testes históricos de RLS não podem ser tidos como passando.
- O novo esquema se chama **baseline v1 do `plataforma`**. Os arquivos usam numeração própria (`0001_…`) e **nunca** os nomes históricos, para ninguém confundir com os originais.
- Se os originais aparecerem depois, o dono do produto decide entre adotá-los e comparar com este baseline; este documento não presume o resultado.

## 2. O que a documentação permite afirmar

Fonte: `menlo/docs/menlo-os/05-dicionario-de-dados.md` (rascunho; cita 19 das 26 tabelas do esquema 0.1) e `04-arquitetura.md`. O dicionário **não** é prova de um esquema completo.

| Tabela citada | Grupo | Observação do dicionário |
| --- | --- | --- |
| `tenant`, `market`, `language` | Base | `tenant` com RLS desde a 0.5 |
| `entity`, `entity_type_schema` | Entidades | contrato de conhecimento por tipo |
| `relation` | Relações | `valid_from`, `valid_to`, fonte, confiança |
| `claim`, `evidence`, `source` | Afirmações | classe VERIFIED/DERIVED/INFERRED/UNSUPPORTED, fonte, data observada, versão |
| `opportunity` | Oportunidades | fatores separados, ação |
| `surface`, `surface_fact`, `template` | Superfícies | `kind`, `page_type`, estágio do template, `contract` jsonb |
| `quality_gate_result`, `publication_policy`, `review_queue`, `decision_trace` | Governança | um resultado por gate; sem nota composta |
| `observation` | Resultado | escrita pelo Python como dono do esquema |
| `job` | Execução | estado e rastro por etapa |
| `surface_link` | prevista | links entre superfícies |

## 3. O que **não** pode ser inferido com segurança

- Tipos, nulidade, chaves e índices de cada coluna ("a preencher a partir do SQL", segundo o próprio dicionário).
- As 7 tabelas do esquema 0.1 que o dicionário não nomeia, a view, as 2 funções e as views do Search Console.
- As tabelas da migração 0.3 (política e raio de impacto de fonte, contrato e elegibilidade de superfície, ciclo de vida de localidade, padrão de conhecimento).
- **Receitas de página e artefatos de página:** o dicionário não tem tabela `page_recipe` nem de artefato; só `template` (com `contract`) e `surface`. Modelá-los é decisão nova.
- Papel `menlo_app`: citado, mas sem definição de privilégios.

## 4. Propriedade de tenant e fronteiras de autorização

- `tenant` é a raiz. Toda tabela do data plane tem `tenant_id NOT NULL` referenciando `tenant`, com RLS habilitada e forçada (`FORCE ROW LEVEL SECURITY`).
- Papéis: **dono do esquema** (aplica migrations; carregadores Python com `DATABASE_URL_OWNER`), **papel de aplicação** (sem superusuário, sem `BYPASSRLS`; usado pela aplicação e pelos testes), e opcionalmente um papel de leitura para o Python analítico.
- O tenant da requisição entra por configuração de sessão (`SET LOCAL app.tenant_id`) lida pelas políticas; a autorização de quem pode chamar fica na API (regra 4), não no banco sozinho.
- Tabelas **sem** `tenant_id`: referência global (idiomas, tipos de entidade de configuração do núcleo), se houver; decisão a confirmar tabela a tabela.

## 5. Relações entre conceitos (proposta a validar)

```
tenant ─┬─ entity ──< relation (valid_from/valid_to, source, confidence)
        │     └──< claim (class, observed_at, version, valid_from/valid_to) ──< evidence ── source
        ├─ opportunity (fatores separados, ação) ──> decision_trace
        ├─ template (versão, contract jsonb, estágio) [+ receita: a modelar]
        ├─ surface ──< surface_fact (claim_id, claim_version)   # linhagem página → fatos
        └─ quality_gate_result (um por gate, por versão de surface)
```

Cadeia de proveniência: página → `surface_fact` → `claim` → `evidence` → `source`. O resultado de cada gate nunca é agregado em nota única (regra 5).

## 6. Tabelas que exigem `tenant_id` e RLS no primeiro baseline mínimo

`entity`, `relation`, `claim`, `evidence`, `source` (se por cliente), `opportunity`, `surface`, `surface_fact`, `template`, `quality_gate_result`, `decision_trace`. `tenant` tem RLS própria (só enxerga a si mesmo). As demais entram quando o slice precisar.

## 7. Testes de isolamento

- Postgres 16 local descartável (Docker), conexão como papel de aplicação.
- Para cada tabela: com `app.tenant_id = A`, não lê nem escreve linhas de B; sem `app.tenant_id`, retorna zero linhas; `INSERT` com `tenant_id` de outro tenant é rejeitado por `WITH CHECK`.
- Views usam `security_invoker` (PostgreSQL 15+). pgvector, pg_trgm e PostGIS: não incluir no primeiro baseline; testar no Neon antes de depender.

## 8. Ordem, reversibilidade e reprodutibilidade

- Ordem: `0001` papéis e extensões mínimas → `0002` `tenant` e RLS → `0003` entidades, claims, evidência → `0004` oportunidades e superfícies → `0005` governança. Cada uma com teste.
- Migrations só para frente; correção vira nova migration; não há `down` confiável para dados.
- Reprodutível: do zero a um Postgres vazio em um comando; resultado idêntico em CI.

## 9. Python

O Python lê e escreve nas **mesmas tabelas** pelo papel adequado (observações como dono do esquema, conforme ADR-007/010). Nenhum esquema é definido em Python, e o Drizzle não gera migrations (ver ADR-011), para existir uma só autoridade.

## 10. Decisões do dono do produto necessárias

1. Continuar tentando recuperar os originais ou aprovar um baseline novo?
2. Aprovar ADR-011 (SQL manual como autoridade).
3. Como modelar receitas e artefatos de página (o dicionário não define). Perguntas em aberto, **não chutadas** nesta fase:
   - Receita: identidade e versionamento (imutável por versão? estágio rascunho/canário/geral/aposentado como em `template`?), contrato (intenção de busca, entidades e atributos exigidos, exigências de evidência, política de frescor) e se é jsonb validado por Zod ou colunas.
   - Relação entre `template` (que já tem `contract` jsonb) e receita: a mesma coisa, ou a receita referencia o template?
   - Artefato de página: o que é congelado (HTML, dados estruturados, links planejados), como se liga a `surface` e `surface_fact`, e como guarda proveniência por versão.
   - Estado de compilação e ciclo de vida: estados, transições permitidas, quem as dispara, e o que significa reproduzir uma compilação.
   - Relação com `quality_gate_result` (por versão de artefato ou de `surface`).
4. ~~Nome do papel de aplicação~~: decidido, `menlo_app` (Fase 2).
