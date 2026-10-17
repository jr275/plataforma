# Auditoria funcional e fundação operacional (2026-10-17)

Linha de código: `main` (`d5d852b`) + PR #9, sobre a branch `feat/gsc-export-report`. Ambiente: macOS, Node 24.9.0, pnpm 12.10.1, PostgreSQL 16.15 (Homebrew), servidor de desenvolvimento local **sem Supabase, banco, Search Console nem DataForSEO configurados**. Nenhuma migration foi escrita ou aplicada, nenhum banco compartilhado ou de produção foi acessado e nenhum provedor externo foi chamado. Este documento descreve o que foi **observado**; o que não foi verificado está dito como tal.

## 1. Baseline (antes de qualquer alteração)

| Verificação | Resultado |
| --- | --- |
| `check:consistency` | saída 0 |
| `turbo typecheck lint build --force` | saída 0, 6 de 6 |
| Testes da web | 143 passaram |
| Testes da API (sem banco) | 331 passaram |
| `test:api` (PostgreSQL 16 descartável) | saída 0, 33 passaram |
| `test:schema` | saída 0, 61 passaram, **1 pulado** |
| CI da `main` (RLS, migrations, security, bootstrap, gate, hardening, api, schema) | último run: sucesso |

Depois das correções: web 169, API 354, `test:api` 33, `test:schema` 61 + 1 pulado, `turbo` 6 de 6, `check:consistency` 0. Nenhum cluster temporário restou.

**Teste pulado:** `run.product.test.ts` ("carga REAL do IBGE: 5.571 municípios") só roda com `PLATAFORMA_TEST_IBGE_CSV` apontando para o arquivo real. **A importação completa de dados reais não é exercitada nem localmente nem no CI.** Lacuna de evidência.

## 2. Cobertura da auditoria (números reais)

| Item | Descobertos | Verificados | Como |
| --- | ---: | ---: | --- |
| Páginas (rotas) | 46 | **44** | carga, conteúdo, erro na tela, imagem quebrada, estouro horizontal (desktop e celular) e **erros de console e de execução**; 36 fixas, `/login`, `/dev/preview` (+ replay) e 6 dinâmicas com id real |
| Páginas dinâmicas de geração (`/generation/pages/[id]`, `/generation/runs/[id]`) | 2 | 0 de forma plena | só o estado "sem banco"; o "não encontrado" real exige banco configurado |
| Route handlers | 2 (imagens OG) | 0 neste passo | cobertos por testes unitários |
| Server actions | 2 arquivos | 0 neste passo | cobertos por testes unitários (29 na geração) |
| Interações (botões, formulários, filtros) | não inventariadas | **0** | a varredura NÃO exercita interações; só testes unitários de visão |
| Ferramentas registradas | 9 | 9 avaliadas | ver seção 4 |
| Etapas do pipeline canônico | 15 | **0** verificadas | 5 ausentes, 5 parciais, 5 implementadas; nenhuma tem evidência de execução real neste ambiente |

Ids inexistentes nas 6 telas com dados de exemplo mostram "não encontrado" sem quebrar.

## 3. Defeitos encontrados e corrigidos

1. **Rolagem horizontal da página inteira no celular (+306 px) em `/analytics/search-console`.** Causa: `Panel` dentro de uma grade de coluna única cresce até a largura mínima da tabela. Correção: `min-w-0` na base de `Panel`. Teste de regressão no contrato do painel. Pós-correção medido: 0 px.
2. **Erro de hidratação em `/graph`** (coordenadas do layout de força diferem na 13ª casa decimal entre servidor e navegador). Correção: arredondar a centésimos o que vai para o SVG. Pós-correção, em aba limpa: 0 erros de console, coordenadas como `-203.81`. *Sem teste automatizado: o contrato é visual e de hidratação; só a verificação no navegador o prova.*
3. **Aviso `Base UI: ... nativeButton` em `/opportunities/[id]`** (3 botões renderizados como link). Correção: componente `LinkButton` (`nativeButton={false}`) e teste de que gera `<a>` e não `<button>`. Pós-correção: 0 erros de console.
4. **Defeito do meu próprio avaliador:** a etapa "Medição" aparecia como verificada só por um export importado. Correção: etapa verificada exige evidência `live` ou `sandbox`. Teste de regressão.

## 4. Fundação operacional (nova)

- **Avaliador de status** (`packages/api/src/ops`): 9 status (`WORKING`, `DEGRADED`, `NOT_WORKING`, `NOT_CONFIGURED`, `NOT_TESTED`, `BLOCKED`, `MOCK`, `DISABLED`, `STALE`) com precedência explícita; módulo puro, sem segredo (só nomes de variáveis), "agora" injetado. 23 testes.
- **Precedência:** desabilitada → configuração ausente → **a evidência mais recente é falha** (uma falha recente não é escondida por um sucesso antigo) → dependência impede a execução (guarda a causa raiz; a dependente não é culpada) → sem evidência → mock, simulação e replay → sucesso vencido → parcial ou bloqueado → sucesso.
- **Registro** com 15 etapas (inclusive as ausentes, declaradas como tal) e 9 ferramentas com dependências reais.
- **Métricas com numerador e denominador:** ferramentas funcionando ÷ registradas; etapas verificadas ÷ declaradas; sucesso das checagens reais ÷ elegíveis (sem base vira `null`, nunca 0% nem 100%).
- **Tela `/operations`:** métricas, contagem dos 9 status em texto, fluxo (React Flow) com as 15 etapas e a tabela ferramenta a ferramenta (evidência, modo, bloqueios, próxima ação). Arestas só onde há dependência real entre ferramentas de etapas diferentes.
- **Evidência usada hoje:** presença de configuração, sondagem do banco na requisição, registros reais de importação e de geração, snapshot do Search Console. Mensagens de erro passam por redação (URLs de conexão, e-mails e tokens).

**Observado neste ambiente local** (sem nenhuma variável de provedor):

| Status | Ferramentas |
| --- | ---: |
| WORKING | 1 (relatório do export, modo IMPORTADO) |
| NOT_CONFIGURED | 4 (identidade, banco, Search Console ao vivo, DataForSEO) |
| BLOCKED | 4 (importação, geração, imagem OG, gates), todas com causa raiz = banco não configurado |
| DEGRADED, NOT_WORKING, NOT_TESTED, MOCK, DISABLED, STALE | 0 |

Cobertura de ferramentas 1 de 9; etapas verificadas 0 de 15; checagens reais elegíveis: nenhuma. O que **não** foi observado: o estado em produção (exige login). A lista de variáveis do projeto na Vercel sugere que o banco, a identidade e os provedores estariam configurados (então seriam `NOT_TESTED`, e não `NOT_CONFIGURED`), mas isso é inferência pelos nomes, não observação da aplicação em execução.

## 5. Segurança

- `pnpm audit --prod`: **1 vulnerabilidade alta**, `braces` (GHSA-vfj7-8cjw-p6xm), sem versão corrigida, transitiva via `apps/web > shadcn > fast-glob > micromatch`. O `shadcn` está em `dependencies`; é ferramenta de geração de componentes, não de execução. **Não alterei dependências**; a decisão é mover `shadcn` para `devDependencies`.
- Varredura de padrões de segredo nos arquivos rastreados: só marcadores literais de teste ("SEGREDO", chave `x`). Nenhum `.env` rastreado.
- Isolamento entre tenants: evidência = suítes de RLS do CI (inalteradas); não foram reexecutadas neste passo.
- Variáveis não sensíveis na Vercel com credenciais (banco do migrador e de teste, senha do DataForSEO, valor antigo da conta de serviço em Preview e Development): registradas em proposta à parte; **nada foi alterado**.

## 6. Não feito, com o motivo

| Item | Motivo |
| --- | --- |
| Armazenamento persistente de execuções (event store) e histórico de verificações | exige migration; o número depende da decisão de integração `main` × motor (PR #14) |
| Verificação funcional real de Search Console ao vivo, DataForSEO e Ahrefs | exige autorização do dono da propriedade, chave e créditos, e custo externo |
| Execução ponta a ponta com dependências reais | exige banco e login configurados neste ambiente |
| Auditoria de interações (botões, formulários, filtros) em todas as telas | fora do alcance deste passo; só carga, console e layout foram varridos |
| `check:catalog` e Linux/GitHub Actions | sem alteração desde as fases anteriores; o CI da `main` passa |

**Auditoria concluída ≠ produto concluído.** A fundação existe e é medida; o pipeline não está verificado de ponta a ponta.
