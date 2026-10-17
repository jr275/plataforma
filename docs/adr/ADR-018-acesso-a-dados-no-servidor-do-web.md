# ADR-018: Acesso a dados no servidor do Next e a tela "Fluxo de dados"

**Status:** PROPOSED (2026-10-12). Implementação local autorizada pelo dono do produto no chat ("sim"); a ativação no Vercel depende de configuração dele.

## Contexto
- Até aqui nenhuma tela lê o banco: `apps/web` usa fixtures (`src/data/demo`) e o login (ADR-015) só protege a interface. A regra 4 diz que telas só leem por funções tipadas de `packages/api`.
- Já existem: autenticador Supabase (`createSupabaseAuthenticator`, claim assinada `app_metadata.tenant_ids`), `withTenant` e as funções de leitura de importação (`listImportRuns`, `listImportRecords`, `listCities`, ADR-017).

## Decisão
1. **Módulo só de servidor** (`apps/web/src/lib/server/`, marcado `server-only`): abre um pool singleton com a credencial `menlo_app` e resolve a identidade a cada requisição. Nada disso entra no bundle do navegador.
2. **Identidade:** o token de acesso é lido do cookie de sessão no servidor e **verificado** por `createSupabaseAuthenticator` (JWKS do projeto, algoritmos fixados `ES256`/`RS256`, emissor `<NEXT_PUBLIC_SUPABASE_URL>/auth/v1`). O tenant vem **só** de `identity.tenantIds`, nunca de parâmetro, cookie livre ou corpo da requisição. Com mais de um tenant, usa-se o primeiro até existir seletor de workspace real.
3. **Configuração:** `PLATAFORMA_APP_DATABASE_URL` (URI `menlo_app`, TLS obrigatório; variável **sem** `NEXT_PUBLIC_`, marcada sensível no Vercel). Sem ela, ou sem Supabase, a tela mostra um estado explícito "não configurado". **Nunca cai para dados fictícios** quando o resultado seria apresentado como real.
4. **Pool:** `createAppPool(url)` em `packages/api` (único lugar que cria `pg.Pool` com `ssl.rejectUnauthorized: true`); `pg` passa a ser dependência de runtime de `packages/api`. O CLI de importação passa a usar a mesma função. `apps/web` passa a depender de `@plataforma/api` (workspace) via `transpilePackages`.
5. **Tela `/data-flow` ("Fluxo de dados"):** Server Component dentro de `Suspense`. Mostra execuções reais (origem real/teste/manual, status, contagens, sha256, horário, erro), o detalhe de uma execução com registros por desfecho e avisos, e o total de cidades. Estados distintos: não configurado, sem sessão, sem tenant na claim, erro de banco (mensagem genérica, sem detalhes de conexão), vazio, pronto.
6. **Rótulo de origem:** toda linha mostra `origin`; execuções `test` aparecem marcadas e nunca somam como dado real nos totais.

## Alternativas rejeitadas
- **Client Component com chamada direta ao banco ou ao Supabase:** viola a regra 4 e expõe credencial.
- **Cair para demonstração quando o banco falha:** mistura fictício com real (proibido pelo critério "sem dado fictício declarado como integração").
- **Tenant escolhido pelo navegador:** quebra o isolamento (ADR-013/015).

## Consequências
- Primeira tela com dado real de ponta a ponta. A prova de isolamento continua sendo o RLS testado; a tela herda a garantia.
- Limite herdado (ADR-015): revogação de acesso só vale quando o token expira.
- Exige do dono: `PLATAFORMA_APP_DATABASE_URL` no Vercel e o claim `tenant_ids` com o uuid do tenant no usuário do Supabase.

## Seleção do tenant ativo (2026-10-14, auditoria de segurança F2/E1)
- **Regra única** (`packages/api/src/tenant-selection.ts`, `pickTenant`; no web, `apps/web/src/lib/server/tenant-selection.ts`, `activeTenantFor`), usada por `tenant-data.ts`, `data-flow.ts` e `gsc.ts`: zero tenants → `no_tenant`; **exatamente um** tenant na claim assinada → ele (comportamento anterior preservado, autorizado no servidor por `withTenant`); **vários** → só uma seleção EXPLÍCITA que conste na claim; sem ela, o estado controlado `tenant_selection_required` (com as opções) e **nenhuma consulta ou mutação** é feita. Antes, `tenantIds[0]` era escolhido por posição em três lugares; um teste estático impede a volta (`tenant-selection.test.ts`).
- **Seleção explícita ainda NÃO existe:** nenhum cookie, parâmetro de URL ou seletor foi ligado. Hoje quem tem vários tenants vê o estado de seleção obrigatória (ação de servidor recusada com mensagem própria). O desenho de como a escolha é feita, guardada e revalidada (por exemplo, cookie httpOnly tratado só como preferência e revalidado contra a claim em toda requisição) precisa de validação com o fluxo de autenticação antes de ser implementado; o argumento `explicit` de `activeTenantFor` é o único ponto onde essa fonte entrará.
- Uma seleção que a identidade não possui é rejeitada (`staleSelection`), nunca obedecida; com um único tenant, uma seleção de outro tenant é ignorada.
- **Mudança de contrato:** um usuário com mais de um tenant deixa de ser levado ao primeiro e passa a ver `tenant_selection_required` até que a seleção exista. Os nomes dos tenants não podem ser exibidos (a aplicação não lê a tabela `tenant`, ADR-014).
