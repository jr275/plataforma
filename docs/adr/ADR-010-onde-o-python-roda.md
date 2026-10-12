# ADR-010: Onde o Python roda
Status: ACCEPTED (2026-10-10)

Contexto: o ADR-007 manteve Python para análise e medição (leitor e carregador do Search Console, estatística do piloto, motor de oportunidades) e deixou em aberto onde ele executa. Hoje roda no Mac do dono do produto e já perdeu extrações longas por sessão encerrada. O Python lê e escreve só no Postgres (o esquema é o contrato). Cargas conhecidas: extração semanal do Search Console (minutos a poucas horas, gravando por mês e retomável), carga no banco, análise do piloto (curta), motor de oportunidades (a medir).

Opções:
A. Agendador do repositório (GitHub Actions: execução agendada e manual). Sem servidor para manter, segredos no repositório, logs e histórico de execuções, retomada porque o extrator já é incremental. Limite de duração por execução e sem GPU. Exige o código no GitHub (confirmado em 10/10/2026: o código do Menlo ficará no GitHub).
B. Função Python na Vercel acionada por cron. Fica junto do produto, mas tem limite curto de duração e memória, ruim para extração longa e estatística.
C. Job em contêiner gerenciado (Cloud Run, Fly, Railway ou similar). Sem limite prático de duração, mais flexível; custo e operação a mais, mais uma conta e uma imagem para manter.
D. Máquina local de alguém. É o estado atual: frágil, sem histórico, depende de uma pessoa.

Recomendação: A agora, com migração para C só se o motor de oportunidades exigir execuções longas ou memória alta. Motivo: a carga atual cabe em A, o custo operacional é quase nulo e o ganho sobre D é imediato (agenda, logs, segredos, retomada). B fica descartada para extração.

Decisão: opção A. O Python roda no agendador do repositório (GitHub Actions, execução agendada e manual). Migrar para C só se o motor de oportunidades exigir execuções longas ou memória alta.

Condições para A funcionar (precisam ser resolvidas antes de ligar):
1. Autenticação sem navegador. O login atual abre o navegador (fluxo de app de computador). Em execução agendada é preciso um token de renovação guardado como segredo, ou uma conta de serviço adicionada como usuário da propriedade `sc-domain:remax.com.br` pela RE/MAX. A permissão da conta atual é "restrita"; confirmar com a RE/MAX se uma conta de serviço também pode ser restrita ou precisa de acesso completo.
2. Papéis do banco. O carregador roda como dono do esquema, nunca como `menlo_app`. Guardar a conexão do dono como segredo separado, só para esse fluxo, e a conexão de `menlo_app` para o que o produto usa.
3. Segredos fora do repositório. `client_secret.json`, `token.json`, chaves e conexões nunca entram no código; rotacionar as que já foram expostas.
4. Idempotência. Cada execução pode rodar duas vezes sem duplicar efeito (regra 3 do CLAUDE.md); o carregador e o extrator por mês já seguem isso.
5. Falha visível. Execução que falha avisa o dono do produto; sem isso o problema só aparece quando alguém olha o painel.

Consequências: uma pasta de fluxos de agendamento no repositório; documentar no Guia para engenheiros o comando para rodar manualmente; revisar a decisão quando o motor de oportunidades entrar na publicação em tempo real (gatilho já previsto no ADR-007).
