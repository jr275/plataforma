# Mapa de reaproveitamento: motor de páginas programáticas AI-native (Incremento 0)

Fonte: especificação "AI-Native Programmatic SEO Platform" (seções 0–21) + dois artigos da Vercel (playbook técnico de SEO para Next.js e "como a IA muda o SEO"). Estado do repositório em `feat/opportunity-engine` (commit `bdfc9a5`). **Nada foi implementado neste incremento**: é só o mapa e a proposta de sequência, para confirmação.

## 1. Conclusão

O repositório já implementa, de forma própria e testada, **cerca de metade do pipeline** da especificação (descoberta → avaliação → blueprint → geração → QA em rascunho). Faltam as camadas de **dados** (Fact/Attribute/Derived Metric persistidos, entidades abaixo de município, POIs, anúncios) e as de **runtime de agentes e feedback**. Duas regras da especificação conflitam com decisões já aceitas (seção 4). O piloto pedido (Curitiba, 5–10 bairros) **não tem dados reais no projeto** (seção 5).

## 2. Mapa por seção

Legenda: **Reutilizar** = existe e atende; **Adaptar** = existe, precisa de extensão/renome; **Criar** = não existe.

| Seção da spec | O que existe hoje | Decisão |
| --- | --- | --- |
| 2 Regras R1–R12 | CLAUDE.md regras 1–10 cobrem R1, R2, R7, R9 (módulo sem dado some), R12 (`unknown`, nunca mock). `engine/truth.ts` (bases), `knowledge/provenance.ts` (5 dimensões de confiança, sem nota única). R3 (distância ≠ tempo), R4, R5, R6, R10, R11 não têm teste automatizado | Reutilizar + **Criar** testes de R3, R5, R6, R10, R11 |
| 3 Pipeline (etapas idempotentes, `run_id`, reprocessável) | `research_run`, `generation_run`, `provider_call` (run_id, custo); idempotência por hash em todas as etapas implementadas | Reutilizar; padronizar `policy_version` nas decisões |
| 4.1 Entity | `city` (IBGE), `knowledge/domain.ts` (Entity genérica, catálogo por pack, ADR-021) sem tabela SQL | **Adaptar**: tabela `entity` genérica; `city` vira uma projeção |
| 4.2 Fact | `knowledge/store.ts`: repositório bi-temporal de referência **em memória** (ADR-021); "Fatia 2 espelha em SQL" **não feita**. `evidence` guarda notícias/indicadores | **Criar** `fact` em SQL (bi-temporal, append-only) a partir do modelo existente |
| 4.3 Attribute / 5 Attribute Discovery | Nada persistido. `engine/dimensions.ts` deriva dimensões de score, não atributos | **Criar** catálogo de atributos + cobertura/frescor sobre `fact` |
| 4.4 DerivedMetric / 12 Evidence Layer | Nada formal. SIDRA/BCB são fontes, não métricas versionadas | **Criar** (contrato + teste de caso conhecido por métrica) |
| 4.5 Topic / 6 Topic & Intent | `growth_opportunity` (query, cluster, intent, stage, JTBD, `hypothesis`), `QueryPattern` × entidade (`engine/discovery.ts`), `cluster_key` determinístico (exato, deduplicação), `opportunity_signal` com demanda | **Adaptar**: Topic = `growth_opportunity` + campos `dimensions`, `data_missing`, `candidate_page_family`; `cluster_key` já faz o papel do `topic_id` |
| 6.2 Demanda (GSC, Trends, SERP, keywords) | Adapters DataForSEO/GSC/LLM prontos, **sem credencial válida** (401) | Reutilizar; bloqueado por credencial |
| 7 Combination Engine | Só padrões × cidade. Sem dimensões, matriz de compatibilidade, poda por redundância com o pai nem canibalização entre tópicos | **Criar** (maior bloco novo de lógica) |
| 8.1 Hard gates G1–G9 | `engine/score.ts` (eligibility checks não compensatórios, ADR-025), 6 gates de experiência do blueprint | **Adaptar**: mapear G1–G9 para checks existentes; criar G5, G6, G7, G9 |
| 8.2 Score 0–100 ponderado + pisos | Score V2: 15 dimensões, 3 objetivos, cobertura mínima, config versionada por tenant, prioridade parcial | **Adaptar** (ver conflito 4.1) |
| 8.3 Mapeamento para decisão | Estados do ciclo de vida + `eligible` boolean | **Adaptar**: acrescentar `decision` (READY/DATA_REQUIRED/RESEARCH_REQUIRED/REJECTED) |
| 9 Eligibility determinística | `score()` é função pura, `inputs_hash`, `opportunity_score` imutável com `config_id` | Reutilizar; **Criar** teste de regressão de determinismo por `policy_version` |
| 10 Máquina de estados | 19 estados validados no servidor + gatilho SQL; `eligible→blueprinted` por exceção; pós-QA bloqueado (ADR-028) | **Adaptar** (ver conflito 4.2) |
| 11 Blueprint | `page_blueprint` (imutável, hash), `blueprint.ts`, template registry (`city-overview`), editor visual `page_draft` (ADR-026) | Reutilizar; **Adaptar** schema (page_family/type/archetype, `data_contract`, `internal_link_plan`) |
| 13 Quality gates Q1–Q14 | 6 gates da página (campos, URL única/estável, metadata, links, fatos rastreáveis) + 6 do blueprint | **Adaptar**: Q1, Q2, Q9, Q11 ≈ existentes; **Criar** Q3–Q8, Q10, Q12–Q14 |
| 14 Agentes (JSON validado, 2 tentativas, auditoria) | `provider/llm.ts` (zod estrito, rejeita saída inválida, modelo e versão de prompt na proveniência), sem chave | **Adaptar** para os 8 agentes; bloqueado por `ANTHROPIC_API_KEY` |
| 15 Domain Pack Real Estate | `packs/real-estate` (padrões, intenções, estágios, escopos, requisitos de evidência, 1 template) | Reutilizar; **Criar** entidades/relações/famílias de atributos/políticas da seção 15 |
| 16 Control Plane | `/opportunities`, detalhe, `/roadmap`, `/trends`, `/blueprint` + editor, `/generation`, `/integrations` | **Adaptar**: C+E já existem; G (Eligibility & QA) parcial; B (Attribute Explorer) **criar** |
| 17 Feedback loop | Nada (GSC sem credencial; publicação bloqueada) | **Criar** na fase 8+, após publicação |
| 18 Multi-tenant, fila, observabilidade | RLS + `withTenant` + testes de isolamento em toda tabela; logs estruturados parciais; **sem fila** (lotes retomáveis em transação) | Reutilizar; **fila** só com ADR (hoje não há justificativa) |
| 20 Pack fictício "restaurantes" | `VerticalDefinition` é genérica (`engine/vertical.ts`), teste com vertical fixture | **Criar** o pack mínimo e o teste |

## 3. O que os artigos da Vercel acrescentam (requisitos técnicos de entrega)

Entram como critérios dos gates Q10–Q12 e do template, sem mudar o motor:
- **Renderização no servidor** (SSG/ISR/SSR) para todo conteúdo crítico: muitos crawlers de IA não executam JavaScript. O app já é Next.js App Router; o gate deve verificar que o HTML renderizado contém título, texto e dados estruturados sem JS.
- **Um único H1, hierarquia H2/H3 e HTML semântico**; resposta direta no início de cada seção, parágrafos curtos, mesmo termo para o mesmo conceito: viram checagens do gate de estrutura e do Agente Editorial.
- **Metadata por página, canonical e `noindex`** coerentes com o blueprint (Q11); JSON-LD alinhado ao texto (sinal de apoio, não compensa texto vago).
- **Política de bots por user-agent** (`robots.txt`/CDN) e monitoramento de crawlers de IA e referrers de chatgpt.com/claude.ai: entra no feedback loop (seção 17); **depende de publicação**, que está bloqueada.
- Guia completo em vez de várias páginas finas para a mesma palavra-chave: reforça o teste de canibalização/redundância com o pai.
- O artigo do playbook não trata sitemaps nem GEO; para sitemaps vale a regra 8 do projeto (sitemaps e IndexNow, nunca a Indexing API).

## 4. Conflitos entre a especificação e o que já foi decidido

1. **Nota composta × gates (regra 5 do projeto e ADR-025).** A spec define `total ≥ 75 → READY` e `60–75 → DATA_REQUIRED`. O projeto proíbe nota composta que esconda falha de gate e já faz prioridade parcial com cobertura. **Proposta:** manter os gates e pisos como autoridade da elegibilidade (já é o caso); usar o total ponderado **só para ordenar**, e converter os limiares 75/60 em parâmetros da política versionada que viram `decision` *depois* dos gates. Requer um ADR curto.
2. **Máquina de estados.** A spec tem 11 estados (DISCOVERED, RESEARCH_REQUIRED, DATA_REQUIRED, READY_FOR_BLUEPRINT…); o projeto tem 19, validados no banco. **Proposta:** não trocar a máquina existente; expor os estados da spec como **decisão** (`decision` em `opportunity_score`) e mapeá-los: READY_FOR_BLUEPRINT ≈ `eligible` com blueprint pronto, QA_REQUIRED ≈ `qa`, ELIGIBLE_FOR_PUBLISHING ≈ `qa` aprovado, PUBLISHED e seguintes continuam **bloqueados**.
3. **Onde registrar decisões.** A spec manda `docs/decisions/`; o projeto usa `docs/adr/` (regra 6). **Proposta:** continuar em `docs/adr/`.
4. **Limiares fixos × política por tenant.** A spec concorda (versionada por tenant); o piloto usa a tabela 15.5 como política inicial do pack, nunca no código.
5. **Pilot e publicação.** A spec pede publicação controlada nos incrementos 8+; hoje a publicação continua bloqueada por decisão (regra 9, saúde do índice ≥ 95%) e sem mecanismo.

## 5. Dados: o que o piloto (Curitiba, 5–10 bairros, famílias 03, 05, 06, 10, 16) realmente tem

| Necessário | Existe? |
| --- | --- |
| Município e população (IBGE) | Sim, **só estado de SP** (645 municípios); Curitiba/PR **não importada** |
| Bairros (geometria, limites) | **Não** |
| POIs (OSM: escolas, transporte, parques…) | **Não** (adapter Overpass pronto, sem coordenadas das entidades, servidor respondeu 504) |
| Anúncios/estoque, preço/m² | **Não** (sem fonte real nem autorização; `PROPERTY_ENTITY_2026-10-13.md`) |
| Demanda de busca | **Não** (DataForSEO 401; GSC sem credencial) |
| Roteamento (tempo de deslocamento) | **Não**: R3 mantém tempo = UNKNOWN |

Consequência: pela R12, **famílias 05, 06, 10 e 16 não podem produzir tópicos elegíveis** hoje (dependem de bairros, POIs e anúncios). Só os incrementos 1–4 podem ser demonstrados com dado real, e apenas para **município** (famílias 04 e, parcialmente, 03/hub), usando o extrato de SP. Curitiba exige importar o extrato do IBGE do Paraná e conseguir bairros (IBGE tem malha de bairros para parte dos municípios; confirmar a fonte) antes de qualquer tópico de bairro.

## 6. Sequência proposta (cada incremento só avança com o anterior testado)

| Inc. | Entrega proposta | Depende de |
| --- | --- | --- |
| 1 | ADR (conflitos 4.1–4.3) + `entity`, `fact` (bi-temporal SQL a partir de ADR-021), catálogo de atributos com cobertura/frescor sobre dados reais **do município** (IBGE, SIDRA, BCB) + testes R1/R9/R12 | Decisão sobre os conflitos |
| 2 | Topic: ampliar `growth_opportunity` (`dimensions`, `data_missing`, `candidate_page_family`) e geração por padrões do pack com deduplicação exata | 1 |
| 3 | Combination Engine (dimensões, matriz de compatibilidade, poda pai→filho com motivo, teto por execução) | 2 |
| 4 | `decision` + gates G1–G9 + teste de regressão de determinismo por `policy_version` + explicação | 3 |
| 5 | Blueprint com `data_contract` e família/arquétipo; agentes 3, 5, 6 (schema validado) | 4; `ANTHROPIC_API_KEY` para os agentes |
| 6 | Gates Q1–Q14 + checagens de renderização no servidor/estrutura | 5 |
| 7 | Control Plane: Attribute Explorer, tela de Eligibility & QA | 6 |
| 8+ | Fila (se justificada), publicação, feedback, novas fontes | aprovação, regra 9, credenciais |

Trabalho paralelo que destrava dados reais (fora da sequência, por ordem de impacto): credencial do DataForSEO (demanda), importação do IBGE para PR (e UFs do piloto), fonte de bairros, fonte de anúncios e autorização, `ANTHROPIC_API_KEY`, `GSC_*`.

## 7. Aceite da spec (seção 20): situação hoje

Atributos com cobertura/frescor: **não**. Hipóteses por atributo: parcial (padrões × cidade). Combinações com poda: **não**. Intenção e demanda com incerteza: parcial (demanda desconhecida). Elegibilidade determinística: **sim** (função pura; falta o teste de regressão por política). Gates não compensados: **sim**. Blueprint independente do template: **sim**. Dado ausente bloqueia/limita: **sim**. R3/R7/R9 testados: R7 e R9 em parte; **R3 não**. Fluxo inspecionável no Control Plane: **parcial**. Segundo pack fictício: **não**.

## 8. Content Architecture (ADR-033): o que foi reaproveitado

Reuso: `policy` versionada (perfis de densidade e política de links), `decision_audit`, `page_recipe`/`spec_blueprint` (entrada do gate), `qa_report` e `page_approval` (o gate é uma camada a mais, não substitui QA nem aprovação humana), renderer único e deployments (passaram a recusar página sem elegibilidade). Novo: contratos de archetype, grafo de links, `quality_gate_result` e `indexation_observation` (migration 0021). O núcleo não conhece imobiliário; o pack liga família → archetype.
