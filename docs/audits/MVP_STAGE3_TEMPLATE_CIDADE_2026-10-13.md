# MVP — Etapa 3: template de cidade

Data: 2026-10-13. Decisão: ADR-019 (ACCEPTED nos pontos 2 e 4; 1 e 3 implementados como propostos). Código: `packages/api/src/pages/city-overview.ts`.

## Fatos verificados (com evidência)
| Critério do dono | Evidência |
| --- | --- |
| Template executável | `renderCityPage(CITY_OVERVIEW, fatos, contexto)`: função pura (sem rede, relógio, banco ou LLM). 18 testes em `city-overview.test.ts`; pacote `api` com 156 testes passando |
| Com versão | `CITY_OVERVIEW.version = 1` e `templateHash` (sha256 da definição) gravados em cada página; trocar o texto muda o hash (teste) |
| Campos documentados | contrato no ADR-019 seção 5 e em `CITY_OVERVIEW.required`/`requires` por parágrafo |
| Sem preenchimento fictício | fato ausente remove a seção; população sem ano não vira fato; o validador do template recusa algarismo no texto literal; teste confere que todo algarismo do texto vem de um fato usado |
| Duas cidades com conteúdo factual diferente | Alta Floresta D'Oeste × Ariquemes: URL, título, meta, texto e fatos diferentes (teste) |
| Regras de título, meta, headings, URL e links | título ≤ 60, meta 70 a 155, `h1` e `h2` fixos, URL `/cidades/{uf}/{slug}`, link só para destino conhecido (testes) |
| Atualização sem duplicar URL | mudar a população muda o `contentHash` e mantém o `path` (teste) |
| Mutação de sanidade | removendo a validação de algarismo e aceitando origem de teste, os testes correspondentes falham; código restaurado e comparado byte a byte |
| **Em escala, com dado real** | rodado offline sobre os 5.571 municípios do IBGE (CSV de 2026-10-12): 5.571 renderizadas, 0 falhas, 5.571 URLs únicas, 5.571 títulos e metas únicos, título máx. 60, meta de 111 a 150 caracteres |

## Simulado ou não provado
- O teste em escala usou o CSV do IBGE **fora do banco** (script descartável, não versionado). As páginas **não foram gravadas** em lugar nenhum e **não foram publicadas**: não há tabela de páginas, HTML, JSON-LD, sitemap nem canonical absoluto (etapas 4 e 5).
- Os links internos só aparecem para caminhos informados pelo chamador; os hubs `/cidades` e `/cidades/{uf}` **ainda não existem**.
- Regras de título e meta são as propostas no ADR; a redação não foi revisada por um especialista de SEO.

## Riscos e lacunas
1. **Conteúdo raso** (aceito pelo dono para o piloto, com lote inicial de 10 a 20 cidades): as páginas só diferem por nome, UF, região e população. Escalar para milhares exige fatos mais ricos (por exemplo, dados de imóveis da RE/MAX, com autorização) e um gate de mínimo de fatos distintos na etapa 4.
2. **Renomeação de município** muda a URL (slug derivado do nome); o redirecionamento fica para a etapa 5.
3. **Domínio** do site e prefixo de URL ainda não informados (necessários para canonical e sitemap).
4. O template ainda é global (um só, em código); customização por tenant exige novo ADR.

## Critérios de aceite
- Atendidos: todos os de template listados acima, com os limites declarados.
- Próximo: Etapa 4 (geração em lote com gates: ≥ 10 registros, execução registrada, repetição sem duplicar, bloqueio só dos inválidos, detecção de URL duplicada, metadado inválido e link quebrado, reprocessamento com histórico). Exige ADR e migrations para páginas geradas e execuções de geração.
