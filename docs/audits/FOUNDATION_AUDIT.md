# Auditoria da fundação (Fase 0)

Data: 2026-10-11. Modo: somente leitura e comandos que não mudam estado externo. Nada foi instalado, nenhum banco foi tocado, nenhum remoto configurado, nenhum segredo lido ou impresso.

Repositórios examinados:

- `~/plataforma` (código; branch `main`, sem remoto, 3 commits: scaffold, shadcn/ui, ADR/CLAUDE.md/pack)
- `~/Projects/menlo` (documentação; `main`, remoto `github.com/jr275/menlo`, 3 commits)

## 1. Resumo executivo

O produto está **documentado em profundidade e implementado quase nada**. O `plataforma` é um scaffold que compila: Next.js com a página padrão do `create-next-app`, shadcn/ui com um botão, e dois pacotes (`db`, `schemas`) que exportam `{}`. Não existe nenhum componente do produto (Knowledge Layer, Opportunity Engine, Page Architect, Compiler, Quality Gate, Publishing, Observability).

O código que a documentação trata como existente (migrations SQL 0.1 a 0.5 com testes de RLS, Opportunity Engine em Python, `load_gsc.py`, `gsc_semanal.py`) **não está em nenhum repositório nem no disco**. O próprio `menlo/PENDENTES.md` registra isso (G15, G16: "copiar os .sql dos zips", "copiar os .py"). Todas as afirmações de "testado" (7 testes de isolamento, 5 testes da 0.3, 17 testes do motor) são, nesta auditoria, **não verificáveis**.

Maior risco: toda a fundação de dados e de segurança (esquema, RLS) é um artefato que existe só em zips que não temos. Antes de qualquer ferramenta nova, é preciso recuperá-lo e versioná-lo.

## 2. Baseline verificado de repositório e runtime

Comandos executados (resultados observados):

| Comando | Resultado |
| --- | --- |
| `node -v` | `v24.9.0` |
| `pnpm turbo typecheck lint build --force` (sem cache) | `5 successful, 5 total`, 4,5 s |
| `git status -sb` em `~/plataforma` | `## main`; árvore limpa antes deste relatório |
| `git remote -v` em `~/plataforma` | vazio (sem remoto) |

Não executado: `pnpm install --frozen-lockfile` (reprodutibilidade da instalação **não verificada**; só foi observado que `node_modules` e `pnpm-lock.yaml` existem e que o build passa), `pnpm dev`, qualquer teste (não há nenhum).

`pnpm test` passa vazio por `--passWithNoTests` em `packages/schemas`, o que **não é evidência de cobertura**.

## 3. Inventário de arquitetura e implementação

Classificação: **V** implementado e verificado · **NV** implementado, não verificado · **P** parcial · **D** documentado, não implementado · **B** bloqueado por acesso/credenciais · **C** conflitante/obsoleto.

| Componente | Estado | Evidência |
| --- | --- | --- |
| Monorepo pnpm + Turborepo | V | `pnpm-workspace.yaml`, `turbo.json`, build observado |
| Next.js 16 App Router + Tailwind + shadcn/ui | P | `apps/web`: página é o template padrão (`src/app/page.tsx`), só `components/ui/button.tsx` |
| Esquema Drizzle / PostgreSQL | P | `packages/db/src/schema.ts` é `export {}`; sem migrations Drizzle |
| Migrations SQL 0.1 a 0.5 | D (ausentes) | `menlo/db/migrations/README.md` lista `01_esquema.sql` … `10_teste_rls.sql`; só o README existe |
| RLS e papel `menlo_app` | D | descritos em `menlo/docs/menlo-os/02-guia-para-engenheiros.md`; nenhum SQL no disco |
| Contratos Zod | D | `packages/schemas/src/index.ts` é `export {}` |
| Opportunity Engine (Python) | D (ausente) | nenhum `.py` do produto no disco; ADR-007 manda preservar, não há o que preservar |
| Extrator e carregador do Search Console | D (ausentes) | `menlo/analytics/gsc/README.md`: "Copie para cá"; docs dizem testado só contra serviço simulado |
| Page Compiler, Quality Gate, Publishing | D | `menlo/docs/menlo-os/10-o-que-falta.md`: "Não iniciado" |
| `packages/api` (regra 4) | D | não existe |
| `pnpm eval:gate` (regra 5) | D | não existe script; citado em `02-guia-para-engenheiros.md` |
| Testes (Vitest/Playwright) | D | nenhum arquivo de teste |
| CI | C | `menlo/.github/workflows/ci.yml` está no repo de docs, `workflow_dispatch`, referencia scripts `pnpm typecheck/lint/test` e `db/migrations/` que não existem lá; usa Node 22 |
| Python agendado (ADR-010) | D | `menlo/.github/workflows/gsc-semanal.yml` referencia `analytics/gsc` sem `.py`; falta cadastrar segredos |
| ADRs 001 a 010 (texto completo) | D | só índice em `docs/adr/README.md` (ambos repos) |
| Multi-tenancy (`tenant_id`, RLS) | D | zero ocorrências em `apps/` e `packages/` |
| Autorização server-side, auditoria, proteção SSRF | D | superfície de ataque atual é uma página estática; nada a proteger ainda |
| Observabilidade | D | nada configurado |

## 4. Discrepâncias documentação x código

1. **"Testado, 7 testes de isolamento passam"** (`menlo/docs/menlo-os/10-o-que-falta.md`, "Esquema") vs. nenhum arquivo `.sql` no disco. Não verificável.
2. **`docs/adr/` "ADR 007 a 010 escritos"** (`menlo/docs/adr/README.md`) vs. o diretório só tem `README.md`. Os textos completos não existem como arquivos.
3. **Node:** `menlo/.github/workflows/ci.yml` usa `node-version: 22`; `plataforma/package.json` declara `engines.node >=24`. Uma das duas precisa mudar. Proposta em `docs/adr/ADR-012-versao-do-node.md` (Node 24 LTS).
4. **Caminho de pacote:** a regra 4 exige `packages/api`; não existe. As regras 2 e 5 referem `menlo_app` e `quality_gate_result`; não existem no código.
5. **Onde mora o código:** a documentação ainda fala em estrutura de repositório indefinida (`02-guia`, "ainda não está definido"). Decidido nesta sessão: `plataforma` = código, `menlo` = documentação. Falta refletir isso nos docs do `menlo`.
6. **Inventário de abas:** `menlo/PENDENTES.md` G13 diz "17 abas exportadas"; `docs/menlo-os/` tem 17 arquivos de conteúdo mais `README.md`. Consistente.

## 5. Riscos de segurança, tenancy, integridade e publicação

1. **(Crítico) Segredos possivelmente expostos.** `menlo/PENDENTES.md` G11: "Revogar segredos expostos … antes do primeiro push". O `menlo` já recebeu push (`1da3065`). Não li nenhum segredo; não sei se ele foi revogado. Ação do dono do produto.
2. **(Alto) Fundação de segurança só em zips.** Sem as migrations e testes de RLS versionados, qualquer novo código de banco nasce sem a base testada. A migration 0.5 corrigiu dois vazamentos reais (views ignorando RLS; tabela `tenant` sem RLS); reescrever o esquema às cegas reintroduziria esse risco.
3. **(Alto) Duas fontes de verdade para o esquema.** SQL à mão (zips) vs. Drizzle (`packages/db`). Sem decisão explícita, haverá divergência.
4. **(Médio) Repositório de docs com CI e workflow de Python apontando para arquivos inexistentes.** Se alguém ligar o `schedule` do `gsc-semanal.yml` antes de os `.py` e segredos existirem, o job falha toda segunda-feira.
5. **(Médio) Regras 1, 3, 4, 5 e 10 sem enforcement automático.** Hoje só o `CLAUDE.md` as declara.
6. **(Baixo agora, alto depois) Publicação:** estados draft/canário/produção/rollback não modelados. A regra 9 (índice H ≥ 95%) depende de dados do Search Console que ainda não foram extraídos de verdade.

## 6. Capacidades existentes a preservar

- Decisões aceitas (ADR-001 a 010): Postgres primeiro, gates separados sem nota única, TypeScript no produto e Python em análise/medição, Postgres como contrato, Python no GitHub Actions.
- Regras inegociáveis (agora em `CLAUDE.md`).
- O Python do motor e do Search Console: **preservar quando recuperado**, sem reescrever.
- Dicionário de dados (`menlo/docs/menlo-os/05-dicionario-de-dados.md`, 19 de 26 tabelas, rascunho).

## 7. Pré-requisitos ausentes e bloqueios

| Falta | Bloqueia | Quem |
| --- | --- | --- |
| Zips originais (`.sql` 01 a 10, `.py`, `requirements.txt`) | Esquema, RLS, motor, medição | Dono do produto |
| Confirmação de revogação dos segredos expostos | Qualquer novo push/CI | Dono do produto |
| Texto dos ADRs 001 a 010 | Regra 6, auditoria de decisões | Dono do produto |
| Amostra e esquema do feed da RE/MAX | Importador (passo 1 do slice) | RE/MAX |
| Contrato do template `/perto-de/` e `entity_type_schema` do pack | Primeiro page recipe | Dono do produto e RE/MAX |
| Projeto Neon e credenciais | Nada do slice local; só deploy | Dono do produto |

## 8. Primeiro slice vertical recomendado

Adaptação do fluxo candidato, **sem** o feed da RE/MAX e **sem** Neon, usando um Postgres local descartável (Docker) e dados sintéticos de fixture, dentro de `packs/real-estate`:

1. Aplicar as migrations 0.1 a 0.5 (recuperadas) num Postgres 16 local como dono do esquema.
2. Rodar os testes de RLS como `menlo_app`.
3. Inserir um conjunto mínimo e sintético: 1 tenant, 2 tenants para o teste de isolamento, ~5 entidades, claims com evidência.
4. Registrar uma `opportunity` com fatores separados e ação `create`.
5. Compilar **uma** página de **uma** família (por exemplo `perto-de`) a partir de claims, com tokens `{{fact:id}}`, sem LLM.
6. Rodar os gates bloqueantes; gravar um `quality_gate_result` por gate.
7. Emitir um artefato de preview com `noindex`.
8. Testar idempotência (rodar duas vezes, mesmo estado) e isolamento entre tenants.

Passos de LLM (narrativa) e Search Console real ficam **fora** do primeiro slice.

## 9. Backlog priorizado

**P0**
1. Recuperar e versionar os SQL (e depois os `.py`) no `plataforma`, sem reescrever.
2. Confirmar a revogação dos segredos do G11.
3. Postgres local descartável + comando único que aplica as migrations e roda os testes de RLS como `menlo_app`.
4. Decidir a relação Drizzle x SQL escrito à mão (ADR curto, regra 6).

**P1**
5. Contratos Zod do dicionário de dados e schema Drizzle em modo leitura/introspecção das tabelas existentes.
6. Alinhar Node (22 vs 24) e mover o CI para o repo de código.
7. Scripts reais: `pnpm test`, `pnpm test:rls`, `pnpm eval:gate`; checagem automática da regra 10.
8. Escrever os textos dos ADRs 001 a 010.

**P2**
9. Page recipe e compilador do slice.
10. Quality Gate com um gate bloqueante real.
11. Playwright, quando existir um fluxo de interface (preview/draft).
12. AI SDK, quando houver um caso de uso aprovado de narrativa (regra 1).
13. Neon, observabilidade, workflows e queues.

## 10. Decisão de dependências

| Candidato | Bloqueia o slice? | Evidência / recomendação |
| --- | --- | --- |
| PostgreSQL local (Docker) e migrations | **Sim** | Regra 2 e o slice dependem do esquema; `docker` e `psql` já existem na máquina. Fazer primeiro |
| Neon | Não | Só para deploy/ambiente compartilhado; PostGIS/pgvector ainda não testados lá. Depois do slice local |
| Playwright | Não | Não há fluxo de interface; só o preview do slice. P2 |
| Vercel AI SDK e AI Gateway | Não | O slice não usa LLM (regra 1). Sem caso de uso definido. P2 |
| Workflows e queues | Não | O slice roda como script idempotente. Depois |
| Observabilidade | Não | Sem tráfego nem execução recorrente |
| Search Console | Não | Extrator ausente e nunca testado ao vivo; medição vem depois |

## 11. Próxima ação imediata e critérios de aceite

**Recuperar e versionar o esquema SQL e seus testes de RLS no `plataforma`** (`db/migrations/`), sem executá-los contra banco.

Aceite:
- Os arquivos `01` a `10` existem em `db/migrations/`, na ordem do README do `menlo`, com os nomes batendo e os links do LEIA-ME corrigidos.
- Nenhum arquivo foi editado em relação ao original (comparação por hash fornecida pelo dono do produto, ou diff vazio).
- Nenhum segredo, DSN ou credencial nos arquivos copiados (`grep` limpo).
- `pnpm turbo typecheck lint build` continua passando.
- Nada foi executado contra banco.

Bloqueado até o dono do produto fornecer os arquivos originais.

## 12. Hipóteses e decisões em aberto do dono do produto

- Hipótese: `plataforma` é o repositório de código e `menlo` só documentação (decidido em chat, ainda não refletido nos docs do `menlo`).
- Onde estão os zips originais?
- Os segredos do G11 foram revogados?
- Drizzle gera o esquema ou apenas o lê (introspecção)? Recomendação: ler, enquanto o SQL à mão for a fonte.
- Node 22 ou 24 como alvo oficial?
- Meta de módulos por template e contrato do template `/perto-de/` (pendências `13-pendencias.md`).
- Aprovar a lista de termos de marca e a permissão do Search Console (RE/MAX), necessárias só depois do slice.

---

# Atualização da Fase 1 (2026-10-11)

Esta seção verifica a auditoria acima e acrescenta triagem de segurança, decisão de runtime e arquitetura de banco. Nada foi instalado, executado contra banco ou commitado.

## 13. Baseline reverificado

| Item | Observado |
| --- | --- |
| `plataforma` | `/Users/joaormendes/plataforma`, branch `main`, sem remoto; commits `3627769`, `f20ed13`, `9471634` (o `9471634` existe: `git cat-file -t` retornou `commit`) |
| Árvore de trabalho | `docs/audits/` não rastreado; depois desta fase também `docs/adr/ADR-011…`, `ADR-012…`, `docs/adr/README.md` modificado e `docs/proposals/` |
| `menlo` | `/Users/joaormendes/Projects/menlo`, `main` alinhada com `origin/main`, remoto `github.com/jr275/menlo.git`; commits `be68f81`, `3c630f4`, `1da3065`; sem stash |
| Arquivos rastreados no `menlo` fora de `docs/menlo-os/` | `.env.example`, 3 arquivos em `.github/`, `.gitignore`, `CODEOWNERS`, `CONTRIBUTING.md`, `LICENSE`, `PENDENTES.md`, `README.md`, `SECURITY.md`, 3 READMEs (`analytics/gsc`, `db/migrations`, `docs/adr`), `docs/dev-setup.md`, `docs/runbook.md`. Nenhum `.sql` ou `.py` |
| Auditoria anterior | Ainda válida: `plataforma` continua sem migrations, testes, API ou motor |

## 14. Triagem de segurança: G11

**O que o G11 diz** (`menlo/PENDENTES.md`, linha 19): "Revogar segredos expostos — Você: revogar no Google Cloud/Neon/Vercel antes do primeiro push". O G12 (linha 20) manda apagar arquivos `.bak`. O texto não diz quais credenciais, onde nem quando foram expostas.

**Escopo inspecionado (só metadados, nenhum valor lido ou impresso):**
- Histórico Git completo (`--all`) de `menlo` (3 commits) e `plataforma` (3 commits): lista de caminhos já adicionados e busca por padrões de chave privada, JSON de conta de serviço, chaves de API do Google, tokens do GitHub e do Slack, chaves `sk-`, tokens da Vercel e do Neon, e DSNs de Postgres com usuário, senha e host remoto.
- `.gitignore` do `menlo` cobre `.env`, `.env.*` (exceto `.env.example`), `client_secret*.json`, `token*.json`, `saida/` e `*.bak`; o do `plataforma` cobre `.env*`.
- Busca por arquivos `*.bak` em `Downloads`, `Desktop`, `Documents`, `Projects/menlo` e `plataforma` (profundidade 3).

**Resultados:**

| Achado | Evidência | Estado |
| --- | --- | --- |
| Segredo commitado ou enviado ao GitHub pelo `menlo` | Nenhum padrão encontrado em nenhuma revisão; o único arquivo de ambiente já adicionado é `.env.example` | **Sem evidência no escopo inspecionado** |
| Segredo no histórico do `plataforma` | Nenhum; nunca foi enviado a remoto | **Sem evidência no escopo inspecionado** |
| Segredos nos pacotes originais (zips) e nos `.bak` a que o G11/G12 se referem | Esses arquivos não estão no disco e não puderam ser inspecionados | **Impossível determinar** |
| Exposição fora do Git (chat, anexos, capturas, histórico de shell) | Fora do escopo; sem evidência | **Impossível determinar** |

**Estado geral:** potencial exposição que exige verificação do dono do produto. O G11 afirma que há segredos expostos, e o `menlo` já recebeu `push` (`be68f81`, `3c630f4`, `1da3065`) sem confirmação de revogação. Nenhuma prova de que eles foram para o GitHub.

**Limites:** a busca por padrões não detecta segredos em formatos desconhecidos, nem valores codificados ou fragmentados. Ausência de padrão não prova ausência de segredo.

**Contenção recomendada (precisa de sua autorização e de seu acesso; não executei nada):**
1. Dono do produto lista quais credenciais estavam nos pacotes: Google Cloud (credencial do Search Console), Neon (senhas de papel e strings de conexão), Vercel (tokens e chave do AI Gateway).
2. Revogar e rotacionar cada uma no respectivo serviço, mesmo que não tenham ido ao GitHub. Custo baixo, risco alto se for ignorado.
3. Apagar os `.bak` (G12) depois de rotacionar.
4. Antes de copiar os zips para o repo: `grep` de padrões em cada arquivo e revisão manual.
5. Não reescrever histórico nem forçar push; como não há evidência de segredo no histórico, não é necessário.
6. Não bloqueia trabalho local; bloqueia apenas ligar o `gsc-semanal.yml` e qualquer uso das credenciais reais.

## 15. Proposta de runtime Node.js

Ver `docs/adr/ADR-012-versao-do-node.md`. **Recomendação: Node 24 LTS** (valor local, dentro de todos os `engines` das dependências instaladas, padrão atual da Vercel, suporte mais longo). O "22" do CI do `menlo` é provisório e não está em nenhum ADR; o `>=24` do `package.json` foi definido no scaffold e também não vem de documento. Arquivos a alterar quando aprovado: `plataforma/.nvmrc`, `plataforma/package.json` (opcional), `plataforma/.github/workflows/ci.yml` (novo), `menlo/.github/workflows/ci.yml` (remover ou atualizar), `menlo/docs/dev-setup.md`.

## 16. Banco de dados: recuperação e arquitetura

**Recuperação (uma tentativa limitada, somente leitura):** `Downloads`, `Desktop`, `Documents`, `Projects/menlo` e `plataforma` (profundidade 4) por `*.sql`, `load_gsc*`, `gsc_semanal*`, `requirements.txt`, `*menlo*.zip`, `*esquema*` e `*migra*`; histórico Git de `menlo` e `plataforma` por `.sql` e `.py`. Resultado: só o diretório `Projects/menlo/db/migrations` (README) casou com `*migra*`. **Os originais continuam indisponíveis.** Não foram recriados arquivos com os nomes originais. Os testes históricos de RLS não podem ser tidos como passando.

**Decisão de propriedade do esquema:** `docs/adr/ADR-011-fonte-do-esquema.md` (PROPOSED). Recomenda a opção B: SQL escrito à mão como autoridade, Drizzle como camada tipada. Evidência de tensão nos docs: `menlo/docs/dev-setup.md` descreve `packages/db` como "esquema Drizzle" e `db/migrations` como "SQL versionado" ao mesmo tempo.

**Novo baseline:** `docs/proposals/NEW_SCHEMA_BASELINE.md`. Não cria nenhum arquivo de esquema. Aponta o que o dicionário não permite inferir, em especial: tipos e chaves, as tabelas da migração 0.3, e a ausência de `page_recipe` e de artefato de página.

## 17. Primeira fatia de implementação (harness de RLS atendido na Fase 2, ver seção 21)

**Bloqueio genuíno:** decisão do dono do produto sobre o esquema (recuperar os originais ou aprovar baseline novo) e sobre ADR-011. É um bloqueio de fundação, não de ferramenta.

**Não bloqueiam:** Neon (integração posterior), Playwright (sem fluxo de interface), AI SDK (sem caso de uso), filas (conveniência).

**Primeira tarefa recomendada, após aprovação:** um *harness* de RLS em Postgres local descartável, com **uma** tabela de canário (`tenant` e uma tabela com `tenant_id`) e o fluxo de dois papéis (dono do esquema e aplicação). Prova a regra 2 de ponta a ponta sem inventar o esquema do produto.

Critérios de aceite:
- Um comando sobe um Postgres 16 descartável, aplica as migrations como dono e roda os testes como papel de aplicação sem superusuário.
- O teste falha se rodar como superusuário (guarda explícita).
- Dois tenants não se leem nem se escrevem; sem `app.tenant_id` retorna zero linhas.
- `pnpm turbo typecheck lint build` continua passando.
- Nenhuma conexão com Neon ou serviço externo.

## 18. Plano priorizado (revisado)

**P0:** decisão sobre originais vs. baseline novo; aprovar ADR-011 e ADR-012; contenção do G11 pelo dono do produto.
**P1:** harness de RLS local (seção 17); `.nvmrc` e CI no `plataforma`; textos dos ADRs 001 a 010; scripts reais `test`, `test:rls`.
**P2:** baseline v1 mínimo (entidades, claims, evidência, oportunidade); receitas e artefatos de página; compilador e um gate; Playwright e AI SDK quando houver caso de uso; Neon depois do slice local.

## 19. Próximo prompt de implementação (SUPERSEDIDO: o harness foi feito como fixture de teste; ver seção 25)

```
Contexto: ADR-011 (opção B) e ADR-012 (Node 24) foram aprovados. Os originais do esquema
não foram recuperados e não vamos recriá-los.
Tarefa: criar o harness de RLS local em ~/plataforma, sem tabelas do produto.
1. Escreva docs/adr/ADR-013 curto sobre os papéis (dono do esquema, aplicação).
2. Crie db/migrations/0001_papeis_e_canario.sql: papel de aplicação sem superusuário
   nem BYPASSRLS, tabela tenant e uma tabela canario com tenant_id, RLS FORCE e política
   por current_setting('app.tenant_id', true).
3. Crie db/tests/ com o teste de isolamento (dois tenants, leitura e escrita cruzadas,
   WITH CHECK, sem app.tenant_id) e uma guarda que falha se rodar como superusuário.
4. Crie scripts/test-rls.sh e o script pnpm test:rls que sobe um Postgres 16 descartável
   em Docker local, aplica as migrations como dono e roda os testes como papel de aplicação.
5. Adicione .nvmrc com 24.
Restrições: sem Neon, sem dependências novas além das que eu aprovar nominalmente antes
de instalar, nenhuma credencial real, não commitar sem meu aval.
Verifique: pnpm test:rls, pnpm turbo typecheck lint build, e mostre a saída.
```

## 20. Decisões necessárias do dono do produto

1. Recuperar os originais (onde estão?) ou aprovar um baseline novo.
2. Aprovar ou ajustar ADR-011 (SQL como autoridade) e ADR-012 (Node 24).
3. G11: quais credenciais estavam nos pacotes, e autorizar a rotação por você.
4. Nome do papel de aplicação (`menlo_app` ou outro).
5. Como modelar receitas e artefatos de página (o dicionário não define).

---

# Atualização da Fase 2 (2026-10-11): validação de arquitetura e harness de RLS

## 21. O que foi implementado

Uma fixture de teste isolada, **não** o esquema do produto, e **nenhuma** migration de produto.

| Arquivo | Papel |
| --- | --- |
| `scripts/test-rls.sh` | Driver. Cria um cluster PostgreSQL 16 novo com `initdb` num diretório temporário, escuta só em socket Unix dentro dele (sem TCP), aplica a fixture, roda os testes e apaga tudo ao sair (`trap`). Trava de segurança: aborta se `data_directory` não for o do cluster descartável ou se houver `listen_addresses` |
| `package.json` | Único ajuste: script `"test:rls": "bash scripts/test-rls.sh"` |
| `db/test-fixtures/rls/00_roles.sql` | Papéis `rls_fixture_owner` e `menlo_app` (`NOSUPERUSER NOBYPASSRLS`) |
| `db/test-fixtures/rls/10_fixture.sql` | Esquema `rls_fixture`, tabela `tenant_item`, grants, `ENABLE` + `FORCE ROW LEVEL SECURITY`, política `tenant_isolation`, dados de dois tenants, helpers `rls_test.*` |
| `db/test-fixtures/rls/tests/` | `10_app_isolation.sql` (como `menlo_app`), `20_owner.sql` (como dono), `30_superuser_integrity.sql` (como superusuário do cluster descartável) |
| `db/test-fixtures/rls/mutations/` | 6 configurações deliberadamente erradas |
| `db/test-fixtures/rls/README.md` | Como rodar, contexto de tenant, limites |
| `CLAUDE.md` | Uma linha apontando `pnpm test:rls` |

Mecanismo: a política compara `tenant_id` com `nullif(current_setting('app.tenant_id', true), '')::uuid`. A aplicação define o contexto com `set_config('app.tenant_id', '<uuid>', true)` **dentro de uma transação** (local à transação). Sem contexto, valor vazio ou valor malformado: zero linhas ou erro, nunca linhas de outro tenant.

## 22. Matriz de testes e resultados observados

Ambiente: PostgreSQL **real** `16.15 (Homebrew)`, aarch64-apple-darwin, cluster descartável criado pelo próprio script. Não houve mock.

| Teste | O que verifica | Resultado |
| --- | --- | --- |
| T1 | Tenant A lê as próprias linhas | ok |
| T2 (x2) | Tenant A não lê linhas de B (por `tenant_id` e por `payload`) | ok |
| T3, T3b | Inserir linha de B falha (42501); inserir a própria funciona (controle positivo) | ok |
| T4 (x3) | Update e delete em linhas de B afetam 0 linhas; mover linha própria para B falha (42501) | ok |
| T5 (x6) | Sem contexto, contexto vazio e contexto malformado (22P02): nada exposto, escrita rejeitada | ok |
| T5b, T5c | Contexto local não sobrevive a `COMMIT`, `ROLLBACK` nem a comando fora de transação explícita | ok |
| T5d | Demonstra o perigo do contexto de sessão (`is_local=false` vaza entre transações) e que `RESET` o limpa | ok |
| T6 (x13) | `menlo_app`: não é superusuário, sem `BYPASSRLS`, não cria papéis/bancos, não é dono nem membro do dono, RLS ativo e forçado, só SELECT/INSERT/UPDATE/DELETE (sem TRUNCATE/REFERENCES/TRIGGER), não faz TRUNCATE, não desliga RLS, não derruba a política, não assume o dono, não cria objetos, `row_security=off` gera erro em vez de burlar | ok |
| T7 (x7) | Dono: sem superusuário/`BYPASSRLS`, tem privilégios que a aplicação não tem (TRUNCATE, DDL), `FORCE` o sujeita ao RLS, não assume `menlo_app` | ok |
| S1 | **Superusuário ignora RLS mesmo com `FORCE`** (comportamento verificado, não presumido) | ok |
| S2, S3 | Dados de A e B intactos depois dos testes; nenhum outro papel é superusuário/`BYPASSRLS`; uma política `ALL` só para `menlo_app`; `menlo_app` não possui objetos; `PUBLIC` sem privilégios | ok |
| L1 | Limitação documentada: `menlo_app` pode escolher o próprio contexto de tenant | ok (é limitação, não garantia) |
| T8 | Segunda execução no mesmo banco, e depois das mutações com papéis restaurados, produz resultado idêntico; duas execuções completas do script (clusters novos) tiveram saída idêntica | ok |
| T9 | 6 mutações detectadas: `policy_allows_all`, `rls_disabled`, `app_bypassrls`, `app_superuser`, `app_owns_table`, `excess_grant` | 6/6 |

Total: **47 verificações na suíte principal, 6/6 mutações detectadas**, saída `RLS HARNESS: PASSED`. Controle negativo: com a política da fixture quebrada de propósito (`USING (true)`), o script retornou código de saída `1` com 3 verificações `not ok`; a fixture foi restaurada em seguida e o script voltou a retornar `0`. Sem o PostgreSQL 16 disponível, o script retorna `2`.

Observação sobre `excess_grant`: com `TRUNCATE` concedido, o próprio teste executa o `TRUNCATE` (nada o impede) e apaga os dados daquele banco de mutação. Isso ocorre só no banco descartável da mutação e confirma por que o privilégio `TRUNCATE` precisa ser negado.

## 23. Limites e requisitos de segurança restantes antes de produção

- A fixture não é o esquema do produto e não prova que a plataforma é segura. Cobre uma tabela, uma política e dois papéis.
- O `menlo_app` define o próprio `app.tenant_id` (L1). É preciso uma camada de API que vincule o tenant ao usuário autenticado (regra 4, `packages/api` ainda não existe) e nunca use contexto de sessão.
- Superusuário ignora RLS mesmo com `FORCE` (S1). Produção precisa garantir que a aplicação e os carregadores nunca conectem como superusuário nem como papel com `BYPASSRLS`, e separar a credencial do dono do esquema da credencial da aplicação.
- Autenticação `trust` por socket Unix é só para o teste. Produção exige autenticação real, TLS e gestão de segredos.
- Não cobertos: views (`security_invoker`, PostgreSQL 15+), funções `SECURITY DEFINER`, pool de conexões, particionamento, concorrência, extensões (pgvector, pg_trgm, PostGIS), Neon (o comportamento do Neon com papéis e RLS não foi testado), autorização na API, fluxos de trabalho e ferramentas de IA.
- O harness depende de binários PostgreSQL 16 locais (Homebrew aqui). O CI do `plataforma` ainda não existe; ao criá-lo, apontar `RLS_HARNESS_PG_BIN_DIR`.

## 24. Inconsistências encontradas e corrigidas

| Achado | Ação |
| --- | --- |
| ADR-011 citava `app_role` e deixava o nome do papel em aberto, mas a decisão é manter `menlo_app` | ADR-011 corrigido para `menlo_app` |
| ADR-011 ainda constava como PROPOSED; ADR-012 também | Status atualizados e índice de ADRs corrigido (ADR-011 aceito como direção; ADR-012 aceito como runtime pretendido, alinhamento pendente) |
| Seção 19 deste relatório propunha `db/migrations/0001_papeis_e_canario.sql`, o que conflita com a regra de não criar migration de produto como efeito colateral | Marcada como superada |
| **Scaffold em conflito com a decisão:** scripts `generate`/`migrate` do `drizzle-kit` e `drizzle.config.ts` com `out: "./drizzle"` | Não corrigido na Fase 2; **corrigido na Fase 3** (seção 30) |
| O macOS exigiu `LC_ALL` válido para o `postgres` subir ("became multithreaded") | O script exporta `LC_ALL=en_US.UTF-8` (sobrescrevível por `RLS_HARNESS_LC_ALL`) |

## 25. Alinhamento de runtime (relatado na Fase 2; executado na Fase 3, seção 31)

Mudanças necessárias numa tarefa posterior, nenhuma feita agora: criar `.nvmrc` com `24`; opcionalmente restringir `engines.node` a `^24` em `package.json`; criar `.github/workflows/ci.yml` no `plataforma` com `node-version: 24` e PostgreSQL 16 (apontando `RLS_HARNESS_PG_BIN_DIR`); remover ou atualizar `menlo/.github/workflows/ci.yml` (Node 22) e `menlo/docs/dev-setup.md`. O build e o lint atuais passam em Node 24.9.0, o que sustenta a compatibilidade local, mas isso não substitui a verificação no CI.

## 26. Decisões pendentes de modelagem: receitas e artefatos de página

Não decididas e não chutadas; as perguntas estão em `docs/proposals/NEW_SCHEMA_BASELINE.md`, seção 10 (identidade e versionamento da receita, contrato, relação com `template`, o que o artefato congela, ciclo de vida e estado de compilação, relação com `quality_gate_result`).

## 27. G11 (inalterado)

Continua **potencial exposição que exige verificação**. Sem evidência nos caminhos Git inspecionados e nos padrões buscados; os arquivos citados pelo G11/G12 não estavam disponíveis; **a revogação não foi confirmada**. Nada permite concluir que os segredos estão seguros nem que não houve exposição. Nenhum valor de credencial foi lido, pedido ou registrado, e nenhuma credencial foi usada, rotacionada ou validada.

## 28. Próxima tarefa recomendada (concluída na Fase 3; ver seção 36)

**Alinhamento do repositório (runtime, CI e Drizzle):**
1. Criar `.nvmrc` (`24`).
2. Remover os scripts `generate` e `migrate` e o `out` do `drizzle.config.ts` em `packages/db`, conforme ADR-011.
3. Criar `.github/workflows/ci.yml` no `plataforma` com Node 24 e PostgreSQL 16 rodando `pnpm turbo typecheck lint build` e `pnpm test:rls`, de início só `workflow_dispatch`.

Aceite: `pnpm turbo typecheck lint build` e `pnpm test:rls` passam localmente; `grep -n "drizzle-kit generate\|drizzle-kit migrate" -r packages` não retorna nada; o CI roda no GitHub quando o repositório tiver remoto (nada é enviado sem aprovação). Nenhum esquema de produto é criado.

---

# Atualização da Fase 3 (2026-10-11): autoridade do esquema, runtime Node e CI

## 29. Estado verificado antes de editar e conflitos encontrados

Árvore de trabalho com mudanças não commitadas da Fase 2 preservadas (HEAD ainda `9471634`; sem `.github/`, sem `.nvmrc`).

| Conflito | Evidência |
| --- | --- |
| Scripts `generate` e `migrate` do `drizzle-kit` contra o ADR-011 | `packages/db/package.json` linhas 10 e 11 (antes da edição) |
| `drizzle.config.ts` com `out: "./drizzle"` (saída de migrations) | `packages/db/drizzle.config.ts` (usado só pelo `drizzle-kit`; nenhum outro arquivo o importava; fora do `include` do `tsconfig`) |
| `engines.node` = `>=24` (aceita 25, 26 e versões não LTS) e sem `.nvmrc`, contra o ADR-012 | `package.json` |
| Harness com ajuste de locale só para macOS e caminhos de binários só do Homebrew | `scripts/test-rls.sh` |
| Docker daemon desligado nesta máquina | `docker info` falhou ao conectar no socket |

## 30. Autoridade única do esquema (aplicada)

- Removidos: scripts `generate` e `migrate` de `packages/db/package.json` e o arquivo `packages/db/drizzle.config.ts`.
- Preservados: `drizzle-orm` e `@neondatabase/serverless` (runtime, em `packages/db/src/index.ts`), `packages/db/src/schema.ts` (declarações tipadas de tabelas, hoje vazio) e a `devDependency` `drizzle-kit`. Ela fica porque a introspecção (`drizzle-kit pull`) e a checagem de deriva do ADR-011 continuam candidatas e sem decisão; removê-la agora exigiria mexer no lockfile sem necessidade. Sem `drizzle.config.*`, os comandos de geração não rodam por acidente.
- Fluxo autoritativo: SQL escrito à mão em `db/migrations/` (ainda não existe; ver tarefa seguinte), aplicado como dono do esquema; testes de RLS como `menlo_app`; Drizzle só para tipos e consultas.
- Imposição: `scripts/check-consistency.sh` (`pnpm check:consistency`, também no CI). Falha se existir `drizzle.config.*`, histórico `drizzle/meta`, ou `drizzle-kit generate|migrate|push|up|drop` em `package.json`, `turbo.json`, `.github/` ou `scripts/`. Testado de forma negativa: cada violação produziu código 1 e o estado limpo, código 0.
- Nenhum esquema de produto nem migration foi criado.

## 31. Runtime Node e gerenciador de pacotes

- `.nvmrc`: `24`. `package.json`: `"engines": { "node": "^24" }`. `packageManager`: `pnpm@12.10.1`, igual a `packageManagerDependencies.pnpm.version` do `pnpm-lock.yaml`. Nenhuma versão de dependência e nenhuma linha do lockfile mudou (`pnpm install --frozen-lockfile --lockfile-only` passou sem alterar o arquivo).
- O CI lê o Node de `.nvmrc` (`node-version-file`), e o pnpm de `packageManager`. `check:consistency` falha se `.nvmrc`, `engines` ou o pnpm do lockfile divergirem, ou se um workflow fixar o Node à mão.
- Verificação sob o runtime pretendido: `node v24.9.0`, `pnpm 12.10.1`; `pnpm turbo typecheck lint build --force`: 5 de 5 tarefas passaram. Isso comprova compatibilidade local do código atual, que ainda é um scaffold pequeno; não é prova de compatibilidade do produto futuro.

## 32. Desenho do CI (`.github/workflows/ci.yml`)

- **Gatilhos:** `pull_request`, `push` em `main`, `workflow_dispatch`.
- **Segurança:** `permissions: contents: read`; `persist-credentials: false` no checkout; sem segredos, sem deploy, sem push, sem banco externo; `concurrency` cancela execuções antigas da mesma ref.
- **Runner:** `ubuntu-24.04` (fixado), `timeout-minutes: 20`.
- **Passos, em ordem (qualquer falha derruba o job):**
  1. `actions/checkout@v4`
  2. `pnpm/action-setup@v4` (versão vinda de `packageManager`)
  3. `actions/setup-node@v4` com `node-version-file: .nvmrc` e `cache: pnpm`
  4. `pnpm install --frozen-lockfile`
  5. `pnpm check:consistency`
  6. `pnpm turbo typecheck lint build`
  7. `sudo apt-get install -y --no-install-recommends postgresql-16` (pacote do Ubuntu 24.04) e `postgres --version`
  8. `pnpm test:rls` com `RLS_HARNESS_PG_BIN_DIR=/usr/lib/postgresql/16/bin`
- **PostgreSQL 16 no CI:** instalado explicitamente por `apt`; o harness não usa o serviço do sistema nem rede: cria o próprio cluster descartável (socket Unix em diretório temporário) com os binários do pacote. O script aborta com código 2 se a versão major não for 16.
- A sintaxe YAML do workflow foi parseada (Ruby, 8 passos). Nenhum linter de Actions (por exemplo, `actionlint`) estava disponível.
- Melhoria futura: fixar as actions por SHA de commit em vez de tag de versão major (não feito: não foi possível resolver os SHAs sem consultar o GitHub).

## 33. Validação local do harness (resultados observados)

| Verificação | Resultado |
| --- | --- |
| `pnpm test:rls` (PostgreSQL 16.15 real, Homebrew, macOS aarch64) | `PASSED`: 47 verificações, 6 de 6 mutações detectadas, saída 0 |
| Política da fixture quebrada de propósito (`USING (true)`) | código de saída 1, 3 `not ok` |
| Arquivo de teste removido (teste "pulado") | código de saída 1 (falha por erro do `psql`, não passa em silêncio) |
| PostgreSQL ausente (`RLS_HARNESS_PG_BIN_DIR` inválido) | código de saída 2 |
| PostgreSQL de versão major diferente (simulado com um `initdb` falso 15.4) | código de saída 2 |
| Cleanup | nenhum diretório temporário restante (a partir da Fase 4 o prefixo é `plataforma-pg.*`, definido em `scripts/lib/disposable-pg.sh`); o único Postgres em execução na máquina (do projeto Wendy, `-D /opt/homebrew/...`, iniciado antes) não foi tocado; o harness só usa o próprio `-D` temporário e o próprio socket |
| Credenciais | nenhuma necessária; nenhum `DATABASE_URL` lido; autenticação `trust` apenas no socket do cluster descartável |
| `pnpm check:consistency`, `pnpm turbo typecheck lint build` | passaram |

## 34. O que não foi verificado e diferenças entre local e CI

- **O workflow nunca rodou no GitHub.** Não há remoto e não houve push, então não há execução de CI. Tudo acima é verificação local.
- O harness só foi executado no macOS. Não foi possível reproduzir o Linux do runner: o Docker daemon está desligado, então não houve teste em contêiner Ubuntu 24.04. Pontos específicos de Linux não verificados: nome do pacote e caminho `/usr/lib/postgresql/16/bin`; `initdb` com `--no-locale` e o ambiente de locale do runner; `mktemp` e socket em `/tmp`; o `bash` 5 do runner (localmente foi usado o `bash` 3.2 do macOS, o que cobre o subconjunto mais restrito).
- A versão exata do PostgreSQL 16 pode diferir entre o Homebrew (16.15) e o pacote do Ubuntu.
- A ação `pnpm/action-setup@v4` precisa instalar o pnpm 12.10.1 declarado em `packageManager`; não foi possível confirmar sem executar o workflow.
- Primeira execução real recomendada: `workflow_dispatch` ou um PR assim que existir remoto (a configuração do remoto depende de autorização).

## 35. Identidade de tenant: o que o harness prova e o que não prova

**O que prova** (PostgreSQL 16.15 real, tabela de teste): dado um papel de aplicação sem privilégios de bypass e uma sessão cujo `app.tenant_id` está definido em transação, a política `FORCE ROW LEVEL SECURITY` impede ler, inserir, alterar e apagar linhas de outro tenant; sem contexto ou com contexto inválido não vaza nada; o contexto local à transação não sobrevive a `COMMIT`/`ROLLBACK`; configurações erradas conhecidas (política permissiva, RLS desligado, `BYPASSRLS`, superusuário, dono, `TRUNCATE`) derrubam a suíte.

**O que não prova:** que o tenant escolhido pertence ao usuário autenticado. O teste `L1` mostra que `menlo_app` define o próprio `app.tenant_id` e passa a ver os dados do tenant escolhido. RLS e `FORCE` só aplicam a política ao valor que a sessão informa; não validam quem o informou.

**Por que uma variável de sessão livre é frágil:** qualquer caminho de código que execute SQL com a credencial da aplicação (consulta bruta, injeção de SQL, ferramenta de IA com acesso ao banco, worker mal configurado, credencial vazada) pode executar `SET`/`set_config` e trocar de tenant; o banco confia no valor. A fronteira de segurança real passa a ser o código da aplicação, não o banco.

**O que a API futura precisa fazer:**
- Derivar o tenant da identidade verificada (sessão ou token validado no servidor) e da associação autorizada do usuário (tabela de membros), nunca de cabeçalho, corpo, parâmetro ou ID fornecido pelo cliente.
- Definir `app.tenant_id` em um único ponto de acesso a dados, com `set_config(..., true)` dentro da transação da requisição, nunca em nível de sessão.
- Para usuário em vários tenants, exigir escolha explícita entre os tenants dos quais é membro e revalidar a autorização a cada requisição.
- Propagar o tenant em jobs e workflows a partir de registro criado por código confiável, e restringir ferramentas de IA ao tenant e ao orçamento da execução.
- Registrar em auditoria cada definição de contexto de tenant.

**Testes adicionais antes de produção:** usuário do tenant A tentando acessar IDs e rotas do tenant B (cabeçalho, corpo e URL forjados) deve receber 403/404; tentativa de injeção que chame `set_config` ou `SET app.tenant_id`; teste de vazamento com pool de conexões (inclusive modo de transação); propagação de tenant em jobs e em ferramentas de IA; verificação (lint ou teste) de que nenhum código fora do ponto único usa `set_config` ou `SET app.`, e de que nunca se usa `is_local=false`; teste com a credencial real do papel de aplicação em ambiente de integração; revisão de modelagem de ameaças (SSRF, prompt injection, vazamento de segredo).

**Opções de modelo de identidade reforçado no banco, para decisão futura (nenhuma implementada, nenhum mecanismo próprio inventado):**

| Opção | Ideia | Trade-offs |
| --- | --- | --- |
| A. Papel por tenant | `SET ROLE` para um papel por tenant, políticas usam `current_user` | Isolamento forte no banco; explosão de papéis, atrito com pool e Neon, migrations por tenant |
| B. Um banco (ou projeto Neon) por tenant | Isolamento físico | Mais forte; custo e operação, migrations em N bancos, difícil para análise entre tenants |
| C. Contexto só por função verificadora | O papel da aplicação não pode definir a variável; uma função `SECURITY DEFINER` valida a associação do usuário antes de definir | Reduz o raio do erro; mais complexidade e superfície em `SECURITY DEFINER` (exige revisão e testes dedicados) |
| D. Manter variável de sessão e confiar na API | Situação atual | Mais simples; segurança depende por inteiro do código da aplicação e dos testes acima |

Decisão pendente do dono do produto. Nenhuma foi tomada nesta fase.

## 36. Próxima tarefa recomendada (concluída na Fase 4; ver seções 38 a 45)

**Runner de migrations SQL sobre o harness**, sem tabelas de produto:
- Convenção `db/migrations/NNNN_descricao.sql`, com um runner que aplica em ordem como dono do esquema, registra checksum em uma tabela de controle e recusa migration já aplicada que tenha sido editada.
- Testado no PostgreSQL 16 descartável do próprio harness (`pnpm test:rls` ou um comando irmão).

Aceite:
- Aplica migrations em ordem, é idempotente (rodar duas vezes não muda nada) e falha com código diferente de zero se um arquivo aplicado mudar ou se houver lacuna de numeração.
- A tabela de controle é a única tabela criada; nenhuma tabela de produto, nenhum esquema do Neon.
- `pnpm check:consistency`, `pnpm turbo typecheck lint build` e `pnpm test:rls` continuam passando.
- Sem commit, push ou conexão externa.

## 37. G11 (inalterado)

Continua **potencial exposição que exige verificação**: sem evidência nos caminhos Git inspecionados e nos padrões buscados, arquivos citados pelo G11/G12 indisponíveis, revogação não confirmada. Nenhum valor de credencial foi lido, e nenhuma credencial foi usada ou rotacionada.

---

# Atualização da Fase 4 (2026-10-11): runner de migrations SQL

## 38. Estado antes de editar

- **Árvore de trabalho:** mudanças não commitadas das Fases 2 e 3 preservadas (HEAD `9471634`); `db/migrations/` não existia; nenhum `.sql` de produto, nenhum runner, nenhuma dependência de migration (`drizzle-kit` ficou só como `devDependency`, sem scripts nem config).
- **Arquitetura de banco e scripts:** `packages/db` (Drizzle runtime, `schema.ts` vazio); `db/test-fixtures/rls/` (fixture de RLS); `scripts/test-rls.sh` (harness), `scripts/check-consistency.sh`; CI com `check:consistency`, `turbo typecheck lint build` e `test:rls`.
- **Como o harness provisiona e isola o PostgreSQL:** `initdb` novo em diretório `mktemp` próprio (`chmod 700`, arquivo marcador), servidor só com socket Unix naquele diretório (`listen_addresses=''`), `PGHOST` e demais variáveis `PG*` redefinidos, trava que aborta se `data_directory` não for o do cluster descartável ou se houver `listen_addresses`, e `trap` que só remove o próprio diretório (confere o padrão do nome e o marcador).
- **Abordagem escolhida:** Bash + `psql`, sem dependência nova e sem mexer no lockfile. Motivo: um driver Node (`pg`) seria uma dependência nova; o `@neondatabase/serverless` do repositório é um driver HTTP/WebSocket que não mantém uma sessão local com lock de aconselhamento. O `psql` em uma única sessão dá o lock de sessão, as transações explícitas e `ON_ERROR_STOP`, e o harness já o usa.
- **Conflitos encontrados:** nenhum que impedisse a implementação. Ajustes: o prelúdio do harness foi extraído para `scripts/lib/disposable-pg.sh` para o harness de RLS e os testes de migrations compartilharem o mesmo código de isolamento (a saída do `test:rls` ficou idêntica à de antes da refatoração).

## 39. Desenho do runner (SUPERADO em partes na Fase 6: o ledger e o lock mudaram; ver seções 52 a 54)

Documentação completa em `db/migrations/README.md`. Resumo verificado:

- **Arquivos:** `scripts/db-migrate.sh` (runner), `scripts/test-migrations.sh` (testes), `scripts/lib/disposable-pg.sh` (cluster descartável compartilhado), `db/migrations/README.md` (contrato; o diretório está vazio de propósito).
- **Nome e ordem:** `^[0-9]{4}_[a-z0-9][a-z0-9_]*\.sql$`, começando em `0001`, sem lacuna e sem duplicata; ordenação numérica (inteiro decimal); só `README.md` é permitido além das migrations.
- **Checksum:** SHA-256 dos bytes exatos do arquivo, hexadecimal minúsculo, sem normalização. O runner copia os arquivos para um diretório temporário privado e soma e executa a mesma cópia.
- **Ledger:** `plataforma_migrations.ledger` (`seq`, `filename`, `sha256`, `applied_at`, `applied_by`), com restrições de formato; sem privilégios para `PUBLIC` nem para `menlo_app`; estrutura conferida a cada execução.
- **Bloqueio:** `pg_advisory_lock(hashtextextended('plataforma_migrations', 0))` de sessão, obtido antes da validação do histórico e mantido até o fim; um segundo runner espera até `--lock-timeout` (padrão 30 s) e depois sai com código 3.
- **Transação:** uma transação por migration (`BEGIN`, SQL, `INSERT` no ledger, `COMMIT`); falha desfaz tudo e interrompe a execução; a migration já registrada com o mesmo checksum é ignorada.
- **Configuração explícita:** `--socket-dir` (caminho absoluto de socket Unix), `--port`, `--dbname`, `--user`; variáveis `PG*` e `DATABASE_URL` são ignoradas; sem TCP e sem senha (sem acesso a banco remoto nesta versão).
- **Conteúdo proibido:** metacomandos do `psql` e controle de transação no início de linha (verificação heurística), mais a salvaguarda por troca de transação. **(Superado na Fase 9: o runner executa a migration como texto num contexto atômico e esta limitação não existe mais; ver seção 67.)** Limitação da Fase 7: um `COMMIT` escondido na mesma linha de outro SQL é detectado depois de executado, e o que foi confirmado antes dele não pode ser desfeito (exige reparo manual; o ledger não registra a migration).
- **Códigos de saída:** 0 sucesso; 1 integridade, validação ou SQL; 2 uso ou pré-requisito; 3 timeout do lock; 4 falha de conexão.

## 40. Testes executados (`pnpm test:migrations`, PostgreSQL 16.15 real): 112 verificações, 0 falhas

| Grupo | Resultado |
| --- | --- |
| Execução normal (N1 a N4) | ok: diretório vazio cria só o ledger e é estado válido; uma migration é aplicada e o checksum registrado coincide com um SHA-256 calculado por outra ferramenta (`python3 hashlib`); 12 migrations criadas fora de ordem são aplicadas em ordem numérica; a segunda execução não muda nenhum objeto nem linha do ledger; `menlo_app` sem privilégio no ledger |
| Integridade (I1 a I9) | ok: 11 nomes inválidos, subdiretório e link simbólico rejeitados; duplicata, lacuna e início fora de `0001` rejeitados; edição de uma migration aplicada (até de um espaço) detectada; migration ausente, renomeada, renumerada e substituída detectadas; ledger com lacuna, linha fantasma e estrutura diferente falham fechado; checksum malformado recusado pelo próprio banco; erro de sintaxe nomeia a migration e a etapa; banco, porta, socket e papel inexistentes falham sem falso sucesso e sem DSN nem senha na mensagem |
| Transacionalidade (T1 a T8) | ok: falha depois de statements anteriores não deixa tabela nem ledger; a linha do ledger e a tabela têm o mesmo `xmin` (mesma transação); falha no meio impede as seguintes; corrigir e rodar de novo funciona; `COMMIT` no início de linha rejeitado antes de conectar; `COMMIT` escondido detectado (limitação documentada); `\!` (shell) rejeitado e nunca executado; `CREATE INDEX CONCURRENTLY` falha sem execução sem transação; perda de conexão no meio não deixa nada parcial e libera o lock |
| Concorrência (C1 a C3) | ok: dois runners simultâneos aplicam a migration exatamente uma vez (um `applied`, um `current`); o segundo espera o primeiro; com `--lock-timeout 1s` o segundo sai com código 3 e o primeiro conclui; ledger e esquema consistentes |
| Segurança e configuração (S1, S2) | ok: variáveis `PG*` e `DATABASE_URL` do ambiente são ignoradas; faltar `--dbname` ou apontar um host de rede é erro de uso (código 2) |

**Validação do próprio teste (teste de mutação do runner, feito fora do repositório em cópias descartáveis, apagadas depois):** 9 defeitos plantados no runner foram todos detectados pela suíte: sem lock (4 verificações falham), sem comparação de checksum (3), sem transação (39), sem checagem de lacuna (3), sem bloqueio de metacomando (2), código de saída sempre 0 (30), sem checagem de lacuna no ledger (1), sem salvaguarda de troca de transação (2), registro no ledger fora da transação (1).

**Limites do que foi testado:** a ordem numérica só é distinguível da lexicográfica a partir de 10000 migrations, o que a largura fixa de 4 dígitos impede; o teste confirma a ordem de aplicação, e a regra numérica está no código. Dos comandos que não rodam em transação, só `CREATE INDEX CONCURRENTLY` foi exercitado.

## 41. Outras verificações locais

| Verificação | Resultado |
| --- | --- |
| `pnpm test:rls` | passou: 47 verificações, 6/6 mutações; saída idêntica à anterior à refatoração |
| `pnpm turbo typecheck lint build --force` (Node 24.9.0) | 5 de 5 tarefas |
| `pnpm check:consistency` | passou; agora também exige que o workflow execute `pnpm check:consistency`, `pnpm turbo typecheck lint build`, `pnpm test:rls` e `pnpm test:migrations` (verificação estática; testada de forma negativa) |
| `pnpm install --frozen-lockfile --lockfile-only` | passou, lockfile inalterado |
| PostgreSQL ausente ou de versão major diferente (15.4 simulado) no `test:migrations` | código 2 |
| Isolamento | a biblioteca compartilhada aborta se o servidor não for o cluster descartável ou escutar em rede; nenhum diretório ou processo restante; os processos Postgres do projeto Wendy já em execução não foram tocados; nenhuma credencial; nenhuma conexão externa |

## 42. CI e Linux: o que NÃO foi verificado

- **O workflow não rodou no GitHub** (sem remoto). O passo `pnpm test:migrations` foi adicionado ao `ci.yml` depois do `test:rls`, com o mesmo `RLS_HARNESS_PG_BIN_DIR`.
- **Linux não foi exercitado:** o Docker daemon está desligado nesta máquina e não há outro ambiente Linux disponível; tudo foi executado no macOS (bash 3.2, PostgreSQL 16.15 do Homebrew).
- Pontos para fechar com uma execução real: pacote `postgresql-16` e caminho `/usr/lib/postgresql/16/bin`; `initdb --no-locale` e o ambiente de locale do runner (o script só força locale no macOS); `python3` disponível no runner (usado só pelos testes para um SHA-256 independente); `sha256sum` do GNU coreutils no runner (o runner o valida contra o vetor de teste da entrada vazia); comportamento do `sort`, `sed` e `grep` GNU; versão do `bash` 5. Evidência necessária: uma execução verde (ou o log de falha) do `workflow_dispatch` ou de um PR em `ubuntu-24.04`, ou uma execução do `pnpm test:migrations` num contêiner Ubuntu 24.04 com `postgresql-16`.
- As ações de terceiros continuam fixadas por tag de versão major (`actions/checkout@v4`, `actions/setup-node@v4`, `pnpm/action-setup@v4`), não por SHA de commit. Fixar por SHA exige verificar a identidade e a versão oficiais de cada ação, o que não foi feito para não inventar SHAs; fica pendente.

## 43. Limitações de segurança e decisões de produção pendentes

- O runner só fala por socket Unix, sem senha: não alcança banco remoto; **nunca foi executado contra um banco persistente** e não há invocação de produção.
- Papel de migração não definido: o runner usa o `--user` informado. Falta decidir o dono do esquema de produção, a relação com `menlo_app` e a autenticação (TLS, senha ou identidade, Neon).
- A verificação de controle de transação e de metacomandos é heurística por linha; a salvaguarda posterior não desfaz o que já foi confirmado (ver seção 39).
- O ledger é protegido por privilégios e pela validação, não por assinatura: quem for dono do esquema pode alterá-lo; o runner nunca altera nem apaga linhas.
- Continuam valendo as limitações de identidade de tenant (seção 35), o G11 (seção 37), a ausência dos originais do esquema e a modelagem pendente de receitas e artefatos.

## 44. Observação do ambiente

A máquina estava com o disco de dados a 98% e cerca de 1,6 a 4,6 GiB livres durante a fase. Uma execução de teste de um mutante falhou com "No space left on device" (falha do ambiente, não do runner); por isso os testes agora apagam o banco de cada teste ao começar o seguinte. Existem diretórios `/tmp/wendy-p*` (cerca de 1,5 GB cada) que não são deste projeto e não foram tocados.

## 45. Próxima fase recomendada (feita como Fase 5, seção 46: ADR-013 proposto; os itens de implementação seguem pendentes)

**Definir o modelo de acesso e de papéis para executar migrations** (decisão antes de qualquer esquema de produto): papel de migração e dono do esquema, relação com `menlo_app`, como o runner autentica num banco remoto e se roda no CI, no deploy ou à mão. Entregável: ADR curto e, se aprovado, extensão do runner com autenticação explícita testada num PostgreSQL descartável com autenticação por senha (`scram-sha-256`).
Aceite: ADR aprovado; testes novos para a autenticação sem expor credenciais em argumentos, logs ou arquivos; `pnpm test:migrations`, `pnpm test:rls`, `pnpm check:consistency` e `pnpm turbo typecheck lint build` continuam passando; nenhum banco remoto contatado.

---

# Atualização da Fase 5 (2026-10-11): papéis de banco, privilégios de migration e confiança do tenant

Fase de projeto de segurança. Entregável: [ADR-013](../adr/ADR-013-papeis-privilegios-e-confianca-de-tenant.md) (PROPOSED). Nada foi implementado, nenhum arquivo de código, SQL, runner, teste ou CI foi alterado.

## 46. Estado real versus proposto

- **Papéis que existem hoje:** apenas em clusters de teste descartáveis: `rls_bootstrap` (superusuário do cluster, criado pelo `initdb`), `rls_fixture_owner`, `menlo_app` e `mig_test_owner`. Nenhum papel existe em banco persistente ou remoto; nenhum foi definido para produção.
- **Só em documentação:** `DATABASE_URL_OWNER`, `TEST_DATABASE_URL`, "dono do esquema" (docs do `menlo`) e a separação migrator/administrador; `.env.example` tem só `DATABASE_URL=`, e `packages/db/src/index.ts` aceita uma única URL (não distingue papéis).
- **Propostos no ADR-013:** `plataforma_migrator`, `plataforma_admin` (e um papel de carga do Python, adiado); `menlo_app` mantido como papel da aplicação.

## 47. Achados verificados (experimentos ad hoc em PostgreSQL 16.15 descartável, fora do repositório)

1. A aplicação consegue tomar o lock de aconselhamento do runner e bloqueá-lo (o runner falha fechado, código 3); `REVOKE EXECUTE` das funções de lock de `PUBLIC` com `GRANT` mínimo ao migrator resolve no PostgreSQL 16. Neon: não verificado.
2. **O runner atual exige ser dono do ledger** (falhou com código 1 quando outro papel o possuía).
3. **Apagar a última linha do ledger não é detectado**: o runner reaplicou a migration e duplicou dados (código 0). Quem possui o ledger pode adulterá-lo; o dono pode se auto-revogar e reconceder.
4. `ALTER DEFAULT PRIVILEGES` a favor do app expõe tabelas criadas sem RLS (dados de outro tenant legíveis); uma consulta de catálogo as detecta.
5. O papel dono sob `FORCE` não consegue semear dados em tabelas com RLS (a menos que tenha `BYPASSRLS`) e pode desligar a proteção.
6. Um login por tenant isola pelo banco; um login compartilhado que é membro dos papéis dos tenants pode trocar de papel e ler os dados de outro tenant.
7. Contexto de sessão persiste entre transações (e `DISCARD ALL` o limpa); contexto de transação some no `COMMIT`.
8. Sob o `menlo_app`, uma injeção de SQL poderia: forjar `app.tenant_id`, ler o catálogo de papéis e criar tabelas temporárias (num banco com `TEMP` em `PUBLIC`), mas não ler arquivos, `pg_authid`, `COPY ... PROGRAM`, `lo_import` nem criar objetos em `public`.

## 48. Modelo recomendado (resumo; detalhes e alternativas no ADR-013)

- **Papéis:** aplicação (`menlo_app`, sem DDL nem `TEMP`, grants explícitos por tabela), migração (`plataforma_migrator`, dono dos objetos de produto, sem `BYPASSRLS`, só `SELECT, INSERT` no ledger), administrativo (`plataforma_admin`, dono do ledger, extensões e papéis) e teste (`rls_bootstrap`, só em cluster descartável).
- **Migrations:** executadas pelo migrator como identidade de CI/deploy; sem elevação de privilégio; sem `ALTER DEFAULT PRIVILEGES` a favor do app; o runner passa a verificar o ledger em vez de criá-lo (mudança futura).
- **Tenant:** opção A endurecida (autorização na API, contexto só em transação, ponto único de acesso, `menlo_app` com mínimo privilégio). Opções B e D adiadas (exigem desenho revisado); C reservada para poucos tenants de alto valor. Gatilhos para um modelo mais forte estão no ADR.

## 49. Cobertura de testes e lacunas

Os 47 de RLS, as 6 mutações e os 112 de migrations continuam intactos e provam o que declaram para uma tabela de teste e um único papel dono. Lacunas que podem ser fechadas agora (sem esquema de produto): superfície de privilégios do app, privilégios do migrator, lints de catálogo (RLS forçado em toda tabela concedida ao app, `SECURITY DEFINER`, views), limpeza com `DISCARD ALL`, negação de serviço do lock, adulteração do ledger, guarda de inicialização. Lacunas que dependem da API ou do esquema: acesso cruzado por rota, injeção de SQL com tabelas reais, pooler real, jobs e ferramentas de IA. Lista completa no ADR-013.

## 50. Verificação local desta fase (resultados exatos)

| Comando | Resultado |
| --- | --- |
| `pnpm check:consistency` | passou |
| `pnpm test:migrations` | 112 verificações, 0 falhas (PostgreSQL 16.15, Homebrew) |
| `pnpm test:rls` | `PASSED`: 47 verificações, 6 de 6 mutações detectadas |
| `pnpm turbo typecheck lint build --force` (Node 24.9.0) | 5 de 5 tarefas |

Os experimentos da seção 47 rodaram em clusters descartáveis criados pela mesma biblioteca de isolamento e foram apagados; nenhum diretório ou processo restou. **O CI não foi verificado no GitHub** (nunca rodou; sem remoto). Revisão estática do `ci.yml`: sem segredos, `permissions: contents: read`, `persist-credentials: false`, sem `pull_request_target`; riscos remanescentes: ações de terceiros fixadas por tag e não por SHA, e `sudo apt-get install` no runner.

## 51. Decisões necessárias antes do esquema de produto (parte atendida na Fase 6; ver seção 58)

Ver ADR-013, "Decisões em aberto": aprovar taxonomia e nomes; aprovar a opção A e os gatilhos; política de dados semeados sob RLS; comportamento do Neon (locks, ledger, autenticação remota); papel do carregador Python; mudança do runner; pré-requisitos de produção (segredos, G11, auditoria do papel administrativo, primeira execução de CI).

---

# Atualização da Fase 6 (2026-10-11): integridade do ledger, lock e verificações de catálogo

Tudo foi executado só em clusters PostgreSQL 16.15 descartáveis. Nenhum banco persistente ou remoto, nenhum papel de produção, nenhum esquema de produto e nenhuma credencial foram usados ou alterados. Nada foi commitado.

## 52. Mapeamento dos achados (código, reprodução, correção)

| Achado (Fase 5) | Código relevante | Reprodução (runner anterior, antes de mudar) | Correção |
| --- | --- | --- | --- |
| 1. Apagar a última entrada do ledger reaplica a migration | `scripts/db-migrate.sh` criava o ledger com o papel executor, que ficava dono dele | executor apagou a linha; runner saiu com 0, reaplicou; 2 linhas na tabela de negócio | ledger e lock do administrador; executor só `SELECT, INSERT`; gatilhos append-only; recusa de executor inseguro; `--init-ledger`; `--expect-head` |
| 2. A aplicação trava o runner | `pg_advisory_lock(hashtextextended('plataforma_migrations', 0))` | com `menlo_app` segurando a chave, runner saiu com código 3; `pg_locks` é legível pela aplicação | lock de tabela `run_lock` (inacessível à aplicação), por migration, com revalidação sob o lock; sem lock de aconselhamento; sem revogar `EXECUTE` de funções do sistema |
| 3. `ALTER DEFAULT PRIVILEGES` expõe tabela sem RLS | nenhuma verificação existia | `menlo_app` leu a tabela criada sem RLS | `db/checks/catalog_security.sql` (C1 a C10) + `scripts/check-catalog.sh` |
| 4. O dono com `FORCE` altera o RLS | propriedade do PostgreSQL | o dono desligou RLS e a aplicação passou a ler dados de outro tenant | sem correção possível contra o dono; mitigação: aplicação nunca dona, executor não dono do ledger, C8 detecta RLS desligado |

## 53. Modelo de confiança adotado

- **Confiáveis:** o administrador (dono do ledger) e superusuários. **Não confiáveis:** o executor das migrations e a aplicação.
- **Ledger:** o executor não consegue apagar, alterar, truncar, desabilitar gatilhos nem ser dono; a aplicação não tem acesso; os gatilhos append-only barram até o dono e o superusuário, mas um dono privilegiado pode desabilitá-los.
- **Limitação explícita:** apagar as últimas entradas do ledger como administrador/superusuário **não é detectável pelo próprio ledger**. Um checksum ou uma cadeia de hashes sobre as linhas restantes não muda isso, e por isso nenhuma cadeia foi adicionada (sem modelo de ameaça que a exija). A única detecção é a evidência independente: `--expect-head N:SHA256`, guardada fora do banco. Sem ela, o runner reaplica (teste `MIG-L6` documenta isso).
- **Lock:** só o executor tem `UPDATE` em `run_lock`; a aplicação não tem nem `USAGE` no esquema (`MIG-K2`). O administrador e superusuário ainda podem segurá-lo, e uma consulta de aplicação ainda pode atrasar um DDL do executor.

## 54. Mudanças e contrato do runner

`--init-ledger --executor PAPEL` (administrador, uma vez); modo normal sem criar nada, com verificações do papel e do ledger; `--expect-head`; linha `ledger head: N:SHA256`; lock de tabela por migration. Documentação completa: `db/migrations/README.md`. Efeito sobre testes preexistentes: o `setup` dos testes agora inicializa o ledger como administrador; a asserção de `MIG-N1` passou de "só o ledger" para "ledger e run_lock"; `MIG-I7` simula a corrupção como superusuário que contorna os gatilhos (`session_replication_role = replica`); `MIG-T8`, `MIG-C1`, `MIG-C2` e `MIG-C3` passaram a observar o lock de tabela (e `MIG-T8` e `MIG-C1` também afirmam que nenhum lock de aconselhamento é usado). Nenhuma asserção foi removida.

## 55. Testes de regressão e resultados

| Suíte | Resultado (local, PostgreSQL 16.15 real) |
| --- | --- |
| `pnpm test:migrations` | **198 verificações, 0 falhas** (antes: 112): ledger `L1` a `L10` (dono, privilégios mínimos, gatilhos, achado 1, limitação documentada, recusas do runner, `--init-ledger`, `--expect-head`), lock `K1` a `K5` (achado 2: aplicação segurando a chave antiga e outras; negação imediata a `LOCK TABLE`; limpeza após sucesso, falha e perda de conexão; três runners concorrentes), mais as anteriores |
| `pnpm test:security` (novo) | **92 verificações, 0 falhas**: estado correto (também como o próprio `menlo_app`, e com banco sem tabelas: vacuoso), achados 3 e 4 reproduzidos e detectados, 30 mutações de catálogo (default privileges, RLS desligado ou não forçado, sem política, `USING (true)`, política extra, política sem `tenant_id`, `WITH CHECK` aberto, sem coluna, tipo errado, `TRUNCATE`, acesso ao ledger e ao lock, atributos privilegiados, membro, dono, `CREATE`, `TEMP`, `SECURITY DEFINER`, view sem `security_invoker`, view materializada, papel inexistente), tabelas globais aprovadas, entradas obsoletas da lista, uso do verificador |
| `pnpm test:rls` | **47 verificações e 6 de 6 mutações**, saída idêntica à da Fase 2 (nenhuma asserção alterada) |
| `pnpm check:consistency` | passou (agora exige `test:security` no CI e os scripts em `package.json`) |
| `pnpm turbo typecheck lint build --force` (Node 24.9.0) | 5 de 5 tarefas |

**Validação dos testes (defeitos plantados em cópias descartáveis, apagadas depois):** 12 defeitos, todos detectados: lock de aconselhamento de volta (4 falhas), executor pode ser dono (2), executor com todos os privilégios (69), sem gatilhos (72), sem checagem de gatilho (4), `--expect-head` ignorado (2), sem reconferência sob o lock (4), e cinco verificações de catálogo removidas (5, 13, 7, 2 e 2 falhas). Um defeito (acesso ao ledger sem `USAGE` no esquema) passou na primeira rodada, o que revelou uma lacuna na suíte; foi acrescentada a mutação específica e, em seguida, detectado.

## 56. Segurança e isolamento dos testes

Cada suíte cria um cluster novo (socket Unix em diretório temporário, sem TCP) e o apaga ao sair; trava de segurança em `scripts/lib/disposable-pg.sh`; PostgreSQL ausente ou de outra versão major sai com código 2. Os experimentos e mutantes rodaram em cópias fora do repositório e foram apagados. Disco da máquina chegou a 98% de uso; os testes apagam cada banco ao começar o seguinte.

## 57. Limitações restantes e verificação de CI

- **Dono privilegiado e administrador:** podem desabilitar gatilhos, apagar as últimas entradas do ledger, segurar o lock e desligar RLS. Mitigação: `--expect-head`, `db/checks/` rodando no CI e revisão de PR.
- **Identidade de tenant:** continua não resolvida: `app.tenant_id` livremente definível não é identidade autenticada (seção 35, ADR-013). Os testes provam só o que privilégios e RLS garantem.
- **Não aplicado a banco real:** nenhum papel de produção, nenhum banco remoto/Neon (inclusive se o administrador pode criar o ledger lá), nenhuma autenticação remota; `db/checks/` ainda não roda contra um esquema real de produto (não existe).
- **Dados semeados sob RLS:** decisão pendente (o runner recusa executor com `BYPASSRLS`).
- **CI:** o workflow ganhou o passo `pnpm test:security` mas **nunca rodou no GitHub** (sem remoto). **Linux não foi exercitado** (Docker desligado; tudo no macOS, bash 3.2, PostgreSQL 16.15 do Homebrew). Pontos específicos de Linux ainda não verificados: pacote e caminho do `postgresql-16`, locale, `python3` e `sha256sum`/`sort`/`sed`/`grep` GNU, `bash` 5. As ações de terceiros continuam fixadas por tag, não por SHA.
- G11 inalterado (seção 37).

## 58. Próxima fase recomendada (feita como Fase 7, seções 59 a 66)

**Bootstrap de papéis e gate de segurança pós-migration, ainda em ambiente descartável:** (1) script de bootstrap do administrador, testado, que cria os papéis (`plataforma_admin`, `plataforma_migrator`, `menlo_app`), faz os `REVOKE` de `PUBLIC` (`CONNECT`, `TEMP`) e chama `--init-ledger`; (2) opção do runner para rodar `catalog_security.sql` **dentro da transação de cada migration** e desfazê-la se algum `not ok` aparecer (isso fecha o buraco do achado 4 no momento em que ele ocorre); (3) primeira execução real do CI.
Aceite: bootstrap e gate testados em PostgreSQL 16 descartável (migration que desliga RLS, concede a `PUBLIC` ou cria default privileges é desfeita); `pnpm test:migrations`, `test:rls`, `test:security`, `check:consistency` e `turbo typecheck lint build` continuam passando; nenhum banco remoto, credencial ou papel de produção. Depende das decisões do ADR-013 (nomes dos papéis, dados semeados sob RLS) e, para o item 3, de um remoto autorizado por você.

---

# Atualização da Fase 7 (2026-10-11): bootstrap de papéis e gate de segurança transacional

Tudo foi executado só em clusters PostgreSQL 16.15 descartáveis. Nenhum banco persistente ou remoto, nenhum papel de produção, nenhum esquema de produto, nenhuma credencial e nenhum ambiente foram usados ou alterados. Nada foi commitado.

## 59. Estado antes de editar e conflitos de desenho

Verificado no código: o runner da Fase 6 abria uma transação por migration (`BEGIN`, `LOCK TABLE`, revalidação, SQL, `INSERT` no ledger, `COMMIT`) e **não tinha gate**; `catalog_security.sql` era um script de várias instruções, impossível de embutir numa transação; nenhuma migration existe (`db/migrations/` só tem o README). Conflitos resolvidos: (1) o gate precisava de uma fonte única embutível: nova `db/checks/security_gate.sql`, uma única consulta (o `catalog_security.sql` foi removido, a saída de `check-catalog.sh` não mudou); (2) a ordem pedida (lock; validar; `BEGIN`) pressupõe lock de sessão, mas o lock da Fase 6 é de tabela e de transação: a ordem real é `BEGIN; LOCK; validar; executar; gate; ledger; COMMIT` (ADR-013); (3) um bug de ordem de avaliação do PostgreSQL (`has_sequence_privilege` chamado sobre relações que não são sequências) foi encontrado e corrigido com `CASE`; (4) uma vulnerabilidade de projeto encontrada e fechada: sem `search_path` fixo e referências qualificadas, uma migration conseguia **enganar o gate** (tabela temporária `pg_class`, função com nome de catálogo).

## 60. Bootstrap de papéis (`scripts/db-bootstrap.sh`)

Provisiona e verifica `plataforma_admin`, `plataforma_migrator` e `menlo_app`, o banco novo (dono: administrador; `REVOKE` de `PUBLIC` em `CONNECT`/`TEMP`/`CREATE`; `CREATE`+`TEMP` ao executor; `public` fechado) e o ledger (`--init-ledger` como administrador); depois confere o estado real por `db/checks/role_model.sql` (R1 a R9) e pelo gate. Só roda em cluster descartável (marcador, sem TCP, superusuário, PostgreSQL 16, banco novo); `--verify-only` é somente leitura. Atributos e privilégios verificados: ver o ADR-013 (tabela da Fase 7). **Os `REVOKE` de `PUBLIC` valem só para o banco recém-criado; os papéis são globais no cluster.** Implicações de produção e o que não foi verificado no Neon: ADR-013.

## 61. Gate transacional (`db/checks/security_gate.sql` + `scripts/db-migrate.sh`)

Obrigatório (`--app-role`), desligável só por `--no-security-gate` explícito (aviso; apenas testes do runner). Gate de linha de base (read-only) antes de qualquer migration; gate por migration dentro da transação, depois do SQL e antes do `INSERT` no ledger e do `COMMIT`; falha desfaz tudo e a migration não é dada como aplicada. Invariantes C1 a C10 e G1 a G8 (ver `db/checks/README.md`). Estado inicial vazio passa (vacuoso, documentado). Falha fechada. O runner também passou a recusar executor membro de qualquer papel ou sem `TEMP`.

## 62. Revisão do lock

SQL exato, privilégio mínimo (`UPDATE`; `SELECT`+`INSERT` não bastam, testado), exclusão mútua observada em SQL puro e no runner, conexão e transação mantidas durante a migration (amostragem), liberação após sucesso, falha de SQL, `pg_terminate_backend` e `SIGKILL` do `psql`, três runners concorrentes, e a aplicação sem acesso nem interferência. Nenhuma falha de correção ou de segurança foi encontrada no lock; os resíduos (administrador/superusuário seguram o lock; consulta da aplicação atrasa DDL do executor) estão documentados. Nenhum `REVOKE` global em funções do sistema.

## 63. Testes novos e resultados (PostgreSQL 16.15 real)

| Suíte | Resultado |
| --- | --- |
| `pnpm test:gate` (novo) | **237 verificações, 0 falhas**: estado vazio e migrations válidas; 35 migrations inseguras rejeitadas pelo gate ou pelo PostgreSQL, cada uma com: saída 1, motivo nomeado, **não registrada**, **catálogo idêntico ao anterior**, e **versão corrigida aplicada em seguida**; operações não transacionais; tentativas de enganar o gate; linha de base; opt-out; papel inexistente; executor inseguro |
| `pnpm test:bootstrap` (novo) | **89 verificações, 0 falhas**: provisionamento, atributos e privilégios do catálogo, tentativas reais de cada papel, recusas (banco existente, sem marcador, papéis iguais, host de rede, não superusuário), idempotência e 20 sabotagens do estado real detectadas por `--verify-only` |
| `pnpm test:migrations` | **212 verificações, 0 falhas** (eram 198): + revisão do lock (`K0`, `K6` a `K10`); o runner roda com `--no-security-gate` explícito nesta suíte (o gate é coberto por `test:gate`); nenhuma asserção removida |
| `pnpm test:security` | **93 verificações, 0 falhas** (eram 92): refatorado para a consulta única; + G4/G5 no banco padrão; o estado "sem tabelas" agora exige `public` fechado |
| `pnpm test:rls` | **47 verificações e 6 de 6 mutações**, saída idêntica à da Fase 2 |

**Validação dos testes (defeitos plantados em cópias descartáveis, apagadas depois):** 11 defeitos, todos detectados: sem gate por migration (111 falhas), gate depois do `COMMIT` (65), sem defesa contra falsificação do gate (6), sem gate de linha de base (2), `PUBLIC` ignorado (18), gate que não levanta exceção (94), gate opcional em silêncio (1), `PUBLIC` não revogado no banco (29), checagem de associação removida (3), marcador de cluster descartável dispensado (2), papéis não redefinidos (34). Um teste (função com nome de catálogo) não discriminava; foi corrigido (assinatura idêntica) e agora falha sem a defesa.

## 64. Verificações do projeto (resultados exatos, execução local)

| Comando | Resultado |
| --- | --- |
| `pnpm check:consistency` | passou (Node ^24, pnpm 12.10.1 = lockfile; exige no workflow os comandos de teste, inclusive `test:bootstrap` e `test:gate`, e os scripts em `package.json`) |
| `pnpm install --frozen-lockfile --lockfile-only` | passou; lockfile inalterado |
| `pnpm turbo typecheck lint build --force` (Node 24.9.0) | 5 de 5 tarefas |
| `pnpm test:migrations` | 212 verificações, 0 falhas |
| `pnpm test:rls` | 47 verificações e 6 de 6 mutações detectadas (55 linhas `ok`, 0 `not ok`); `scripts/test-rls.sh`, a fixture e os testes de RLS **não foram alterados** nesta fase (só a biblioteca de cluster, sem mudança, e a Fase 6) |
| `pnpm test:security` | 93 verificações, 0 falhas |
| `pnpm test:bootstrap` | 89 verificações, 0 falhas |
| `pnpm test:gate` | 237 verificações, 0 falhas |
| `pnpm check:catalog` | **sem argumentos: sai com código 2 (erro de uso, não é um banco)**; contra um banco descartável provisionado pelo bootstrap: código 0 (18 linhas `ok`, 0 `not ok`); depois de uma exposição deliberada dos metadados de migration a `PUBLIC` e à aplicação: código 1 (`C7` e `G5` falham). Ele só se aplica a um banco; não há banco de produto |

Todos os testes de PostgreSQL usaram PostgreSQL 16.15 (Homebrew, aarch64-apple-darwin), real, em clusters descartáveis criados e apagados pelos próprios scripts (trava de segurança em `scripts/lib/disposable-pg.sh`); ausência do PostgreSQL ou versão major diferente sai com código 2. Nenhum diretório temporário ou processo restou. As ferramentas de mutação rodaram em cópias fora do repositório, já apagadas.

## 65. Limitações restantes e confiança necessária

- **Administrador, dono e superusuário:** podem alterar o gate, o runner, o ledger e a configuração, desabilitar gatilhos, segurar o lock e desligar RLS. O gate protege contra erros e mudanças inseguras revisáveis do executor, não contra um insider privilegiado.
- **`--expect-head`:** só é evidência independente se vier de fonte confiável fora do banco; sem ele, a remoção das últimas entradas do ledger por um dono privilegiado não é detectável (checksum ou cadeia de hashes não mudam isso; nenhuma cadeia foi adicionada).
- **Tenant:** `app.tenant_id` livremente definível não é identidade autenticada; faltam `packages/api` e os testes de integração do ADR-013. O gate verifica que a política existe e cita `tenant_id`, não o isolamento.
- **Produção/Neon:** nenhum procedimento de produção; o Neon não foi consultado; autenticação remota, papéis gerenciados, `REVOKE` em escopo de banco e criação do ledger por um administrador gerenciado não foram verificados.
- **CI:** o workflow ganhou `pnpm test:bootstrap` e `pnpm test:gate` (12 passos; YAML parseado) mas **nunca rodou no GitHub**. **Linux não foi exercitado** (Docker desligado; tudo no macOS, bash 3.2, PostgreSQL 16.15 do Homebrew); `pgrep` e `kill` nos testes de lock, `python3` e as ferramentas GNU são pontos específicos ainda sem verificação.
- G11 inalterado (seção 37).

## 66. Próxima fase recomendada

**Decidir e desenhar o procedimento de produção, antes de qualquer esquema de produto:** aprovar o ADR-013; decidir dados semeados sob RLS; verificar (somente leitura e com sua autorização) o que um projeto Neon permite (criar o ledger/lock/gatilhos e aplicar os `REVOKE` em `PUBLIC` como administrador gerenciado, autenticação do runner); definir onde `--expect-head` é guardado; e rodar o CI no GitHub pela primeira vez (exige remoto autorizado). Aceite: ADR de produção aprovado; nenhuma migration de produto até lá.

---

# Atualização da Fase 9 (2026-10-12): remediação dos achados F1 a F8 da auditoria

Somente clusters PostgreSQL 16.15 descartáveis; nenhum banco persistente ou remoto, credencial, papel de produção, dependência ou lockfile. Nada foi commitado nem enviado. Não é aprovação do ADR-013 nem runbook de produção.

## 67. Estado antes e depois, e confirmação dos achados

- **Antes:** `main`, HEAD `9471634`, árvore com as mudanças não commitadas das fases anteriores. Baseline: `check:consistency` OK; `turbo` 5 de 5; `test:rls` 47 (+6 mutações); `test:security` 93; `test:bootstrap` 89; `test:gate` 237; `test:migrations` 212.
- **Confirmação:** a nova suíte `scripts/test-hardening.sh` foi rodada contra a implementação **anterior**: 33 verificações passaram e 55 falharam, reproduzindo F1 a F8 como estado observável (saída injetada, `ON_ERROR_STOP` desligado, sucesso relatado sem ledger, mudança insegura persistida por `COMMIT` embutido, vazamento de sessão, políticas só léxicas aceitas, grants por coluna/estrangeiras/regras/gatilhos/parâmetros não vistos, bypass do gate e marcador aceitos sem prova, banco parcial). Nenhum achado foi rejeitado; F9 a F13 ficaram adiados (ver ADR-013).
- **Depois:** mesma árvore de trabalho acrescida das mudanças desta fase; HEAD inalterado.

## 68. Arquivos alterados e por quê

`scripts/db-migrate.sh` (execução como texto, isolamento de sessão, validação por função, verificação no banco, prova de cluster descartável para o bypass); `scripts/lib/disposable-pg.sh` (nonce no marcador e no servidor); `scripts/db-bootstrap.sh` (prova por nonce, pré-checagem de papéis, limpeza, verificação read-only); `scripts/check-catalog.sh` (read-only); `db/checks/security_gate.sql` (forma canônica, colunas, C11 a C14); `scripts/test-hardening.sh` (novo, 96 verificações); ajustes de contrato nos testes existentes (`MIG-T5`, `MIG-I9` mantido, `BOOT-7` e a fixture `BASE` do `test-gate`); `package.json`, `ci.yml`, `check-consistency.sh` (novo `test:hardening`); `db/migrations/README.md`, `db/checks/README.md`, ADR-013, `CLAUDE.md`.

**Asserções existentes que mudaram (nenhuma foi removida para passar):** `MIG-T5` (era "limitação conhecida: o `COMMIT` escondido não é desfeito"; agora exige rejeição **e** que nada persista); `BOOT-7` (era "papel perigoso é redefinido"; agora é **recusado antes de qualquer mudança**); a fixture `BASE` de `test-gate` passou a definir a função auxiliar com aspas comuns (convenção canônica). Todas as demais permanecem iguais.

## 69. Resultados (execução local, macOS, bash 3.2, PostgreSQL 16.15 real)

| Comando | Saída | Resultado |
| --- | --- | --- |
| `pnpm check:consistency` | 0 | OK (exige também `test:hardening` no CI) |
| `pnpm turbo typecheck lint build --force` | 0 | 5 de 5 tarefas |
| `pnpm test:rls` | 0 | 47 verificações e 6 de 6 mutações (inalterado) |
| `pnpm test:security` | 0 | 93 verificações |
| `pnpm test:bootstrap` | 0 | 95 verificações (eram 89) |
| `pnpm test:gate` | 0 | 237 verificações |
| `pnpm test:hardening` (novo) | 0 | 96 verificações |
| `pnpm test:migrations` | 0 | 213 verificações (eram 212) |
| `pnpm check:catalog` | 2 sem argumentos (erro de uso); 0 contra um banco descartável bootstrapado (22 `ok`, 0 `not ok`); `bootstrap --verify-only`: 0 e catálogo inalterado | ver ressalva |

Os números são contagens de asserções de cada script nesta execução, não garantias independentes. Nenhum diretório temporário restou.

## 70. Limitações remanescentes e itens adiados

- Autor malicioso e administrador comprometido: **não suportados** (modelo de ameaça).
- Política de tenant: convenção de forma; isolamento comportamental e identidade autenticada continuam não provados (futura API).
- Adiados: F9 (parcial), F10, F13 (actions por SHA, `apt-get`), e a classificação por texto do stderr.
- **Linux, GitHub Actions, produção e Neon: NÃO verificados.** Tudo rodou no macOS. O novo teste de `SIGKILL` do lock e os dublês de `psql` ainda não foram exercitados em Linux.

## 71. Próximo passo proposto (não executado)

Decidir, com o dono do produto, se algum caso de uso exige um modelo de ameaça mais forte que "código revisado"; se sim, isso exige uma arquitetura diferente (executar migrations por um mecanismo que não as dê a um papel privilegiado). Em paralelo: aprovar a forma canônica de política, rodar o CI pela primeira vez no GitHub (precisa de remoto autorizado) e validar em Linux.

# Atualização da Fase 13 (2026-10-12): validação independente, correções de alegações e evidência reproduzível

Só leitura do código e execução das suítes existentes em clusters descartáveis. Nenhum commit, remoto, dependência ou banco persistente. Este bloco corrige alegações anteriores; não aprova nenhum ADR.

## 72. Base e o que os números significam

- HEAD `f4a7ffe` (branch `main`, sem remoto, árvore limpa no início); histórico `9471634` → 8 commits. Ambiente: macOS 26.2, arm64, Node 24.9.0, pnpm 12.10.1, PostgreSQL 16.15 (Homebrew). Docker Desktop está instalado, mas o daemon não está em execução e não foi iniciado: **nenhuma validação em Linux foi feita**.
- Reexecução no HEAD, todas com saída 0: `check:consistency`; `test:rls` 55 linhas `ok` (47 da suíte principal + 2 de repetibilidade T8 + 6 mutações T9; o "47" citado antes é só a suíte principal); `test:migrations` 213; `test:security` 93; `test:bootstrap` 95; `test:gate` 237; `test:hardening` 96; `turbo typecheck lint build --force` 5 de 5. Nenhum cluster `/tmp/plataforma-pg.*` restou.
- **Esses números são linhas `ok` impressas, não testes únicos.** Muitos casos são laços parametrizados (por exemplo, `test-gate.sh` tem 33 chamadas `expect` no código e 237 linhas `ok`; 13 identificadores distintos). Todas as suítes falam com um PostgreSQL 16 real. Duas exceções de dublê, ambas encapsulando o `psql` real: `HARD-F2a` (um `psql` falso que imprime marcadores forjados) e `HARD-F8b` (um `psql` que falha só no script do runner). Os dublês servem para provar a reação do runner a uma saída forjada e a uma falha injetada, não o comportamento do servidor.
- As mutações do `test-rls.sh` contam como detectadas quando há **pelo menos uma** linha `not ok` ou erro; não afirmam qual teste deveria falhar. Em `excess_grant`, o `TRUNCATE` concedido apaga a tabela e provoca falhas em cascata (por isso `L1` também falha); a detecção é pela razão certa (`T6`), mas o contador de falhas inclui cascata. As mutações da Fase 9 (gate, hardening) não estão versionadas e não foram revalidadas.

## 73. Isolamento de tenant: veredito

- **Mecanismo de RLS na fixture: VERIFICADO em PostgreSQL real (macOS), papel sem privilégios (`menlo_app`).** T1 a T7, S1 a S3: lê só as próprias linhas; não lê, não insere (42501), não atualiza nem apaga linhas do outro tenant; sem contexto ou com contexto vazio, zero linhas e escrita recusada; contexto malformado dá erro 22P02; não é superusuário, não tem BYPASSRLS, não é dona, não herda a dona; sem TRUNCATE, REFERENCES nem TRIGGER; `row_security=off` falha em vez de contornar; seis mutações (BYPASSRLS, superusuário, dona sem FORCE, TRUNCATE concedido, política `true`, RLS desligado) derrubam a suíte.
- **Vazamento entre transações:** verificado dentro de uma mesma conexão (`set_config(..., true)` não sobrevive a COMMIT, ROLLBACK nem fora de transação); o contexto de sessão (`is_local=false`) **vaza por desenho** (T5d) e nunca deve ser usado. **Um pooler real (PgBouncer, Neon) não foi testado.**
- `FORCE ROW LEVEL SECURITY` não protege contra superusuário nem contra BYPASSRLS (S1 documenta isso) nem contra o dono que desliga o RLS por DDL (o gate detecta o estado resultante).
- **Isolamento do produto: NÃO PROVADO.** A tabela é uma fixture (`rls_fixture.tenant_item`), não existe tabela de produto e `app.tenant_id` é livre para o papel da aplicação (L1). Falta a identidade autenticada (`packages/api` não existe).

## 74. Achados desta revisão (sem correções aplicadas)

- **Linux:** não verificado. Pré-requisitos para uma execução reproduzível: daemon do Docker ativo, imagem Linux com PostgreSQL 16, Node 24 e pnpm 12.10.1 já disponíveis localmente ou baixáveis com autorização, execução **como usuário sem privilégios** (o `initdb` recusa `root`) e `RLS_HARNESS_PG_BIN_DIR` apontando para o diretório dos binários do PostgreSQL.
- **P3, janela entre varredura e instantâneo** em `scripts/db-migrate.sh`: as varreduras de entrada (incluindo a checagem dos marcadores de aspas de dólar derivados do hash) leem o arquivo original, mas o que é executado e somado vem de uma cópia feita depois. Um arquivo trocado nessa janela poderia conter o marcador derivado do hash da cópia. Fora do modelo de ameaça declarado (autor malicioso não é suportado); correção barata: copiar antes de varrer e varrer a cópia.
- **F10 (impacto real):** o texto de `stderr` só decide o **código de saída** (3 ou 4 em vez de 1) e a mensagem. Nenhuma classificação errada faz uma falha virar sucesso: o sucesso exige saída 0 do `psql` e o ledger confirmado no banco. Um servidor com `lc_messages` traduzido classificaria timeout de lock como 1; uma migration cuja mensagem contenha "lock timeout" ou "No such file or directory" seria classificada como 3 ou 4. Prioridade P2 para automação que decida retry pelo código de saída.
- **Referência obsoleta:** `scripts/test-security.sh` (comentário da linha 2) e o ADR-013 citam `db/checks/catalog_security.sql`, que não existe; o arquivo é `security_gate.sql`. Só texto; nenhum script o lê.
- **F13, fingerprints:** sem mudança em relação à seção 70 e ao relatório da Fase 11.
- **Runner:** não encontrei caminho alternativo que contorne o gate, a verificação de checksum ou a prova de cluster descartável dentro do modelo de ameaça (migrations revisadas); `--psql` aceita um binário arbitrário por contrato. O runner só fala por socket Unix, então **não funciona contra o Neon** como está.

# Atualização da Fase 14 (2026-10-12): validação em Linux (contêiner descartável)

Cópia descartável do commit `f4a7ffe` (`git archive`) em contêiner Ubuntu 24.04.5 (`ubuntu@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55`, linux/arm64, kernel linuxkit 7.0.12), PostgreSQL 16.15 (pacote Ubuntu `16.15-0ubuntu0.24.04.1`, `postgresql-16`), Node 24.21.0 (tarball oficial, SHA-256 conferido), pnpm 12.10.1, bash 5.2.21, execução como usuário sem privilégios, `pnpm install --frozen-lockfile` (lockfile inalterado) e `RLS_HARNESS_PG_BIN_DIR=/usr/lib/postgresql/16/bin`. Contêiner, imagem e arquivos removidos ao final; nada foi alterado no repositório original além deste texto.

## 75. Resultados e achados

- **Passaram em Linux (saída 0):** `check:consistency`; `turbo typecheck lint build --force` (5 de 5); `test:rls` (55 linhas `ok`, 47 + 6/6 mutações); `test:security` (93); `test:bootstrap` (95); `test:gate` (237); `test:hardening` (96).
- **`test:migrations` falhou em Linux: 210 `ok` e 3 `not ok` na primeira execução; 212 `ok` e 1 `not ok` depois de instalar `python3` no contêiner.**
  - `MIG-N2` e `MIG-L10`: o teste calcula o SHA-256 "independente" com `python3` (`scripts/test-migrations.sh`, linha 23). A imagem mínima do Ubuntu não traz `python3`; com ele instalado, as duas passam. É um **pré-requisito não documentado das suítes**. Não verificado: se a imagem `ubuntu-24.04` do GitHub Actions o traz (acredita-se que sim).
  - `MIG-K10` ("the server released the lock when the client died"): **falha de forma reproduzível em Linux**. A causa não é o código do runner. O servidor só percebe que o cliente morreu depois que a instrução em andamento termina (`client_connection_check_interval` = 0 por padrão); um diagnóstico à parte (fora do repositório, `pg_sleep(6)` após `SIGKILL` do cliente) mediu o lock liberado **6,03 s depois no Linux e 6,11 s no macOS**. O teste espera no máximo 50 × 0,1 s mais o tempo de cada consulta; no macOS cada consulta é lenta o bastante para o laço durar mais que 6 s, no Linux dura menos de 6 s. Ou seja, o teste depende implicitamente da latência de `fork/exec` da plataforma. As outras três verificações do `MIG-K10` passaram em Linux: o `psql` do runner foi de fato morto (saída não zero do runner), nada parcial foi gravado (sem tabela e sem entrada no ledger) e a execução seguinte aplicou a migration.
  - **Consequência operacional:** um runner morto durante uma instrução longa deixa o servidor segurando o lock até essa instrução terminar; a transação não é confirmada. Mitigações possíveis (não aplicadas): `statement_timeout` ou `client_connection_check_interval` no servidor, e uma espera do teste maior que a duração da instrução.
  - **Correção mínima proposta (não implementada):** no `MIG-K10`, esperar o lock até um prazo maior que o `pg_sleep` (por exemplo, 12 s, ou encurtar o `pg_sleep`) em vez de contar iterações, e documentar o `python3` como pré-requisito.
- **GitHub Actions: NÃO verificado** (sem remoto). Diferenças conhecidas para o workflow: arquitetura aarch64 em vez de x86_64, Node 24.21.0 fixado manualmente em vez de `setup-node`, contêiner mínimo em vez da imagem do runner.

# Atualização da Fase 15 (2026-10-12): correção dos defeitos de portabilidade dos testes de migrations

Só infraestrutura de teste e documentação; o runner, o gate, o SQL, a CI, os ADRs e as dependências não foram alterados. As mudanças de teste e do README foram commitadas à parte (`test(db): harden migration test failure handling`); este registro entra em commit próprio.

## 76. O que mudou e o resultado

- **`MIG-K10`** (`scripts/test-migrations.sh`): a espera por 50 iterações de 0,1 s foi trocada por uma espera por **condição** com prazo de 20 s (`$SECONDS`; o bash não tem relógio monotônico, resolução de 1 s). A condição é a ausência de lock granted em `plataforma_migrations.run_lock`, observada por outra conexão (superusuário do cluster descartável). O `SIGKILL` continua real; a asserção agora também exige que o `pgrep` tenha achado o processo, que o `kill -9` tenha sido entregue e que o processo não exista mais. As quatro asserções originais foram mantidas (contagem inalterada: 213). O teste imprime, por linha `#`, o pid do cliente morto, o pid do backend que segura o lock e o tempo até a liberação; em falha imprime os locks e os backends. O `pg_sleep(6)` não foi encurtado.
- **Causa da falha em Linux:** o `SIGKILL` mata o `psql` (cliente), não o backend. Com `client_connection_check_interval = 0`, o backend só percebe o cliente morto quando a instrução em andamento termina; o lock sai com a transação abortada, cerca de 6 s depois, no macOS e no Linux. A espera antiga durava menos de 6 s no Linux porque cada consulta é mais rápida lá, e mais de 6 s no macOS, onde passava por folga de latência.
- **`python3` removido:** o SHA-256 "independente" de `MIG-N2` e `MIG-L10` agora vem do `openssl dgst -sha256`, conferido contra o vetor da entrada vazia, com saída 2 e mensagem clara se o `openssl` faltar. O runner usa `sha256sum`/`shasum`; o `openssl` é outra implementação, então a verificação continua independente da ferramenta do runner. Pré-requisitos das suítes documentados em `db/migrations/README.md`.
- **macOS (PostgreSQL 16.15 Homebrew):** `test:migrations` 3 vezes seguidas, saída 0 e 213 `ok` nas três; liberação do lock observada em cerca de 6 s (46 a 47 consultas). `check:consistency`, `test:rls` (55), `test:security` (93), `test:bootstrap` (95), `test:gate` (237), `test:hardening` (96): saída 0.
- **Linux (Ubuntu 24.04.5 aarch64, PostgreSQL 16.15, Node 24.21.0, pnpm 12.10.1, **sem `python3`**):** `test:migrations` 3 vezes seguidas, saída 0 e 213 `ok` nas três (liberação em cerca de 6 s, 51 consultas); as demais suítes e `turbo typecheck lint build --force` também com saída 0 e as mesmas contagens do macOS.
- **Falha fechada confirmada na cópia descartável do contêiner (não no repositório):** com o prazo reduzido para 2 s, o teste falha com diagnóstico (lock `ExclusiveLock` do backend em `PgSleep`) e a asserção seguinte (a próxima execução aplicar a migration) também falha. O contêiner e a imagem foram removidos; as listas do Docker voltaram ao estado anterior.
- **Evidência por fase (o que cada uma executou).** A Fase 15 relatou três execuções de `test:migrations` no macOS e três no Linux (213 `ok` cada). A Fase 16 reproduziu **só no macOS** uma execução normal (saída 0, 213 `ok`), o `MIG-K10` com prazo reduzido a 2 s (falha esperada, com o diagnóstico de lock `ExclusiveLock` em `PgSleep`) e a ausência simulada do `openssl` (saída 2, nenhuma asserção executada); o Linux não foi reexecutado na Fase 16 nem na 17. A Fase 17 executou só no macOS: `test:migrations` (saída 0, 213 `ok`), `check:consistency` (saída 0) e três injeções de falha do `openssl` numa cópia fora do repositório (saída de erro, saída malformada e saída vazia), cada uma com saída 1 e exatamente `MIG-N2` e `MIG-L10` em `not ok` (211 `ok`). Nessa fase o SHA-256 independente passou a falhar de forma explícita (`sha_indep` retorna erro e `eq_sha` exige 64 hex nos dois lados) e o texto de pré-requisitos do README foi corrigido (a falta do `openssl` sai com código 2; a do `pgrep` faz o `MIG-K10` falhar com código 1).
- **Não verificado:** GitHub Actions e x86_64; pooler real; isolamento de tenant do produto.
