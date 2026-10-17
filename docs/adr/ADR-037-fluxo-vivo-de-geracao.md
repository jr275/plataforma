# ADR-037: Fluxo vivo de geração (React Flow) e imagem OG

**Status:** PROPOSED (2026-10-15). Implementado só em código local, com testes de unidade e verificação visual na fixture de desenvolvimento. **Não verificado contra um banco real**: nenhum banco foi acessado e nenhuma migration foi criada.

## Contexto

- A área Geração de páginas mostra o resultado (páginas, gates, execuções) em tabelas, mas não o **caminho**: de onde vêm os fatos, qual receita foi aplicada, quais gates passaram, por que a decisão foi aquela e o que vem depois.
- Referências do dono do produto (vídeos do Stitch e do React Flow, o time de agentes com nó de decisão, a documentação de Vercel OG e o site da Palantir): páginas que se materializam num canvas, arestas tracejadas para um nó de saída, nó de decisão com anel de contagem e cards grandes com o canto cortado.
- Regras que valem aqui: nada de nota composta (regra 5, ADR-002); fatos nunca inventados (regra 1); a publicação (etapa 5) ainda não existe.

## Decisão

1. **React Flow (`@xyflow/react` 12.12.0, MIT, versão exata).** Única dependência nova (traz `d3-*`, `zustand` e `classcat`). Compatível com React 19; a atribuição da biblioteca é mantida.
2. **Definição ≠ execução.** `components/generation/flow-model.ts` monta, por funções puras, a DEFINIÇÃO (etapas e ligações, ids estáveis) e o ESTADO de cada etapa a partir de registros reais (página, versões, gates, execução, itens). Nenhum status, duração, contagem ou progresso é inventado. A etapa sem capacidade no backend aparece como **"Não implementada"** (publicação, indexação e desempenho, aprendizado) e a que esta geração não usa como **"Não usada"** (Search Intelligence e Opportunity Engine), sempre com o motivo.
3. **Decisão = contagem de gates, não nota.** O juiz mostra "PASS · 6 de 6 gates" ou "FAIL · N gates reprovaram", com o motivo de cada gate. Não existe juiz de IA, "revisão necessária" por pontuação nem score composto. Aprovar (gates) e publicar (inexistente) são etapas separadas.
4. **Ao vivo só quando é real.** A execução em andamento é reconsultada no servidor a cada 3 s (`router.refresh`), com a aba visível; para sozinha quando a execução fecha. Nada é animado por conta própria. A tela diz **AO VIVO** só com a execução `running` e **REGISTRO** nos demais casos. Um *replay* só existe na fixture de desenvolvimento, rotulado.
5. **Atualização sem recriar o grafo.** O React Flow é chaveado pelo id da definição; atualizações trocam só o estado dos nós (viewport, zoom e seleção preservados). Posição, zoom e seleção sobrevivem às atualizações (verificado no navegador).
6. **Imagem OG com `next/og` (Vercel OG, título dinâmico).** `GET /generation/pages/[id]/og` lê a página por `withTenant` (RLS); sem sessão, sem tenant ou página de outro workspace a resposta é a mesma 404. É só uma prévia (`Cache-Control: private, no-store`): não é guardada nem publicada.
7. **Visual.** O fluxo **inteiro** cabe na abertura: layout em bandas (cards de 320 × 208 px, um só tamanho; coluna a cada 380 px, linha a cada 300 px) com ligações em ângulo reto (testes impedem sobreposição e limitam o conjunto a 6 colunas × 6 linhas). **Tema claro ("Claro", padrão)**, com a pegada da Palantir: fundo lavanda, cards só de contorno fino, rótulos em caixa alta e pontos de estado; **tema escuro** disponível num botão, com a nova paleta (tokens `--flow-*` **aditivos**; nenhum token existente muda e o layout azul/lavanda do resto do produto continua). Fontes quadradas só no fluxo (títulos em Space Grotesk, rótulos em Chakra Petch), por tokens `--font-flow` e `--font-flow-label`.
8. **Nome do produto: Menlo AIB**, na fonte única `config/brand.ts` (título da aba e marca lateral).

## Alternativas rejeitadas

- **Grafo decorativo com todas as etapas "concluídas":** viola a regra de não inventar status.
- **Nota composta no juiz (anel de confiança como nas referências):** viola a regra 5; o anel mostra a contagem real de gates aprovados.
- **SSE ou WebSocket agora:** o transporte do projeto é a consulta ao banco; a atualização por reconsulta é a menor mudança compatível.
- **Restilizar todo o produto de uma vez:** vários assuntos num só PR e risco para o layout aprovado.

## Consequências

- Para ver dados reais é preciso o ambiente completo (banco, login, claim do tenant e dados), como nas demais telas reais. **Nada disso foi verificado aqui**; a verificação visual usa `/dev/preview` (fixture com o motor e os gates reais; 404 em produção).
- Estados que o backend ainda não registra por página (normalização por item, durações, tokens) **não aparecem**. Quando o backend os registrar, entram na definição sem mudar o contrato.
- A seleção de tenant segue a regra vigente de `loadForTenant` (achado F2 tratado em outra branch).
- **Decisão do dono (2026-10-15): o novo visual vale para o produto inteiro.** Aplicado na base: `--font-sans` em Space Grotesk e `--font-mono` (rótulos) em Chakra Petch; bordas do tema claro mais firmes; `.card-cut` (card grande com o canto superior direito cortado e borda em sombra interna) no `Panel` e nas demais superfícies de card; títulos de página e números de destaque maiores. O tema escuro mantém as cores, com as novas fontes. O layout azul/lavanda antigo deixa de ser a referência visual. Verificado: as 36 rotas estáticas respondem HTTP 200 sem erro; conferência visual da Overview, de Opportunity Discovery e de Blueprints; **as demais telas só foram conferidas por resposta HTTP, não visualmente**.
