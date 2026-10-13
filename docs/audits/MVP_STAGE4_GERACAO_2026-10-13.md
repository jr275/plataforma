# MVP — Etapa 4: geração de páginas em lote, gates e versões (em `draft`)

Data: 2026-10-13. Decisão: ADR-020 (ACCEPTED, com adendo). Código: `packages/api/src/pages/{gates,generate,read}.ts`; migrations `0005_generation_run.sql` e `0006_page.sql`. **Nada foi aplicado no Neon, publicado ou enviado ao remoto.** Toda a prova roda em PostgreSQL 16 **local descartável**.

## O que esta prova cobre (e o que não cobre)
Cobre a jornada **de geração em draft**: dado real do IBGE → seleção → render → 6 gates → persistência → versionamento → auditoria. **Não** é a jornada completa do MVP: ela ainda depende de publicação com aprovação (etapa 5), medição (etapa 6), Search Console e do site de teste.

## Jornada executada (`generation.product.test.ts`, 9 testes, extrato real de SP em `db/test-fixtures/generation/`)
| Passo | Resultado observado |
| --- | --- |
| 1-2 Importar o extrato real (645 municípios de SP, origem `real`) e selecionar as **20 maiores populações** | 645 aceitos, 0 rejeitados; 20 selecionados, ordem decrescente de população, seleção idêntica em duas consultas; os dois primeiros: São Paulo e Guarulhos |
| 3-5 Gerar, passar nos gates e persistir | **20 drafts**, 20 URLs distintas, 20 hashes distintos, 6 gates `pass` com detalhe em cada um dos 20 itens, todas as páginas `draft` (nada publicado); execução registrada (`succeeded`, 20/20/0/0) |
| 6 Reexecutar | 20 `unchanged`, **0 versões novas**, 0 páginas novas; reimportar o mesmo arquivo e reexecutar: ainda 20 `unchanged` |
| 7-8 Alterar um dado (população de São Paulo +1000) | **1 versão nova** (`v2`), mesma URL, 19 `unchanged`; a `v1` permanece íntegra com o valor antigo |
| 9-10 Registros inválidos | (a) cidade de origem `test`: bloqueada em `required_fields`, demais gates `skipped`, sem página; (b) renomear Guarulhos para "São Paulo": bloqueada em `url_unique` e `url_stable`, página fica `blocked` mantendo URL e versão antigas, nenhuma URL duplicada; **os outros 19 seguiram**; corrigido o dado, volta a `draft` sem versão nova |
| 11 Falha e reprocessamento | falha injetada em 1 item: só ele bloqueado (erro registrado), sem versão parcial; falha injetada no fechamento: execução `failed`, **nenhuma versão gravada**, 0 itens; reprocessar conclui (1 `generated`) e uma nova execução é 100% `unchanged` |
| 12 Isolamento | tenant D gera as próprias 20 páginas; C não vê versões, execuções nem itens de D; escrita com `tenant_id` alheio recusada por RLS, referência cruzada recusada por FK composta, UPDATE alheio afeta 0 linhas; 0 vazamentos |
| Extras | `page_version` e `generation_item` imutáveis e sem DELETE para a aplicação; teto de 500 e validação do escopo |

## Verificações executadas (todas PASS)
`pnpm check:consistency`; `pnpm turbo typecheck lint build` (6 tarefas); pacote `api`: 229 testes; `pnpm test:rls`, `test:migrations`, `test:security`, `test:bootstrap`, `test:gate`, `test:hardening`, `test:api`; `pnpm test:schema` **77/77** (inclui 22 verificações novas das tabelas de geração e de importação). Mutações: desligar o gate `url_unique` derruba a jornada (2 testes); incluir a data de coleta no hash derruba o teste unitário do hash.

## Limites e riscos honestos
- **Rollback de migration:** não há migrations de reversão (ADR-011); a atomicidade da aplicação é a do runner, já coberta por `test:migrations`. Não foi criada uma prova de rollback específica para 0005 e 0006.
- O teste de reimportação com hash estável roda **no mesmo dia**; a independência do hash em relação à data de coleta é provada no teste unitário (data de 2027), não na jornada.
- Os links internos: os hubs `/cidades` e `/cidades/{uf}` **não existem**, então as páginas saem sem links (o gate `links_resolve` passa com 0 links; a detecção de link quebrado é provada em teste unitário).
- A falha por item e a do fechamento são **injetadas** (gancho `faults`, só para testes); falhas reais de banco no meio do lote não foram observadas.
- Conteúdo raso (ADR-019, aceito pelo dono): as 20 páginas diferem por nome, UF, região e população.
- O fixture é um extrato real do IBGE, importado como origem `real` num banco de teste; os dados de "teste" usados nos casos inválidos (Cidade de Teste; renomeações) existem só no banco descartável.

## Pendências reais para a Etapa 5
Decisão sobre o **site e o mecanismo de publicação de teste** (baseline), domínio/canonical, hubs de navegação, aprovação explícita por página, HTML/JSON-LD e sitemap só de URLs elegíveis, política de redirecionamento para renomeações (hoje bloqueadas por `url_stable`), e aplicar as migrations 0005 e 0006 no Neon dev **somente com autorização**.
