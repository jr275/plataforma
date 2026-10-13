# Runbook: banco de desenvolvimento no Neon

Projeto `plataforma-dev` (`autumn-art-97369869`), PostgreSQL 16, São Paulo. **Só desenvolvimento.** Nenhum dado real, nenhum papel de produção.

## Pré-requisitos
- `neon` CLI (`npm i -g neon@latest`) e `neon login` (abre o navegador). `psql` 16 e `python3` no PATH.
- `.env.neon.local` na raiz do repositório (**fora do Git**, permissão 600) com `NEON_OWNER_URL` (URI do papel dono do Neon, conexão direta, `sslmode=require`). **Nunca** cole URLs ou senhas em chats, commits ou logs.

## Preparar o banco (uma vez)
```bash
bash scripts/neon-bootstrap.sh --project-id autumn-art-97369869
```
Cria `plataforma_admin`, `plataforma_migrator` e `menlo_app` (sem `BYPASSRLS`), restringe o banco, inicializa o ledger e verifica o estado real. As três URLs novas vão para `.env.neon.local` (`NEON_ADMIN_URL`, `NEON_MIGRATOR_URL`, `NEON_APP_URL`). Se os papéis já existirem, só verifica. Recusa projeto, banco ou versão diferentes.

## Aplicar migrations
```bash
NEON_MIGRATOR_URL="$(sed -n 's/^NEON_MIGRATOR_URL=//p' .env.neon.local)" \
  bash scripts/db-migrate.sh --remote-conn-env NEON_MIGRATOR_URL --app-role menlo_app
```
O gate de segurança roda dentro de cada migration e o bypass é recusado em banco remoto. Reaplicar é seguro (idempotente).

## Criar tenant e carregar cidades (IBGE)
```bash
bash scripts/neon-create-tenant.sh --slug remax --name "RE/MAX (piloto)"      # imprime o uuid do tenant
bash scripts/neon-import-cities.sh --tenant UUID_DO_TENANT                    # baixa do IBGE e importa como menlo_app
```
Ambos são idempotentes. A carga usa `NEON_APP_URL` (nunca é impressa) e grava a execução, os registros por linha e as cidades.

## Testar (isolamento, TLS, falhas, API)
```bash
bash scripts/test-neon.sh --project-id autumn-art-97369869
```
Cria um branch temporário (cópia do `main`), roda tudo nele e o apaga ao sair. Se o script for interrompido, apague branches `teste-*` no painel do Neon ou com `neon branches list/delete --project-id autumn-art-97369869`.

## Recuperação
- **Verificar sem alterar:** `bash scripts/neon-bootstrap.sh --project-id autumn-art-97369869` (papéis já existentes: só verifica).
- **Senha vazada ou perdida:** redefina o papel no painel do Neon ou com `neon roles reset-password`, atualize a linha correspondente de `.env.neon.local` e rode a verificação. Nunca versione o arquivo.
- **Migration que falhou:** nada fica registrado (atômico, com o gate); corrija o arquivo (ainda não aplicado) e rode de novo. Migration já aplicada não se edita: crie uma nova.
- **Recomeçar do zero:** crie um projeto novo (PostgreSQL 16), troque o `--project-id` e a `NEON_OWNER_URL`, e rode o bootstrap e as migrations.
