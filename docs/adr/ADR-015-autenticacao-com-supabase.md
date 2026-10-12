# ADR-015: Autenticação com Supabase e origem da associação usuário↔tenant

**Status:** PARCIALMENTE ACEITO (2026-10-12). O dono do produto respondeu no chat (2026-10-12): (1) banco do produto **Neon**; (2) origem da associação **opção A** (claim assinada); (3) **sim** ao uso de uma biblioteca de verificação de JWT. Implementado: o autenticador do lado do servidor (`packages/api/src/auth/supabase.ts`, com a biblioteca `jose`) e seus testes sem rede. **Cliente do Supabase para Next:** o dono respondeu "todos" (chat, 2026-10-12) à pergunta sobre o que fazer a seguir, que listava a aprovação do cliente do Supabase para Next; foi interpretado como aprovação, e `@supabase/ssr` e `@supabase/supabase-js` foram adicionados a `apps/web` com a tela `/login`, o proxy de sessão e "Sair" no menu. **Só a chave pública** (URL e anon/publishable) é usada; sem as duas variáveis o app roda em modo demonstração. **Verificado contra um Supabase real em 2026-10-12:** o dono criou o projeto, configurou a URL e a chave pública em `apps/web/.env.local` e relatou no chat que **entrou com sucesso** (depois de redefinir uma senha esquecida; a tentativa com senha errada mostrou "E-mail ou senha inválidos" vinda do serviço real). Antes disso o fluxo tinha sido exercitado só com valores falsos (redirecionamento, validação e erro de rede). **Ainda não verificados:** "Sair", a renovação de sessão por um período longo, a claim `app_metadata.tenant_ids` num token real, o autenticador de `packages/api` contra um token real do projeto, e o deploy na Vercel (que não tem as variáveis nem login). **Não implementado:** a ligação das telas a dados reais, a tabela `tenant_member` (opção B) e o procedimento do administrador para gravar `app_metadata.tenant_ids`. `devIdentity` segue sendo a identidade de desenvolvimento.

## Contexto

- `withTenant` (ADR-013, opção A endurecida) só aceita um tenant que conste na `VerifiedIdentity`; só um autenticador pode criá-la (teste estático em `tenant-context.guard.test.ts`). Hoje não há autenticador real.
- A segurança entre tenants depende do código da API e dos testes (ADR-013, item 2): o RLS aplica o valor de `app.tenant_id`, mas **não autentica ninguém**.
- O banco do produto está indefinido: o `CLAUDE.md` diz Neon; o Supabase também oferece Postgres. Isso é a decisão 4 do ADR-014.

## Decisão proposta

### 1. Identidade
O Supabase Auth autentica o usuário e emite o token de acesso (JWT). A API **verifica o token no servidor**: assinatura (chaves públicas do provedor), emissor, audiência e expiração. Algoritmo fixo na configuração (nunca o que o token declara; `none` recusado). O `sub` do token é o `userId`. Nenhum dado de autorização do cliente (tenant escolhido na tela, cabeçalhos) é confiável por si só.

### 2. Origem da associação usuário↔tenant (decisão em aberto)
| Opção | Como funciona | Prós | Contras |
| --- | --- | --- | --- |
| **A. Claim assinada** (`app_metadata.tenant_ids`) | Só o administrador (chave de serviço, fora do runtime) escreve; a API lê da claim já verificada | Sem tabela nem papel novo; simples | Revogação só vale quando o token expira; fonte da verdade fica no provedor |
| **B. Tabela `plataforma.tenant_member`** | A API consulta a associação no nosso banco | Revogação imediata; a verdade é nossa | A consulta é entre tenants (por usuário), e o gate exige RLS por `tenant_id` em toda tabela acessível à aplicação: exige um **papel novo** estreito (emenda ao ADR-013) e novos testes |

**Recomendação:** começar pela **A**, com o prazo do token curto e a limitação documentada, e migrar para a **B** quando houver convite, papéis por tenant ou revogação imediata. A emenda de papéis fica para quando for necessária.

### 3. Forma da implementação (se aprovada)
- Um único módulo autenticador em `packages/api` (por exemplo `auth/supabase.ts`) que devolve `VerifiedIdentity`; entra na lista de autenticadores do teste estático. Segredos e URLs só no servidor; nada de chave de serviço no navegador.
- Testes de verificação **sem rede**, com chaves geradas no teste: token expirado, emissor ou audiência errados, assinatura inválida, algoritmo `none`, `sub` ausente, claim de tenant malformada, tenant fora da claim recusado por `withTenant`.
- Dependências novas a aprovar (nenhuma foi adicionada): uma biblioteca de verificação de JWT (por exemplo `jose`) e, para o fluxo de login na interface, o cliente do Supabase para Next. Cada uma exige aprovação explícita.
- A tela de login e a renovação de sessão (proxy do Next) são uma fatia seguinte; esta ADR só fixa o contrato do lado do servidor.

### 4. Banco do produto: recomendação
**Manter o Neon para o banco e usar o Supabase só para autenticação.** Motivos:
- Todo o modelo de segurança (papéis, runner, gate, testes) foi construído e verificado contra um PostgreSQL 16 padrão com papéis nossos. O Postgres do Supabase traz papéis, esquemas e exposição próprios (por exemplo, a API de dados automática), que precisariam ser desligados e **reverificados** contra o gate.
- Autenticação é só verificação de token no servidor: funciona com qualquer banco.
- Contra: dois fornecedores em vez de um, e itens do ADR-013 (item 4: lock de aconselhamento, ledger e TLS no banco remoto) continuam não verificados **em qualquer** das duas escolhas.

Se o dono preferir o Postgres do Supabase, uma ADR própria precisa antes provar o isolamento e o gate nesse ambiente.

## Alternativas rejeitadas
- **Confiar no tenant enviado pelo cliente:** é exatamente o que `withTenant` existe para impedir.
- **Usar o RLS do Supabase (`auth.uid()`) como isolamento:** troca o modelo aprovado (ADR-013) por outro sem verificação, e o resto do projeto não depende dele.
- **Autenticação própria (senha no nosso banco):** mais superfície de risco sem ganho.

## Consequências
- O primeiro autenticador real fecha a lacuna "sem provedor de login", mas **não** resolve L1 (SQL arbitrário sob `menlo_app` troca de tenant) nem prova o isolamento dos dados de produto.
- A revogação de acesso, na opção A, tem o atraso do prazo do token.

## Decisões do dono do produto
1. **Aprovado (2026-10-12):** banco do produto Neon; o Supabase fica só com a autenticação.
2. **Aprovado (2026-10-12):** opção A (claim assinada `app_metadata.tenant_ids`); a B fica para quando houver convite, papéis por tenant ou revogação imediata.
3. **Aprovado (2026-10-12):** uma biblioteca de verificação de JWT (`jose`). O cliente do Supabase para Next foi tratado como aprovado pelo "todos" do dono (ver o status).

## Em aberto
- Validar o login contra um projeto Supabase real (URL e chave pública em `apps/web/.env.local`) e ligar o autenticador de `packages/api` às telas.
- Como o administrador escreve `app_metadata.tenant_ids` com a chave de serviço (procedimento fora do runtime, ainda não desenhado).
- Itens do ADR-013 (item 4) específicos do Neon: lock de aconselhamento, ledger e TLS no banco remoto.
