# ADR-029: Camada de dados do motor de páginas: entidade, fato bi-temporal, política versionada e catálogo de atributos

**Status:** ACCEPTED (2026-10-14), Incremento 1 da especificação "AI-Native Programmatic SEO Platform" (ver `docs/reuse-map.md`). A migration `0013` foi aplicada **somente em Postgres descartável**.

## Decisões de alinhamento com a especificação (confirmadas com "continue" às propostas do mapa)
1. **Nota composta × gates:** os gates e pisos são a autoridade da elegibilidade; o total ponderado só ordena; os limiares 75/60 serão política versionada aplicada depois dos gates (Incremento 4).
2. **Estados:** a máquina de 19 estados (ADR-023/028) não é trocada; os estados da especificação entram como campo `decision` (Incremento 4). Pós-QA continua bloqueado.
3. **Registro de decisões:** `docs/adr/` (regra 6 do projeto), não `docs/decisions/`.
4. **Pilot:** só o que tem dado real avança; o nível município (IBGE de SP) é o único com dados hoje. Curitiba, bairros, POIs e anúncios aguardam fonte (R12).

## Decisão técnica
- **`entity`** genérica (`entity_type`, chave estável da fonte, aliases, pais, ids externos, `resolution_confidence`, `status`). Única por (tipo, chave da fonte). Só `status`, aliases, confiança de resolução e pais podem mudar.
- **`fact`** (R1): `value`, `unit`, fonte (nome obrigatório, URL, licença), `observed_at` com **precisão** (`day|month|year`, para fontes que só informam o ano), `ingested_at`, `confidence`, precisão geoespacial e a origem (`import_run_id` ou `provider_call_id`). **Bi-temporal e append-only:** no máximo uma versão corrente por (entidade, atributo); corrigir um fato fecha a versão antiga (`superseded_at`, a única mutação, uma vez, por gatilho) e insere a nova. Valor ausente **não** é gravado (R12). Reverter a um valor antigo é permitido (nova linha).
- **`policy`** versionada por tenant (`kind`, `version`, hash): a política de descoberta (cobertura mínima para VALID/PARTIAL, confiança mínima) mora aqui, nunca no código. A versão 1 nasce do padrão do pack.
- **`catalog_run` + `attribute_catalog`**: o Attribute Discovery é uma **função pura** (`catalog/discovery.ts`) sobre os fatos correntes e as definições **declaradas pelo pack**. Mede cobertura, frescor (o fato mais antigo manda), confiança média, distribuição (numérica ou categórica) e classifica em `VALID|PARTIAL|DATA_PENDING|INVALID`. **Cobertura `NULL`** = não existem entidades do tipo (nada a medir); **0** = existem entidades e nenhuma tem o atributo. Atributo `INFERRED` nunca é usável como fato de página. Idempotente por hash (mesmos fatos + política + dia).
- **Nada factual é criado para ampliar o universo de páginas:** só atributos declarados são medidos; o que não tem dado é `DATA_PENDING`.
- **Confiança dos fatos** = qualidade da fonte **declarada pelo pack** para o atributo (valores iniciais calibráveis); atributo sem qualidade declarada recebe 0.
- **Núcleo genérico:** `packages/api/src/catalog` não cita o domínio imobiliário (teste de regra 10); o pack declara `city`, `neighborhood`, `listing` e seus atributos. Um pack fictício de "restaurantes" é usado nos testes do núcleo.
- **Fontes materializadas hoje:** importação real do IBGE (`city`) e SIDRA (Censo 2022), com a resposta bruta ligada (`provider_call`). Importações de teste, manuais, em andamento ou com falha nunca viram fato.

## Alternativas rejeitadas
- Gravar fatos como colunas de `city`: não generaliza para bairro, POI e anúncio e perde proveniência e histórico.
- Reaproveitar `evidence`: é notícia/indicador com tema, não fato por atributo de entidade.
- `UNIQUE` por conteúdo do fato: impediria reverter um valor corrigido; a unicidade é só da versão corrente.

## Consequências
- O relatório de lacunas ordena o que destravaria mais famílias de página; hoje o piloto real mostra: UF, região e população VALID (645/645); Censo 2022 com 20/645 (3,1%, DATA_PENDING); tudo de bairro/anúncio DATA_PENDING.
- O Incremento 2 (Topic) usa `data_available`/`data_missing` calculados deste catálogo.
