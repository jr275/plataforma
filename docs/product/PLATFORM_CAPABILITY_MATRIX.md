# Matriz de capacidades da plataforma

Data: 2026-10-13. Base: `b49165b` (igual a `origin/main` nos refs locais) **mais** as alterações locais não commitadas da unidade Generation Hardening (ver `docs/audits/GENERATION_HARDENING_2026-10-13.md`). Esta matriz é a fonte de verdade do que existe. Não afirma que o produto está completo.

## Como ler

Duas colunas independentes, nunca misturadas:

- **Implementação** (`impl`): `working` (implementado e executa de ponta a ponta com dados reais), `partial` (parte existe, o fluxo está incompleto), `ui_only` (há interface sem implementação funcional por trás), `mocked` (opera sobre dados de demonstração ou sintéticos), `blocked` (depende de credencial, permissão, fonte, serviço externo ou decisão do dono), `missing` (não existe).
- **Verificação** (`verif`): `verified` (critério de aceite e evidência registrados) ou `not_verified`. Um item `working` pode estar `not_verified`; um item `mocked` nunca é `verified` como capacidade de produção.

Evidência citada vem de comandos efetivamente executados (testes em PostgreSQL descartável, leituras somente leitura do Neon, inspeção de código). "Não verificado" significa que a evidência falta, não que esteja errado.

## Panorama

| Situação | Contagem de capacidades abaixo (79 no total) |
|---|---|
| `working` | 25 |
| `partial` | 17 |
| `ui_only` | 0 |
| `mocked` | 10 |
| `blocked` | 9 |
| `missing` | 18 |

Verificação: 34 capacidades `verified` e 45 `not_verified` (a coluna conta como `verified` só quando a evidência cobre o item; ressalvas ficam no texto da célula).

Resumo honesto: **só a trilha "importar cidades → inspecionar a entidade e sua origem → explorar o grafo → gerar rascunhos de página → conferir gates → pré-visualizar" é real** (telas `/cities`, `/graph`, `/generation`, `/data-flow` e `/integrations`). As outras 14 telas do menu operam sobre dados de demonstração guardados no navegador (`apps/web/src/data/demo`, `localStorage`) e não leem o banco. Não há rotas de API (`route.ts`), nenhuma chamada de rede (`fetch`) no aplicativo web, nenhuma biblioteca de grafo e nenhuma biblioteca de agente (CopilotKit/AG-UI não estão instalados).

## Rotas do aplicativo

| Rota | Situação | Origem dos dados | Código |
|---|---|---|---|
| `/login` | `working`, `not_verified` (sem sessão real nesta auditoria) | Supabase (só autenticação) | `app/(auth)/login`, `components/auth`, `proxy.ts` |
| `/generation` | `working`, `not_verified` visualmente (testes automáticos sim) | Banco, por `withTenant` | `app/(app)/generation`, `components/generation` |
| `/generation/pages/[id]` | idem | Banco | idem |
| `/generation/runs/[id]` | idem | Banco | idem |
| `/data-flow` | `working`, `not_verified` visualmente | Banco (`import_run`, `import_record`, `city`) | `components/screens/data-flow-view.tsx`, `lib/server/data-flow.ts` |
| `/dev/preview` | `working` só em desenvolvimento (404 em produção, provado); exige login | Extrato IBGE em arquivo + motor real | `lib/dev-fixture.ts` |
| `/cities` | `working`, `not_verified` visualmente (testes automáticos e de produto sim) | Banco, por `withTenant` (somente leitura) | `app/(app)/cities`, `components/cities`, `lib/server/cities.ts`, `packages/api/src/ingest/city-search.ts` |
| `/cities/[id]` | idem (proveniência: origem, linha original, página gerada, relações da fonte) | Banco | idem |
| `/graph` | `working` (testes e prévia visual com fixture); **não verificado** com sessão real | Banco, por `withTenant` (somente leitura): cidades, UFs, regiões, páginas e execuções de importação | `app/(app)/graph`, `components/graph`, `lib/server/graph.ts`, `packages/api/src/graph` |
| `/integrations` | `working` (sonda real de sessão e banco; fontes bloqueadas com a dependência exata) | Variáveis (só nomes e presença) e sondas reais | `app/(app)/integrations`, `lib/server/integrations.ts` |
| `/dev/graph`, `/dev/cities` | `working` só em desenvolvimento (404 em produção); extrato real do IBGE em memória, origem declarada como teste | Arquivo versionado | `lib/dev-graph-fixture.ts` |
| `/` (visão geral) | `mocked` | `data/demo` | `components/overview` |
| `/opportunities`, `/opportunities/[id]`, `/opportunities/score` | `working`, **não verificado** com sessão real (testes de interface, de ações e de produto; verificação visual só na prévia com dados reais capturados) | Banco, por `withTenant`: pesquisa (escrita) e leitura; configuração do score versionada | `app/(app)/opportunities`, `components/opportunities`, `lib/server/opportunities.ts`, `packages/api/src/engine` |
| `/opportunities/[id]/blueprint` | `working`, **não verificado** com sessão real | Banco, por `withTenant` (prévia renderizada agora, não persistida) | `app/(app)/opportunities/[id]/blueprint`, `components/opportunities/blueprint-view.tsx` |
| `/dev/editor` | `working` só em desenvolvimento (404 em produção); exige `scripts/dev-editor.sh` (banco descartável, sem login) | PostgreSQL descartável | `app/(app)/dev/editor`, `lib/server/dev-editor.ts` |
| `/dev/trends`, `/dev/score`, `/dev/opportunities/[id]/blueprint` | `working` só em desenvolvimento (404 em produção) | Arquivos versionados | `lib/dev-opportunity-fixture.ts` |
| `/roadmap` | `working`, **não verificado** com sessão real | Banco, leitura derivada | `app/(app)/roadmap`, `components/opportunities/roadmap-view.tsx` |
| `/dev/roadmap` | `working` só em desenvolvimento (404 em produção); caso de teste declarado na tela | Arquivos versionados | `lib/dev-opportunity-fixture.ts` |
| `/trends` | `working`, **não verificado** com sessão real | Banco: evidência coletada (BCB, IBGE, Agência Brasil) e execuções | `app/(app)/trends`, `components/opportunities/trends-view.tsx` |
| `/dev/opportunities`, `/dev/opportunities/[id]` | `working` só em desenvolvimento (404 em produção); motor real sobre respostas reais capturadas, sem banco | Arquivos versionados | `lib/dev-opportunity-fixture.ts` |
| `/data-sources`, `/data-sources/[id]` | `mocked` | `data/demo` | `components/screens/sources-views.tsx` |
| `/entities`, `/entities/[id]` | `mocked` | `data/demo` | `components/screens/entities-views.tsx` |
| `/knowledge`, `/knowledge/[id]` | `mocked` | `data/demo` | `components/screens/knowledge-views.tsx` |
| `/search-universe` | `mocked` | `data/demo` | `components/screens/search-universe-view.tsx` |
| `/analytics` | `mocked` | `data/demo` | `components/screens/analytics-view.tsx` |
| `/pages`, `/pages/[id]` | `mocked` (sobrepõe-se a `/generation`) | `data/demo` | `components/screens/pages-views.tsx` |
| `/programmatic` | `mocked` | `data/demo` | `components/screens/programmatic-view.tsx` |
| `/quality-trust` | `mocked` | `data/demo` | `components/screens/quality-view.tsx` |
| `/research` | `mocked` | `data/demo` | `components/screens/research-view.tsx` |
| `/agents`, `/agents/[id]` | `mocked` | `data/demo`, execuções só no `localStorage` | `components/screens/agents-views.tsx` |
| `/ask` | `mocked` | resposta por casamento de palavras em `lib/ask.ts`, sem modelo nem servidor | `components/screens/ask-view.tsx` |
| `/settings` | `mocked` | preferências só no navegador | `components/screens/settings-view.tsx` |

Observação: o seletor de workspace do cabeçalho troca entre workspaces **de demonstração** (`aurora`, `northgate`). As telas reais (`/generation`, `/data-flow`, `/cities`, `/graph`, `/integrations`) ignoram esse seletor e usam o tenant da sessão. `lib/demo-data.ts` não é importado por nenhum arquivo (código morto).

Em modo sem Supabase configurado, `proxy.ts` não protege nenhuma rota (comportamento de demonstração). A autorização por tenant é do servidor, não do proxy.

## A. Plano de controle e tenants

| ID | Capacidade (finalidade) | impl | verif | Código | Dependências e persistência | O que falta | Próximo passo |
|---|---|---|---|---|---|---|---|
| A1 | Isolamento multi-tenant (RLS forçada, `withTenant`) | `working` | `verified` | `db/migrations/0001..0007`, `packages/api/src/tenant-context.ts` | PostgreSQL; `tenant_id` em toda tabela do data plane | Prova no Neon só por leitura como `menlo_app`; ledger e checksums sem confirmação direta | Confirmar o ledger com credencial de leitura dedicada |
| A2 | Autenticação (Supabase, JWT verificado no servidor por JWKS) | `working` | `not_verified` | `packages/api/src/auth`, `lib/server/identity.ts` | Projeto Supabase só para login | Sessão real de ponta a ponta não exercitada nesta auditoria | Roteiro manual com sessão real (ver `END_TO_END_WORKFLOWS.md`) |
| A3 | Papéis, permissões e associação de usuários a tenants | `partial` | `not_verified` | `lib/server/tenant-data.ts` | Claim assinada `app_metadata.tenant_ids`; usa o primeiro tenant | Não há modelo de papéis nem tela de administração; tenant múltiplo sem seletor real | ADR de papéis de aplicação e tabela de membros |
| A4 | Domain packs (RE/MAX é o primeiro) | `partial` | `not_verified` | `packs/real-estate` (só scripts Python do Search Console) | Regra 10: termos de domínio fora do núcleo | Não há contrato nem registro de pack; templates e fatos ainda no núcleo (`city-overview`) | ADR do contrato de pack |
| A5 | Configuração por tenant | `missing` | `not_verified` | — | — | Sem tabela nem tela real | Após A3 |
| A6 | Status e saúde de integrações (sem expor segredos) | `partial` | `verified` (testes) | `/integrations`, `lib/server/integrations.ts` | Só nomes de variáveis e presença; sondas reais da sessão e do banco; fontes bloqueadas com a dependência exata | Não há configuração por tenant nem teste de conectividade de fontes externas (não existem) | Conectores reais (B9, B10) |
| A7 | Trilha de auditoria | `partial` | `not_verified` | `generation_run.created_by` | — | Só autoria da execução de geração; não há trilha geral nem de publicação | Tabela de eventos de auditoria |
| A8 | Saúde operacional (jobs, falhas) | `missing` | `not_verified` | — | — | Tudo | Depois de K1 |

## B. Ingestão e conectores

| ID | Capacidade | impl | verif | Código | Dependências e persistência | O que falta | Próximo passo |
|---|---|---|---|---|---|---|---|
| B1 | Importar CSV de cidades (mapeamento, validação, classificação de 100% das linhas) | `working` | `verified` | `packages/api/src/ingest`, `import_run`, `import_record`, `city` | Arquivo CSV; origem `real`/`test`/`manual` | Só roda por linha de comando; um único tipo de entidade | Generalizar com B5 |
| B2 | Histórico de importações e proveniência (sha256, horário, motivo por linha) | `working` | `verified` (dados) / `not_verified` (tela) | `listImportRuns`, `listImportRecords`, `/data-flow` | `import_run`, `import_record` | Tela só lida com sessão real | Roteiro manual |
| B3 | Registro e configuração de fontes de dados | `mocked` | `not_verified` | `components/screens/sources-views.tsx` (demo) | — | Não há tabela de fontes; `import_run.source_name` é só texto | Tabela `data_source` com contrato de conector |
| B4 | Conectores XLSX, JSON, XML, APIs, bancos relacionais | `missing` | `not_verified` | — | Fontes autorizadas | Tudo | Conforme fonte real disponível (ver `REMAX_DATA_AUDIT.md`) |
| B5 | Interface comum de conector (contrato para novos provedores) | `missing` | `not_verified` | — | — | O importador de cidades é específico | Extrair contrato do importador atual |
| B6 | Mapeamento de campos | `partial` | `not_verified` | parâmetro `mapping` de `runCityImport` | — | Sem interface; sem transformação | C4 |
| B7 | Sincronização incremental, retentativa, exclusões, atualidade | `partial` | `not_verified` | reimportar o mesmo arquivo é idempotente (teste de produto) | — | Sem exclusões lógicas, sem atualidade da fonte, sem retentativa | Fatia própria |
| B8 | Disparar importação pela interface ou API documentada | `missing` | `not_verified` | — | — | Só CLI | Server action com autorização |
| B9 | Search Console (consultas, páginas, desempenho) | `blocked` | `not_verified` | extrator legado `packs/real-estate/analytics/gsc/*.py` | OAuth do dono; permissão completa na propriedade; aprovação da lista de marca; ADR-016 só PROPOSED | Tabelas `search_*`, papel de carga, carregador reescrito | Decisão e credenciais do dono |
| B10 | Inventário de imóveis | `blocked` | `not_verified` | `docs/proposals/PROPERTY_ENTITY_2026-10-13.md` | Fonte real e autorizada; política de dados pessoais | Tudo | Fonte e autorização do dono |
| B11 | GA4 | `blocked` | `not_verified` | — | Propriedade e acesso | Tudo | Decisão do dono |

## C. Mapeamento e base mestre de entidades

| ID | Capacidade | impl | verif | Código | Dependências e persistência | O que falta | Próximo passo |
|---|---|---|---|---|---|---|---|
| C1 | Entidade canônica "cidade" com proveniência | `working` | `verified` | `plataforma.city` (FK composta para `import_run`) | 5.571 cidades reais no Neon (leitura) | Só um tipo de entidade; sem história de mudanças | Histórico (C5) |
| C2 | Outras entidades (escritórios, corretores, bairros, imóveis) | `blocked` | `not_verified` | — | Fontes autorizadas; LGPD | Tudo | Fonte do dono |
| C3 | Resolução de entidades e deduplicação | `partial` | `verified` | duplicidade por `ibge_code` dentro de uma importação | — | Não há resolução entre fontes distintas | Quando houver segunda fonte |
| C4 | Mapping Studio (interface de mapeamento) | `missing` | `not_verified` | — | B3, B5 | Tudo | Após B5 |
| C5 | Histórico de mudanças da entidade | `missing` | `not_verified` | — | — | `city` é atualizada no lugar | Tabela de versões |
| C6 | Relatório de reconciliação | `partial` | `verified` | contagens por desfecho em `import_run` | — | Sem comparação entre execuções | Fatia própria |
| C7 | Tela de Entidades (genérica) | `mocked` | `not_verified` | `/entities` | — | Continua demonstração; a tela real de cidades é C8 | Unificar com C8 quando houver mais de um tipo de entidade |
| C8 | Cidades: busca, filtros, detalhe com origem da importação, linha original, página gerada e relações derivadas da fonte (somente leitura) | `working` | `verified` (testes) | `/cities`, `searchCities`, `getCityDetail` | Tabelas `city`, `import_run`, `import_record`, `page`; sem escrita e sem migration | Validação visual autenticada pendente; gatilho de importação ainda só por CLI | Roteiro manual com sessão real |

## D. Knowledge Graph Explorer

| ID | Capacidade | impl | verif | Código | Dependências e persistência | O que falta | Próximo passo |
|---|---|---|---|---|---|---|---|
| D1 | Grafo de conhecimento: entidades e relações consultáveis, com proveniência | `partial` | `verified` (testes) | `packages/api/src/graph` (leitor único; armazenamento SQL e de memória; 10 testes de produto, incluindo conformância SQL × memória) | Nós e relações **derivados** de `city`, `import_run` e `page` (UF e região vêm das colunas da fonte; cidade → página é vínculo gravado). Sem tabela própria e **sem migration** | Não há modelo persistido de entidades/relações genéricas (só cidade, UF, região e página); sem histórico de relações; sem conflito entre fontes | Modelo persistido (ADR + migration, exige autorização) quando houver mais de um tipo de entidade |
| D2 | Explorador interativo (busca, seleção, expansão, filtro por tipo, navegação ao detalhe, inspeção de origem) | `working` | `verified` (testes automáticos e revisão visual na prévia com fixture) | `/graph`, `components/graph/*` | Leitura por `withTenant`; a seleção é a URL | Validação visual **autenticada** pendente; sem busca de caminhos entre dois nós; sem edição | Roteiro manual com sessão real |
| D3 | Investigação contextual: ferramentas reais e somente leitura sobre a entidade selecionada | `partial` | `verified` (testes) | `components/graph/agent-panel.tsx`, `app/(app)/graph/actions.ts`, `graph/tools.ts` | O usuário aciona cada ferramenta (5 ferramentas); resultado com passos, achados (fato/derivado/sugestão) e citações | **Não há agente**: sem modelo de linguagem, sem streaming, sem CopilotKit/AG-UI; texto livre desabilitado | Agente real (K2/K4), com ADR |

## E. Base de conhecimento e camada de evidência

| ID | Capacidade | impl | verif | Código | Dependências e persistência | O que falta | Próximo passo |
|---|---|---|---|---|---|---|---|
| E1 | Contratos epistêmicos e bi-temporais | `partial` | `verified` (unidade) | `packages/api/src/knowledge` | Em memória | Sem persistência SQL; sem uso pelas telas | ADR-021, Fatia 2 |
| E2 | Fatos com fonte, validade e rastreabilidade na geração | `working` | `verified` | `city-overview`, gate `facts_traceable`, `page_version.content.factsUsed` | `import_run` da cidade | Apenas fatos de cidade | Generalizar `Fact` (ADR) |
| E3 | Aviso de atualidade dos fatos | `working` | `verified` (unidade) | `reviewFacts` | — | É aviso, não gate | — |
| E7 | Inspetor de entidade: atributos com a natureza de cada valor (fato, derivado), origem, atualidade, verificação da origem, sugestões separadas | `working` | `verified` (testes) | `components/graph/inspector.tsx`, `graph/reader.ts` | Só dados persistidos; nenhuma inferência é exibida | Sem conflito/expiração por fato (E5); sem histórico | Depois de E5 |
| E4 | Documentos, trechos e embeddings | `missing` | `not_verified` | — | — | Tudo | Decisão de escopo |
| E5 | Registros de evidência e detecção de conflitos | `missing` | `not_verified` | — | — | Tudo | Após D1 |
| E6 | Tela de Conhecimento | `mocked` | `not_verified` | `/knowledge` | — | Não lê dados reais | Após E5 |

## F. Inteligência de busca e oportunidades

| ID | Capacidade | impl | verif | Código | Dependências e persistência | O que falta | Próximo passo |
|---|---|---|---|---|---|---|---|
| F1 | Tabela legada de oportunidades (0002, qualitativa, sem fonte) | `partial` | `verified` (testes) | `0002_opportunity.sql`, `packages/api/src/opportunities.ts` | Mantida; **substituída na prática por F6** (não alterada) | Sem escritor | Decidir aposentar (ADR) |
| F2 | Tela de oportunidades | `working` | `not_verified` com sessão real | `/opportunities` (lê F6) | Banco | Ver F6 | Validação visual autenticada |
| F6 | **Motor de oportunidades (Slice A)**: pesquisa real, evidência, hipóteses por vertical, clusters, score V2 configurável e versionado, ciclo de vida com histórico (ADR-023, migration 0008) | `working` | `verified`: 133 testes do motor; 16 de produto em PostgreSQL real (idempotência, isolamento, concorrência, 19x19 transições SQL=TS, imutabilidade); pesquisa AO VIVO em banco descartável (`scripts/verify-engine-live.sh`: 3 fontes reais, 204 hipóteses, 2ª execução sem duplicar nada); mutação (ver critérios) | `packages/api/src/engine`, `packs/real-estate`, `db/migrations/0008_opportunity_engine.sql` | 7 tabelas com RLS; `migration 0008` **não aplicada no Neon** | Demanda de busca, SERP e concorrência desconhecidas (sem fonte): prioridade sempre **parcial**; só um padrão de experiência suportado (visão geral da cidade) | Fontes de demanda/SERP (bloqueadas); Slices B a E |
| F8 | **Blueprint, registro de templates e seis gates de experiência (Slice C, ADR-024, migration 0009)** | `working` | `verified`: testes unitários (19 + 6), 18 de produto (idempotência, SERP dispensada registrada, isolamento, imutabilidade, versão mais nova); execução ao vivo; 28 mutações detectadas | `engine/blueprint*.ts`, `engine/experience-gates.ts`, `pages/registry.ts` | `page_blueprint` (RLS, histórico imutável); `0009` **não aplicada no Neon** | Só um template real (`city-overview`): as demais experiências aparecem como bloqueadas; JSON-LD só proposto; SERP, demanda e IA `not_evaluated` | Novos templates (ADR); provedor de SERP |
| F9 | **Roadmap de oportunidades (Slice D)** | `working` | `verified` (testes de produto e ao vivo) | `engine/roadmap.ts`, `/roadmap` | Leitura derivada, sem tabela | Sem execução automática do restante do pipeline (dados, QA, publicação) | Depois de publicação (decisão do dono) |
| F11 | **Interface operacional do motor (ADR-025)**: tabela com cobertura e objetivos, painel de investigação (o que sei/de onde/o que falta/o que bloqueia/próximo passo), blueprint completo (`/opportunities/[id]/blueprint`: dados, template, links, seis gates, prévia real, decisão de publicação desabilitada), exceção escrita de SERP, roadmap com etapas e bloqueios, tendências com frescor, capacidades com estado | `working` | `verified`: testes de interface, de ações e de produto; navegação na aplicação em modo sem login (estados reais) e nas prévias de desenvolvimento (estado pronto); celular sem overflow | `components/opportunities`, `app/(app)/opportunities`, `lib/server/opportunities.ts`, `engine/investigation.ts` | Banco; `0008`/`0009` não aplicadas no Neon | Sem sessão real nem Neon; a prévia usa respostas reais capturadas | Validação autenticada |
| F12 | **Editor visual da experiência de página (ADR-026, migration 0010)**: 12 tipos de nó com contratos, conexões validadas, inspector por contrato, desfazer/refazer, ELK sob demanda, validação cliente+servidor, gates reavaliados sobre o rascunho, prévia sincronizada, versões imutáveis por tenant, lista acessível | `working` | `verified`: 48 testes do domínio e do estado, 13 de produto em PostgreSQL real (persistência, recuperação, concorrência, isolamento, imutabilidade, prévia), fluxo completo no navegador sobre banco descartável (editar, conectar, validar, salvar, recarregar, prévia) | `packages/api/src/draft`, `engine/page-draft-store.ts`, `pages/preview-draft.ts`, `components/opportunities/editor`, `lib/editor` | `page_draft` (RLS, imutável); `0010` **não aplicada no Neon** | Sem sessão real nem Neon; só um template (`city-overview`); publicação segue bloqueada | Validação autenticada; novos templates (ADR) |
| F10 | Contratos das fontes bloqueadas (SERP, concorrentes, citações em IA, demanda, conversão) | `blocked` (contrato e estado; sem implementação) | `verified` (teste de consistência com o score) | `engine/providers.ts` | Credenciais e contratos do dono | Tudo além do contrato | Autorização do dono |
| F7 | Fontes de pesquisa: BCB (SGS), notícias do IBGE, RSS da Agência Brasil | `working` | `verified` (testes com respostas reais capturadas; consulta ao vivo) | `engine/adapters` | Sem credencial; robots.txt respeitado; só HTTPS público; limites de tempo e tamanho | Trends, SERP, Search Console, GA4, IA: contrato e estado `blocked` | Autorização e credenciais do dono |
| F3 | Ingestão do Search Console | `blocked` | `not_verified` | ver B9 | — | Ver B9 | Ver B9 |
| F4 | Search Universe e Analytics | `mocked` | `not_verified` | `/search-universe`, `/analytics` | — | Sem métrica real | Depende de B9 |
| F5 | Classificação de intenção, canibalização, concorrência | `partial` | `verified` (testes) | `engine/classify.ts`, `engine/dimensions.ts` | Intenção por padrão da vertical; canibalização só contra páginas do tenant | Concorrência e SERP: `unknown` até haver fonte | Depois de B9 |

## G. Fábrica de páginas e SEO programático

| ID | Capacidade | impl | verif | Código | Dependências e persistência | O que falta | Próximo passo |
|---|---|---|---|---|---|---|---|
| G1 | Template de cidade (renderização pura a partir de fatos) | `working` | `verified` | `packages/api/src/pages/city-overview.ts` | `city`, `import_run` | Um só arquétipo | Novos arquétipos exigem ADR |
| G2 | Seis gates independentes (`required_fields`, `url_unique`, `url_stable`, `metadata_valid`, `links_resolve`, `facts_traceable`) | `working` | `verified` | `pages/gates.ts` | — | Sem gates de conteúdo fino, esquema, rastreio | Ver H |
| G3 | Geração em lote em rascunho (versões, idempotência por hash, uma execução por tenant, recuperação de abandono) | `working` | `verified` | `pages/generate.ts`, migrations 0005 a 0007 | Neon: execução `11d30ce6…` com 20 rascunhos (leitura) | Roda síncrona na requisição; sem fila nem cancelamento | K1 |
| G4 | Telas de geração (lista, detalhe, execução, reprocessar) | `working` | `not_verified` visualmente; testes automáticos `verified` | `app/(app)/generation`, `components/generation` | — | Validação visual autenticada pendente | Roteiro manual |
| G5 | Pré-visualização do conteúdo persistido e do snippet de busca | `working` | `verified` (unidade) | `page-preview.tsx`, `serp-snippet.tsx` | — | Sem pré-visualização do HTML final publicado | Slice 4 |
| G6 | Aprovação explícita e publicação controlada | `missing` | `not_verified` | botão desabilitado; `status` só aceita `draft` e `blocked` | Site e mecanismo de publicação (decisão do dono) | Tudo | Decisão do dono |
| G7 | Dados estruturados (JSON-LD), canonical, robots, sitemap | `missing` | `not_verified` | — | G6 | Tudo | Slice 4 |
| G8 | Detecção de duplicidade e conteúdo fino | `partial` | `verified` (duplicidade de URL, título e meta) | `gates.ts` | — | Sem conteúdo fino nem similaridade textual | Slice 4 |
| G9 | Outros arquétipos e páginas de imóvel | `blocked` | `not_verified` | — | B10 | Tudo | Fonte do dono |
| G10 | Telas `/pages` e `/programmatic` | `mocked` | `not_verified` | — | — | Sobrepõem `/generation` | Redirecionar ou ligar a G3 |

## H. SEO, GEO e visibilidade em IA

| ID | Capacidade | impl | verif | Código | Dependências | O que falta | Próximo passo |
|---|---|---|---|---|---|---|---|
| H1 | Validação técnica de título e meta | `working` | `verified` | gate `metadata_valid` | — | — | — |
| H2 | Links internos resolvem | `partial` | `verified` | gate `links_resolve` com `knownPaths` | Hubs não existem | Sem hubs; sem rastreio | Slice 4 |
| H3 | Dados estruturados, robots, sitemap, canonical | `missing` | `not_verified` | — | G6 | Tudo | Slice 4 |
| H4 | Monitoramento de indexação | `blocked` | `not_verified` | — | B9 e G6 | Tudo | Depois de publicar |
| H5 | Visibilidade e citações em IA | `blocked` | `not_verified` | — | Fonte de medição autorizada | Nenhuma fonte definida | Decisão do dono |
| H6 | Tela de Pesquisa | `mocked` | `not_verified` | `/research` | — | — | Depende de H5 |

## I. Estúdio de geração e conteúdo

| ID | Capacidade | impl | verif | Código | O que falta | Próximo passo |
|---|---|---|---|---|---|---|
| I1 | Histórico de versões e proveniência por página | `working` | `verified` | `page_version` imutável | — | — |
| I2 | Reprocessar uma página | `working` | `verified` (API); `not_verified` visual | `reprocessAction` | — | Roteiro manual |
| I3 | Fluxo de aprovação e restauração de versão | `missing` | `not_verified` | — | Tudo | Depois de G6 |

## J. Qualidade, confiança e experimentos

| ID | Capacidade | impl | verif | Código | O que falta | Próximo passo |
|---|---|---|---|---|---|---|
| J1 | Gates independentes, sem nota composta | `working` | `verified` | `gates.ts` | — | — |
| J2 | Tela Qualidade e Confiança | `mocked` | `not_verified` | `/quality-trust` | Não lê gates reais | Ligar aos gates persistidos |
| J3 | Experimentos, coortes, antes e depois | `missing` | `not_verified` | — | Tudo | Depende de G6 e B9 |
| J4 | Medição de resultado por URL | `blocked` | `not_verified` | — | Tudo | Depende de B9 e G6 |

## K. Orquestração e agentes

| ID | Capacidade | impl | verif | Código | O que falta | Próximo passo |
|---|---|---|---|---|---|---|
| K1 | Jobs de longa duração (estado, retentativa, cancelamento) | `partial` | `verified` (recuperação de abandono, uma execução por tenant) | `runGeneration` síncrono | Sem fila, sem cancelamento, sem progresso por passo | ADR de orquestração |
| K2 | Agente que chama ferramentas autorizadas | `partial` | `verified` (testes) | `graph/tools.ts` | Ferramentas reais, só leitura, acionadas pelo usuário; sem planejamento autônomo | Sem modelo, sem agente, sem ferramentas de escrita nem aprovação | Slice de agente com ADR |
| K3 | Telas Agentes e Perguntar | `mocked` | `not_verified` | `/agents`, `/ask`, `lib/ask.ts` | Respostas por casamento de palavras, sem modelo | Substituir por K2 |
| K4 | CopilotKit / AG-UI | `missing` | `not_verified` | — (não instalados) | Dependências, backend de agente, decisão de arquitetura | Slice 5, com ADR |
| K5 | Aprovação de ações do agente, permissões de ferramentas | `missing` | `not_verified` | — | Tudo | Slice 5 |

## L. Integrações, configurações e operação

| ID | Capacidade | impl | verif | Código | O que falta | Próximo passo |
|---|---|---|---|---|---|---|
| L1 | Tela de configurações | `mocked` | `not_verified` | `/settings` | Preferências só no navegador | Substituir por A5, A6 |
| L2 | Notificações e falhas | `missing` | `not_verified` | — (toasts de demonstração) | Tudo | Depois de A8 |
| L3 | CI (typecheck, lint, build, RLS, testes) | `working` | `verified` | `.github/workflows/ci.yml`; run 38415758080 verde em `b49165b` | Corrida `typecheck` x `build` inconclusiva | — |
| L4 | Ambiente local reproduzível com dados reais | `working` | `verified` | `pnpm dev:local` | Só local | — |
| L5 | Implantação (Vercel) | `partial` | `not_verified` | status do GitHub: `plataforma` e `plataforma-px9y` com sucesso; `gsc` falha | Variáveis de produção e causa de `gsc` desconhecidas | Autorização para ver logs privados |

## M. Casca, identidade e contrato de modo de dados

| ID | Capacidade | impl | verif | Código | O que falta | Próximo passo |
|---|---|---|---|---|---|---|
| M1 | Casca e navegação hierárquica com estado por item (real, demonstração, planejado) | `working` | `verified` (testes e revisão visual na instância isolada) | `config/navigation.ts`, `components/shell/*` | Itens planejados (Workflows, GEO & AI Citations, Experiments) sem rota, desabilitados; sessão real pendente | Rotas reais conforme as capacidades existirem |
| M2 | Contrato de modo de dados: selo permanente no topo, faixa nas telas de demonstração, etiqueta por item, paleta de comandos rotulada | `working` | `verified` (testes e revisão visual) | `routeMode`, `ModeBadge`, `ModeBanner` | Telas de demonstração seguem existindo (14) | Substituí-las por reais, uma a uma |
| M3 | Identidade visual (tokens claro e escuro, cantos suaves, tinta + uma cor de sinal) | `working` | `verified` visualmente em desktop e celular (instância isolada, sem sessão) | `app/globals.css`, componentes de UI | Revisão com sessão real; contraste automatizado não medido | Auditoria de contraste e teclado |
| M4 | Prévias de desenvolvimento com o extrato real (`/dev/*`) | `working` | `verified` (404 em produção, provado antes) | `lib/dev-graph-fixture.ts` | — | — |

## Requisitos transversais

- **Tenant e autorização:** toda leitura e escrita real passa por `withTenant` com a identidade verificada no servidor (ADR-018). O `tenant_id` nunca vem do cliente (provado por testes e mutações). O proxy do Next só protege a interface.
- **Testes de referência:** API 275 (unitários); web 222; `test:schema` com 96 testes de produto (20 de cidades e 10 do grafo); `test:schema` 79/79 com testes de produto; `test:rls` 47; `test:security` 93; `test:migrations` 213; `test:bootstrap` 95; `test:gate` 237; `test:hardening` 96. Todos em PostgreSQL descartável local, nunca no Neon.
- **Neon (dev, somente leitura verificado):** tenant `remax` com 5.571 cidades reais e 20 rascunhos; ledger e checksums sem confirmação direta.
- **Lacunas de ponta a ponta:** não existe rota de API pública documentada; qualquer ação de usuário passa por server actions (hoje só em `/generation`).

## Estado dos slices 1 e 2 e próximo passo

**Slice 1 (cidades reais) e slice 2 (casca, grafo, inspetor, investigação, integrações e contrato de modo de dados) entregues em código e testes, ainda não commitados.** Provas: `turbo typecheck lint build test --force` verde na cópia isolada (9/9); web 222 testes; API 275; `test:schema` 79/79 com 96 testes de produto; 45 mutações (20 do slice 1 e 25 do slice 2) todas detectadas; revisão visual em desktop e celular na instância isolada (porta própria, sem `.env`), sem rolagem horizontal. **Não verificado:** qualquer tela real com sessão autenticada (o ambiente isolado não tem login) e a leitura contra o Neon (nenhuma conexão foi feita). Nenhuma migration nova.

Próximo passo recomendado (slice 3): reduzir a superfície de demonstração onde já existe equivalente real: tornar real o **Command Center** (indicadores do workspace: cidades, páginas, execuções, saúde das fontes, tudo já medível), **Data Sources** (registro derivado de `import_run`) e **Content** (lista de páginas sobre `page`, hoje duplicada em `/generation`). Não exige migration. Depende do dono: Search Console, imóveis e publicação.
