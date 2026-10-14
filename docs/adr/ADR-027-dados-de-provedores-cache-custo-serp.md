# ADR-027: Dados de provedores externos: cache bruto, custo, sinais, SERP e concorrentes

**Status:** ACCEPTED (2026-10-14) por pedido expresso do dono (Unidade 2, "Opportunity Engine funcionando de ponta a ponta"). A migration `0011` foi aplicada **somente em Postgres descartável**; nada no Neon.

## Contexto
O motor (ADR-023/024/025) só tem fontes públicas (BCB, IBGE, RSS). Demanda de busca, SERP e concorrência são `unknown`. O dono autorizou DataForSEO, Search Console e fontes públicas adicionais, com teto de US$ 50 para a unidade e 500 requisições por execução. Faltava onde guardar a resposta bruta, o custo e as observações por fator, sem reescrever o que já existe (`growth_opportunity`, `evidence`, `opportunity_score`, `page_blueprint`, `page_draft`, ciclo de vida, gates).

## Decisão
1. **Cinco tabelas novas** (migration `0011_provider_data`), todas do tenant, RLS forçada, histórico imutável para a aplicação (SELECT/INSERT):
   - `provider_call`: UMA linha por requisição real (provedor, endpoint, parâmetros, **chave de cache determinística** sha256, resultado `ok`/`provider_error`, custo em US$, resposta bruta, validade, execução). É o cache bruto, a proveniência e o registro de custo por execução (`run_id` → `research_run`).
   - `opportunity_signal`: um fator observado por linha (valor, unidade, base, confiança, fonte, data, validade, `provider_call_id` = *raw_ref*). **Ausência de dado não gera linha**; `unknown` não é uma base gravável; métrica de provedor sem resposta bruta é recusada pelo banco.
   - `serp_snapshot` + `serp_result` + `competitor`: o grafo competitivo é **relacional** (resultado → concorrente, resultado → instantâneo → query). Sem banco de grafos. `serp_result.page_type` é `NULL` até ser classificado (nunca "outro" por padrão); a única mutação permitida à aplicação é classificar (`UPDATE (page_type, classification, competitor_id)`).
2. **Contrato único dos provedores** (`packages/api/src/provider`): toda chamada devolve `ok` (dados + proveniência), `provider_not_configured` (lista as variáveis ausentes, só os nomes) ou `provider_error` (código, mensagem truncada, `retryable`). Não existe mock em tempo de execução; fixtures só nos testes.
3. **Executor único** (`callProvider`): cache por chave determinística (só respostas `ok` ainda válidas, por tenant) → reserva de orçamento → requisição → gravação da resposta bruta e do custo. Falhas são gravadas como `provider_error` e nunca reaproveitadas.
4. **Orçamento** (`RunBudget`): teto global de US$ 50 calculado sobre o gasto **gravado** (`spentUsd`) e limite de requisições por execução (padrão 500, configurável). Só requisições reais contam; cache é gratuito. Estourar recusa **antes** de chamar o provedor e não grava nada.
5. **Credenciais**: só por nome de variável de ambiente; nunca impressas, nunca guardadas em `provider_call.params`. Um provedor sem credencial é `provider_not_configured`.
6. **Autoridade e reuso**: `opportunity_score`, o ciclo de vida e os gates continuam sendo as autoridades; os sinais só alimentam as dimensões do score em passos posteriores. Nada de demanda é afirmado sem uma linha de `opportunity_signal` ligada a uma resposta real.

## Alternativas rejeitadas
- Guardar sinais só no JSON de `opportunity_score.dimensions`: perde data, validade, resposta bruta e histórico por fator.
- Cache em memória ou Redis: não é multi-tenant, não é auditável e perde o custo registrado.
- Tabela de arestas genérica para o "grafo": `serp_result` já relaciona query, página, domínio e posição; um grafo genérico duplicaria o dado.

## Consequências
- O custo de uma execução é uma consulta (`costByRun`), e o teto da unidade é verificável.
- Adicionar um provedor é escrever um *fetcher* e um *parser* puros; cache, custo, orçamento, proveniência e estados de erro vêm do executor.
- Autoridade de nível de tenant: a migration não é aplicada em Neon sem autorização (só a branch `dev-opportunity-engine`, ainda não fornecida).
