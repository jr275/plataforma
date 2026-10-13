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

Os textos completos de 007 a 010 estão neste diretório; os de 001 a 006 ainda não foram escritos como arquivos; o índice acima é copiado de `menlo/docs/menlo-os/11-decisoes.md`.
