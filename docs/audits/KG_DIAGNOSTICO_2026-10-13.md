# Diagnóstico técnico (Fase 0): infraestrutura de conhecimento, Knowledge Graph temporal e governança agêntica

Data: 2026-10-13. Repositório `~/plataforma`, branch `main`, HEAD `2007dcd` (um commit local à frente de `origin/main`; árvore limpa no início). Fatos verificados estão marcados; o que é hipótese ou depende de terceiros está dito como tal.

## 1. Estado inicial verificado
- **Stack:** pnpm 12.10.1 + Turborepo, Node 24.9, TypeScript, Next.js 16.4 (`apps/web`), PostgreSQL 16 (Neon dev e cluster descartável local), SQL escrito à mão como autoridade do esquema (ADR-011), Drizzle só para tipos (`packages/db`), `jose` para JWT, `pg` no pacote `api`. Sem dependência de grafo, vetor, fila ou LLM.
- **Verificações executadas em `2007dcd` (todas PASS):** `check:consistency`, `test:rls`, `test:migrations`, `test:security`, `test:bootstrap`, `test:gate`, `test:hardening`, `test:api`, `test:schema`; além de `turbo typecheck lint build` e dos 156 testes do pacote `api` (rodados antes, no mesmo commit de código). **Nenhuma falha preexistente encontrada.**
- **Persistência real:** Neon dev `plataforma-dev` com 4 migrations (`tenant`, `opportunity`, `import_run`, `import_record`, `city`); tenant `remax` com 5.571 municípios do IBGE. Isolamento por RLS forçada (`plataforma.current_tenant_id()`), papéis `plataforma_admin`, `plataforma_migrator`, `menlo_app`, gate de segurança no runner.
- **Autenticação:** Supabase (JWT verificado no servidor por JWKS; tenant só da claim assinada `app_metadata.tenant_ids`). Primeira tela com dado real: Fluxo de dados (ADR-018).
- **Páginas:** template `city-overview` v1, render puro, `Fact` com fonte/ano/data de coleta, só dado de origem real (ADR-019). Geração em lote (ADR-020) **proposta, não implementada**.
- **Esquema legado, não aplicado:** `db/legacy/v0.1-0.5/` tem um desenho prévio com `entity`, `relation` (intervalo `valid_from`/`valid_to` e exclusão de sobreposição), `claim` (imutável, `superseded_by`, classes VERIFIED/DERIVED/INFERRED/UNSUPPORTED), `evidence`, `claim_conflict`, `decision_trace`, `job`. Está em `menlo.*`, PostgreSQL 15, sessão com `menlo.tenant_id` e **fora** do modelo atual (ADR-011/013). É referência de desenho, não código reutilizável como está.

## 2. Capacidades pedidas × o que existe (busca e leitura do código)
| Capacidade | Existe? | Evidência |
| --- | --- | --- |
| Observation / Evidence / Provenance | **Parcial, só em ingestão de CSV** | `import_run` (fonte, sha256, horário, origem real/teste/manual) e `import_record` (linha bruta, desfecho, motivos); `Fact.source` das páginas. Sem snapshot de conteúdo web, sem versão de parser/normalização, sem cadeia de transformações |
| Entidades e relações genéricas | **Não** (só `city` e `opportunity`) | migrations 0001 a 0004; legado não aplicado |
| Property × Listing × Agent × BrokerageOffice × POI × Transaction | **Não** | nenhuma tabela, tipo ou fixture de dados reais. `packs/real-estate` só tem o carregador do Search Console (Python, esquema legado) |
| Estados epistemológicos (OBSERVED_TRUE etc.) | **Não** | o legado tem 4 classes de afirmação, sem OWA nem `ABSENT`/`UNKNOWN_STALE` |
| Modelo bi-temporal | **Não** | legado: só tempo de validade; só `created_at`. A migration `0004_city` usa `created_at`/`updated_at` e **não é** bi-temporal |
| Entity Resolution | **Não** | zero ocorrências |
| Freshness / expiração / tombstones | **Não** | — |
| Geografia, POI, deslocamento | **Parcial mínimo** | `city` com UF/região; sem coordenadas, POI, roteamento |
| Pipeline em estágios com idempotência | **Parcial** | importação CSV com 3 transações e upsert; sem estágios Observation→Extraction→Normalization, sem `job` |
| Context Engine / consulta factual elegível | **Não** | — |
| Governança agêntica (N0 a N3), validação determinística de respostas, escalonamento | **Não** | zero código; a tela "Agents" é demonstração com dados fictícios |
| Leads, capacidade, roteamento, exclusividade de corretor | **Não** | zero código (os acertos em "lead" no código são texto de interface) |
| Consentimento / opt-out / retenção / auditoria de acesso | **Não** | só menções em documentos |
| Regras financeiras | **Não** | nenhuma implementação de cálculo ou cobrança, e nenhuma deve existir sem autorização |
| Multi-tenant e RLS | **Sim, testado** | `test:rls`, `test:schema` (55), `test-neon` (22); teste estático de onde o contexto de tenant pode ser definido |
| Autenticação e autorização no servidor | **Sim para login e tenant**; **não** para papéis por função/recurso | ADR-015/018 |
| SSRF e proteção de conectores | **Não aplicável ainda** | não há conector de rede; o carregador do IBGE é script manual |
| Observabilidade/métricas operacionais | **Não** | — |

O Mova, Alex, Sardano/Copilot e o fluxo de leads existem como **documentos** no repositório `menlo` (docs-only, não tocado aqui). Não há fornecedor de IA, fila humana nem integração implementados em `plataforma`.

## 3. Componentes reutilizáveis
`withTenant` + RLS + migrations com gate; o padrão `import_run`/`import_record` (execução + registro por linha, 100% classificado, 3 transações); `Fact` e `renderCityPage` (precursores de fato rastreável); a decisão de **recusar origem não real** nas páginas; o desenho do legado como inspiração para claim/evidence/conflict; o runner e os scripts do Neon.

## 4. Lacunas comprovadas (em relação ao pedido)
Praticamente todo o núcleo do pedido (modelo de conhecimento, estados epistemológicos, bi-temporalidade, ER, pipeline de observações, Context Engine, governança agêntica, leads, consentimento) **não existe** e **não pode** ser inferido de código existente. O que existe é uma fatia vertical de cidades (IBGE) e a infraestrutura de segurança multi-tenant.

## 5. Dependências bloqueantes (nada disso se resolve por código)
1. **Fonte de dados de imóveis/anúncios/corretores/escritórios.** Não há feed, API, banco ou autorização da RE/MAX no repositório. Sem isso, **Property, Listing, Agent e BrokerageOffice só podem existir como contratos e fixtures sintéticas**, nunca como conhecimento real. Estado: **BLOCKED** para dados reais.
2. **Fornecedor de IA e canal de atendimento humano (fila, Sardano/Copilot):** não definidos; sem eles a governança agêntica é só política e testes.
3. **Limiares X%, Y%, Z% de promoção de autonomia e a autoridade aprovadora:** pendentes; a promoção deve ficar **bloqueada** enquanto indefinidos.
4. **Regras financeiras e portão G.0:** exigem aprovação formal e responsável nomeado. Resultado atual do G.0: **BLOCKED**.
5. **Provedor de roteamento/grafo viário** para tempos de deslocamento: inexistente; nada será simulado.
6. **Acesso do Search Console** (propriedade, permissão, autorização RE/MAX): pendente (ADR-016).
7. **Jurídico/LGPD:** base legal, retenção e consentimento precisam de validação dos responsáveis.

## 6. Riscos
- **Crítico, escopo:** o pedido cobre meses de trabalho de várias equipes (grafo temporal, ER, agentes, operação humana). Tentar tudo de uma vez produz estrutura sem dado e sem operação, o oposto do pedido de evidência. Recomendação: fatias verticais, cada uma com contratos, testes e documentação de limites.
- **Alto, conflito de prioridades:** antes desta diretiva, o dono definiu como critério de aceite do MVP **não expandir escopo (agentes autônomos, GEO, vários templates) antes da primeira jornada funcionar**. A Etapa 4 (geração em lote com gates, ADR-020) aguarda três respostas do dono. As duas frentes disputam o mesmo tempo; a ordem precisa ser decidida por ele.
- **Alto, dado:** sem fonte de imóveis, qualquer "conhecimento imobiliário" seria sintético; as demonstrações devem ser rotuladas assim.
- **Médio:** `menlo_app` executa `pg_advisory_lock` no Neon (aceito só em desenvolvimento); papel dono do Neon com `BYPASSRLS` (só preparação).
- **Médio:** conteúdo raso das páginas de cidade (risco aceito pelo dono, lote piloto pequeno).

## 7. Cronograma do piloto × estado real (hoje, 13/10/2026)
| Marco | Evidência no repositório |
| --- | --- |
| 05/09 construção e arquitetura | existe (ADRs 001 a 020, esquema, auth, importação) |
| 05/10 ensaio integrado com corretores reais e compradores de teste | **nenhuma evidência**: não há corretor, comprador, lead nem agente implementados |
| 20/10 apresentação de prontidão em modo assistido (daqui a 7 dias) | **só é possível demonstrar** a fatia de dados real (tenant isolado, importação IBGE rastreável, páginas de cidade em rascunho) e a arquitetura documentada; **não** é possível demonstrar atendimento agêntico, leads ou imóveis reais |
| 04/11 soft launch com cobrança real | **BLOCKED** pelo portão G.0 (aprovações, responsável, consentimento, capacidade humana e rollback inexistentes) |
| 04/12 operação repetível | depende dos itens acima |
Plano de recuperação realista: para 20/10, apresentar o que existe com rótulos honestos; abrir os bloqueios 1 a 4 acima como decisões do dono; não prometer 04/11.

## 8. Sequência recomendada (adaptada às dependências reais)
| Fatia | Conteúdo | Depende de | Critério de aceite (testes) |
| --- | --- | --- | --- |
| **1. Contratos do domínio** (em andamento) | tipos e invariantes puros: intervalo temporal, estados epistemológicos e transições, observação/evidência/proveniência (confiança em dimensões separadas), versão de fato, repositório bi-temporal de referência | nada externo | testes unitários de invariantes, de Valid × Transaction Time e de OWA |
| 2. Persistência temporal | migrations para entidade/fato/evidência com tempo de validade e de transação, RLS, FKs compostas, testes de isolamento e de reconstrução temporal | ADR da fatia 1 aprovado | `test:schema` e Neon |
| 3. Pipeline de observações | observação imutável + extração + normalização versionadas, idempotência, reprocessamento (generaliza `import_run`) | fatia 2 | reprocessar sem duplicar nem perder histórico |
| 4. Entity Resolution por regras | EQUIVALENT/DISTINCT/UNCERTAIN com justificativa e reversão; avaliação sobre **fixtures sintéticas rotuladas** | fatia 1 e 2 | casos de endereço, duplicata, atributos conflitantes; sem alegar desempenho real |
| 5. Context Engine + experiência | consulta factual elegível (proveniência, atualidade, estado) ligada a **um** fluxo vertical (as páginas de cidade) | fatias 1 a 3 | fato sem proveniência ou vencido é recusado |
| 6. Governança agêntica | política N0 a N3 no servidor, N2 desligado, validação determinística, escalonamento, com **fornecedor de IA simulado por interface** | decisão do dono sobre fornecedor e limiares | ações fora da política recusadas; promoção bloqueada com limiares indefinidos |
| 7. Operação | métricas, capacidade, leads, concorrência; G.0 como verificação que devolve BLOCKED | dados e autoridade reais | testes de corrida e idempotência |
A Etapa 4 do MVP (geração em lote com gates, ADR-020) permanece pendente e consome o conceito de `Fact` que a fatia 1 formaliza.

## 9. Critérios de aceite (estado hoje)
| # | Critério | Estado |
| --- | --- | --- |
| 1 | Arquitetura real inspecionada e documentada | **PASS** (este documento) |
| 2 | Contratos de domínio implementados e validados | NOT TESTED (fatia 1 em andamento; ver relatório da fatia) |
| 3 | Property e Listing com identidades e ciclos distintos | NOT TESTED (**BLOCKED** para dado real: sem fonte) |
| 4 | Observações e evidências rastreáveis | NOT TESTED (parcial só para CSV) |
| 5 | Ausência ≠ falsidade | NOT TESTED |
| 6 | Fatos com estados epistemológicos | NOT TESTED |
| 7 | Histórico temporal preservado | NOT TESTED |
| 8 | ER com incerteza e conflitos | NOT TESTED |
| 9 | Pipeline com reprocessamento e idempotência | NOT TESTED (parcial na importação CSV) |
| 10 | Consultas respeitam proveniência e atualidade | NOT TESTED |
| 11 | Autonomia aplicada no servidor | NOT TESTED |
| 12 | N2 desativado no piloto | NOT TESTED |
| 13 | Respostas agênticas com validação e escalonamento | NOT TESTED |
| 14 | Isolamento de tenants e privacidade testados | **PASS** para as tabelas existentes (RLS); privacidade/consentimento NOT TESTED |
| 15 | Leads com limites, auditoria e concorrência | NOT TESTED |
| 16 | G.0 impede operação financeira sem aprovação | **BLOCKED** (sem aprovações; nenhuma operação financeira existe no código) |
| 17 | Testes executados e registrados | **PASS** (seção 1) |
| 18 | Riscos, dependências e pendências documentados | **PASS** (este documento) |

## 10. Relatório da Fatia 1 (contratos e repositório bi-temporal de referência), 2026-10-13

**Decisão:** ADR-021. **Código:** `packages/api/src/knowledge/` (`temporal.ts`, `epistemic.ts`, `provenance.ts`, `domain.ts`, `store.ts`), puro, sem banco, rede, relógio nem dependência nova.

### Implementado e provado (testes: pacote `api` 202 passando, 46 novos; typecheck, lint e build verdes)
- **Intervalo temporal** semiaberto `[início, fim)` com limites `instant`/`unbounded`/`unknown` e consultas de três valores.
- **Estados epistemológicos** (6) com semântica documentada, transições válidas com motivo coerente e evidência, políticas de consumo (assertiva, cautelosa, histórica). **Nenhuma transição leva a `ABSENT`** (Open-World).
- **Observação e evidência** com validação (sha256, versão do parser, ingestão ≥ observação, origem http(s) ou referência interna sem esquema, derivação exige origem). **Confiança em 5 dimensões separadas, sem função de agregação** (um teste confere).
- **Catálogo de domínio** genérico (tipos de entidade, tipos de relação com cardinalidade declarada, validação de entidade e de relação, mesmo tenant nas pontas).
- **Repositório bi-temporal de referência (em memória):** valid time × transaction time independentes; correção retroativa que **não apaga** o conhecimento anterior (reconstruível por `knownAt`); idempotência; observação concorrente de outra fonte vira `CONFLICTING` sem sobrescrever; corroboração soma evidências; vencimento (`UNKNOWN_STALE`) e encerramento de vigência sem apagar; tempo de transação monotônico; isolamento por tenant; versões imutáveis.
- **Imutabilidade:** a versão inicial só congelava o objeto de forma rasa (as datas eram compartilhadas); corrigida em seguida (ver correções).
- **Mutações de sanidade:** ignorar o tempo de transação na consulta derrubou 6 testes; permitir `ABSENT` derrubou 1; código restaurado e comparado byte a byte. Um erro de projeto foi achado pelos testes: a corroboração descartava a evidência anterior (corrigido; agora soma).

### Não implementado (fora desta fatia)
Persistência (esquema SQL, RLS, exclusão de sobreposição), pipeline de observações, Entity Resolution, Context Engine, geografia/POI/roteamento, governança agêntica, leads e consentimento, métricas, G.0 e catálogo imobiliário (Property ≠ Listing). Contratos ainda ausentes: `ResolutionDecision`, `IngestionRun` generalizado, `KnowledgeChange`, `AgentAction`, `GovernanceDecision`.

### Limites conhecidos
O repositório **rejeita** validade com limite `unknown` (o contrato a representa); a corroboração soma evidências só quando a validade é idêntica; as evidências são identificadores sem verificação de existência; tudo é em memória, sem concorrência real. (O conflito, antes conservador, agora é segmentado no tempo; ver correções abaixo.) As fixtures de teste são sintéticas e não são evidência de desempenho em produção.

### Critérios de aceite após a Fatia 1 (substitui a tabela da seção 9 onde mudou)
| # | Critério | Estado |
| --- | --- | --- |
| 2 | Contratos de domínio implementados e validados | **PASS** para Entity, Relation, Observation, Evidence, FactVersion e TemporalInterval; **NOT TESTED** para os 5 contratos ausentes acima |
| 3 | Property e Listing distintos | NOT TESTED (**BLOCKED** para dado real; o catálogo genérico já permite registrá-los, o do pack não existe) |
| 4 | Observações e evidências rastreáveis | **PASS** no contrato e no repositório de referência; persistência NOT TESTED |
| 5 | Ausência ≠ falsidade | **PASS** no repositório de referência (`ABSENT` ≠ `OBSERVED_FALSE`); persistência NOT TESTED |
| 6 | Estados epistemológicos explícitos | **PASS** (referência) |
| 7 | Histórico temporal preservado | **PASS** (referência em memória); persistência NOT TESTED |
| 10 | Consultas respeitam proveniência e atualidade | **PASS** só para a filtragem por política (`eligibleVersions`); Context Engine NOT TESTED |
Demais critérios: sem mudança.

### Próxima unidade de trabalho recomendada
**Fatia 2 (persistência temporal):** ADR próprio, migrations de entidade/fato/evidência com tempo de validade e de transação, RLS e testes de isolamento e de reconstrução temporal contra o PostgreSQL descartável e o Neon dev. Exige aprovação do dono antes de qualquer migration. Em paralelo, a Etapa 4 do MVP (geração de páginas com gates, ADR-020) segue pendente de três respostas do dono.

### Correções pós-revisão (2026-10-13), commit seguinte à Fatia 1
Defeitos comprovados por sonda e corrigidos: **P1** imutabilidade rasa (o chamador alterava as datas gravadas); **P2** conflito que contaminava o passado; **P3** prazo em conflitos e em repetições; **P4** isolamento por tenant só por convenção do chamador (agora o repositório é vinculado a um tenant); **P5** exportações genéricas (agora namespace `knowledge`). Testes: pacote `api` com 216 passando; mutações (devolver o `Date` interno; remover a checagem de tenant na escrita) derrubam os testes correspondentes e o código foi restaurado byte a byte.
