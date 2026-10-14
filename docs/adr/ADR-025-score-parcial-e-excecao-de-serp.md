# ADR-025: Score parcial exploratório e exceção escrita da etapa SERP

**Status:** ACCEPTED (2026-10-14) por decisão do dono (pedido "Próxima fase: interface real, decisões de produto e fluxo operacional completo"). Refina, sem apagar, o ADR-014, o ADR-023 (seção 6) e o ADR-024 (item 5). A migration `0009` e a `0008` seguem **não aplicadas** no Neon.

## Divergências encontradas e como foram resolvidas
| Tema | Antes | Decisão do dono | Resolução |
|---|---|---|---|
| Nota composta (ADR-014: "proibida") | ADR-023 a revogou só para priorização, com pedido de confirmação | **Confirmada**, como ordenação exploratória | O ADR-014 permanece como histórico; vale o ADR-023 + este ADR. Nenhum gate usa a nota (regra 5 intacta). |
| `eligible → blueprinted` (ADR-024 item 5) | A criação do blueprint avançava a oportunidade sozinha, com motivo gerado pelo sistema | Só **por exceção explícita**, com motivo, autor e horário | O blueprint não avança mais de "elegível". `applySerpWaiver` exige blueprint pronto, motivo (10 a 1000 caracteres) e confirmação; o motivo é escrito pela pessoa. |
| Revisão da exceção | Não prevista | Revisável quando houver provedor | A exceção fica vigente até a oportunidade passar por "SERP analisada"; roadmap e telas mostram a pendência. |

## Decisão
1. **Score parcial**: ordena a leitura. Sempre exibido com cobertura (objetivos calculados, dimensões conhecidas/15, confiança), dimensões desconhecidas, limitações e justificativa. Ausência de dado nunca é evidência negativa. Não substitui os seis gates nem a elegibilidade. Scores de cobertura diferente não são equivalentes: a lista avisa quando mistura coberturas e o histórico mostra as dimensões conhecidas de cada cálculo. A configuração e o histórico da fórmula continuam por vertical (versões imutáveis).
2. **Exceção de SERP**: transição `eligible → blueprinted` só por `applySerpWaiver`. Grava no evento: autor, horário (do evento), motivo, `serp: not_evaluated`, `reviewable: true`, `authorizesPublication: false`, versão do blueprint. A SERP continua `not_evaluated` no blueprint e nos gates. **Não autoriza publicar**: a decisão de publicação segue bloqueada por mecanismo inexistente (decisão do dono) e saúde do índice desconhecida. Quando houver provedor real, o caminho normal (`serp_analyzed`) encerra a exceção (`reviewed`).
3. **Roadmap**: blueprint pronto e ainda "elegível" não é "pronta para construir": falta a etapa de SERP (`serp_pending`). Com exceção vigente, a oportunidade fica "pronta" **com a pendência `serp_waiver` visível**.
4. **Transições manuais** continuam restritas ao que não afirma trabalho feito (ADR-024 item 8).
5. **Estado das capacidades** (`engine/providers.ts`): implementada e testada, configurada não verificada (só em tempo de execução), aguardando credencial, aguardando decisão de produto, ainda não implementada. Só BCB, notícias do IBGE e RSS são "implementada e testada".

## Consequências
- O motivo da exceção deixa de ser um texto automático: o histórico passa a registrar a justificativa de quem decidiu.
- Existe uma etapa a mais para a pessoa (registrar a exceção), de propósito.
- Vocabulário único de verdade na interface: `live`, `demo`, `derived`, `estimated`, `not_evaluated`, `blocked`, `unavailable`.
