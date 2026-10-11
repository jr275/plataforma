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
| ADR-007 | TypeScript no produto; Python em análise e medição; o Postgres é o contrato | Accepted (2026-10-10) |
| ADR-008 | O documento mestre (repo `menlo`) é a fonte de verdade da documentação | Accepted (2026-10-10) |
| ADR-009 | Migração 0.3 (contrato e elegibilidade de superfície, ciclo de vida de localidade, padrão de conhecimento) | Accepted (2026-10-10) |
| ADR-010 | O Python roda no agendador do repositório (GitHub Actions) | Accepted (2026-10-10); falta montar |

Os textos completos de 001 a 010 ainda não foram escritos como arquivos; o índice acima é copiado de `menlo/docs/menlo-os/11-decisoes.md`.
