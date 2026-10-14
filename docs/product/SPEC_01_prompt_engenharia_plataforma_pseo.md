# PROMPT DE ENGENHARIA: AI-NATIVE PROGRAMMATIC SEO PLATFORM

> **Uso:** este documento é a especificação para o agente de código (Claude Code, Cursor, Codex) que vai construir a plataforma.
> Os prompts dos agentes que rodam dentro dela estão em `02_prompts_agentes_runtime.md`.
> Tenant #001: RE/MAX (imobiliaria.remax). Domain Pack #001: Real Estate.

---

## 0. Como trabalhar com este documento

1. Leia o documento inteiro antes de escrever código.
2. Inspecione o repositório existente (seção 18) e produza um **mapa de reaproveitamento** antes de qualquer alteração.
3. Implemente **apenas o incremento atual** do plano da seção 19. Não implemente tudo superficialmente.
4. Onde este documento define um contrato (schema, estado, regra), siga-o. Onde ele deixa uma decisão em aberto, escolha a opção mais simples, registre-a em `docs/decisions/` e siga.
5. Todos os limiares numéricos aqui são **valores iniciais calibráveis**, armazenados como política versionada por tenant. Nunca os codifique diretamente na lógica.

---

## 1. Objetivo

Construir uma plataforma que transforme **atributos verificáveis, entidades, relacionamentos e intenções de busca** em um universo de **oportunidades de página**. Cada oportunidade deve ser avaliada, e somente as que merecem existir viram páginas.

A plataforma não é um gerador de URLs a partir de filtros. É um motor de **descoberta → avaliação → priorização → especificação → geração → verificação → aprendizado**.

> **Princípio permanente:** Never create a page merely because a combination of attributes exists. Discover the opportunity, establish the intent, verify the evidence, measure the differentiation, and determine whether the page deserves to exist.

Contexto: o Google trata como abuso de conteúdo em escala a produção de grandes volumes de páginas feitas principalmente para manipular rankings, com ou sem IA. O diferencial da plataforma é **dados proprietários + entidades relacionadas + cálculos reproduzíveis + evidência + utilidade real**, nunca volume.

---

## 2. Regras duras (invioláveis, aplicáveis a todo o sistema)

| # | Regra | Onde é aplicada |
|---|---|---|
| R1 | **Nenhum fato sem proveniência.** Todo fato carrega `value · source · observed_at · confidence`. | Fact Layer, QA |
| R2 | **Inferência nunca substitui evidência.** Toda afirmação interpretativa aponta para os fatos ou métricas que a sustentam (`evidence_refs`). | Narrative Layer, QA |
| R3 | **Distância ≠ tempo.** Tempo de deslocamento só existe se houver cálculo de rota ou fonte de routing para o trajeto. Sem isso, `travel_time = UNKNOWN` e exibe-se apenas a distância. | Derived Layer, QA (regex + validação de campo) |
| R4 | **Scores proprietários são do tenant.** Metodologia pública, componentes verificáveis e limitações explícitas. Nunca apresentar como índice oficial de terceiros. | Derived Layer, módulos de score |
| R5 | **Proibido atribuir características sociais complexas a lugares** (ex.: "tolerância", "segurança percebida", "qualidade dos moradores") sem metodologia pública e dados robustos. Contexto social e cultural somente como fatos verificáveis. | Domain Pack, QA |
| R6 | **Fontes de terceiros alimentam a Entity Resolution; não são copiadas.** Nada de reproduzir listas, rankings ou textos de Tripadvisor, Google, portais etc. | Ingestion, Editorial |
| R7 | **O LLM não decide elegibilidade, não calcula métricas e não inventa dados.** Scores, gates e elegibilidade são código determinístico. O LLM propõe hipóteses, modela intenção, redige narrativa e explica decisões. | Arquitetura |
| R8 | **Gates não são compensatórios.** Demanda alta não compensa ausência de evidência, de utilidade ou de diferenciação. | Opportunity & Eligibility |
| R9 | **Módulo sem dados não é preenchido com texto genérico.** Ele é removido ou exibe a insuficiência. | Content Compilation, QA |
| R10 | **História e cultura exigem fonte e revisão editorial.** Lacunas permanecem lacunas. | Editorial, QA |
| R11 | **Volume de busca é estimativa.** Registrar fonte, período, metodologia e incerteza. Nunca tratar como valor exato. | Intent Discovery |
| R12 | **Não inventar dados de produção** para mascarar integrações ausentes. Ausência = `DATA_PENDING`. | Todo o sistema |

---

## 3. Arquitetura do pipeline

```
SOURCE DATA
 → INGESTION
 → NORMALIZATION
 → ENTITY RESOLUTION
 → KNOWLEDGE GRAPH
 → ATTRIBUTE DISCOVERY            (código)
 → DERIVED METRICS                (código)
 → TOPIC GENERATION               (LLM propõe, código valida)
 → INTENT MODELING                (LLM + dados de demanda)
 → COMBINATION ENGINE             (código, com expansão controlada)
 → OPPORTUNITY SCORING            (código)
 → ELIGIBILITY ENGINE             (código determinístico; LLM só explica)
 → BLUEPRINT GENERATION           (LLM preenche, código valida schema)
 → TEMPLATE & MODULE SELECTION    (código)
 → CONTENT COMPILATION            (LLM dentro do blueprint)
 → QUALITY GATES                  (código + LLM verificador)
 → PUBLISHING                     (código, com aprovação)
 → PERFORMANCE FEEDBACK LOOP      (código)
```

Requisitos de cada etapa:

- contrato de entrada e saída tipado (seção 4);
- idempotente (mesma entrada + mesma versão de política = mesma saída);
- persistência do resultado com `run_id`, `policy_version` e `created_at`;
- falha explícita: nada de saídas parciais silenciosas;
- executável isoladamente (reprocessar uma etapa sem rodar o pipeline inteiro).

**Não acoplar** descoberta, geração e publicação em um único agente ou processo.

---

## 4. Contratos núcleo (domain-agnostic)

Use a linguagem de tipos do projeto (TypeScript, Pydantic, Zod etc.). Os campos abaixo são obrigatórios; podem ser acrescentados outros.

### 4.1 Entity
```json
{
  "entity_id": "string (estável, nunca reutilizado)",
  "tenant_id": "string",
  "entity_type": "string (definido pelo Domain Pack)",
  "name": "string",
  "aliases": ["string"],
  "geometry": "GeoJSON | null",
  "parent_ids": ["entity_id"],
  "external_ids": { "osm": "", "ibge": "", "...": "" },
  "resolution_confidence": 0.0,
  "status": "ACTIVE | MERGED | DEPRECATED"
}
```

### 4.2 Fact
```json
{
  "fact_id": "string",
  "entity_id": "string",
  "attribute_id": "string",
  "value": "any",
  "unit": "string | null",
  "source": { "name": "", "url": "", "license": "" },
  "observed_at": "ISO date",
  "ingested_at": "ISO date",
  "confidence": 0.0,
  "geospatial_precision": "exact | street | neighborhood | city | null"
}
```

### 4.3 Attribute
```json
{
  "attribute_id": "string",
  "entity_type": "string",
  "attribute_name": "string",
  "data_type": "numeric | categorical | geographic | temporal | relational | derived | contextual | commercial | semantic | qualitative",
  "origin": "OBSERVED | DERIVED | INFERRED",
  "semantic_category": "string",
  "source": "string",
  "source_quality": 0.0,
  "coverage": 0.0,
  "freshness_days": 0,
  "confidence": 0.0,
  "derivation_method": "metric_id | null",
  "related_entities": ["entity_type"],
  "available_dimensions": ["string"],
  "supported_intents": ["transactional | commercial | informational | local | comparative | seasonal | question"],
  "potential_page_families": ["page_family_id"],
  "validation_status": "VALID | PARTIAL | DATA_PENDING | INVALID"
}
```

### 4.4 DerivedMetric
```json
{
  "metric_id": "string",
  "name": "string",
  "formula": "string (legível) + referência ao código",
  "methodology_version": "semver",
  "inputs": ["attribute_id"],
  "sources": ["string"],
  "computed_at": "ISO date",
  "coverage": 0.0,
  "uncertainty": "string ou intervalo",
  "limitations": ["string"],
  "refresh_policy": "string",
  "public_methodology_url": "string | null"
}
```

### 4.5 Topic (hipótese)
```json
{
  "topic_id": "string (hash determinístico das dimensões normalizadas)",
  "tenant_id": "string",
  "primary_entity": "entity_id",
  "secondary_entities": ["entity_id"],
  "dimensions": { "property_type": "apartment", "transaction": "sale", "bedrooms": 3, "near": "school" },
  "attributes_used": ["attribute_id"],
  "relationships_used": ["relationship_type"],
  "geo_granularity": "property | street | neighborhood | city | region",
  "intent": {
    "what": "", "where": "", "why": "", "when": "", "for_whom": "",
    "intent_type": "transactional | commercial | informational | local | comparative | seasonal | question",
    "query_hypothesis": "string",
    "primary_keyword": "string",
    "variants": ["string"],
    "demand_signal": { "value": null, "source": "", "period": "", "method": "", "uncertainty": "" }
  },
  "user_need": "string",
  "evidence_required": ["string"],
  "data_available": ["attribute_id"],
  "data_missing": ["attribute_id"],
  "candidate_page_family": "page_family_id",
  "differentiation_vs_existing": "string",
  "commercial_potential": "high | medium | low | none",
  "refresh_dependencies": ["attribute_id"],
  "origin": "ATTRIBUTE | RELATIONSHIP | COMBINATION | DEMAND_DATA | GAP_ANALYSIS",
  "state": "ver seção 10"
}
```

### 4.6 EligibilityDecision
```json
{
  "topic_id": "string",
  "eligible": true,
  "decision": "READY_FOR_BLUEPRINT | DATA_REQUIRED | RESEARCH_REQUIRED | REJECTED",
  "gate_results": { "G1_entity": "PASS", "G2_intent": "PASS", "...": "..." },
  "blocking_reasons": ["string"],
  "missing_requirements": ["string"],
  "scores": { "...": 0 },
  "total_score": 0,
  "evidence_refs": ["fact_id | metric_id"],
  "policy_version": "semver",
  "evaluated_at": "ISO date",
  "recommended_action": "string",
  "explanation": "string (gerada pelo LLM a partir dos campos acima, sem alterá-los)"
}
```

### 4.7 Blueprint
Ver seção 11.

---

## 5. Attribute Discovery Engine

Descobre automaticamente quais atributos existem em cada tipo de entidade e o que eles podem originar.

- Varre o Knowledge Graph por `entity_type` e calcula, por atributo: cobertura (% de entidades com valor), frescor, confiança média, distribuição (para numéricos) e cardinalidade (para categóricos).
- Classifica o `origin`: **OBSERVED** (vem de fonte), **DERIVED** (calculado por métrica versionada) ou **INFERRED** (interpretação; nunca usado como fato em página).
- Sugere `supported_intents` e `potential_page_families` a partir de regras do Domain Pack (seção 15) e, quando não houver regra, por proposta do LLM marcada como `validation_status = PARTIAL` até revisão.
- **Nunca cria atributos factuais inexistentes** para ampliar o universo de páginas.

Saída: catálogo de atributos persistido + relatório de lacunas (atributos com cobertura < política, ordenados pelo número de tópicos que destravariam).

---

## 6. Attribute-to-Topic & Intent Discovery

### 6.1 Geração de tópicos
Para cada atributo ou relacionamento com `validation_status ∈ {VALID, PARTIAL}`:

1. Aplica os **padrões de tópico** do Domain Pack (ex.: `{metric} em {neighborhood}`, `{entity_type_plural} de {city} {relationship} {poi_category}`).
2. Opcionalmente, pede ao LLM (Agente 2) hipóteses adicionais. Toda hipótese do LLM passa por validação de schema e por existência de entidade/atributo no KG; o que falhar é descartado com log.
3. Gera `topic_id` determinístico: hash de `tenant + dimensões normalizadas e ordenadas`. Isso garante deduplicação exata gratuita.

Exemplos (Real Estate):

| Entidade | Atributo / relação | Intenção | Tópico |
|---|---|---|---|
| Bairro | preço/m² | pesquisar preço | Preço do m² no Campo Comprido |
| Bairro | near → parque | encontrar áreas verdes | Bairros de Curitiba próximos a parques |
| Listing | apartamento + 3 quartos + venda + bairro | encontrar imóvel | Apartamentos de 3 quartos à venda no Campo Comprido |
| Bairro | densidade + diversidade de amenidades | avaliar onde morar | Bairros de Curitiba com mais serviços do dia a dia |

### 6.2 Modelagem de intenção
Cada tópico recebe as cinco dimensões **WHAT · WHERE · WHY · WHEN · FOR_WHOM** e um `intent_type`.

Fontes de demanda, quando disponíveis: Search Console, busca interna, Google Trends, SERPs, autocomplete, buscas relacionadas, concorrentes, dados de conversão e ferramentas de keyword. O sistema deve:

- identificar intenções transacionais, comerciais, informacionais, locais, comparativas, sazonais, perguntas e long tail;
- detectar **necessidades não atendidas** (consultas com impressões e sem página adequada, ou buscas internas sem resultado);
- registrar a incerteza de cada sinal (R11). Se não houver sinal, `demand_signal.value = null` e o tópico só pode avançar como `RESEARCH_REQUIRED`, com hipótese documentada.

---

## 7. Combination Engine

Descobre oportunidades que uma lista de palavras-chave não revela, **sem** enumerar o produto cartesiano.

### 7.1 Dimensões
O Domain Pack declara as dimensões combináveis, cada uma com tipo, valores válidos e a quais `entity_type` se aplica. Ex.: `property_type`, `transaction`, `bedrooms`, `price_band`, `neighborhood`, `city`, `near:{poi_category}`, `lifestyle_profile`, `period`.

### 7.2 Expansão controlada (ordem de poda)
A expansão é feita em largura, um nível de dimensão por vez, e cada combinação candidata passa pelos filtros abaixo **em ordem**, parando no primeiro que falhar (filtros baratos primeiro):

1. **Compatibilidade semântica:** a matriz do Domain Pack diz quais dimensões podem coexistir (ex.: `bedrooms` não combina com `transaction=land`).
2. **Compatibilidade de entidade e geografia:** a entidade existe, a relação `near` está dentro do raio da política e a granularidade é coerente.
3. **Limite de profundidade:** `max_dimensions` por família (padrão: 4; long tail: 5).
4. **Suficiência de dados:** a contagem de itens no conjunto resultante é ≥ mínimo da família (seção 15.5).
5. **Teste de redundância com o pai:** a combinação filha só sobrevive se o filtro realmente filtrar: `|resultado_filho| ≤ 0,8 × |resultado_pai|` **e** se ela tiver ao menos 1 bloco de dados que o pai não tem. Senão, vira seção ou filtro da página pai, não uma URL.
6. **Demanda:** há sinal de demanda **ou** uma hipótese justificável (que leva a `RESEARCH_REQUIRED`).
7. **Canibalização:** a similaridade de intenção com tópicos ou páginas existentes fica abaixo do limiar; se ficar acima, ganha o de maior score e o outro vira canônico ou seção dele.

Teto de segurança: `max_candidates_per_run` por tenant. Ao atingir o teto, interrompe a expansão e registra no relatório; não trunca silenciosamente.

Combinações são **hipóteses**, nunca páginas publicáveis por padrão.

---

## 8. Opportunity Scoring (dois estágios)

### 8.1 Estágio 1: Hard gates (não compensatórios)
Qualquer gate em FAIL bloqueia, independentemente do score.

| Gate | Critério |
|---|---|
| G1 Entity | Entidade principal existe, `status=ACTIVE`, `resolution_confidence ≥ 0,8` |
| G2 Intent | Intenção identificada com sinal de demanda **ou** hipótese documentada (esta última leva a RESEARCH_REQUIRED) |
| G3 Data sufficiency | Mínimos da família atendidos (seção 15.5) |
| G4 Evidence | 100% dos blocos obrigatórios têm fatos com fonte; confiança média ≥ 0,7 |
| G5 Uniqueness | ≥ 3 blocos de dados que variam entre instâncias da família (não apenas o nome do lugar) |
| G6 Geo/semantic coherence | Sem conflito geográfico (ex.: POI fora do raio, bairro na cidade errada) |
| G7 Freshness | Dados dentro do `max_age` de cada tipo (seção 15.5) |
| G8 Policy | Compatível com as regras duras (R3, R5, R10) |
| G9 Cannibalization | Nenhum conflito impeditivo não resolvido |

### 8.2 Estágio 2: Score ponderado (0–100)
Calculado apenas para tópicos que passaram nos gates. Pesos padrão, configuráveis por tenant:

| Dimensão | Peso | Piso mínimo |
|---|---|---|
| Search demand | 20 | — |
| User utility | 15 | ≥ 50 |
| Data availability | 10 | — |
| Evidence quality | 10 | ≥ 60 |
| Uniqueness | 10 | ≥ 50 |
| Business relevance | 10 | — |
| Conversion potential | 5 | — |
| SERP opportunity | 5 | — |
| Internal graph connectivity | 5 | — |
| Production & maintenance cost (invertido) | 5 | — |
| Freshness | 3 | — |
| GEO/AI discoverability | 2 | — |

Os pisos também são **não compensatórios**: abaixo do piso, o tópico vai para `DATA_REQUIRED` ou `REJECTED`, mesmo com total alto.

Cada dimensão persiste `score`, `inputs`, `justification` (1 linha) e `uncertainty`.

### 8.3 Mapeamento para decisão
```
gates FAIL (impeditivo)               → REJECTED (com blocking_reasons)
gates FAIL (dados faltantes)          → DATA_REQUIRED (com missing_requirements)
sem sinal de demanda, hipótese ok     → RESEARCH_REQUIRED
total ≥ 75 e pisos ok                 → READY_FOR_BLUEPRINT
60 ≤ total < 75                       → DATA_REQUIRED (lista do que eleva o score)
total < 60                            → REJECTED
```

---

## 9. Eligibility Engine

Função **pura e determinística**: `evaluate(topic, kg_snapshot, policy) → EligibilityDecision`.

- A mesma entrada com a mesma `policy_version` deve produzir a mesma saída (teste de regressão obrigatório).
- Toda decisão persiste os resultados dos gates, os scores, os `evidence_refs` e a `policy_version`.
- O campo `explanation` é gerado pelo LLM (Agente 5) **a partir** da decisão, sem poder alterá-la.
- Nunca publicar só porque uma URL pode ser construída.

**Indexabilidade ≠ existência.** Uma página pode existir para o usuário (ex.: filtro de listagem) e ter `indexability_policy = noindex`. A elegibilidade decide **indexação e criação de URL canônica**, não a existência de filtros na UI.

---

## 10. Máquina de estados

```
DISCOVERED ──► RESEARCH_REQUIRED ──► (sinal obtido) ──► DISCOVERED
     │
     ├──► DATA_REQUIRED ──► (dados ingeridos) ──► DISCOVERED
     ├──► REJECTED
     └──► READY_FOR_BLUEPRINT ──► READY_FOR_GENERATION ──► QA_REQUIRED
                                                              │
                                       ┌──────────────────────┤
                                       ▼                      ▼
                            ELIGIBLE_FOR_PUBLISHING      (falha) DATA_REQUIRED / REJECTED
                                       │
                                       ▼ (aprovação humana ou política auto-approve)
                                   PUBLISHED ──► NEEDS_REFRESH ──► QA_REQUIRED
                                       │
                                       └──► (perde elegibilidade) ──► UNPUBLISHED (noindex/410/redirect por política)
```

- Cada transição tem uma regra explícita, autor (sistema | usuário), motivo e timestamp, e é auditável.
- `REJECTED` não é terminal: pode ser reavaliado quando dados ou a política mudarem; a reavaliação gera um novo registro.
- `NEEDS_REFRESH` é disparado por expiração de `max_age`, mudança relevante de dados (ex.: o preço/m² variar mais que X%) ou nova versão de métrica.

---

## 11. Blueprint

### 11.1 Hierarquia (não confundir os níveis)
1. **Page family:** agrupamento amplo (ex.: "Bairros").
2. **Page type:** função semântica (ex.: "visão geral de bairro", "preço do m²").
3. **Page archetype:** estrutura de conteúdo (ex.: hub, listagem com contexto, data page, guia, comparação, ranking).
4. **Template:** contrato de renderização.
5. **Modules:** componentes reutilizáveis, cada um com seu próprio contrato de dados.
6. **Page recipe:** configuração concreta de uma página (blueprint + template + módulos + dados).

### 11.2 Schema
```json
{
  "page_id": "", "tenant_id": "", "topic_id": "",
  "page_family": "", "page_type": "", "page_archetype": "",
  "primary_entity": "", "secondary_entities": [],
  "search_intent": { "...": "copiado do Topic" },
  "topic_definition": "1 frase: que pergunta esta página responde e para quem",
  "target_query_cluster": { "primary": "", "secondary": [] },
  "url": "", "title_pattern": "", "h1_pattern": "", "meta_description_pattern": "",
  "required_attributes": [], "required_relationships": [],
  "data_contract": [
    { "module_id": "", "fields": [], "min_items": 0, "status": "RICH | PARTIAL | DATA_PENDING", "on_missing": "remove | show_insufficiency" }
  ],
  "unique_fields_per_instance": [],
  "derived_metrics": ["metric_id"],
  "evidence_requirements": [ { "claim_type": "", "source_class": "", "max_age_days": 0 } ],
  "differentiation_strategy": "o que esta página tem que o pai, os irmãos e os concorrentes não têm",
  "template_id": "", "module_requirements": [],
  "internal_link_plan": { "parents": [], "siblings": [], "children": [], "listings": "" },
  "schema_requirements": ["schema.org types"],
  "canonical_policy": "", "indexability_policy": "index | noindex",
  "freshness_policy": { "refresh_trigger": "", "max_age_days": 0 },
  "quality_gates": ["Q1..Q14"],
  "kpis": ["impressions", "clicks", "ctr", "position", "property_views", "leads"],
  "version": "semver"
}
```

O blueprint é **independente de apresentação visual**. Trocar o template não altera o blueprint.

---

## 12. Derived Metrics & Evidence Layer

- Toda métrica segue o contrato 4.4 e tem teste unitário com caso conhecido.
- Métricas com amostra pequena declaram a incerteza e **não são exibidas** abaixo do `n` mínimo da política (ex.: mediana de preço/m² exige n ≥ 15 anúncios ativos no recorte).
- Scores compostos (ex.: um Place Score com Walkability, Transit, Daily Amenities, Healthcare, Education, Leisure e Airport Access) seguem estas regras:
  - fórmula pública em página de metodologia versionada;
  - componentes exibidos ao lado do score agregado;
  - contagens brutas sempre visíveis ("27 restaurantes, 4 supermercados…") antes da interpretação;
  - limitações declaradas (cobertura do OSM, data da coleta, raio usado).
- Distância: geodésica ou por rede, sempre rotulada. Tempo: somente com routing (R3).

---

## 13. Editorial & Quality Gates

### 13.1 Camadas de conteúdo
- **Fact Layer:** fatos estruturados e verificáveis.
- **Derived Layer:** métricas reproduzíveis.
- **Narrative Layer:** interpretação editorial; toda frase factual referencia `fact_id` ou `metric_id`.
- **Hypothesis Layer:** oportunidades não confirmadas; nunca renderizada em página pública.

### 13.2 Gates de QA (antes de `ELIGIBLE_FOR_PUBLISHING`)
| # | Gate | Implementação mínima |
|---|---|---|
| Q1 | Fact checking | Todo número ou nome na narrativa existe nos dados do recipe |
| Q2 | Proveniência | Toda afirmação factual tem `evidence_ref` |
| Q3 | Completude | Módulos obrigatórios RICH ou com insuficiência declarada |
| Q4 | Duplicação semântica | Similaridade com páginas da mesma família abaixo do limiar, após remover o nome do lugar |
| Q5 | Thin content | Parcela de conteúdo que varia por instância ≥ 40% |
| Q6 | Canibalização | Sem outra página indexável para o mesmo cluster de intenção |
| Q7 | Coerência geográfica | Entidades citadas pertencem à geografia da página |
| Q8 | Distância vs tempo | Nenhuma expressão de tempo de deslocamento sem fonte de routing |
| Q9 | Links internos | Plano de links resolvido, sem links quebrados |
| Q10 | Dados estruturados | JSON-LD válido para os tipos declarados |
| Q11 | Canonical / indexação | Coerentes com o blueprint |
| Q12 | Frescor | Nenhum dado acima do `max_age` |
| Q13 | Política editorial | R4, R5, R6, R10 respeitadas |
| Q14 | Utilidade | Verificador (Agente 8) responde: "o usuário aprende aqui algo que não encontra na página pai nem nos irmãos?" |

Falha em Q1, Q2, Q8 ou Q13 é **bloqueante**, sem override automático.

---

## 14. Camada de agentes (runtime)

Os prompts estão em `02_prompts_agentes_runtime.md`. Regras de integração:

- Cada agente tem entrada e saída JSON com schema validado; uma saída inválida gera uma nova tentativa (máximo de 2) e depois falha explícita.
- Os agentes recebem **apenas** os dados do recorte (snapshot do KG), nunca acesso livre à web durante a geração de conteúdo.
- O código decide; os agentes propõem, descrevem e redigem (R7).
- Todo output de agente persiste junto com o prompt, a versão do prompt, o modelo e os tokens, para auditoria.

| Agente | Papel | Decide algo? |
|---|---|---|
| 1 Inventory | Resumir cobertura do KG e lacunas | Não |
| 2 Topic Proposer | Propor tópicos além dos padrões | Não (código valida) |
| 3 Intent Modeler | WHAT/WHERE/WHY/WHEN/FOR_WHOM + keywords | Não |
| 4 Combination Reviewer | Revisar redundância semântica de combinações | Não (sinaliza) |
| 5 Eligibility Explainer | Explicar decisões em linguagem humana | Não |
| 6 Blueprint Writer | Preencher campos semânticos do blueprint | Não (código valida) |
| 7 Editorial | Redigir a Narrative Layer | Não |
| 8 QA Verifier | Verificar Q1, Q2, Q8, Q13 e Q14 | Sinaliza; o código bloqueia |

---

## 15. Domain Pack #001: Real Estate (RE/MAX)

Tudo nesta seção é configuração do pack, não código do núcleo.

### 15.1 Entidades
Property, PropertyListing, Street, Neighborhood, City, State, Region, POI, School, University, Daycare, Hospital, Clinic, Pharmacy, Laboratory, Supermarket, ShoppingCenter, Park, Gym, Restaurant, Bar, Cinema, Theater, TransitStop, TransitLine, BRTStation, MetroStation, TrainStation, BusTerminal, Airport, CivicService, TouristAttraction, Museum, CulturalInstitution, Event, HistoricalPlace, RealEstateMarketSnapshot, SearchIntent.

### 15.2 Relacionamentos
`located_on`, `located_in`, `near` (com `distance_m` e `distance_method`), `serves`, `connected_to`, `belongs_to`, `available_for`, `has_attribute`, `compared_with`, `supported_by`, `derived_from`.

### 15.3 Famílias de atributos (matéria-prima dos tópicos)
| Código | Família | Exemplos | Origem típica |
|---|---|---|---|
| A | Mercado imobiliário | preço médio, preço/m², aluguel/m², estoque, novos anúncios, removidos, tempo anunciado, faixas de preço, tipologia, quartos, suítes, vagas, área, variação | OBSERVED + DERIVED |
| B | Mobilidade | ônibus, BRT, metrô, trem, terminais, rodoviária, aeroporto, ciclovias; densidade, diversidade, cobertura e distância ao transporte | OBSERVED + DERIVED |
| C | Acessibilidade urbana | Walkability, Transit, Daily Amenities, Place Score (proprietário) | DERIVED |
| D | Educação | escolas, universidades, creches, cursos, bibliotecas | OBSERVED |
| E | Saúde | hospitais, clínicas, farmácias, laboratórios | OBSERVED |
| F | Compras | shoppings, supermercados, mercados, comércio | OBSERVED |
| G | Lazer | parques, academias, cinemas, teatros, bares, restaurantes, clubes | OBSERVED |
| H | Cívico | prefeitura, polícia, bombeiros, fórum, serviços públicos | OBSERVED |
| I | Turismo / o que fazer | atrações, museus, natureza, praias, eventos, passeios; por item: categoria, preço, horário, tempo necessário, family/pet friendly, outdoor | OBSERVED (consolidado, R6) |
| J | História | fundação, origem do nome, formação urbana, marcos, edificações, transformações | OBSERVED + revisão editorial (R10) |
| K | Cultura e contexto social | instituições culturais, festivais, patrimônio afro-brasileiro e indígena, imigração histórica, diversidade religiosa, espaços culturais LGBTQ+ (somente fatos, R5) | OBSERVED |
| L | Lifestyle | famílias, estudantes, pets, idosos, home office, vida noturna, quem viaja muito | DERIVED de B–K, com regra pública |
| M | Inteligência de mercado | séries de preço/m², oferta × demanda, rankings por métrica | DERIVED |
| N | Comparações | bairro × bairro, cidade × cidade | DERIVED (somente atributos comuns e mesma data-base) |
| O | Tipologia × lugar | tipo × transação × quartos × vagas × faixa de preço | OBSERVED |

### 15.4 Famílias de página e padrões de URL
| # | Família | Padrão | Arquétipo |
|---|---|---|---|
| 01 | Imóvel | `/imoveis/{tipo}-{quartos}-quartos-{bairro}-{cidade}-{id}` | detalhe |
| 02 | Rua | `/imoveis/{rua}-{cidade}` | listagem com contexto |
| 03 | Bairro | `/imoveis/bairros/{bairro}-{cidade}` | hub |
| 04 | Cidade | `/imoveis/cidades/{cidade}-{uf}` | hub |
| 05 | Tipologia × lugar | `/{tipo-plural}/{bairro}-{cidade}` | listagem com contexto |
| 06 | Atributo × lugar | `/bairros/{cidade}/{atributo}` | ranking metodológico |
| 07 | Mobilidade | `/mobilidade/{lugar}` | data page |
| 08 | Serviços e amenidades | `/perto-de/{categoria}/{lugar}` | data page + mapa |
| 09 | Lifestyle | `/bairros/{cidade}/{perfil}` | guia com ranking |
| 10 | Preço e mercado | `/preco-m2/{lugar}` · `/mercado-imobiliario/{lugar}` | data page |
| 11 | Turismo | `/o-que-fazer/{lugar}[/{recorte}]` | guia + mapa |
| 12 | História e cultura | `/historia/{lugar}` | editorial com fontes |
| 13 | Comparação | `/comparar/{lugar-a}-vs-{lugar-b}` | comparação |
| 14 | Rankings | `/rankings/{cidade}/{metrica}` | ranking metodológico |
| 15 | Guias e perguntas locais | `/guias/{lugar}/{pergunta-slug}` | guia / FAQ |
| 16 | Long tail combinada | `/{tipo-plural}/{quartos}-quartos/{bairro}-{cidade}/perto-de-{categoria}` | listagem com contexto |
| 17 | Insights | `/insights/{lugar}/{tema}-{periodo}` | data page |

### 15.5 Política inicial (valores calibráveis por porte de cidade)
| Parâmetro | Grande (> 1M hab.) | Média (200k–1M) | Pequena (< 200k) |
|---|---|---|---|
| Mín. anúncios ativos para páginas de tipologia × lugar | 8 | 5 | 3 |
| Mín. anúncios para exibir preço/m² (mediana) | 20 | 15 | 10 |
| Mín. POIs da categoria no raio para páginas de atributo × lugar | 5 | 3 | 2 |
| Raio padrão de `near` (bairro) | 1.500 m | 2.000 m | 3.000 m |
| Mín. de itens para "o que fazer" | 20 | 12 | 8 |
| Mín. de bairros com dado para rankings | 15 | 8 | 5 |
| Mín. de blocos únicos (G5) | 3 | 3 | 3 |

`max_age` padrão: anúncios 7 dias · métricas de mercado 30 dias · POIs 180 dias · transporte 90 dias · turismo 180 dias · história: sem expiração, com revisão editorial a cada 24 meses.

### 15.6 Matriz de compatibilidade (excerto; completar no pack)
- `bedrooms`, `suites` e `parking` não combinam com `property_type ∈ {land, commercial_lot}`.
- `near:airport` só é válido para granularidade ≥ neighborhood.
- `lifestyle_profile` não combina com `property_id` (é atributo de lugar, não de imóvel).
- Comparações exigem a mesma `entity_type` e a mesma `city` ou `region` (cidade × cidade exige o mesmo estado ou porte similar).
- Família 16 (long tail): no máximo 1 dimensão `near:*` + no máximo 3 dimensões de tipologia.

---

## 16. Control Plane

Interface para operar o sistema sem planilhas. Prioridade de implementação:

**MVP (incrementos 1–4):**
- **C. Topic Discovery + E. Opportunity Explorer** (tela única): lista filtrável de tópicos com estado, score por dimensão, gates e explicação.
- **G. Eligibility & QA:** bloqueios, dados faltantes e falhas de QA por tópico ou página.
- **B. Attribute Explorer:** cobertura, frescor e lacunas por atributo.

**Fase 2:**
- **A. Knowledge Explorer** (entidades, relações e fontes).
- **D. Combination Explorer** (árvore pai → filhos, podas e motivos).
- **F. Blueprint Studio** (inspeção e edição versionada).
- **H. Publishing Control** (aprovação, publicação, canonical, indexação, desativação).

**Fase 3:**
- **I. Performance & Revenue.**
- **J. Experiments.**

Filtros globais: tenant, domínio, entidade, atributo, localização, intenção, família, estado, score e performance. Controle de acesso por tenant.

---

## 17. Feedback Loop

```
Opportunity → Blueprint → Page → Search Performance → User Behavior → Conversion → Learning
```

- Ingerir por URL: indexação, impressões, cliques, CTR, posição, tráfego, interações, visualizações de imóveis, leads, conversões e receita atribuível quando mensurável.
- Agregar por tópico, família, tipo, template e política.
- Recalibrar priors de demanda e pesos **somente com versionamento** e registro do motivo.
- Não atribuir causalidade sem desenho experimental (Experiments); correlação é registrada como tal.
- Não otimizar só por tráfego: considerar qualidade do usuário, leads, custo de produção e custo de manutenção.
- Páginas publicadas com 0 impressões após o período da política (padrão: 120 dias indexadas) entram em revisão: enriquecer, consolidar ou desindexar.

---

## 18. Requisitos técnicos

**Antes de modificar o código:**
1. Inspecionar a arquitetura existente: módulos, rotas, banco, contratos, integrações e testes.
2. Produzir `docs/reuse-map.md` mapeando o que existe para cada seção deste documento (reutilizar / adaptar / criar).
3. Identificar lacunas reais e dependências.
4. Propor a sequência incremental e confirmar antes de começar.

**Requisitos:**
- multi-tenancy desde o núcleo (`tenant_id` em todas as tabelas e consultas);
- separação core engine × domain packs (o pack é configuração e plugins, não fork);
- contratos e schemas tipados com validação em runtime;
- persistência de tópicos, decisões, blueprints, evidências e transições de estado;
- processamento assíncrono (fila) para ingestão, combinação e geração;
- idempotência nos pipelines;
- versionamento de políticas, métricas, prompts e blueprints;
- observabilidade: logs estruturados com `run_id`, `tenant_id`, `topic_id`;
- testes unitários, de integração e de regressão (especialmente o determinismo da elegibilidade);
- tratamento explícito de falhas e dados incompletos;
- operações reversíveis e publicação controlada.

Não substituir tecnologias existentes sem justificativa escrita. Não duplicar funcionalidades já disponíveis.

**Proibido sem autorização explícita:** publicar páginas reais, executar migrações destrutivas, alterar produção, modificar branches protegidas.

---

## 19. Plano de execução (fatia vertical primeiro)

Trabalhe em incrementos pequenos e verificáveis, usando **dados reais já existentes no projeto**. Escopo do piloto: **uma cidade (Curitiba), um subconjunto de bairros (5–10), famílias 03, 05, 06, 10 e 16.**

| Incremento | Entrega | Pronto quando |
|---|---|---|
| 0 | `docs/reuse-map.md` + plano confirmado | Mapa revisado |
| 1 | Contratos 4.1–4.6 + persistência + Attribute Discovery sobre dados existentes | Catálogo de atributos com cobertura real gerado para o piloto |
| 2 | Topic Generation (padrões do pack) + `topic_id` determinístico | Tópicos persistidos, sem duplicatas exatas |
| 3 | Combination Engine (seção 7) com podas e logs de motivo | Árvore pai → filho inspecionável; teste de redundância funcionando |
| 4 | Gates + Score + Eligibility determinística + máquina de estados | Mesma entrada gera mesma decisão (teste); explicação disponível |
| 5 | Blueprint para tópicos READY + Agentes 3, 5 e 6 | Blueprints válidos no schema |
| 6 | QA gates Q1–Q14 sobre recipes compilados (sem publicar) | Relatório de QA por página |
| 7 | Control Plane MVP (seção 16) | Fluxo completo inspecionável na UI |
| 8+ | Publicação controlada, feedback loop, novas fontes, novas famílias | Por aprovação |

Só avance de incremento com o anterior testado.

---

## 20. Critérios de aceitação

1. Atributos identificados a partir de dados existentes, com cobertura, frescor e origem.
2. Cada atributo válido origina hipóteses de tópico.
3. Combinações compatíveis descobrem novas oportunidades; as redundantes são podadas com motivo registrado.
4. Toda oportunidade tem intenção, justificativa, requisitos de evidência e incerteza da demanda.
5. A elegibilidade é determinística, explicável e reproduzível (teste de regressão).
6. Gates e pisos não são compensados pelo score total.
7. Cada oportunidade aprovada gera um blueprint válido e independente do template.
8. Dados ausentes bloqueiam ou limitam a geração conforme a política; nenhum módulo é preenchido com texto genérico.
9. As regras R1–R12 são verificadas por testes automatizados onde for possível (no mínimo R3, R7 e R9).
10. O fluxo completo pode ser inspecionado no Control Plane.
11. O Domain Pack Real Estate é configuração; um segundo pack fictício mínimo (ex.: "restaurantes") carrega sem alterar o núcleo.

---

## 21. Relatório final de cada incremento

- Arquitetura encontrada.
- Componentes existentes reutilizados.
- Componentes implementados.
- Alterações no banco e nos contratos.
- Testes executados e resultados **reais** (saída dos comandos).
- Números do piloto: atributos, tópicos, combinações podadas (por motivo), decisões por estado.
- Limitações e dependências.
- Próximos passos priorizados.
