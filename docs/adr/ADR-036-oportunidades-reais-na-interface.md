# ADR-036: Oportunidades reais na interface (primeira tela ligada ao banco do produto)

**Status:** PROPOSED (2026-10-14). Implementado só em código local, com testes de interface e da ação de servidor, todos sem banco. **Não validado contra um banco real**: nenhum banco foi acessado e nenhuma migration foi criada ou aplicada.

## Contexto

- A tela Opportunity Discovery (`/opportunities`, `/opportunities/[id]`) ainda lê só as fixtures de `apps/web/src/data/source.ts` (`DATA_IS_DEMO = true`). Só a área Generation, a de integrações e o fluxo de dados já usam dado real por tenant (ADR-018).
- A tabela `plataforma.opportunity` (migration 0002, ADR-014) e as funções `listOpportunities` e `getOpportunity` de `packages/api` já existem, com RLS e teste de isolamento entre tenants.
- O ADR-018 diz que as telas reais nunca caem para dados fictícios. Mas hoje o ambiente local e o de demonstração não têm login nem banco, e a tela precisa continuar abrindo neles.

## Decisão

1. `/opportunities` e `/opportunities/[id]` leem as oportunidades reais pelo `loadForTenant` (identidade verificada no servidor, `withTenant`, RLS). Só funções tipadas de `packages/api` (regra 4).
2. **Cada situação é um estado explícito**: não configurado, sem sessão, sem tenant, tabela inexistente, erro (sem a mensagem do banco) e lista vazia. Nenhuma delas vira dado de demonstração.
3. **A demonstração só aparece quando o ambiente não tem login ou banco configurados**, sempre com um aviso visível ("Dados de demonstração") que diz o que falta. Esta é a única exceção à regra do ADR-018 e vale só para esta área, para não quebrar o ambiente de demonstração. Quando uma configuração existir, a exceção deixa de se aplicar.
4. **Só uma escrita: mudar o status.** Uma ação de servidor (`changeStatusAction`) usa `setOpportunityStatus`, com o tenant sempre da sessão. O servidor **revalida a transição contra o estado atual** lido na mesma transação (`candidata → em revisão → pronta`, voltar, descartar e restaurar); não se pula etapas e `blocked` não é destino de clique (vem dos gates). Descartar é reversível (não há `DELETE`, ADR-014). Não há criação nem edição de conteúdo pela interface.
5. **Sem nota.** O modelo real tem fatores separados (demanda, concorrência, evidência) e ordem editorial; a tela não mostra pontuação, risco nem ciclo, que pertencem à demonstração (regra 5, ADR-002). Os pesos e o score v1 continuam só nas fixtures.

## Alternativas rejeitadas

- **Manter só a demonstração:** não entrega valor real.
- **Mostrar "não configurado" também no ambiente sem configuração:** quebra o ambiente de demonstração e o visual aprovado.
- **Trocar a demo por dado real em todas as telas de uma vez:** vários assuntos num só PR, difícil de revisar e de reverter.

## Consequências

- Para ver dados reais é preciso: `PLATAFORMA_APP_DATABASE_URL`, o login (Supabase) configurado, o usuário com a claim `app_metadata.tenant_ids` e linhas em `plataforma.opportunity`. **Nenhuma dessas condições foi verificada aqui.** Os tenants e as oportunidades não são criados por migration (ADR-013); falta o procedimento administrativo.
- **Risco herdado:** o `loadForTenant` ainda escolhe o tenant por posição (`tenantIds[0]`), o achado F2 da auditoria de segurança. Quem tem mais de um tenant vê sempre o primeiro. O endurecimento (`pickTenant`, ADR-018) está pronto na branch `feat/tenant-selection`, ainda não integrada; esta tela herda a correção quando ela entrar (os estados já estão previstos aqui). Até lá, não use esta tela com usuários de vários tenants.
- O ADR-036 também não cobre a criação ou a edição de oportunidades pela interface nem a ligação com o motor de provedores.
