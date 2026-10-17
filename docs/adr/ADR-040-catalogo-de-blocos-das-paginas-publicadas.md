# ADR-040: Catálogo de blocos e renderizador das páginas publicadas (design system do site)

**Status:** PROPOSED (2026-10-17). Implementado só em código local, com testes de unidade e verificação visual na prévia de desenvolvimento. **Nada foi publicado, nenhum banco foi acessado e nenhuma migration foi criada.**

## Contexto

- O motor de páginas (ADR-019) gera um `RenderedPage` estruturado e puro: título, descrição, h1, seções, links e os fatos usados, cada um com fonte e validade. A prévia atual o mostra como um artigo simples, sem tokens, sem blocos e sem verificação do que é exibido.
- Um design system do **produto** (Menlo AIB) já existe. O **site publicado** é outra coisa: precisa de consistência, acessibilidade e desempenho entre milhares de páginas, e de um conjunto fechado de peças que o QA consiga verificar.
- Regras que valem: fatos nunca vêm de LLM, e número só entra por token ligado a um fato com fonte (regra 1); nada é publicado sem passar nos gates (regra 5); núcleo genérico (regra 10).

## Decisão

1. **Catálogo fechado de blocos**: `hero`, `breadcrumb`, `prose`, `facts`, `links` e `sources`. Um bloco desconhecido é **recusado**; não existe bloco de HTML livre.
2. **Conversão pura** `RenderedPage → PageBlock[]` (`packages/api/src/pages/blocks.ts`): sem E/S, sem LLM, sem texto novo. Todo parágrafo da página aparece **exatamente uma vez** nos blocos; o renderizador não acrescenta frase nenhuma, só rótulos fixos (por exemplo "Dados da cidade").
3. **Validação que falha fechada** antes de exibir: um único `hero` e primeiro; tipos do catálogo; texto sem marcação (`<` e `>` recusados); cada linha de `facts` exige fonte e id do fato; caminhos de link começam por `/`. Se falhar, a prévia mostra o motivo em vez da página.
4. **Tokens do site em um só lugar** (`SITE_TOKENS`), separados dos tokens do produto, com **contraste conferido por teste** (WCAG 2.1 AA, 4,5:1 para texto normal).
5. **Responsivo por contêiner**, não por janela: o bloco reage à largura do quadro onde está. Assim a alternância Desktop/Celular da prévia mostra o layout de verdade.
6. Na prévia, links não navegam (o destino ainda não existe publicado): aparecem como texto com o caminho. O modo `live` existe para o site real.

## Alternativas rejeitadas

- **HTML ou CSS gerado por LLM:** viola a regra 1, não é verificável e não é determinístico.
- **Reaproveitar os componentes do produto no site:** acopla o site às telas internas e aos tokens do painel.
- **Biblioteca de componentes externa agora:** peso e dependência sem necessidade para seis blocos.

## Consequências e limites

- Cobre o template `city-overview` (cidade). Comparação e bairro precisam de blocos próprios (tabela comparativa, tipologia) e dados que ainda não existem de forma real.
- **Não cobre:** dados estruturados (JSON-LD), renderização HTML para publicação, mapa do site, `noindex` por ambiente e medição de desempenho. A prévia **não é** a renderização de publicação.
- Verificação de acessibilidade é de contraste e de estrutura (um h1, ordem de títulos). Leitor de tela e navegação por teclado reais não foram testados.
