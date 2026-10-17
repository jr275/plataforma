# ADRs

A documentação do produto vive no repositório `menlo` (`docs/menlo-os/`) e é a fonte de verdade (ADR-008). Este repositório guarda o código e as decisões de arquitetura que o afetam. Decisão nova vira um ADR curto aqui **antes** do código.

Modelo curto: Contexto · Decisão · Alternativas rejeitadas · Consequências · Data e status.

## Índice

| ID | Decisão | Status |
| --- | --- | --- |
| ADR-001 | Postgres primeiro; ClickHouse só em fase posterior | Accepted |
| ADR-002 | Gates e fatores separados, sem nota única | Accepted |
| ADR-003 | A cidade é a unidade do piloto, com diferença em diferenças | Accepted; parâmetros a definir |
| ADR-004 | Publicar em `/perto-de/` por proxy reverso | Accepted; depende da configuração do cliente |
| ADR-005 | O grafo é a fonte da verdade; OKF é exportação opcional depois do piloto | Accepted |
| ADR-006 | Sem conteúdo que muda por visitante na mesma URL | Accepted |
| ADR-007 | [TypeScript no produto; Python em análise e medição; o Postgres é o contrato](ADR-007-linguagem-do-motor.md) | Accepted (2026-10-10) |
| ADR-008 | [O documento mestre (repo `menlo`) é a fonte de verdade da documentação](ADR-008-documento-mestre-fonte-de-verdade.md) | Accepted (2026-10-10) |
| ADR-009 | [Migração 0.3 (contrato e elegibilidade de superfície, ciclo de vida de localidade, padrão de conhecimento)](ADR-009-migracao-0.3.md) | Accepted (2026-10-10) |
| ADR-010 | [O Python roda no agendador do repositório (GitHub Actions)](ADR-010-onde-o-python-roda.md) | Accepted (2026-10-10); falta montar |
| ADR-011 | [Fonte de verdade do esquema do banco](ADR-011-fonte-do-esquema.md): SQL escrito à mão é a autoridade; Drizzle só tipa o acesso | ACCEPTED (2026-10-11; confirmado pelo dono do produto no chat em 2026-10-12); scaffold alinhado na Fase 3; runner de migrations pendente |
| ADR-012 | [Versão do Node.js](ADR-012-versao-do-node.md): Node 24 LTS | ACCEPTED (2026-10-11; confirmado pelo dono do produto no chat em 2026-10-12); `.nvmrc`, `engines` e CI alinhados na Fase 3 |
| ADR-013 | [Papéis de banco, privilégios de migration e fronteira de confiança do tenant](ADR-013-papeis-privilegios-e-confianca-de-tenant.md): aplicação, migrator e administrador separados; tenant por A endurecida | PARCIALMENTE ACEITO (2026-10-12): itens 1 a 3 (taxonomia de papéis, opção A endurecida, sem dados de tenant em migrations) aprovados pelo dono do produto no chat; itens 4 a 7 em aberto, o restante PROPOSED; correções de ledger, lock e catálogo (Fase 6), bootstrap de papéis e gate de segurança transacional (Fase 7) implementados e testados só em ambiente descartável; papéis de produção e Neon pendentes |
| ADR-014 | [Primeira fatia do esquema de produto (`tenant` e `opportunity`)](ADR-014-primeira-fatia-tenant-e-opportunity.md): duas migrations, RLS forçada, API tipada sobre `withTenant`, sem ligar a tela ao banco | PARCIALMENTE ACEITO (2026-10-12): decisões 1 a 3 aprovadas pelo dono no chat; banco do produto (4) e autenticação (5) em aberto; implementado só em cluster descartável |
| ADR-015 | [Autenticação com Supabase e origem da associação usuário↔tenant](ADR-015-autenticacao-com-supabase.md): verificação de JWT no servidor; Neon para o banco (recomendado); claim assinada ou tabela de associação | PARCIALMENTE ACEITO (2026-10-12): Neon, opção A e `jose` aprovados pelo dono; autenticador de servidor implementado e testado sem rede; login pelo cliente Next verificado contra um Supabase real, localmente e no deploy da Vercel; claim de tenants e autenticador contra token real ainda não |
| ADR-016 | [Dados do Search Console como primeira fonte real](ADR-016-dados-do-search-console.md): tabelas `search_*` genéricas, papel de carga estreito, carregador reescrito para o esquema `plataforma` | PROPOSED (2026-10-12): RE/MAX como tenant piloto indicada pelo dono; nada aprovado nem implementado |
| ADR-017 | [Ingestão em lote e a primeira entidade (cidade)](ADR-017-ingestao-em-lote-e-cidades.md): `import_run`, `import_record` imutável e `city`, com origem real/teste/manual e dado do IBGE | ACCEPTED (2026-10-12): IBGE escolhido pelo dono; modelo, regras, tenant `remax` e limite aprovados |
| ADR-018 | [Acesso a dados no servidor do Next e a tela Fluxo de dados](ADR-018-acesso-a-dados-no-servidor-do-web.md): módulo só de servidor, identidade verificada, pool `menlo_app`, tela real sem fallback fictício | PROPOSED (2026-10-12): implementação local autorizada |
| ADR-019 | [Template de página de cidade](ADR-019-template-de-pagina-de-cidade.md): código versionado, fatos rastreáveis derivados de `city` e `import_run`, regras de URL, título, meta, headings e links, risco de conteúdo raso | ACCEPTED (2026-10-12): URL e risco aprovados pelo dono |
| ADR-020 | [Geração de páginas em lote, histórico por versão e gates](ADR-020-geracao-em-lote-e-gates.md): `generation_run`, `generation_item`, `page`, `page_version`; seis gates com resultado próprio; reprocessar sem duplicar nem perder histórico | ACCEPTED (2026-10-13): cinco decisões do dono registradas; piloto = 20 maiores cidades de SP |
| ADR-021 | [Contratos do conhecimento e tempo bi-temporal (Fatia 1)](ADR-021-contratos-do-conhecimento-e-tempo-bitemporal.md): estados epistemológicos, proveniência em dimensões, repositório bi-temporal de referência em memória | ACCEPTED para a Fatia 1 (2026-10-13); persistência exige ADR próprio |
| ADR-022 | [Área Geração de páginas, segurança das execuções e ambiente local](ADR-022-area-de-geracao-e-ambiente-local.md): uma execução por tenant (0007), recuperação de abandonadas, escopo validado, área `/generation`, socket local fora de produção, `pnpm dev:local` | ACCEPTED (2026-10-13): implementado sob a diretiva do dono |
| ADR-035 | [Ahrefs como provedor externo complementar](ADR-035-ahrefs-como-provedor-complementar.md): adapter desativável, custo em unidades com teto por execução, sem substituir fontes; não validado contra a API real | Proposed |
| ADR-036 | [Oportunidades reais na interface](ADR-036-oportunidades-reais-na-interface.md): `/opportunities` lê `plataforma.opportunity` por `withTenant`; demo só sem login/banco, com aviso; só muda o status (transição revalidada no servidor); sem nota | Proposed |
| ADR-037 | [Fluxo vivo de geração (React Flow) e imagem OG](ADR-037-fluxo-vivo-de-geracao.md): definição × execução, status só de registros reais, decisão por contagem de gates (sem nota), ao vivo só com execução em andamento, OG com next/og; não verificado com banco real | Proposed |
| ADR-038 | [Relatórios a partir de export do Search Console](ADR-038-relatorios-a-partir-de-export-do-search-console.md): snapshot agregado em arquivo local fora do Git, amarrado a um tenant, estado "Importado", cobertura sempre visível, sem banco (PROPOSED) | Proposed |
| ADR-039 | [Conexão ao Search Console por OAuth próprio](ADR-039-oauth-proprio-do-search-console.md): escopo somente leitura, token cifrado só no servidor, uma conexão por tenant e propriedade, auditável e revogável; só texto, depende dos ADR-013 e 016 | Proposed |
| ADR-040 | [Catálogo de blocos e renderizador das páginas publicadas](ADR-040-catalogo-de-blocos-das-paginas-publicadas.md): seis blocos fechados, conversão pura sem texto novo, validação que falha fechada, tokens do site com contraste testado, responsivo por contêiner (PROPOSED) | Proposed |

Os textos completos de 007 a 010 estão neste diretório; os de 001 a 006 ainda não foram escritos como arquivos; o índice acima é copiado de `menlo/docs/menlo-os/11-decisoes.md`.
