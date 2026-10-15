# Proposta: procedimento do administrador para ligar um usuário a um tenant com dados

**Status:** PROPOSTA (2026-10-14). Nada aqui foi executado em Neon, Supabase ou produção. Cada passo que toca um ambiente compartilhado exige a autorização do dono para aquela operação (`docs/POLITICA_DE_ENGENHARIA.md`, seção 2, quando ela estiver integrada). Os comandos abaixo usam **marcadores**; nenhum segredo entra neste documento nem no chat.

## Por que isto é necessário
Para a tela `/opportunities` mostrar dado real (ADR-024) é preciso, no ambiente: (1) banco e login configurados; (2) um tenant; (3) a claim `app_metadata.tenant_ids` no usuário; (4) linhas em `plataforma.opportunity`. As migrations não criam tenants nem dados (ADR-013, item 3). Hoje existe só o passo 2 para o banco de **desenvolvimento** do Neon (`scripts/neon-create-tenant.sh`); os passos 3 e 4 não têm procedimento.

## Camadas de acesso de cada passo

| Passo | O que faz | Onde | Camada (política, seção 2) | Autorização |
|---|---|---|---|---|
| A | Subir banco descartável com dados de TESTE e ver a tela | máquina local (`pnpm dev:local`) | 4, descartável | não exige |
| B | Criar o tenant | Neon de desenvolvimento (`scripts/neon-create-tenant.sh`) | 7, escrita em banco compartilhado | explícita, por operação |
| C | Gravar a claim no usuário | Supabase (Admin API) | conta de serviço, fora do runtime | explícita, por operação |
| D | Inserir oportunidades | Neon, como `menlo_app`, sob RLS | 7 | explícita, por operação |
| E | Verificar | leitura | 3, leitura em banco compartilhado | explícita |

## A. Ver a tela real sem tocar em nada compartilhado
`pnpm dev:local` (ou `scripts/dev-local.sh --setup-only` só para conferir) sobe um PostgreSQL 16 **descartável**, aplica todas as migrations com o gate ativo, cria o tenant com o **mesmo UUID da claim do seu login**, importa o IBGE de SP e agora semeia **4 oportunidades de teste** (títulos com `[teste local]`). Ao sair, apaga o banco e o arquivo de ambiente. O login (Supabase) precisa estar configurado em `apps/web/.env.local` **da worktree em que o script roda**; esse arquivo não é copiado entre worktrees.

## B. Criar o tenant (Neon de desenvolvimento)
`scripts/neon-create-tenant.sh --slug <slug> --name "<nome>"`. Já existe, é idempotente e recusa banco que não seja `plataforma` em PostgreSQL 16; a URL vem de `NEON_MIGRATOR_URL` em `.env.neon.local` e **nunca é impressa**. Anote o `id` (UUID) devolvido: é ele que vai na claim.

## C. Gravar a claim `app_metadata.tenant_ids` (Supabase) — a lacuna principal
Só o administrador escreve a claim (ADR-015, opção A), com a **chave de serviço** do Supabase, que **nunca** vai para o app, para o Vercel nem para o navegador.

Desenho proposto, a decidir pelo dono:
1. Um script de uma só finalidade (por exemplo `scripts/supabase-set-tenants.sh`, que **ainda não existe**), executado na máquina do administrador, que lê a chave de serviço de um arquivo fora do Git ou de um prompt oculto, nunca de argumento de linha de comando.
2. Antes de gravar, lê o usuário (`GET /auth/v1/admin/users/<user_id>`) e mostra **só** o `app_metadata` atual, para conferir.
3. Grava com `PUT /auth/v1/admin/users/<user_id>`, corpo `{"app_metadata":{"tenant_ids":["<uuid>"]}}`. **A confirmar na documentação do Supabase antes de executar:** se `app_metadata` é mesclado ou substituído (um `PUT` que substitui apagaria outras chaves). Por isso o passo 2 existe.
4. Lê de novo e confere. Valida cada UUID no formato antes de enviar.
5. **Com mais de um tenant a regra é outra:** hoje quem tem vários tenants vê o estado "Seleção de workspace necessária" (ADR-018, `pickTenant`). Para o piloto, grave **exatamente um** tenant por usuário.

Efeito em tempo real: a claim só aparece em um token novo. O usuário precisa sair e entrar, ou esperar a renovação; a revogação tem a janela do prazo do token (ADR-015).

## D. Inserir oportunidades reais
Não por migration (ADR-013). Duas opções a decidir:
- **Script administrativo** que insere como `menlo_app` dentro de uma transação com `app.tenant_id` definido (como o passo 5b do `dev-local.sh` faz no banco descartável), a partir de um arquivo revisado pelo dono. As colunas e valores aceitos estão no ADR-014 (`kind`, `intent`, `demand`/`competition`/`evidence`, `status`, `rank`).
- **Tela de cadastro** (fatia futura, com ação de servidor e teste próprios).
Nenhuma das duas existe para o Neon hoje. Os dados precisam vir de fontes reais; este procedimento **não inventa oportunidades**.

## E. Verificar (leitura)
1. A claim: `GET` do usuário mostra `tenant_ids` com o UUID do passo B.
2. O banco, como `menlo_app` em `BEGIN READ ONLY` com `app.tenant_id` definido: `SELECT count(*) FROM plataforma.opportunity` bate com o esperado.
3. A tela: entrar com o usuário e abrir `/opportunities`. O selo "Dados reais" aparece e o aviso de demonstração **não**.

## Recuperação
- Claim errada: regravar o `app_metadata` anterior (por isso o passo C.2 guarda o valor lido).
- Oportunidade inserida por engano: não há `DELETE` para a aplicação (ADR-014); o caminho é mudar o `status` para `dismissed`.
- Tenant criado por engano: operação do executor, com a mesma autorização, antes de existir dado ligado a ele.

## Fora de escopo e riscos
- Seleção explícita de workspace (UI e cookie): desenho pendente (ADR-018).
- Criação de usuários e convites (opção B do ADR-015, `tenant_member`).
- Produção: este procedimento descreve o ambiente de **desenvolvimento**. Produção exige autorização e um ensaio próprios.
