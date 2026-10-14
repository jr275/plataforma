# ADR-024: Blueprint de página, registro de templates, gates de experiência e roadmap (Slice C/D)

**Status:** ACCEPTED (2026-10-13) por mandato expresso do dono ("Build the Real SEO + GEO Opportunity Engine"). **Um ponto pede confirmação do dono** (⚠): a dispensa registrada da etapa SERP no ciclo de vida. A migration `0009` **não foi aplicada** no Neon.

## Contexto
O ADR-023 entrega oportunidades pontuadas e elegíveis, mas "iniciar a execução" ainda era só mudar de estado. Falta o passo que transforma uma hipótese em um plano de página verificável: qual experiência, qual template, que dados existem, o que bloqueia. Sem provedor de SERP (ADR-023), a etapa `serp_analyzed` não pode ser cumprida de verdade.

## Decisão
1. **Blueprint** (`engine/blueprint.ts`, puro e genérico): derivado só de dados já persistidos (oportunidade, vertical, evidência atual, dados da entidade). Conteúdo: experiência, template selecionado (ou `missing` com o motivo), requisitos de evidência e se foram atendidos, seções do template com a disponibilidade dos dados de cada uma, bloco de resposta direta (GEO), tipos de dados estruturados propostos, caminho (URL) proposto, política de indexação (`noindex` até a publicação, regra 5) e limitações. Determinístico: o mesmo insumo gera o mesmo conteúdo e o mesmo hash.
2. **Registro de templates** (`pages/registry.ts`): o que o sistema REALMENTE sabe gerar (hoje só `city-overview` v1), com seções, fatos exigidos, tipo de entidade, caminho e dados estruturados. A vertical aponta suas experiências para chaves do registro (`servedByTemplates`); experiência sem template é `missing`, nunca "sugerida".
3. **Gates de experiência** (`engine/experience-gates.ts`): seis gates independentes (negócio, conhecimento, experiência, busca, GEO, técnico), cada um com verificações `pass | fail | warning | not_evaluated`. **Sem nota composta** (regra 5). Verificação sem fonte (demanda, SERP, monitoramento de citação em IA, indexabilidade) é `not_evaluated` e aparece como tal; nunca passa por padrão. O blueprint está **pronto** quando nenhum gate reprova.
4. **Persistência** (migration `0009_page_blueprint`): `page_blueprint`, versões imutáveis por oportunidade (RLS forçada; a aplicação só insere e lê), únicas por conteúdo (repetir não cria versão).
5. **Ciclo de vida** ⚠: nova transição `eligible → blueprinted`, a **dispensa da etapa SERP**. Só é usada quando não há provedor de SERP, exige o motivo no histórico e o blueprint grava `search.serp_analysis = not_evaluated`. Com um provedor, o caminho normal (`eligible → serp_analyzed → blueprinted`) continua o recomendado. A tabela de transições é única e o banco a repete (teste 19x19).
6. **Roadmap** (`/roadmap`): leitura derivada, sem tabela própria. Agrupa por prontidão (pronta para construir, bloqueada, elegível sem blueprint, a medir) e **soma os bloqueios** (ex.: "7 oportunidades dependem do template `guide`"). Ordena por prioridade (parcial, rotulada).

7. **Fontes bloqueadas (Slices B e E)**: `engine/providers.ts` fixa os contratos (`SerpProvider`, `AiCitationMonitor`) e o registro `BLOCKED_CAPABILITIES` (demanda, Search Console, SERP, concorrentes, citações em IA, conversão), cada um com a dependência exata e as dimensões do score que passaria a medir. Não há implementação nem simulação. Um teste garante que toda dimensão hoje desconhecida é destravada por alguma capacidade listada (e só elas).
8. **Transições manuais**: só as que não afirmam trabalho feito (aposentar, voltar a "pontuada", reabrir rejeitada). Etapas como SERP, blueprint, dados e publicação são registradas pelo fluxo que as realiza.

> **Refinado pelo ADR-025 (2026-10-14):** o item 5 deixa de ser automático. `eligible → blueprinted` só ocorre por exceção escrita (motivo, autor, horário), revisável e sem autorizar publicação.

## Alternativas rejeitadas
- Gerar o blueprint por LLM: viola a regra 1 e esconde a origem dos fatos.
- Aprovar blueprint com template inexistente "para depois": é exatamente o que o gate de experiência recusa.
- Fingir a análise de SERP para seguir o fluxo: seria dado inventado.

## Consequências
- Hoje quase nenhuma oportunidade fica pronta: só as de `location_overview` (template real) com dados da cidade; as demais mostram o bloqueio exato (template, inventário, editorial). Isso é o retrato real do produto.
- Novos templates entram no registro (com ADR) e passam a atender experiências sem mudar o motor.
- Dados estruturados (JSON-LD) e publicação continuam fora desta fatia: o blueprint só propõe tipos.
