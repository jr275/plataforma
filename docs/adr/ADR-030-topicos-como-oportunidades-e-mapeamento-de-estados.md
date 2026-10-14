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

## Adendo (Incremento 4): como a decisão é calculada e aplicada
- **Função pura** `evaluate(snapshot, política)`; o snapshot congela as entradas **e o instante de referência**. Mesma entrada + mesma política = mesma decisão (testes de regressão com tempo, política e snapshot controlados). Cada decisão é gravada em `eligibility_decision` (imutável) com o snapshot, os gates G1–G9 (com detalhe, tipo `data`/`blocking` e requisitos faltantes), as 12 dimensões (score, peso, piso, entradas, justificativa e incerteza), o total, a cobertura de pesos, os `fact_id` usados e a versão da política.
- **Ordem de decisão:** impedimento (`blocking`) → REJECTED; falta de dado (`data`) → DATA_REQUIRED; só então a nota. Sem demanda observada → RESEARCH_REQUIRED (qualquer nota). Pisos não atingidos ou cobertura de pesos baixa → DATA_REQUIRED. Depois: ≥ `readyMin` (75) READY_FOR_BLUEPRINT; ≥ `dataRequiredMin` (60) DATA_REQUIRED; abaixo, REJECTED. Gate reprovado ⇒ **nenhuma nota** é calculada.
- **Ausência não é zero:** dimensão sem dado (demanda sem fonte, SERP não analisada, descoberta por IA não medida) fica `null` e sai do denominador; a cobertura de pesos mede o quanto da nota é conhecido.
- **Fórmulas das dimensões** são heurísticas **iniciais da política** (demanda em escala logarítmica saturada; utilidade = blocos/ideal da família; unicidade = blocos que variam/alvo; relevância e conversão por tabelas; conectividade por pai/irmãos/filhos; custo invertido; frescor = fração média da validade). Todos os números estão na política versionada do tenant e devem ser calibrados com dados de desempenho (Incremento 8+).
- **Canibalização (G9):** similaridade de intenção = Jaccard dos pares `dimensão=valor` entre tópicos da mesma família e entidade primária.
- **Transições:** `planTransitions` leva o tópico pela máquina existente (ex.: `discovered → validated → scored → eligible`); a migration 0016 acrescenta `scored → rejected` e `eligible → rejected`. Estados avançados (blueprint em diante) **não regridem**: a decisão é registrada e o estado preservado. Se a decisão já existe, o estado ainda é reconciliado com ela.

## Adendo (Incremento 5): agentes e blueprint
- **Prompts:** o arquivo `02_prompts_agentes_runtime.md` foi lido por inteiro, copiado para `packs/real-estate/prompts/` e convertido por `scripts/gen-agent-prompts.sh` em `agent-prompts.generated.ts`; a versão do prompt é derivada do sha256 do arquivo e um teste impede divergência. Prompts do domínio ficam no pack (regra 10); o núcleo só conhece o contrato (`AgentPrompts`).
- **Runner** (`agents/runner.ts`): variáveis `{{…}}` sem valor lançam (nunca se envia placeholder cru); saída inválida (JSON, esquema zod estrito ou regra do código) → nova tentativa com os erros devolvidos ao modelo, máximo 2, depois **falha explícita**; cada execução grava em `agent_run` (imutável) agente, versão e sha do prompt, modelo, entrada, saída, tentativas, erros e tokens. Sem `ANTHROPIC_API_KEY` o estado é `not_configured`, também auditado. O cache determinístico (`provider_call`) evita pagar duas vezes a mesma chamada.
- **O código manda (R7):** Agente 3 — demanda e `unmet_need` são recalculados do INPUT (divergência do agente registrada, nunca aceita); Agente 5 — a explicação é ligada à decisão e conferida (não pode citar outra decisão, sugerir prontidão, ter mais de 4 frases); Agente 6 — só campos `__FILL__`, placeholders existentes em `data_contract`, limites de título/meta, consultas secundárias só das variantes; Agente 2 — cada proposta é validada contra o catálogo e a matriz, descartando as inválidas com motivo.
- **Blueprint da especificação** (`spec_blueprint`, imutável, único por conteúdo): só nasce de READY_FOR_BLUEPRINT (estado `eligible`); módulos RICH/PARTIAL/DATA_PENDING a partir dos fatos, regra de ausência da receita (R9), 14 gates de QA, `noindex`; independente do template (hash estrutural ignora `template_id` e módulos de apresentação); `template_gap` registrado quando o template não existe. Cria também o `page_blueprint` do motor existente para a geração reaproveitar o pipeline; **não** avança o estado (SERP/exceção, ADR-025). `INSUFFICIENT` do Agente 6 devolve o tópico a DATA_REQUIRED (`eligible → scored`, com o motivo auditado).
- **Honestidade:** os testes usam um LLM roteirizado e identificado; nenhuma saída de modelo real foi obtida. A conformidade real com os prompts e a qualidade editorial só se verificam com a chave.
