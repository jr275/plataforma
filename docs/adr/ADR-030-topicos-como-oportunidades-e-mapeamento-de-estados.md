# ADR-030: Tópicos como oportunidades ampliadas e mapeamento dos estados da especificação

**Status:** ACCEPTED (2026-10-14). Incrementos 2 a 7 da especificação "AI-Native Programmatic SEO Platform". Migration `0014` só em banco descartável.

## Decisões
1. **Tópico = `growth_opportunity` ampliada** (migration 0014: `topic_id`, `dimensions`, `data_available`, `data_missing`, `candidate_page_family`, `parent_topic_id`, `topic_origin`, `intent_type`, `demand_signal`…). Reaproveita o ciclo de vida de 19 estados com gatilho SQL, a auditoria (`opportunity_event`), o blueprint, a geração e o QA existentes; as hipóteses do motor anterior continuam válidas (colunas opcionais). `topic_id` é o sha256 de tenant + dimensões normalizadas (sem acento, minúsculas, chaves ordenadas), único por tenant: deduplicação exata sem custo.
2. **Padrões de tópico** são declarados pelo pack (`TopicPattern`) e apontam um `QueryPattern` marcado `topicOnly`, que dá ao tópico o contrato de experiência/blueprint. `topicOnly` é ignorado pela descoberta e pela classificação do motor anterior (não duplica hipóteses).
3. **Só atributos VALID/PARTIAL no catálogo geram tópicos** (spec 6.1). O que falta de dado por entidade fica em `data_missing`; nada de demanda, número ou fato é criado (R11/R12).
4. **Execuções rastreáveis:** toda etapa em lote abre uma `research_run` (`params.kind`: `topics`, `combinations`, `evaluation`…), uma por tenant por vez, tudo ou nada.

## Mapeamento dos estados da especificação para a máquina existente (implementado e testado nos Incrementos 4 a 6)
| Especificação | Representação | Observação |
| --- | --- | --- |
| DISCOVERED | `discovered` | tópico recém-gerado |
| (validado/avaliado) | `validated` → `scored` | gates e score avaliados; a decisão é gravada em `eligibility_decision` (histórico imutável) |
| RESEARCH_REQUIRED | `scored` + decisão `RESEARCH_REQUIRED` | sem sinal de demanda; volta a avaliar quando houver sinal (`scored → scored`, nova decisão) |
| DATA_REQUIRED | `scored` + decisão `DATA_REQUIRED` | lista `missing_requirements`; reavaliável |
| REJECTED | `rejected` | reavaliável (`rejected → discovered`, nova decisão) |
| READY_FOR_BLUEPRINT | `eligible` | só com todos os gates PASS, pisos atendidos, demanda presente e total ≥ limiar de READY |
| READY_FOR_GENERATION | `blueprinted` | blueprint estrutural válido (exceção de SERP registrada quando não há provedor, ADR-025) |
| QA_REQUIRED | `data_assembled` → `evidence_validated` → `experience_built` → `qa` | recipe compilado; QA Q1–Q14 em `qa_report` |
| ELIGIBLE_FOR_PUBLISHING | `qa` com Q1–Q14 todos PASS | Q14 exige o verificador (LLM): sem ele, `NOT_RUN` e nada é aprovado por padrão |
| PUBLISHED, NEEDS_REFRESH, UNPUBLISHED | `published…` **bloqueados** (ADR-028) | NEEDS_REFRESH e UNPUBLISHED ficam fora desta fase (dependem de publicação) |
Uma **decisão isolada não muda o estado**: toda transição passa por `assertExecutable`, grava evento com autor, motivo e a decisão que a originou, e é recusada pelo gatilho se inválida.

## Pontuação e gates (substitui a interpretação anterior "total só ordena")
Gates G1–G9 e pisos são **obrigatórios e não compensatórios**. Só depois deles se aplicam os limiares da **política versionada**: total ≥ 75 → READY_FOR_BLUEPRINT; 60 ≤ total < 75 → DATA_REQUIRED; < 60 → REJECTED; sem demanda → RESEARCH_REQUIRED (nunca READY). Uma nota alta jamais supera um gate reprovado (teste obrigatório).

## Fora do escopo (não confundir)
Os dados municipais reais de SP validam o motor; **não concluem o piloto imobiliário de Curitiba**, que exige bairros, POIs, anúncios e demanda.
