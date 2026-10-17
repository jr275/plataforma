# Diagnóstico de indexação: encontre o primeiro estado que falha

**Regra.** Quando uma URL não aparece, não ranqueia ou perde tráfego, percorra os cinco estados **na ordem** (Descoberta → Busca → Renderização → Índice → Exibição) e pare no **primeiro que falha**. Só então corrija. Rode a matriz **em uma URL** antes de levantar teorias sobre o site inteiro.

Dois limites de prova que evitam diagnósticos errados:
- Um teste de renderização **não prova descoberta**.
- Um relatório de índice **não prova conversão**.

Cada estado tem a sua pergunta e a sua evidência. Evidência de um estado não vale como prova de outro.

## Matriz

| Estado | Pergunta | Evidência observável | Falha típica |
| --- | --- | --- | --- |
| **Descoberta** (Discovery) | O buscador sabe que a URL existe? | Links, relatórios de sitemap, Inspeção de URL | A URL está órfã ou só é exposta por um controle que o rastreador não segue |
| **Busca** (Fetch) | O rastreador consegue pedir e receber uma resposta estável? | Logs do servidor, status, cabeçalhos, tempo de resposta | Bloqueio por robots, timeout, 5xx, cadeia de redirecionamentos |
| **Renderização** (Render) | O conteúdo principal está presente depois do processamento? | HTML bruto × DOM renderizado, cascata de recursos | Casca de aplicação vazia, JS/CSS bloqueado, renderização atrasada ou falha |
| **Índice** (Index) | A URL foi escolhida e armazenada? | Status no índice, canonical escolhido, trecho exibido | `noindex`, duplicada, soft 404, canonical alternativo |
| **Exibição** (Serve) | Ela consegue competir pela consulta pretendida? | Impressões por consulta, formato do resultado, URL de destino | Intenção errada, evidência fraca, candidato mais forte |

## Como aplicar

1. Escolha **uma** URL representativa e registre a consulta pretendida.
2. Responda a pergunta de cada estado, em ordem, com a evidência da coluna correspondente. Anote o que viu, não o que supõe.
3. Pare no primeiro estado que falha. Os estados seguintes ainda não podem ser avaliados com confiança.
4. Corrija a causa daquele estado e repita a matriz na mesma URL.
5. Só depois de a URL passar pelos cinco estados, generalize: verifique se o padrão se repete em outras URLs do mesmo template antes de falar em problema do site inteiro.

## Na plataforma

- **Publicada não é indexada.** O estado de indexação só vale quando há observação registrada (por exemplo, do Search Console). Sem instrumentação, o estado é "não instrumentado", nunca "indexada".
- **Descoberta:** a indexação é por links internos, sitemaps e IndexNow; a Google Indexing API não é usada para imóveis (regra 8 de `CLAUDE.md`).
- **Busca e Renderização:** a página gerada é HTML estático pelo renderer único; compare o HTML bruto com o renderizado e os cabeçalhos antes de suspeitar do índice.
- **Índice:** `noindex`, canonical e duplicidade vêm das políticas de indexação e do canonical do blueprint; ambientes de teste saem com `noindex` (regra 5).
- **Exibição:** use impressões e consultas por URL (Search Console) e compare a intenção da página com a consulta.
- Antes da primeira onda de publicação, a saúde do índice do domínio deve ser de pelo menos 95% (regra 9).

Esta é uma boa prática de diagnóstico, não um gate: ela organiza a investigação e não substitui os Quality Gates nem a aprovação humana.
