# Mapa de reuso: runtime dos agentes (EXISTENTE → REUTILIZÁVEL → FALTANTE → PLANO)

| Camada | Existia | Reutilizado | Faltava | O que foi feito |
|---|---|---|---|---|
| Chamada ao modelo | `runAgent` (JSON + zod + 2 correções, cache, orçamento, `agent_run`) | tudo | tempo por agente, retentativa transitória, cancelamento, teto de laço, rastreio, estados `invalid_output`/`timed_out`/`cancelled` | estendido no próprio `runAgent` (`RuntimeContext`) |
| Cabeçalho/templates | `fillTemplate` (lança em variável sem valor), cabeçalho do pack | `fillTemplate`, cabeçalho | contexto de execução versionado e sanitizado | `renderContextBlock` + `safeValue` |
| Os 8 agentes | funções com validação do código (A01–A08) | todas | registro formal, lote, dependências | `agents/registry.ts` + `agent_definition` |
| Prompts | arquivo do pack → TS gerado, versão = sha do arquivo | arquivo como origem | versões no banco, ativar/rollback, regressão, resolução por tenant/pacote | `prompt_version` + `runtime/prompts.ts` |
| Execução | `agent_run` | sim | pipeline, passos, correlação, retomada | `pipeline_run`/`pipeline_step`, `runPagePipeline`, `runTopicStage` |
| Persistência de decisões | `eligibility_decision`, `decision_explanation`, `opportunity_event` | sim | auditoria de decisão com recomendação de agente | `decision_audit` |
| A04 | só `reviewCombinations` (sem aplicar) | função | aplicação pelo código e histórico | `judgeCombination` + `applyCombinationReviews` |
| Decisão final | `QaOutcome` | sim | Quality Gate Engine | `qualityGate` (pura) |
| Interface | rotas `/opportunities`, `/blueprints`, `/integrations`; `/agents` demonstrativa | componentes de UI, `loadForTenant`, ações com `actionContext` | telas reais do runtime | `/engine/*` |

## Plano restante (não feito)
Persistir os tópicos aceitos do A02; entrada do A01 a partir do catálogo real; `Retry-After`; executor de regressão de prompts; execução real quando houver `ANTHROPIC_API_KEY`.
