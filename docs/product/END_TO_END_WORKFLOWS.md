# Fluxos de ponta a ponta

Data: 2026-10-13. Define cada etapa do pipeline "fonte → resultado", o que cada uma exige e **o estado real hoje**. Estado é sempre o da `PLATFORM_CAPABILITY_MATRIX.md`; nada aqui é promessa.

Pipeline alvo: Fonte → Conector → Validação → Normalização → Resolução de entidades → Base mestre → Grafo de conhecimento → Evidência e confiança → Inteligência de busca → Motor de oportunidades → Fábrica de páginas → Compilação SEO/GEO → Gates de qualidade → Pré-visualização → Publicação autorizada → Monitoramento de indexação → Medição de resultado → Ciclo de aprendizado.

## Estado do pipeline hoje

| Etapa | Estado | Evidência | Bloqueio ou próximo passo |
|---|---|---|---|
| Fonte | `working` para IBGE (CSV). Search Console, imóveis e demais: `blocked` | `REMAX_DATA_AUDIT.md` | Dono |
| Conector | `partial`: importador de CSV de cidades; sem interface comum | `packages/api/src/ingest` | Extrair contrato (B5) |
| Validação | `working` (obrigatórios, tipos, duplicatas, classificação de 100% das linhas) | testes de produto | — |
| Normalização | `working` para cidades | idem | — |
| Resolução de entidades | `partial` (duplicidade por `ibge_code` numa importação) | idem | Segunda fonte |
| Base mestre | `partial`: tabela `city` com proveniência; um só tipo; inspeção na tela `/cities` | migrations 0003, 0004; `city-search.ts` | Outros tipos de entidade e histórico |
| Grafo | `partial`: leitura derivada dos dados persistidos, sem persistência própria | `packages/api/src/graph`, `/graph` | Modelo persistido (migration, autorização) |
| Evidência e confiança | `partial`: fatos com fonte, validade e aviso de atualidade na geração | gate `facts_traceable`, `reviewFacts` | Persistir evidência (E5) |
| Inteligência de busca | `partial`: pesquisa de sinais reais (BCB, IBGE, Agência Brasil) funciona; demanda, SERP e concorrência `blocked` | ADR-016 PROPOSED; ADR-023 | Dono (Search Console, provedor de SERP) |
| Motor de oportunidades | `working` (hipóteses com evidência, score V2 versionado, ciclo de vida); prioridade sempre parcial sem demanda | `packages/api/src/engine`, `/opportunities` | Fontes de demanda; Slices B a E |
| Fábrica de páginas | `working` (cidade) | `pages/*` | Novos arquétipos exigem ADR |
| Compilação SEO/GEO | `partial`: só título e meta | gates | JSON-LD, canonical, sitemap |
| Gates de qualidade | `working` (6 gates independentes) | `gates.ts` | Ampliar |
| Pré-visualização | `working` | `/generation/pages/[id]` | — |
| Publicação autorizada | `missing` | botão desabilitado | Decisão do dono |
| Monitoramento de indexação | `blocked` | — | Search Console e publicação |
| Medição de resultado | `blocked` | — | Idem |
| Ciclo de aprendizado | `missing` | — | Depois de medir |

## WF1: Importar cidades (existente)

Entrada: CSV com `ibge_code, name, uf, region, population, population_year` e um mapeamento. Saída: `import_run` e `import_record` (um por linha, com desfecho e motivos) e `city`.
- **Persistência:** três tabelas, todas com `tenant_id` e RLS.
- **Idempotência:** reimportar o mesmo arquivo atualiza, não duplica (teste de produto).
- **Erros:** linha inválida vira `rejected` com motivo; duplicata vira `duplicate`; nenhuma linha é descartada em silêncio.
- **Proveniência:** `sha256` do arquivo, origem (`real`, `test`, `manual`), horário e autor.
- **Gatilho hoje:** só linha de comando. Falta um gatilho autorizado pela interface (B8).
- **Estado:** `working`, `verified` (dados); tela de leitura `/data-flow` sem verificação visual.

## WF2: Gerar rascunhos de página (existente)

Entrada: UF e limite, ou lista de cidades. Saída: `generation_run`, `generation_item` (resultado dos 6 gates por cidade), `page` e `page_version` (imutável).
- **Idempotência de conteúdo:** hash factual; conteúdo igual não cria versão.
- **Concorrência:** índice parcial permite uma execução `running` por tenant; abandonadas são recuperadas após 15 minutos.
- **Falha parcial:** SAVEPOINT por item; só os inválidos ficam bloqueados.
- **Publicação:** inexistente; o banco só aceita `draft` e `blocked`.
- **Estado:** `working`, `verified` (testes de produto e leitura do Neon: execução `11d30ce6…`, 20 rascunhos).

## WF3: Reprocessar uma página (existente)

Entrada: identificador da página. Saída: nova execução de uma cidade; nova versão só se o conteúdo mudou. Valida identificador, sessão e tenant no servidor; falhas de login, banco e entrada inválida têm mensagens próprias. **Estado:** `working`, `verified` (API e ações); visual pendente.

## WF4 (slice 1): Inspecionar entidades reais e sua origem

Objetivo: o usuário vê as cidades reais do tenant, abre uma e enxerga **de onde vieram os dados** e **o que foi gerado a partir delas**.
- Entrada: sessão autenticada; filtros (busca por nome ou código IBGE, UF, ordenação, página).
- Saída (somente leitura): lista paginada e detalhe da cidade com atributos, linha original recebida (`import_record.raw`), desfecho e motivos da validação, execução de importação (fonte, origem, arquivo, `sha256`, horário), página gerada (URL, status, versão) e relações **derivadas só das colunas da fonte** (cidade → UF → região).
- **Persistência:** nenhuma escrita; nenhuma migration.
- **Erros:** estados distintos para sem sessão, sem tenant, não migrado, banco indisponível, falha de login e erro; identificador malformado é entrada inválida; cidade de outro tenant não existe (RLS).
- **Idempotência:** leitura pura.
- **Estado:** `working`, `verified` por testes (20 de produto em PostgreSQL real, web e mutação); **não verificado** com sessão real nem contra o Neon. Código: `packages/api/src/ingest/city-search.ts`, `app/(app)/cities`.

## WF5: Search Console → oportunidades (bloqueado)

Fonte (OAuth do dono) → carregador idempotente com papel `plataforma_loader` → `search_page_daily` e `search_query_period` → análise → `opportunity` com evidência e fatores separados. Bloqueio: credenciais, permissão completa, aprovação da lista de marca, ADR-016 e migrations. Métrica ausente aparece como "indisponível", nunca como zero.

## WF6: Publicação controlada e medição (bloqueado)

Rascunho → aprovação explícita → publicação autorizada → URL estável, canonical, sitemap só com URLs elegíveis → indexação monitorada → impressões, cliques, CTR e posição por URL. Bloqueio: site e mecanismo de publicação (decisão do dono) e WF5. Condição extra: saúde do índice do domínio de pelo menos 95% antes da primeira onda (regra 9).

## WF7: Pipeline de imóveis (bloqueado)

Fonte autorizada → `property` e anúncio (ADR-021) → fatos com validade → template novo → gates → pré-visualização. Bloqueio: fonte real, autorização e política de dados pessoais. Nada foi simulado.

## WF8: Explorar o grafo (a construir)

Primeira versão **entregue**: `/graph` consulta entidades e relações derivadas dos dados persistidos (cidade, UF, região, página), com busca, filtro por tipo, expansão com limite, navegação ao detalhe e inspeção de origem e atualidade. Sem persistência própria e sem migration. Falta: modelo persistido de entidades genéricas, caminhos entre dois nós, histórico. Estado: `partial`, `verified` por testes (SQL e conformância com a memória); visual autenticado pendente.

## WF9: Investigação por agente (a construir)

Primeira versão **parcial entregue**: o painel "Investigar" do grafo executa ferramentas REAIS e somente leitura sobre a entidade selecionada (5 ferramentas), com passos, achados rotulados (fato, derivado, sugestão) e citações. **Não é um agente**: sem modelo de linguagem, sem streaming, sem CopilotKit/AG-UI (não instalados), sem ferramentas de escrita nem aprovação. `/ask` e `/agents` seguem demonstração. Exige ADR para o agente real. Estado: `partial`.

## WF10 (Slice A): Pesquisar oportunidades

Entrada: sessão autenticada; número de cidades (1 a 100) em `/opportunities`. Passos, todos no servidor: (1) abre a execução (`research_run`, uma `running` por tenant; abandonadas há mais de 15 minutos viram `failed`); (2) consulta as fontes FORA do banco: BCB (séries 432, 13522, 189), API de notícias do IBGE e RSS da Agência Brasil (respeita `robots.txt` e `Crawl-delay`); (3) em UMA transação grava a evidência (única por conteúdo), gera as hipóteses da vertical a partir das cidades reais, agrupa (padrão x intenção x entidade), calcula o score e os eventos, e fecha a execução.
- **Persistência:** 7 tabelas com RLS; sem `DELETE` para a aplicação; histórico (evidência, score, evento) imutável.
- **Idempotência:** repetir com as mesmas respostas não cria evidência, oportunidade, score nem vínculo (teste de produto e execução ao vivo: 2ª execução com 0 novos).
- **Falha parcial:** fonte fora do ar torna a execução `partial`; o que foi coletado é gravado; nada é inventado no lugar.
- **Verdade:** demanda de busca, SERP e concorrência são `unknown` (sem fonte). A prioridade é `partial` e rotulada; só vira `overall` com os 3 objetivos calculáveis.
- **Estado:** `working`, `verified` por testes e por consulta ao vivo em banco descartável; **não verificado** com sessão real nem no Neon (migration 0008 não aplicada lá).

## WF11 (Slices C/D): Blueprint, gates e roadmap

Entrada: oportunidade elegível (ou com blueprint) e o botão "Gerar blueprint" em `/opportunities/[id]`. No servidor, em UMA transação com a oportunidade travada: monta o blueprint só com dados gravados (experiência da vertical, template do REGISTRO real, requisitos de evidência, fatos da cidade com origem real, caminho proposto, canibalização do score), avalia os seis gates e grava uma versão imutável (única por conteúdo). Se nenhum gate reprova, a oportunidade avança para "Com blueprint"; vinda de "Elegível", isso é a **dispensa registrada da etapa SERP** (evento com o motivo; a SERP fica `not_evaluated`). Se reprova, o blueprint fica com os bloqueios exatos e a oportunidade não avança.
- **Roadmap** (`/roadmap`): leitura derivada que agrupa por prontidão e soma os bloqueios. No banco descartável com dados reais: 204 oportunidades, 1 elegível (bloqueada: experiência "Dados e indicadores" sem template) e 203 fora da elegibilidade (160 por risco de evidência/viabilidade, 83 sem demanda ou justificativa estratégica).
- **Nada é publicado.** Dados estruturados só propostos; a página sairia `noindex`.
- **Estado:** `working`, `verified` por testes e execução ao vivo em banco descartável; **não verificado** com sessão real nem no Neon.

## Ordem recomendada das fatias

1. **Slice 1 (entregue, não commitado):** entidades reais e proveniência (WF4), leitura, sem migration.
2. **Slice 2 (entregue, não commitado):** casca, grafo derivado, inspetor, investigação por ferramentas reais, integrações e contrato de modo de dados (WF8, WF9 parcial).
3. Slice 3: contrato de conector e gatilho de importação pela interface (WF1 completo).
4. Slice 4: compilação SEO/GEO (JSON-LD, canonical, sitemap) e aprovação (precede WF6).
5. Slice 5: agente real (WF9).
6. Desbloqueio pelo dono: Search Console (WF5), imóveis (WF7), publicação (WF6).
