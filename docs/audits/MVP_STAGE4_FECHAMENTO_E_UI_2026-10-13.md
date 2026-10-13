# Fechamento da Etapa 4 e primeira experiência visual funcional — 2026-10-13

Base: HEAD `8841fc1` (8 commits locais à frente de `origin/main`; as alterações desta unidade **não estão commitadas**). Decisões: ADR-020 (adendo), ADR-022. Nenhum push, deploy, migration no Neon ou alteração persistente.

## A. Defeitos da Etapa 4: antes e depois
Testes de regressão em `packages/api/src/pages/generation-safety.product.test.ts` (10 testes, PostgreSQL local descartável, dados reais do IBGE). **Antes da correção: 9 falhavam** (`Tests 9 failed | 27 passed`). **Depois: todos passam** (`pnpm test:schema` 79/79; 61 testes de produto).
| Defeito | Antes | Depois |
| --- | --- | --- |
| Ids inexistentes sumiam | pedia 2, processava 1, sem aviso (sonda S3) | `GenerationScopeError` lista os ids, **antes** de abrir a execução; nada gravado |
| Execução presa em `running` | ficava `running` para sempre (sonda S5) | recuperada para `failed` ("abandonada") após o prazo (padrão 15 min, `staleAfterMinutes`); fechamento só vale se ainda `running`; uma abandonada que volta a andar desfaz tudo |
| Execução concorrente | segunda falhava com `duplicate key … page_tenant_id_path_key` e 20 itens "bloqueados" (sonda S1) | índice parcial `0007` (uma `running` por tenant); segunda recusada com `GenerationBusyError` (id da ativa), nada gravado |
Também testado: tenants isolados (a execução de F não bloqueia E, a recuperação em E não toca em F), histórico sem lacunas, repetição idempotente, mínimo de 10 como critério de aceite (reprocessar 1 página continua permitido). **Mutações:** fechamento sem checar `running` derrubou o teste da abandonada; tratar o índice como erro cru derrubou 3 testes; ambos restaurados byte a byte.
**Riscos remanescentes:** o prazo de 15 min é uma escolha (uma execução legítima mais longa seria encerrada e desfaria o que fez); a prova de concorrência usa um gancho de teste (`faults`) para pausar a primeira execução, não um corte real de processo; a regra "menor código IBGE vence" na colisão de URL dentro do lote continua (sem colisão nos 5.571 municípios).

## B. Inventário da experiência visual existente (leitura do código)
| Área | Estado real |
| --- | --- |
| Login (`/login`), proxy de sessão | **Real** (Supabase; testado pelo dono; JWKS ES256 verificado) |
| Fluxo de dados (`/data-flow`) | **Real** (importações reais; sem teste automatizado da tela) |
| Overview, Ask AI, Research, Search Universe, Opportunities, Knowledge, Entities, Data Sources, Pages, Programmatic, Agents, Quality & Trust, Analytics, Settings (+ detalhes `[id]`) | **Simulado** (fixtures `data/demo`; o topo diz "Dados demonstrativos") |
| Imóveis, anúncios, corretores | **Inexistente** (nenhuma entidade nem fonte) |
| Casca (sidebar, topbar, paleta de comandos, tema), design system (`Panel`, `PageHeader`, `Badge`, `Button`, `Field`, `Tabs`, `Modal`, `ResourceList`), `error.tsx`, `not-found.tsx`, `loading.tsx`, "Ir para o conteúdo" | **Reaproveitado** (não foi criada segunda aplicação) |
Problemas achados e tratados: `usePathname()` em sidebar e topbar fora de `Suspense` quebrava rotas com id dinâmico (corrigido); um pânico do Turbopack era cache corrompido de `.next` (build com o cache regenerado passa); componente de cliente importando o pacote da API arrastaria `pg`/`fs` ao navegador (corrigido: lista de UFs vem do servidor). Pendentes (não tocados): telas demonstrativas continuam com dados fictícios e sem teste de acessibilidade automatizado.

## C. A primeira fatia entregue: Geração de páginas → Pré-visualização
Rotas reais em `apps/web/src/app/(app)/generation`: lista (`/generation`: busca, filtros, ordenação, paginação pela URL, formulário de gerar, execuções), detalhe da página (`/generation/pages/[id]`: pré-visualização desktop/celular, resultado de busca com contadores, 6 gates, fatos e fontes, fatos ausentes, versões antigas navegáveis, reprocessar, "Aprovar e publicar" **desabilitado** com motivo), detalhe da execução (`/generation/runs/[id]`). Estados reais: não configurado, sem sessão, sem tenant, **tabelas ausentes (migrations pendentes)**, erro, vazio, sem resultado de filtro. **Não implementado, declarado na tela:** editar campos (o template não tem), JSON-LD/sitemap, publicação.

## D. Integrar ao Neon com segurança (plano; **nada aplicado**)
- **Migrations necessárias, nesta ordem:** `0005_generation_run`, `0006_page`, `0007_generation_single_active`. Dependências já presentes no Neon (verificado em leitura): `plataforma.tenant`, `city (tenant_id, id)` único, `set_updated_at()`, ledger com 1 a 4 e checksums idênticos aos arquivos.
- **Destino:** Neon dev `plataforma-dev`, branch `main`, banco `plataforma`; tenant `remax` (`fce17b74-…`, 5.571 cidades reais).
- **Impacto sobre dados existentes:** nenhum. Só `CREATE TABLE` (4), `CREATE INDEX`, `REVOKE ... FROM PUBLIC` e `GRANT` mínimo às novas tabelas; nenhum `ALTER`/`DROP` de objeto existente.
- **Recuperação:** não há migrations de reversão (ADR-011). As tabelas nascem vazias; antes de aplicar, criar um branch do Neon (cópia instantânea) como ponto de restauração. Se algo falhar, a migration é atômica (nada fica registrado); depois de aplicada, o caminho é uma migration corretiva nova.
- **Testes de RLS e isolamento:** `pnpm test:schema` (79/79, inclui as tabelas novas) e, contra o Neon, `bash scripts/test-neon.sh --project-id autumn-art-97369869` (branch temporário: aplica as pendentes com o gate e roda os testes de produto; **atualizei o script para semear os tenants C a H**; não foi executado, por ser contra o Neon).
- **Verificação depois de aplicar:** `check-catalog.sh --remote-conn-env NEON_ADMIN_URL ...` (o gate avalia as 4 tabelas), ledger com `1..7`, e `scripts/neon-import-cities.sh`/gerar pelo CLI `packages/api/src/pages/cli.ts` com a credencial da aplicação; depois abrir `/generation` já em produção do Neon com o seu login.

## E. Critérios de aceite da fatia
| # | Critério | Estado | Evidência |
| --- | --- | --- | --- |
| 1 | Abrir o app e navegar sem links quebrados | **PASS** (parcial) | `next build` lista as rotas; `pnpm dev:local` serve `/login` 200 e `/generation` 307 para o login; links da lista e do detalhe testados (SSR); links de rotas demonstrativas não foram auditados |
| 2 | Lista de imóveis com fonte real | **BLOCKED** | não existe entidade nem fonte de imóveis (ADR-022, bloqueio) |
| 3 | Abrir um imóvel | **BLOCKED** | idem |
| 4 | Cadastrar/editar imóvel | **BLOCKED** | idem; depende de fonte, tabela e permissões |
| 5 | Criar uma página a partir de template real | **PASS** (banco local) | formulário `GenerateForm` → `generateAction` → `runGeneration`; jornada e `dev-local` geram 20 rascunhos |
| 6 | Página renderizada inspecionável | **PASS** | screenshots desktop e celular em `/dev/preview`; 25 testes de SSR |
| 7 | Gates e problemas de proveniência visíveis | **PASS** | painel de gates, fatos e fontes, fatos ausentes e aviso de revisão por idade (testes) |
| 8 | Rascunho até aprovação explícita | **PASS** | status só `draft`/`blocked` por CHECK; botão desabilitado com motivo (teste de mutação) |
| 9 | Repetir sem mudança não cria versão | **PASS** | jornada: 20 `unchanged`, 0 versões novas |
| 10 | Testes de isolamento, validação, erros e estados de interface | **PASS** | 79/79 no banco (61 testes de produto), 247 no `api` e 73 no `web` (interface, ações do servidor, resolução de tenant e de identidade, classificação de erros reais do PostgreSQL; mutações em cada ponto de segurança) |
| 11 | Build, lint, typecheck e testes | **PASS** | ver abaixo |
| 12 | Relatório separa feito, configuração e bloqueado | **PASS** | este documento |
**Depende de configuração/ação sua:** ver a tela com os dados reais exige o seu login (eu não tenho a senha); rodar `pnpm dev:local` e entrar. **Bloqueado:** Imóveis (fonte), publicação (etapa 5), Neon (autorização).
