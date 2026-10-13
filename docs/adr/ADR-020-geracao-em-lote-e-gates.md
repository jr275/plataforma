# ADR-020: Geração de páginas em lote, histórico por versão e gates de qualidade

**Status:** ACCEPTED (2026-10-13) nos cinco pontos abaixo, por decisão expressa do dono no chat (histórico do ADR preservado: o texto original das seções 1 a 6 e as perguntas seguem abaixo, sem alteração; as mudanças de implementação estão no **Adendo**).

## Contexto
- Etapa 4 do MVP (critérios do dono): ao menos **10 registros válidos** num lote; **execução registrada**; **repetição sem duplicar**; **bloqueio só dos registros inválidos**; detecção de **ausência de campo, URL duplicada, metadado inválido e link quebrado**; **reprocessamento sem perder histórico**.
- Regra 5 do projeto: nada é publicado indexável sem passar no Quality Gate; **cada gate grava o próprio resultado; nunca há nota composta**. Regra 3: todo passo é idempotente. Regra 2: toda tabela do data plane tem `tenant_id`, RLS e teste de isolamento.
- Já existe (ADR-017/019): `city`, `import_run`, `buildCityFacts` e `renderCityPage` (puros). Não existe tabela de páginas, execução de geração nem gate.

## Decisão proposta

### 1. Quatro tabelas (migrations `0005` e `0006`)
Todas com `tenant_id NOT NULL`, FKs compostas `(tenant_id, id)`, RLS forçada, política canônica e **sem DELETE** para a aplicação.

| Tabela | Papel | Colunas principais | Privilégios da aplicação |
| --- | --- | --- | --- |
| `generation_run` | uma execução do lote | `id`, `template_key`, `template_version`, `template_hash`, `scope` (jsonb: UF ou lista de cidades, e limite), `status` (`running`, `succeeded`, `partial`, `failed`), `total_items`, `generated_items`, `unchanged_items`, `blocked_items`, `error`, `started_at`, `finished_at`, `created_by` | `SELECT`, `INSERT`, `UPDATE` (fechar) |
| `page` | a página lógica de uma entidade | `id`, `entity_kind` (`city`), `entity_id`, `path`, `latest_version`, `status` (`draft`, `blocked`), `created_at`, `updated_at`; **`UNIQUE (tenant_id, path)`** e **`UNIQUE (tenant_id, entity_kind, entity_id)`** | `SELECT`, `INSERT`, `UPDATE` |
| `page_version` | histórico **imutável** de conteúdo | `id`, `page_id`, `version`, `run_id`, `content` (jsonb = `RenderedPage`), `content_hash`, `template_*`, `gates_passed`, `created_at`; `UNIQUE (page_id, version)` | `SELECT`, `INSERT` |
| `generation_item` | **um registro por entidade tentada** (100% classificado, como `import_record`) | `id`, `run_id`, `entity_id`, `outcome` (`generated`, `unchanged`, `blocked`), `gates` (jsonb: lista de `{gate, outcome, detail}`), `page_id`, `page_version_id` | `SELECT`, `INSERT` |

Os resultados dos gates ficam **dentro de cada item**, um por gate, sem nota agregada (regra 5). O `page.status` é derivado do último resultado: `draft` (passou em todos os gates) ou `blocked`. **Nenhum estado de publicação existe nesta etapa**: publicar é a etapa 5, com aprovação explícita.

### 2. Gates da etapa 4 (puros e determinísticos; cada um grava `pass` ou `fail` com detalhe)
| Gate | Falha quando |
| --- | --- |
| `required_fields` | falta campo obrigatório do template, a origem não é real ou a execução de origem não terminou (motivo vem de `buildCityFacts`/`renderCityPage`) |
| `url_unique` | o `path` já pertence a outra entidade no tenant, ou dois itens do mesmo lote colidem (vale o de menor `ibge_code`; os demais bloqueiam) |
| `url_stable` | a entidade já tem página e o `path` novo é diferente do antigo (mudança de nome do município): exige redirecionamento (etapa 5), então **bloqueia** em vez de criar uma segunda URL |
| `metadata_valid` | título fora de 1 a 60, meta fora de 70 a 155, `h1` vazio, ou título/meta repetidos por outra página do tenant |
| `links_resolve` | algum link do conteúdo aponta para caminho que não está no conjunto de caminhos existentes informado à execução |
| `facts_traceable` | algum fato do conteúdo sem fonte ou algarismo na prosa que não esteja nos valores dos fatos usados (reconferência independente do render) |

### 3. Idempotência e histórico
Um item cujo `content_hash` é igual ao da última versão da página vira `unchanged` (**nada é gravado** em `page_version`); mudou o dado, nasce a versão `n+1` e `page.latest_version` avança; as versões antigas permanecem. Reprocessar o mesmo escopo, sem mudança de dado, não cria página, versão nem URL nova.

### 4. Ciclo de vida da execução
Mesmo padrão da importação (ADR-017): (1) abre `generation_run` como `running` e confirma; (2) processa **todos** os itens, grava `generation_item`, versões e atualiza `page`, e fecha a execução, **tudo atômico**; (3) se falhar, outra transação marca `failed` com o erro (sem segredos). Seleção por UF ou por lista de cidades, com **teto de 500 cidades por execução**. Cidades cuja execução de origem é de teste ou manual **entram como itens bloqueados** (classificadas, não descartadas).

### 5. Código e leitura
`packages/api/src/pages/generate.ts` (execução e persistência por `withTenant`), `gates.ts` (gates puros) e funções de leitura (`listGenerationRuns`, `listGenerationItems`, `listPages`, `getPageVersion`) para as telas, que nunca leem o banco direto (regra 4). Sem dependência nova.

### 6. Prova esperada
Testes de isolamento entre dois tenants nas quatro tabelas (disposable PG e Neon); lote de **10 a 20 cidades reais** do tenant `remax` gerando páginas `draft`; um registro inválido injetado (cidade de execução de teste, colisão de URL e nome absurdamente longo) que **bloqueia só ele**; reprocessar sem mudança (`unchanged`, zero versões novas); mudar um dado e reprocessar (nova versão, mesma URL, histórico preservado); mudança de nome (bloqueio `url_stable`).

## Alternativas rejeitadas
- **Tabela `gate_result` separada:** mais uma superfície de escrita; um jsonb imutável por item atende "cada gate grava o próprio resultado" com menos peças.
- **Sobrescrever a página a cada execução:** perde o histórico exigido pelo critério.
- **Aprovar e publicar automaticamente quem passa:** viola a regra de publicação controlada (etapa 5, aprovação explícita).
- **Bloquear o lote inteiro por um registro inválido:** contraria "bloqueio só dos registros inválidos".

## Consequências
- Primeira entidade com ciclo gerar → validar → versionar, rastreável por execução; a etapa 5 parte de `page` com `status = draft`.
- O conteúdo (`content` jsonb) é uma cópia do render: cresce com o número de versões; aceitável no piloto, a revisar na escala.
- Conteúdo raso (ADR-019) continua sendo um risco editorial; os gates desta etapa verificam **integridade**, não qualidade editorial.

## Decisões necessárias do dono do produto
1. Aprovar as quatro tabelas, os estados e a idempotência por `content_hash`.
2. Aprovar a lista de seis gates (ou acrescentar/retirar algum).
3. Aprovar o teto de 500 cidades por execução.
4. **Escolher o lote piloto** (10 a 20 cidades): proposta, as 20 maiores por população de **um** estado à sua escolha, ou uma lista que a RE/MAX indicar.
5. Confirmar que, nesta etapa, as páginas ficam apenas como `draft` (nenhuma publicação sem a etapa 5 e aprovação explícita).

## Decisões do dono (2026-10-13, chat)
1. **Aprovado:** tabelas de execução, página e versão, com idempotência por hash e histórico preservado.
2. **Aprovado:** os seis gates deste ADR, desde que implementados como verificações reais.
3. **Aprovado:** teto de 500 cidades por execução, com lotes menores no piloto.
4. **Piloto:** 20 cidades do estado de **São Paulo**, selecionadas pela **população oficial do IBGE** disponível no projeto (sem inventar ranking nem dado ausente).
5. **Aprovado:** páginas geradas só como `draft`, sem publicação nem indexação automática.
Autorizações operacionais da mesma mensagem: migrations só em PostgreSQL local descartável (nunca no Neon ou banco persistente), commits locais pequenos; push, deploy, publicação e operações financeiras seguem proibidos sem autorização explícita.
Nenhuma condição adicional material deste ADR foi dispensada.

## Adendo de implementação (2026-10-13)
- **Gates:** os seis do ADR (`required_fields`, `url_unique`, `url_stable`, `metadata_valid`, `links_resolve`, `facts_traceable`). A **origem dos dados** (apenas `real`) é verificada em `required_fields`; a **consistência de renderização** é a reconferência independente de `facts_traceable` (todo fato com fonte, todo algarismo da prosa vindo de um fato). Um gate que não pode ser avaliado porque não houve conteúdo recebe `skipped` (extensão de `pass`/`fail`, para toda tentativa ter resultado auditável por gate).
- **Versões só de conteúdo aprovado:** `page_version` guarda apenas conteúdo que passou em todos os gates (por isso não há coluna `gates_passed`). Tentativas reprovadas ficam em `generation_item.gates`, com o motivo. Página nova bloqueada não cria `page`; página existente cujo reprocessamento é bloqueado vai a `blocked` e mantém suas versões.
- **Hash de conteúdo** (`contentHash`): projeção factual determinística (caminho, título, meta, `h1`, seções exceto "Fonte dos dados", links, e de cada fato usado `id`, valor e ano de referência, mais a versão do template). **Não inclui** data de coleta, identificador de execução nem hash do arquivo de origem (que mudaria para todas as cidades se uma única linha do arquivo mudasse).
- **Migrations:** `0005_generation_run.sql` e `0006_page.sql` (`page`, `page_version`, `generation_item`). Não há migrations de reversão (ADR-011); a atomicidade da aplicação é a do runner (`test:migrations`).
- **Falha:** cada item persiste dentro de um `SAVEPOINT`; falha de um item é registrada em `generation_item.error` e não afeta os demais. Falha da execução inteira a marca `failed` (transação separada) e reprocessar é seguro.
