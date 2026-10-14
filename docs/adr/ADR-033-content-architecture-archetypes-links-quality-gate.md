# ADR-033: Content Architecture — archetypes, grafo de links e Quality Gate de arquitetura

Status: aceita (implementada e verificada contra o esquema real; nenhum deploy, publicação em produção ou push foi feito).

## Contexto
Entre a oportunidade e a publicação faltava uma camada que dissesse, por página, QUAL contrato ela cumpre, a que cluster pertence, quem linka para ela e se pode ser aprovada, publicada ou indexada. Cadeia adotada: Knowledge Graph → Search Intent → Topic Cluster → Page Archetype → Template Contract → Page Recipe → Internal Linking Graph → Quality Gates → Aprovação → Publicação → Monitoramento de indexação.

## Decisões
1. **Núcleo agnóstico de domínio** (`packages/api/src/architecture`): 12 archetypes T01–T12 como contratos configuráveis (schema zod, requisitos por nível, perfil de densidade versionado, regras de links, regra de canonical, tipos JSON-LD obrigatórios/opcionais/condicionais). T03 (cidade) é a referência; o acoplamento ao imobiliário fica no pack (`packs/real-estate/src/architecture.ts`: família → archetype, adaptação de dados, domínio, locale).
2. **Validação em 5 camadas** com resultado estruturado (VALID / VALID_WITH_WARNINGS / DATA_PENDING / INVALID, score, `isValidForGeneration`, `isValidForIndexing`, problemas, avisos, dados ausentes, regras reprovadas). Só dado com proveniência conta; o mínimo de síntese é o do perfil do archetype (reconciliado em 100 caracteres no perfil T03).
3. **Perfis de densidade por archetype e tenant**, versionados na tabela `policy` (`archetype_profiles`): pesos somam 1, limiar em (0,1], sinais conhecidos. Reverter a um perfil/política anterior cria uma versão NOVA e vigente (`_supersedes`/`supersedes`), porque `savePolicyVersion` reaproveitaria a versão antiga idêntica e deixaria a vigente errada.
4. **Grafo de links internos** compilado dos recipes: arestas VALID/INVALID com motivo (SELF_LINK, DUPLICATE, DESTINATION_MISSING, NON_CANONICAL_DESTINATION, CONFLICTING_CANONICAL, SOURCE_INELIGIBLE, RELATION_NOT_ALLOWED, FORBIDDEN_DESTINATION). **Mínimo padrão de 3 inlinks contextuais válidos**, configurável por tenant/archetype; exceção só explícita (escopo, justificativa, responsável, data), registrada no resultado; falha = `INSUFFICIENT_CONTEXTUAL_INLINKS`.
5. **Canibalização**: diagnóstico de intenção/URL com ação recomendada; conflito rígido bloqueia, sinal só avisa.
6. **Quality Gate de 10 passos** (`gate.ts`), persistido em `quality_gate_result` (histórico imutável, CHECK `indexar ⊆ publicar ⊆ aprovar`). Elegibilidades de aprovação, publicação e indexação são separadas; **indexação observada** é outra coisa (`indexation_observation`, só com evidência de fonte) e nunca altera elegibilidade. Idempotência: um novo resultado só é gravado se o hash de entrada difere do resultado MAIS RECENTE da receita (voltar a um estado antigo grava registro novo; o "atual" nunca fica preso a um resultado velho).
7. **JSON-LD por archetype** gerado e validado; nunca inventa `AggregateOffer` nem campos sem dado.
8. **Integração**: passo `architecture` no pipeline (reprovação de aprovação → BLOCKED com o motivo); aprovação, deployment e produção recusam página sem elegibilidade; 23 etapas calculadas dos registros (16 originais + 7 do gate); métricas novas; lista de páginas com filtros (archetype, cluster, elegibilidade, falha de links, conflito).
9. **Migration 0021**: `topic_cluster`, `page_architecture`, `link_graph`, `link_edge`, `quality_gate_result`, `indexation_observation`; RLS forçado, SELECT/INSERT apenas.

## Achados honestos (dados reais de SP)
- As páginas reais de cidade **não são indexáveis hoje**: faltam POIs, estações, FAQs e coordenadas (densidade 0,3 contra 0,75); a BreadcrumbList aponta para hubs que não existem; a política do blueprint é `noindex`. O gate mostra isso, não o esconde.
- A compilação do recipe descarta links para caminhos desconhecidos e trata `/cidades` como conhecido sem ser uma página (4 arestas DESTINATION_MISSING).

## Limites
- Indexação só é registrada por observação manual/fonte; não há Search Console.
- Os archetypes T01–T02 e T04–T12 existem como contratos e são testados sem dados reais; apenas T03 tem adaptador de pack.
- UI dedicada (/engine/topics, detalhe com inlinks/outlinks) ainda não foi construída: os dados e filtros estão na API e na lista de páginas.
