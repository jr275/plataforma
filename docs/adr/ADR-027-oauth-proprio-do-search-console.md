# ADR-027: Conexão ao Search Console por OAuth próprio da Plataforma

**Status:** PROPOSED (2026-10-17). Só texto: **nenhum código, tabela, migration, cliente OAuth, variável de ambiente ou deploy foi criado.** Depende da aprovação do ADR-016 (tabelas `search_*`) e do ADR-013 (papéis e privilégios), ambos ainda PROPOSED.

## Contexto

- A conta de serviço da Plataforma (`plataforma-gsc@plataforma-511815.iam.gserviceaccount.com`) autentica no Google, mas o dono da propriedade ainda não a autorizou: a validação devolve "Permissão negada". Só um **proprietário** da propriedade pode adicionar usuários.
- Quem não é proprietário, mas tem acesso de leitura, consegue conectar por **login Google (OAuth)**. Foi o que o OpenSEO fez para a Wendy e para o projeto da RE/MAX.
- O OpenSEO em modo **hospedado** guarda o token do Google em servidor de terceiros, fora do nosso isolamento por tenant. É útil para pesquisa, mas não deve ser a base do produto.
- Hoje o relatório do Search Console (ADR-026) é carregado à mão, de exports, em arquivo local. Não há conexão permanente nem histórico.
- Regras que valem: fatos nunca inventados (regra 1); `tenant_id` e RLS em toda tabela do data plane, com teste de isolamento (regra 2); telas só leem por `packages/api` (regra 4); núcleo genérico (regra 10); dados do cliente e segredos nunca no repositório nem no cliente.

## Decisão proposta

1. **Fluxo OAuth 2.0 de aplicação web** (código de autorização com `state` e PKCE), escopo único `https://www.googleapis.com/auth/webmasters.readonly` (**somente leitura**). Nenhum escopo de escrita.
2. **Uma conexão por tenant e por propriedade** (`sc-domain:…` ou prefixo de URL), registrando **quem autorizou**, quando e o escopo concedido. A propriedade vem da lista que o Google devolve àquele usuário, nunca de texto livre.
3. **Token só no servidor.** O `refresh token` é cifrado em repouso (cifra autenticada, chave fora do banco, com versão para rotação) e **nunca** vai ao navegador, ao log, a um prompt ou ao repositório. O `access token` é obtido sob demanda e não é guardado.
4. **Acesso por função tipada** de `packages/api`, com `withTenant`/RLS; o papel da aplicação não lê a coluna do token cifrado por SQL livre (a decifragem acontece numa função de servidor, e a política de privilégio da coluna é definida junto com o ADR-013).
5. **Revogável e auditável:** botão "Desconectar" revoga no Google e apaga o token; cada conexão, uso e revogação gera registro de auditoria (sem o segredo). Se o usuário que autorizou perder o acesso à propriedade, a conexão passa a "reautorizar" (estado explícito, nunca "conectado" por padrão).
6. **Carga incremental** para as tabelas `search_*` do ADR-016 (idempotente, regra 3), respeitando a cota da API e o atraso de ~3 dias dos dados. Até a carga existir, a tela continua mostrando só "Importado" (ADR-026).
7. **Estados honestos na tela:** não configurado, autorização pendente, conectado, sem permissão, reautorização necessária, erro do provedor. Nada de "conectado" sem uma leitura real bem-sucedida.

## Modelo de ameaça (resumido)

- **Roubo do banco ou do backup:** token cifrado com chave fora do banco; sem a chave, inútil. A chave e a rotação dependem de um cofre de segredos (decisão pendente).
- **Vazamento entre tenants:** tabela com RLS forçada e política canônica; teste de isolamento obrigatório no mesmo PR.
- **Conta pessoal como ponto único:** o token carrega o acesso de **uma pessoa**; sair da empresa corta a conexão. Mitigação: reautorização explícita e aviso, e, a longo prazo, preferir a conta de serviço autorizada pelo dono.
- **Terceiro hospedando o token** (OpenSEO hospedado): rejeitado como base do produto.
- **Tela de consentimento do Google:** o escopo de Search Console é "sensível"; em modo de teste só usuários cadastrados conseguem autorizar, e produção aberta exige verificação do aplicativo. Isso não foi avaliado.

## Alternativas rejeitadas

- **Só a conta de serviço:** é o ideal, mas depende do dono da propriedade, que hoje é o bloqueio.
- **OpenSEO hospedado como backend:** token fora do nosso isolamento.
- **CSV manual para sempre:** serve de ponte (ADR-026), não de conexão.

## Plano em fases (cada uma pede autorização própria)

1. **Aprovar este ADR, o ADR-016 e o ADR-013.**
2. **Migrations em branch, sem aplicar** (`search_connection`, `search_*`), com RLS e testes de isolamento em PostgreSQL descartável. **Bloqueio de numeração:** a `main` e a branch do motor têm migrations diferentes com o mesmo número `0008`; o número só pode ser fixado depois da integração.
3. **Rotas OAuth e leitura** em desenvolvimento, com cliente OAuth de teste.
4. **Configuração de produção, só com o dono:** criar o cliente OAuth e a tela de consentimento no Google Cloud, definir a chave de cifra e as variáveis na Vercel, e fazer o deploy.

## O que NÃO está verificado

Nada disto foi implementado nem testado. Não se sabe ainda: o tipo de verificação que o Google exigirá, onde ficará a chave de cifra e quem será o usuário que autoriza a RE/MAX.
