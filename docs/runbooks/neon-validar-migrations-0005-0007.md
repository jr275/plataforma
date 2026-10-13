# Plano: validar as migrations 0005, 0006 e 0007 no Neon (NÃO executado)

Status: **plano para aprovação**. Nenhum comando abaixo foi executado contra o Neon nesta unidade. Cada fase exige autorização própria.

## O que está pendente (evidência)
- Neon dev `plataforma-dev` (`autumn-art-97369869`), branch `main`: ledger em `1..4` (inspeção SOMENTE LEITURA em 2026-10-13: checksums de 0001 a 0004 idênticos aos arquivos locais; as 4 tabelas de geração não existem; `set_updated_at()` e `UNIQUE (tenant_id, id)` em `city` existem). Não foi reconfirmado nesta unidade; refazer a leitura antes de qualquer aplicação.
- Pendentes: `0005_generation_run.sql`, `0006_page.sql`, `0007_generation_single_active.sql` (checksums locais: 74073c68…, 254f7235…, d6eb0765…).
- Scripts que poderiam aplicá-las: `scripts/db-migrate.sh --remote-conn-env NEON_MIGRATOR_URL` (aplica TODAS as pendentes, em ordem, cada uma atômica com o gate de segurança dentro da transação) e `scripts/test-neon.sh` (aplica as pendentes **só numa branch temporária**). `scripts/neon-bootstrap.sh`, `neon-create-tenant.sh` e `neon-import-cities.sh` não aplicam migrations (o último escreve dados).

## Fase 0: pré-requisitos (sem escrita)
1. Autorização expressa do dono para a Fase 1 (e outra, separada, para a Fase 2).
2. `neon` CLI autenticada; `psql` 16; `.env.neon.local` com `NEON_ADMIN_URL`, `NEON_MIGRATOR_URL`, `NEON_APP_URL` (nunca impressas).
3. Repositório limpo no commit a validar; bateria local verde (`pnpm test:schema` 79/79, `pnpm turbo typecheck lint build test`).
4. Releitura somente leitura do ledger e das tabelas (mesma consulta de hoje).

## Fase 1: branch temporária (escreve só na cópia)
```bash
bash scripts/test-neon.sh --project-id autumn-art-97369869
```
O script cria `teste-<epoch>` como cópia instantânea de `main`, aplica as pendentes com o gate ativo, confere a reaplicação (`0 aplicada(s), 7 já atualizada(s)`), semeia os tenants de teste (A, B e C a H) **só na branch**, roda 22 verificações de papéis/TLS/isolamento e os testes de produto (62, 1 deles opcional) e apaga a branch ao sair.
**Critérios de sucesso:** saída `NEON TESTS: PASSED` com todas as verificações; mensagem "branch temporário … apagado"; depois, releitura somente leitura mostrando `main` ainda em `1..4` e sem tabelas novas.
**O que isto ainda não prova (incógnitas):** (a) os testes de geração e de concorrência **nunca rodaram contra o Neon** (latência de TLS pode afetar os temporizadores de 4 a 6 s da prova de concorrência e o limite de 30 s por teste); (b) o comportamento do índice parcial e de `FORCE RLS` com FKs compostas no Neon é o mesmo do PostgreSQL local, mas só a Fase 1 confirma; (c) o custo de uma geração de 20 cidades por rede.
**Se falhar:** a falha fica na branch (descartável). Corrigir localmente e repetir. Se o script for interrompido, listar e apagar branches `teste-*` (`neon branches list/delete`). `main` não é tocado por construção.

## Fase 2: aplicar em `main` (autorização separada)
1. **Ponto de restauração:** `neon branches create --project-id autumn-art-97369869 --name pre-0005-<data> --parent main`.
2. **Guarda do ledger + aplicação:**
```bash
NEON_MIGRATOR_URL="$(sed -n 's/^NEON_MIGRATOR_URL=//p' .env.neon.local)" \
  bash scripts/db-migrate.sh --remote-conn-env NEON_MIGRATOR_URL --app-role menlo_app \
  --expect-head 4:0b463cc4a657e6f405b06d0173ce0804e573922aba1a21df775fdb4f0934cc91
```
(`--expect-head` recusa a aplicação se o ledger não estiver exatamente em 4 com esse checksum.)
3. **Verificação depois:** ledger `1..7` com checksums iguais aos locais; `check-catalog.sh --remote-conn-env NEON_ADMIN_URL --app-role menlo_app --executor-role plataforma_migrator` avalia as 4 tabelas novas; consulta como `menlo_app` (leitura, `READ ONLY`) mostra `city = 5571` ainda intacta; abrir `/generation` com o login deve sair de "migrations pendentes" para "Nenhuma página gerada ainda".
4. **Gerar o piloto no Neon é outra escrita** (dados reais em `main`): pedir autorização à parte (`packages/api/src/pages/cli.ts` com `NEON_APP_URL`; esperado `generated:20`, `pilotAcceptance:true`).

## Recuperação
- Cada migration é atômica: falha no meio não deixa nada registrado nem tabelas parciais.
- Depois de aplicada, não há migration de reversão (ADR-011). As 4 tabelas nascem vazias, então o caminho é uma migration corretiva nova (`DROP` só de objetos novos e vazios) ou restaurar `main` a partir do ponto de restauração da Fase 2 (perde o que foi escrito depois dele).
- Impacto: **não é afirmado como nulo.** Evidência a favor: revisão estática (só `CREATE TABLE`, `CREATE INDEX`, `REVOKE ... FROM PUBLIC`, `GRANT` mínimo às novas; nenhum `ALTER`/`DROP` de objeto existente) e execução local com o gate. Evidência que falta: a Fase 1.
