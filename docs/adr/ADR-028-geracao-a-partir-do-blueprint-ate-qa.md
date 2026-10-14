# ADR-028: Geração a partir do blueprint até QA, ligação oportunidade-página e publicação bloqueada no banco

**Status:** ACCEPTED (2026-10-14) por pedido expresso do dono (Unidade 2, incremento D). A migration `0012` foi aplicada **somente em Postgres descartável**.

## Contexto
O blueprint (ADR-024) e o rascunho do editor (ADR-026) descreviam a página, mas não alimentavam o pipeline de geração (`/generation`, ADR-020). O dono exige reuso (sem pipeline paralelo), os seis gates visíveis, ciclo de vida executável só até QA e nenhuma publicação ou indexação.

## Decisão
1. **Um único pipeline.** `generateFromBlueprint` (packages/api) usa o blueprint mais recente e, se existir e for válido, o rascunho salvo para escolher template, seções e links, e chama `runGeneration` (render + 6 gates, páginas `draft`, versões imutáveis, idempotência por hash). `GenerationInput` ganhou `linkCandidates` opcional; nada mais mudou no pipeline.
2. **Pré-condições explícitas** (todas reportadas, nada gravado se faltar): estado `blueprinted` ou posterior; blueprint pronto; template existente no registro (senão `template_gap`); cidade real com fatos de importação real; rascunho salvo válido e gerável.
3. **Ciclo de vida até QA, passo a passo, com evento por transição**: `data_assembled` (fatos reais com origem) → `evidence_validated` (blueprint sem gate reprovado) → `experience_built` (a geração avaliou a página) → `qa` (os 6 gates da página foram avaliados). Gate reprovado leva a `qa` com os motivos (evento `blocker`; nenhuma versão é gravada), nunca adiante. Falha de execução (erro) interrompe no último estado alcançado.
4. **Ligação `opportunity_page`** (migration 0012, insert-only, RLS): oportunidade ↔ blueprint ↔ rascunho ↔ execução de geração ↔ página/versão, com os 6 gates da página e `qa_passed`. É o que a tela "Rascunho da página" lista.
5. **Publicação bloqueada em três camadas.** (a) `assertExecutable` no motor recusa qualquer destino de `PUBLICATION_STATES` (`published` … `refreshed`) mesmo sendo uma aresta do modelo; (b) a tabela de transições continua descrevendo o ciclo completo (contrato); (c) o gatilho `growth_opportunity_guard` do banco recusa essas entradas por qualquer caminho, inclusive SQL direto. Quando houver mecanismo real de publicação, uma migration própria troca (c).
6. **Edição do rascunho** passa a ser permitida de `blueprinted` até `qa` (refazer a página a partir de um rascunho novo).

## Alternativas rejeitadas
- Gerar sem o blueprint (como o lote de `/generation`): perderia a justificativa por dados e o gate de blueprint.
- Marcar `qa` só quando aprovado: esconderia o motivo da reprovação; o brief pede QA com motivos.
- Bloquear só na aplicação: um `UPDATE` direto contornaria; por isso o gatilho.

## Consequências
- `Gerar de novo` com o mesmo conteúdo é `unchanged` e não cria estado, versão nem transição.
- A UI não tem botão de publicar; o estado `qa` aprovado não autoriza publicação (regras 5 e 9 continuam valendo).
