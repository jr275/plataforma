# Hardening da área de geração (`/generation`) — 2026-10-13

Base: `b49165b` (igual a `origin/main`, verificado com `git ls-remote`). Alterações desta unidade: **locais, não commitadas**. Nenhum push, deploy, migration, escrita no Neon ou publicação.

## 1. Estado verificado do Neon e do GitHub (somente leitura)
- GitHub: `main` = `b49165b`; 15 commits desde `500f2d2` no histórico remoto; CI principal (run 38415758080) com sucesso.
- Neon dev `plataforma-dev`, branch `main`, como `menlo_app` no tenant `remax`: execução `11d30ce6-5824-452e-a10a-efa10d9e237e` (`succeeded`, 20 gerados, 0 inalterados, 0 bloqueados, 6 gates aprovados nos 20 itens); 20 páginas `draft`; 20 versões; 20 URLs distintas; 5.571 cidades (importação real IBGE).
- Branch `pre-0005-20261013-0737` existe e não foi tocada.
- **Não verificado:** ledger de migrations e checksums (`menlo_app` não lê o schema do ledger; não foi usada credencial privilegiada). As migrations 0005 a 0007 estão confirmadas só de forma indireta (as tabelas existem e funcionam).
- Vercel: o check do projeto `gsc` aparece como falha no GitHub para `b49165b` e já aparecia em `500f2d2`; causa desconhecida (exige logs privados da Vercel).
- Publicação (etapa 5): não implementada. O banco só aceita `draft` e `blocked`.

## 2. Defeitos encontrados e correções
| # | Sev. | Defeito (causa raiz) | Correção |
|---|---|---|---|
| 1 | Média | Página de resultados fora do intervalo (ex.: `?page=9` com 45 itens) mostrava "Nenhuma página gerada ainda": havia dados, mas a tela dizia o contrário. | `generation-home-view.tsx`: estado próprio com links para a primeira e a última página, preservando filtros. |
| 2 | Média | Falha inesperada ao verificar a sessão (serviço de login fora) subia como exceção: nas ações, sem mensagem; nas telas, ao `error.tsx`. | `loadForTenant` devolve o estado `auth_unavailable`; as ações devolvem mensagem clara e não executam nada. |
| 3 | Média | Banco indisponível, timeout e erro inesperado eram um único estado `error`. | `isDatabaseUnavailable` (SQLSTATE classe 08, 57P01/02/03, 53300, 57014, erros de rede e as duas falhas sem código do driver `pg`) e o estado `db_unavailable`. |
| 4 | Baixa | `reprocessAction` tratava identificador mal formado como "página não encontrada". | Validação de UUID antes de qualquer consulta: "Identificador de página inválido." |
| 5 | Baixa | `?v=` era lido com `parseInt`: `1abc`, `1.5`, `1e3` e `01` eram aceitos como versão 1; `0`, `-3`, `abc` e parâmetro repetido caíam na mais recente sem aviso; um número gigante era aceito; `?v=99` (inexistente) mostrava a mais recente sem avisar. | `parseVersionParam` estrito (`lib/server/generation.ts`): ausente ou vazio = mais recente; só inteiro de 1 a 999999999 em decimal simples vale; qualquer outro valor presente é inválido e a tela avisa. Versão positiva inexistente também avisa. Em todos os casos o fallback é a mais recente, mas nunca silencioso. |
| 6 | Baixa | URL do banco malformada era tratada como falha de login. | `resolveTenantContext` devolve `not_configured`. |
| 7 | Baixa | Falhas de servidor não eram registradas. | `lib/server/log.ts`: registra só tipo e código (nunca a mensagem). Erros esperados (execução em andamento, cidade inexistente, tabela ausente) não são registrados. |
| 8 | Aberto | Corrida `web#typecheck` x `web#build` em `.next/types` (ver seção 4). | `turbo.json`: `build` depende de `typecheck`. Garantia estrutural comprovada; eficácia empírica **inconclusiva**. |
| 9 | Média | `try/catch` ao redor de `resolveTenantContext()` (que chama `cookies()` e `connection()`) capturava os erros de controle de fluxo do Next.js e os convertia em `auth_unavailable` (telas) ou em "Não foi possível verificar sua sessão" (ações). Demonstrado com os erros REAIS do framework (`redirect()`, `notFound()`, `DynamicServerError` e a rejeição da promessa pendente de `connection()` abortado): 7 testes falhavam antes. A documentação do Next 16.4.0 instalada manda não capturar esses erros e usar `unstable_rethrow`, que existe nessa versão. | `unstable_rethrow(e)` no topo do `catch` em `loadForTenant` (`tenant-data.ts`) e em `context()` (`actions.ts`). Só repassa os erros do framework; falha comum de login continua tratada (testes de controle). Os demais `catch` não foram alterados de propósito: o de `appPool()` e o de `withTenant` só envolvem código de banco, sem APIs do Next. Observação: o build final já feito mostrava que o shell estático de `/generation` continha só "Carregando…", ou seja, o problema não se manifestou no prerender; o risco ficou fechado por teste, não por falha observada. |

Erro meu, corrigido na própria unidade: `log.ts` tinha `let name = typeof e`, que o TypeScript infere como união literal e rejeita `String(...)` (TS2322). O Vitest não checa tipos; só o `tsc` pegou. Correção: `let name: string`. Teste direto em `log.test.ts`.

O que **já estava correto** e foi apenas coberto por testes novos: identidade e tenant derivados só da sessão verificada; tenant do formulário ignorado; reprocessar página de outro tenant recusado pelo RLS sem gerar nada; reprocessamento sem publicação; paginação estável com `updated_at` empatado (prova em banco real).

## 3. Idempotência, repetição e concorrência (distinções)
- **Conteúdo:** o mesmo conteúdo não cria versão (`unchanged`); coberto em `generation-reprocess.product.test.ts`, e a mutação "ignorar o hash" é detectada.
- **Operação:** repetir a ação cria uma nova execução registrada (cada tentativa fica auditada); não cria versão nem página se nada mudou. Isso é decisão de projeto, não idempotência de operação.
- **Concorrência:** índice parcial permite uma execução `running` por tenant (migration 0007); a segunda recebe `GenerationBusyError`. O botão fica desabilitado durante o envio. Cobertura em `generation-safety.product.test.ts`.

## 4. Corrida `typecheck` x `build` (medição)
Hipótese: `next typegen` (typecheck) e `next build` escrevem `.next/types` ao mesmo tempo; o build limpa o diretório e o typegen falha com `ENOENT`.
Medição em cópia isolada (mesmo código e lockfile; turbo 2.11.7, next 16.4.0; só o `turbo.json` muda):
- Primeira execução, configuração antiga, cópia nova: **falhou** com `ENOENT ... .next/types/routes.d.ts`.
- Execuções 2 a 5 desse lote falharam por um erro de tipos meu (`log.ts`), portanto **não valem** para a corrida.
- Lote antigo (6) e novo (6), `.next` aquecido: 0 falhas em cada.
- Bateria final, 10 rodadas de 3 variantes (antiga, nova, sequencial como controle), sempre com `.next` limpo: **0 falhas em 30**.
- Total para a configuração antiga: 1 falha em 17 observações válidas; nova: 0 em 16.
**Conclusão: inconclusivo.** O grafo prova que, com a mudança, `web#build` só começa depois de `web#typecheck` (`turbo build --dry=json`). Que a disputa deixou de ocorrer não foi demonstrado, porque a falha original não se reproduziu em condições controladas. **O problema permanece aberto.** O `ci.yml` não foi alterado.

## 5. Mutação (cópias isoladas)
16 mutações aplicáveis, **16 detectadas, 0 sobreviveram**, pelo critério "código de saída diferente de zero com linha de base verde". Tabela com o que os artefatos da bateria VÁLIDA guardaram (`mut-result.json`, `mut.log`, `mut14.log`; scratchpad da sessão, fora do repositório):

| ID | Mutação | Linha de base | Execução mutada (exit) | Evidência guardada | Teste que detectou | Classificação |
|---|---|---|---|---|---|---|
| M1 | aceitar tenant enviado pelo cliente em resolveTenantContext | ok (suíte web completa) | falhou (1) | Tests: 9 falharam, 87 passaram de 96; arquivos com falha: 1 | não identificado (nomes não guardados) | detectado |
| M2 | gerar com o tenantId vindo do formulário | ok (suíte web completa) | falhou (1) | Tests: 1 falharam, 95 passaram de 96; arquivos com falha: 1 | não identificado (nomes não guardados) | detectado |
| M3 | remover a validação da UF no servidor | ok (suíte web completa) | falhou (1) | Tests: 5 falharam, 91 passaram de 96; arquivos com falha: 1 | não identificado (nomes não guardados) | detectado |
| M4 | remover a validação do limite (teto de 500) | ok (suíte web completa) | falhou (1) | Tests: 1 falharam, 95 passaram de 96; arquivos com falha: 1 | não identificado (nomes não guardados) | detectado |
| M5 | ignorar a falha de autenticação (sem sessão passa adiante) | ok (suíte web completa) | falhou (1) | Tests: 3 falharam, 93 passaram de 96; arquivos com falha: 1 | não identificado (nomes não guardados) | detectado |
| M6 | classificar mal: permissão negada (42501) como banco indisponível | ok (api `pg-errors.test.ts` e web `tenant-data.test.ts`) | falhou (1) | contagem não capturada (o resumo guardado traz só durações) | não identificado (nomes não guardados) | detectado |
| M7 | classificar mal: tabela ausente (42P01) como erro genérico | ok (suíte web e api `pg-errors.test.ts`) | falhou (1) | Tests: 5 falharam, 91 passaram de 96; arquivos com falha: 2 | não identificado (nomes não guardados) | detectado |
| M8 | reprocessar sem checar a existência/autorização da página | ok (suíte web completa) | falhou (1) | Tests: 2 falharam, 94 passaram de 96; arquivos com falha: 1 | não identificado (nomes não guardados) | detectado |
| M9 | converter falha de operação em sucesso aparente (redireciona mesmo com erro) | ok (suíte web completa) | falhou (1) | Tests: 7 falharam, 89 passaram de 96; arquivos com falha: 1 | não identificado (nomes não guardados) | detectado |
| M10 | remover a validação do identificador da página (entrada inválida) | ok (suíte web completa) | falhou (1) | Tests: 1 falharam, 95 passaram de 96; arquivos com falha: 1 | não identificado (nomes não guardados) | detectado |
| M11 | engolir erro do provedor de login como 'sem dados' (estado ready vazio) | ok (suíte web completa) | falhou (1) | Tests: 1 falharam, 95 passaram de 96; arquivos com falha: 1 | não identificado (nomes não guardados) | detectado |
| M12 | erro de infraestrutura vira lista vazia silenciosa | ok (suíte web completa) | falhou (1) | Tests: 2 falharam, 94 passaram de 96; arquivos com falha: 1 | não identificado (nomes não guardados) | detectado |
| M13 | interface: página fora do intervalo volta a dizer 'nenhuma página gerada' | ok (suíte web completa) | falhou (1) | Tests: 2 falharam, 94 passaram de 96; arquivos com falha: 1 | não identificado (nomes não guardados) | detectado |
| M14 | pipeline: reprocessar conteúdo igual cria versão nova (ignora o hash) | ok (`test:schema`, 79/79 na verificação completa) | falhou (1) | test:schema 78/79; check reprovado: as funções de oportunidades (packages/api) passam contra o esquema real | check `as funções de oportunidades (packages/api) passam contra o esquema real` (executa os testes de produto da API; o teste individual não foi guardado) | detectado |
| M15 | pipeline: falha na execução reportada como sucesso | ok (`test:schema`, 79/79 na verificação completa) | falhou (1) | test:schema 78/79; check reprovado: as funções de oportunidades (packages/api) passam contra o esquema real | check `as funções de oportunidades (packages/api) passam contra o esquema real` (executa os testes de produto da API; o teste individual não foi guardado) | detectado |
| M16 | consulta: remover o desempate por URL na paginação | ok (`test:schema`, 79/79 na verificação completa) | falhou (1) | test:schema 78/79; check reprovado: as funções de oportunidades (packages/api) passam contra o esquema real | check `as funções de oportunidades (packages/api) passam contra o esquema real` (executa os testes de produto da API; o teste individual não foi guardado) | detectado |
| M17 | consulta: página de outro tenant legível (sem contexto de tenant, só filtro de id) | n/a | n/a | n/a | n/a | inválido (descartado: não havia mutação real) |

Limitações, preservadas de propósito:
- Os **nomes dos testes** que falharam em cada mutante não foram guardados e não foram reconstruídos; a bateria não foi repetida só para isso.
- A linha de base foi registrada só como "ok" (sem contagens). A única contagem de referência é a da suíte completa no mesmo código: web 96 testes na época.
- Em M6 só o resumo de duração foi guardado: o exit code é a única evidência de falha.
- Em M7 o comando era "web e depois API" encadeado: como a suíte web falhou primeiro, a parte da API não chegou a rodar.
- A detecção é por código de saída: não distingo falha de asserção de outro tipo de falha. As contagens (ex.: M1, 9 de 96) tornam improvável que seja outra causa, mas não a excluem.
- Uma tentativa anterior foi **inválida** (o harness lia o código de saída do `tail`) e está preservada em `mut-invalido-harness.*`; foi corrigida (`pipefail`, linha de base verde obrigatória) e refeita. Nenhuma mutação ficou na árvore real.

## 6. Verificações executadas
**Rodada 1 (hardening):** `pnpm turbo typecheck lint build test --force` (cópia isolada, 9 tarefas); web 96 testes; API 252; `check:consistency`; `test:schema` (79/79; 66 passaram, 1 ignorado nos de produto); `test:api` (33); `test:rls` (47, 6/6 mutações); `test:security` (93); `test:migrations` (213); `test:bootstrap` (95); `test:gate` (237); `test:hardening` (96). Todos só em PostgreSQL descartável local.
**Rodada 2 (correção dos riscos da auditoria):** `pnpm turbo typecheck lint build test --force` na cópia isolada (9 de 9 tarefas) e a suíte web na árvore real: **110 testes, 5 arquivos**. As baterias de banco NÃO foram repetidas: nada em `packages/`, `scripts/` ou `turbo.json` mudou depois delas (conferido por data de modificação); só mudou `apps/web` e este relatório.

## 7. Pendências e dívida técnica
- Validação visual autenticada (desktop e mobile): bloqueada, exige sessão real. Lista manual: filtros pela URL e atualização do navegador; página fora do intervalo; `?v=` válido, inexistente e inválido; "Reprocessar" com duplo clique; foco e teclado; ausência de rolagem horizontal; distinção rascunho/bloqueada/publicada.
- Ledger e checksums no Neon (exigem credencial de leitura dedicada ou consulta no console).
- Causa do check Vercel `gsc` (logs privados).
- Corrida `typecheck` x `build`: aberta (inconclusiva).
- **Dívida técnica fora desta unidade:** `apps/web/src/lib/server/data-flow.ts` (tela "Fluxo de dados") mantém o tratamento antigo: `requestIdentity()` sem proteção, `catch {}` sem log e sem distinguir banco indisponível nem repassar erros do framework. Não foi tocado.
- `app/error.tsx` exibe `error.message`; em produção o Next a oculta, em desenvolvimento aparece. Não alterado.
- A ligação de `parseVersionParam` em `pages/[id]/page.tsx` não tem teste unitário próprio (componente assíncrono interno); o parser e a view têm testes, e a tipagem comprova a ligação.
