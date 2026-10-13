# ADR-019: Template de página de cidade (versionado, executável, só com fatos rastreáveis)

**Status:** PROPOSED (2026-10-12). Aguarda as decisões do dono do produto ao final. Nada aqui está implementado.

## Contexto
- Etapa 3 do MVP (critérios do dono, `docs/audits/MVP_BASELINE_2026-10-12.md`): template **executável, com versão, campos documentados, sem preenchimento fictício**; **duas cidades com conteúdo factual diferente**; regras explícitas para **título, meta, headings, URL e links**; **atualização sem duplicar URL**.
- Regra 1 do projeto: fato nunca é gerado por LLM; número em texto só existe como token `{{fact:id}}` ligado a um fato com **fonte, confiança e validade**. Regra 10: o núcleo é genérico (nada de imóvel fora de `packs/real-estate`).
- **Dado disponível hoje** (ADR-017, verificado): para cada cidade do tenant, `ibge_code`, nome, UF, região e população estimada com ano, mais a execução de origem (`import_run`: fonte, sha256, horário, origem real/teste/manual). **Não existe** nenhum dado de mercado imobiliário (preços, anúncios, bairros). O Search Console não fornece fatos de cidade (hipótese H2).
- **Verificado nos 5.571 municípios do IBGE (2026-10-12):** nenhum `(UF, slug do nome)` se repete; 240 slugs se repetem entre UFs diferentes (então a UF precisa estar na URL); o maior nome tem 32 caracteres; todos têm população.

## Decisão proposta

### 1. O template é código versionado, não tabela
Um objeto tipado em `packages/api/src/pages/` (`city-overview`), com `key`, `version` (inteiro), `hash` (sha256 da definição) e a lista documentada de **campos** que consome. Cada página gerada registra `template_key`, `template_version` e `template_hash` (reprodutível: mesma versão + mesmos fatos = mesmo resultado, bit a bit). Mudar o texto exige nova versão por PR. Não há tabela de templates nesta etapa: customização por tenant é decisão futura (novo ADR). Evita-se uma superfície nova de escrita sem necessidade.

### 2. Fatos derivados das tabelas existentes (sem tabela nova)
Uma função pura transforma `city` + `import_run` em `Fact[]`: `{ id, key, value, unit, source: { name, runId, retrievedAt, sha256 }, asOf (ano), confidence }`. Confiança: `high` só se `origin = real`; execuções `test` e `manual` **não** geram páginas publicáveis (o render recusa, a menos de modo de prévia explícito). Fato ausente = campo ausente: **nunca** valor padrão nem texto inventado.

### 3. Renderização pura e determinística
`renderCityPage(template, facts, context) → RenderedPage` (sem rede, sem relógio, sem LLM): `path`, `title`, `metaDescription`, `h1`, `sections[]` (cada uma com `heading`, parágrafos e os `factIds` usados), `links[]`, `factsUsed[]`, `template {key, version, hash}`. O resultado é dado estruturado; HTML e JSON-LD são etapas posteriores (publicação).

### 4. Regras explícitas
| Elemento | Regra |
| --- | --- |
| **URL** | `/cidades/{uf-minúsculo}/{slug}`; `slug` = nome sem acentos, minúsculo, hífens. Único por tenant (verificado por gate, etapa 4). Determinística: a mesma cidade gera sempre a mesma URL; reprocessar **atualiza**, não cria. Limite conhecido: se o IBGE renomear um município, a URL muda; o tratamento (redirecionamento) fica para a etapa 5. |
| **Título** | `{Nome} ({UF}): população e localização`, no máximo 60 caracteres; se passar, cai para `{Nome} ({UF})`. |
| **Meta descrição** | Frase fixa com nome, UF, região e, **se existir**, a população com o ano de referência; 70 a 155 caracteres. Sem população, a frase omite esse trecho. |
| **Headings** | Um `h1` (`{Nome}, {UF}`) e `h2` fixos e na mesma ordem: "Visão geral", "População" (só se há população), "Localização", "Fonte dos dados". |
| **Texto** | Frases fixas em pt-BR. **Nenhum algarismo no texto literal do template** (o validador do template recusa); todo número entra por token `{{fact:chave}}`, formatado em pt-BR. |
| **Links internos** | Só para caminhos que o chamador informa como existentes (por exemplo o hub da UF); o render **nunca** produz link para destino desconhecido. Sem destino, sem link. |
| **Proveniência** | A seção "Fonte dos dados" lista cada fato usado com fonte, ano e data da coleta. |

### 5. Campos do template (contrato documentado)
Obrigatórios para renderizar: `name`, `uf`, `ibge_code`. Opcionais: `region`, `population`, `population_year`. Cada seção declara de quais campos depende; sem eles, a seção sai (não fica vazia). Uma cidade sem os obrigatórios **não renderiza** e o motivo é devolvido.

### 6. Prova esperada (testes)
Duas cidades reais distintas geram títulos, metas, textos e fatos diferentes; mesma entrada gera saída idêntica (hash estável); cidade sem população omite as seções dependentes sem inventar; execução `test` é recusada; número no texto literal do template é recusado; link para destino desconhecido não é emitido; reprocessar mantém a URL.

## Alternativas rejeitadas
- **Template em tabela por tenant agora:** abre escrita e versionamento antes de haver necessidade; o mínimo que cumpre os critérios é código versionado.
- **Texto redigido por LLM:** viola a regra 1 e a imutabilidade dos fatos; fica fora do MVP.
- **Tabela `fact` própria:** duplica `city`/`import_run`; só se justifica quando houver fatos de várias fontes (Search Console, anúncios).

## Riscos e limites (sem rodeio)
- **Conteúdo raso.** Com só dados do IBGE, as páginas diferem apenas por nome, UF, região e população. Publicar milhares delas **é risco real de conteúdo fino/duplicado** para os buscadores. Este ADR entrega o **mecanismo correto e rastreável**; a **qualidade editorial** depende de fatos mais ricos (por exemplo, dados de imóveis da RE/MAX, com autorização) que ainda não existem. O gate da etapa 4 deve exigir um mínimo de fatos distintos por página, e o primeiro lote deve ser pequeno (10 a 20 cidades) até haver dado melhor.
- **Termos de imóvel.** Nada de imobiliário no núcleo; a camada de imóveis entra depois como pack.

## Decisões necessárias do dono do produto
1. Aprovar template como código versionado (sem tabela nova) e fatos derivados de `city` + `import_run`.
2. Aprovar o padrão de URL `/cidades/{uf}/{slug}` (ou indicar o que o site da RE/MAX já usa).
3. Aprovar as regras de título, meta e headings acima (ou ajustar os limites e a redação).
4. Aceitar explicitamente o risco de conteúdo raso no piloto, com lote inicial pequeno, até haver fatos mais ricos.
5. Informar o **domínio** e o prefixo de URL do site onde as páginas serão publicadas (necessário para canonical e sitemap na etapa 5; não bloqueia esta etapa).
