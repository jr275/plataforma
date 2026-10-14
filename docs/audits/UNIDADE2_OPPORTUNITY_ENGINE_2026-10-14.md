# Unidade 2: Opportunity Engine: relatório de retomada segura (2026-10-14)

Branch `feat/opportunity-engine` (local; sem push, merge ou deploy). Banco: **somente Postgres descartável**; nenhuma conexão com o Neon. Custo real de APIs pagas: **US$ 0** (nenhuma chamada paga foi feita).

## Resumo honesto
- **Funciona de ponta a ponta com dados reais:** pesquisa (BCB, IBGE, Agência Brasil) → hipóteses por padrão × entidade IBGE no escopo de São Paulo → score parcial → elegibilidade → blueprint → (exceção de SERP escrita) → geração pelo pipeline existente → seis gates da página → QA, com a publicação bloqueada. A geração até QA está provada em banco descartável com a importação real do IBGE; no piloto ao vivo **nenhuma oportunidade elegível tinha template**, então 0 páginas foram geradas nele (ver "Execução piloto").
- **Não funciona (bloqueado por credencial):** demanda de busca, SERP, concorrentes, Trends, backlinks, Search Console e classificação por LLM. Os adapters existem e passam nos testes de contrato com fixtures **construídas da documentação**, mas **nenhuma resposta real** foi obtida: a credencial DataForSEO no ambiente foi rejeitada (HTTP 401), e as de GSC e Anthropic não existem.

## Commits locais
`2eff7af` workspace/lockfile · `369d9c1` migration 0011 + camada de provedores · `80b9091` SIDRA/GDELT/Overpass · `6dcbc3e` escopo piloto · `db24c8a` geração a partir do blueprint até QA (migration 0012) · `3d9edd3` DataForSEO/GSC/LLM + integrações. Base: `31c765c`, `9799760`, `db751a0`, `d828c78` (trabalho anterior, preservado em 4 commits por camada).

## Migrations e destino
`0011_provider_data` (provider_call, opportunity_signal, competitor, serp_snapshot, serp_result) e `0012_opportunity_page` (+ gatilho que bloqueia as etapas pós-QA). Aplicadas só no Postgres descartável (`scripts/test-schema.sh`, 174 verificações). **Nada** no Neon (a branch `dev-opportunity-engine` não foi fornecida; as URLs do ambiente apontam para o mesmo endpoint da main).

## Matriz de aceite
| Item | Estado | Evidência |
| --- | --- | --- |
| Modelo: provider_call, sinais, SERP, concorrentes, opportunity_page | Aprovado (banco descartável) | RLS, sem DELETE, imutabilidade, CHECKs e isolamento: `test-schema.sh` + `provider.product.test.ts` |
| Cache determinístico, custo por execução, teto US$ 50 / 500 req | Aprovado | `provider.product.test.ts`; mutações detectadas |
| SIDRA | Verificado ao vivo | Resposta 200 real (SP, Censo 2022) + fixture real |
| GDELT | Só fixtures | Real: 429 e `{}`; sucesso construído da documentação |
| Overpass | Só fixtures | Real: 504; sucesso construído da documentação |
| DataForSEO (volume, dificuldade, relacionadas, SERP, notícias, Trends, backlinks) | Só fixtures; **bloqueado** (401) | Fixtures construídas; envelope e erros testados |
| Search Console | Só fixtures; **bloqueado** (sem variáveis) | JWT RS256 verificado com chave de teste |
| Classificação por LLM (zod) | Só fixtures; **bloqueado** (sem chave) | Saída inválida rejeitada e não cacheada |
| AI Optimization | Somente contrato | `AI_OPTIMIZATION_STATE = "contract_only"` |
| Escopo piloto (SP; RJ e BH configurados) | Aprovado | Pesquisa ao vivo com `pilot-sao-paulo`; RJ/BH listados como ausentes |
| Blueprint → geração (/generation) até QA | Aprovado (banco descartável + navegador na bancada) | `blueprint-generation.product.test.ts`; bancada: 4 transições, 6 gates ok, regerar = `unchanged` |
| QA reprovado guarda motivos | Aprovado | teste de conflito de URL: `blocked`, sem versão, evento `blocker` |
| Publicação bloqueada | Aprovado em 3 camadas | modelo (`assertExecutable`), função de transição e gatilho SQL; testes |
| Demanda de busca real / SERP real | **Bloqueado** | credenciais |
| Execução com custo real de API | **Não realizada** | credenciais |
| Neon (branch dev) | **Não verificado** | URL não fornecida |

## Testes
`pnpm turbo typecheck lint build test --force` 11/11 (verde em 3 execuções; 2 execuções sob carga falharam por timeout em testes pesados já existentes e passaram isolados e na repetição); `test:schema` 174/174; `check:consistency` OK; `git diff --check` OK.
Mutações: provedores 7/7 detectadas (não configurado, mapa de 401, esquema estrito, ausência→0, GSC sem dados, ordem das chaves, orçamento e cache nas rodadas anteriores); geração 4/5 detectadas, 1 equivalente (`qa_passed` sem conferir gates: uma página gerada só existe se todos os gates passaram).

## Execução piloto (fontes públicas reais, banco descartável, escopo São Paulo)
- **Funil:** 14 hipóteses → 14 validadas → 14 pontuadas → **1 elegível** → 1 blueprint (reprovado: `template_gap`, experiência `data_insights`) → **0 páginas** → 0 QA.
- **Fontes:** BCB 3 requisições (3 indicadores); notícias IBGE 6 requisições (26 itens); Agência Brasil RSS 2 requisições (3 itens); SIDRA 1 requisição. Custo US$ 0.
- **Prioridade sempre parcial** (7 de 15 dimensões desconhecidas, confiança 0,51); demanda, SERP, concorrência, autoridade, citação e conversão desconhecidas. Nenhum sinal de demanda gravado.
- **Top 10 (prioridade parcial):** taxa de juros do financiamento imobiliário (67,0; elegível, sem template), financiamento imobiliário em São Paulo (59,9), casas à venda em São Paulo (50,7), apartamentos à venda em São Paulo (50,7), reajuste do aluguel IGP-M (48,8), apartamentos para alugar em São Paulo (48,6), remax São Paulo (46,0), morar em São Paulo (45,9; experiência `location_overview`, **atendida por `city-overview`**, mas abaixo do limite de elegibilidade), casas para alugar em São Paulo (44,3), selic e financiamento imobiliário (42,6).
- **Rejeitadas:** 0. A única validação hoje é a de aderência à vertical (todas passaram). A rejeição por "sem demanda mensurável" exige o provedor de keywords e **não pôde ser exercida**: não há exemplos reais de rejeição por demanda.
- **Qualidade dos dados:** a importação "real" traz a população de São Paulo como 11.911.337 (ano 2026, estimativa) e o SIDRA, 11.451.999 (Censo 2022): **anos de referência diferentes**, não erro; o painel não deve compará-los sem o ano.

## Pendências que dependem de decisão ou acesso
1. DataForSEO: senha de API válida (a atual deu 401) → primeira chamada de verificação (`appendix/user_data` é gratuita).
2. GSC: `GSC_CLIENT_EMAIL`, `GSC_PRIVATE_KEY`, `GSC_SITE_URL` e o domínio próprio (Authority Gap e Cannibalization seguem desconhecidos).
3. Anthropic: `ANTHROPIC_API_KEY` (e o modelo). O pipeline de geração atual **não usa LLM** (renderização determinística): não há variável existente a reaproveitar. O custo em US$ da classificação não é calculado (tabela de preços não configurada; tokens ficam registrados).
4. URL da branch Neon `dev-opportunity-engine`.
5. Escopo de Rio e BH: os municípios não estão importados (o extrato real do repositório é só do estado de SP).
6. Preço do m² e anúncios: licença de base (DataZAP/Loft) não disponível; módulos que dependem disso ficam omitidos ou bloqueiam a oportunidade.
7. Novo template (comparação de entidades): fora do que foi feito; o piloto mostra 1 elegível sem template.

## Próximo bloqueio concreto
A credencial do DataForSEO. Sem ela não há demanda de busca real e a prioridade continua parcial.
