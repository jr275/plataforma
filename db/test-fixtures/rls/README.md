# Harness de RLS (fixture de teste, NÃO é o esquema do produto)

Prova, contra um PostgreSQL 16 real e descartável, o mecanismo de isolamento por tenant descrito na regra 2 do `CLAUDE.md` e no ADR-011. Os nomes aqui são de teste (`rls_fixture`, `rls_test`). Nada neste diretório é migration de produto, e nenhum arquivo daqui deve ser copiado para `db/migrations/`.

## Como rodar

```bash
pnpm test:rls          # ou: bash scripts/test-rls.sh
```

O script cria um cluster PostgreSQL **novo** com `initdb` num diretório temporário próprio, escuta **somente** em socket Unix dentro desse diretório (sem TCP), aplica só estes arquivos, roda os testes e apaga o diretório ao sair. Não usa Docker, Neon, `DATABASE_URL` nem qualquer banco existente. Código de saída diferente de zero indica falha.

Requisito: binários PostgreSQL 16 (`initdb`, `pg_ctl`, `psql`) no `PATH` ou em `RLS_HARNESS_PG_BIN_DIR` (procura também em `/opt/homebrew/opt/postgresql@16/bin`, `/usr/local/opt/postgresql@16/bin` e `/usr/lib/postgresql/16/bin`). O script não instala nada. Sem PostgreSQL 16 ele sai com código 2, nunca com sucesso.

No CI (`.github/workflows/ci.yml`), o PostgreSQL 16 vem do pacote `postgresql-16` do Ubuntu 24.04, instalado por `apt` num passo explícito; o harness usa só os binários e cria o próprio cluster descartável (não usa o serviço do sistema).

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `00_roles.sql` | Papéis do cluster descartável: `rls_fixture_owner` (dono) e `menlo_app` (aplicação, sem superusuário nem `BYPASSRLS`) |
| `10_fixture.sql` | Esquema `rls_fixture`, tabela `tenant_item`, grants, RLS `ENABLE` + `FORCE`, política, dados de dois tenants, helpers `rls_test` |
| `tests/10_app_isolation.sql` | Roda como `menlo_app`: isolamento, falha fechada, endurecimento do papel |
| `tests/20_owner.sql` | Roda como dono: privilégios diferentes e sujeito ao RLS (`FORCE`) |
| `tests/30_superuser_integrity.sql` | Roda como superusuário do cluster descartável: comportamento de bypass, integridade, catálogo |
| `mutations/*.sql` | Configurações deliberadamente erradas; o script exige que a suíte **falhe** em cada uma |

## Contexto de tenant

A política lê `current_setting('app.tenant_id', true)`. A aplicação deve **sempre** defini-lo dentro de uma transação com `set_config('app.tenant_id', '<uuid>', true)` (terceiro argumento `true` = local à transação, descartado no `COMMIT`/`ROLLBACK`). Nunca usar `false` (nível de sessão): vaza entre requisições em conexões reutilizadas (demonstrado em `T5d`). Sem contexto, valor vazio ou UUID inválido: zero linhas ou erro, nunca linhas de outro tenant.

## Limites (o que isto NÃO prova)

- Não é o esquema do produto nem prova que a plataforma inteira é segura.
- O papel `menlo_app` consegue definir o próprio `app.tenant_id`; quem garante que o valor vem do usuário autenticado é a camada de API, que não existe ainda (limitação `L1`).
- Superusuário ignora RLS mesmo com `FORCE` (verificado em `S1`): a proteção depende de a aplicação nunca usar um superusuário nem `BYPASSRLS`.
- Autenticação do cluster descartável é `trust` por socket Unix, sem senha, só para o teste. Produção exige autenticação real, TLS e gestão de segredos.
- Não testa pool de conexões, particionamento, nem concorrência. Views, `SECURITY DEFINER`, default privileges e atributos do papel são cobertos como **estado de catálogo** (`db/checks/`, `pnpm test:security`), não como comportamento.
