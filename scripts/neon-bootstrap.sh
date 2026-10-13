#!/usr/bin/env bash
# Bootstrap do banco de DESENVOLVIMENTO no Neon (ADR-013: papéis administrador, executor e aplicação; ADR-017 quando aprovado).
#
#   scripts/neon-bootstrap.sh --project-id ID_DO_PROJETO_NEON [--verify-only]
#
# Lê NEON_OWNER_URL do arquivo .env.neon.local (fora do Git, permissão 600): o URI libpq do papel dono que o Neon cria. Esse papel
# tem BYPASSRLS e só serve a ESTE preparo; a aplicação nunca o usa. O script:
#   1. confere que o servidor é PostgreSQL 16, o banco é `plataforma` e o projeto Neon (GUC neon.project_id) é o informado;
#   2. cria os três papéis (LOGIN, sem superusuário, sem BYPASSRLS, sem CREATEROLE/CREATEDB/REPLICATION), com senhas geradas
#      aqui e gravadas SÓ no .env.neon.local (nunca impressas nem passadas na linha de comando);
#   3. restringe o banco (PUBLIC sem acesso), passa a posse ao administrador e inicializa o ledger de migrations;
#   4. verifica o estado REAL (modelo de papéis e gate de catálogo). Recusa-se a rodar se já houver papéis de outro estado.
# Não toca em outro banco nem em outro projeto. Código de saída: 0 ok · 1 verificação falhou · 2 uso/pré-requisito · 4 falha de execução.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=lib/remote-conn.sh
source "$ROOT/scripts/lib/remote-conn.sh"
die() { echo "ERRO: $*" >&2; exit 2; }
fail4() { echo "FALHA [execução]: $*" >&2; exit 4; }

ENV_FILE="${NEON_ENV_FILE:-$ROOT/.env.neon.local}"
ADMIN=plataforma_admin MIGRATOR=plataforma_migrator APP=menlo_app EXPECTED_DB=plataforma OWNER_ROLE=plataforma_owner
PROJECT_ID="" VERIFY_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --verify-only) VERIFY_ONLY=1; shift ;;
    --project-id) [[ $# -ge 2 ]] || die "$1 exige valor"; PROJECT_ID="$2"; shift 2 ;;
    *) die "argumento desconhecido: $1" ;;
  esac
done
[[ "$PROJECT_ID" =~ ^[a-z0-9-]+$ ]] || die "--project-id é obrigatório (ID do projeto Neon, ex.: autumn-art-97369869)"
PSQL_BIN="$(command -v psql || true)"; [[ -n "$PSQL_BIN" ]] || die "psql não encontrado"
command -v openssl >/dev/null || die "openssl não encontrado"

# --- o arquivo de segredos: existe, só do dono, fora do Git ------------------------------------------
[[ -f "$ENV_FILE" ]] || die "arquivo de conexão ausente: $ENV_FILE"
[[ "$(stat -f '%Lp' "$ENV_FILE" 2>/dev/null || stat -c '%a' "$ENV_FILE")" == "600" ]] || die "o arquivo de conexão precisa ter permissão 600"
git -C "$ROOT" check-ignore -q "$ENV_FILE" || die "o arquivo de conexão NÃO está no .gitignore: recusado"
env_get() { sed -n "s/^$1=//p" "$ENV_FILE" | head -1; }
env_set() { # env_set NOME VALOR: grava/substitui NOME=VALOR no arquivo (sem imprimir o valor)
  local tmp; tmp="$(mktemp "$ENV_FILE.XXXXXX")"; chmod 600 "$tmp"
  { grep -v "^$1=" "$ENV_FILE" || true; printf '%s=%s\n' "$1" "$2"; } > "$tmp"; mv "$tmp" "$ENV_FILE"
}
NEON_OWNER_URL="$(env_get NEON_OWNER_URL)"; export NEON_OWNER_URL
NEON_ADMIN_URL="$(env_get NEON_ADMIN_URL)"; NEON_MIGRATOR_URL="$(env_get NEON_MIGRATOR_URL)"; NEON_APP_URL="$(env_get NEON_APP_URL)"
export NEON_ADMIN_URL NEON_MIGRATOR_URL NEON_APP_URL

# Conexão do DONO (variáveis PG* do libpq, sem segredo na linha de comando).
remote_conn_export NEON_OWNER_URL || die "NEON_OWNER_URL ausente ou inválida no arquivo de conexão"
OWNER_HOST="$PGHOST"
P() { "$PSQL_BIN" -X -q -t -A -w -v ON_ERROR_STOP=1 "$@"; }
[[ "$PGHOST" == *.neon.tech ]] || die "o host não é do Neon: recusado"
[[ "$PGDATABASE" == "$EXPECTED_DB" ]] || die "o banco da conexão deve ser '$EXPECTED_DB' (veio '$PGDATABASE')"
VNUM="$(P -c "SHOW server_version_num")" || fail4 "não foi possível conectar ao servidor"
[[ "$VNUM" -ge 160000 && "$VNUM" -lt 170000 ]] || die "PostgreSQL 16 exigido (server_version_num=$VNUM)"
[[ "$(P -c "SELECT coalesce(current_setting('neon.project_id', true), '')")" == "$PROJECT_ID" ]] \
  || die "o servidor não pertence ao projeto Neon informado ($PROJECT_ID): recusado"
[[ "$(P -c "SELECT current_user")" == "$OWNER_ROLE" ]] || die "a conexão de NEON_OWNER_URL deve ser do papel $OWNER_ROLE"

verify() { # verifica o estado REAL como administrador (somente leitura)
  local out rc=0 fails=0
  (
    remote_conn_export NEON_ADMIN_URL
    export PGOPTIONS='-c default_transaction_read_only=on'
    "$PSQL_BIN" -X -q -t -A -w -v ON_ERROR_STOP=1 -v "admin_role=$ADMIN" -v "migrator_role=$MIGRATOR" -v "app_role=$APP" \
      -v "ledger_schema=plataforma_migrations" -f "$ROOT/db/checks/role_model.sql"
  ) > /tmp/.neon-verify.$$ 2>&1 || rc=$?
  cat /tmp/.neon-verify.$$
  if grep -q '^not ok - ' /tmp/.neon-verify.$$; then
    # DESVIO CONHECIDO DO NEON (PostgreSQL 16): o papel que CRIA um papel recebe ADMIN OPTION sobre ele, concedido pelo
    # superusuário da plataforma (cloud_admin), sem INHERIT e sem SET: administra o papel, mas não herda nem assume seus
    # privilégios, e não pode removê-lo. Só esse padrão EXATO é aceito; qualquer outra falha (inclusive outra associação) reprova.
    if [[ "$(grep -c '^not ok - ' /tmp/.neon-verify.$$)" == "1" ]] && grep -q '^not ok - R3 ' /tmp/.neon-verify.$$; then
      EXPECTED_M="$OWNER_ROLE|$ADMIN|cloud_admin|t|f|f
$OWNER_ROLE|$MIGRATOR|cloud_admin|t|f|f
$OWNER_ROLE|$APP|cloud_admin|t|f|f"
      GOT_M="$(PGOPTIONS='-c default_transaction_read_only=on' P -F '|' -c "
        SELECT m.rolname, r.rolname, g.rolname, am.admin_option, am.inherit_option, am.set_option
          FROM pg_auth_members am JOIN pg_roles r ON r.oid = am.roleid JOIN pg_roles m ON m.oid = am.member JOIN pg_roles g ON g.oid = am.grantor
         WHERE r.rolname IN ('$ADMIN','$MIGRATOR','$APP') OR m.rolname IN ('$ADMIN','$MIGRATOR','$APP') ORDER BY r.rolname" | sed 's/true/t/g; s/false/f/g' | sort)"
      if [[ "$GOT_M" == "$(printf '%s\n' "$EXPECTED_M" | sort)" ]]; then
        echo "ok* - R3 (desvio conhecido do Neon) só existem as 3 associações do dono com ADMIN OPTION, sem INHERIT e sem SET"
      else
        fails=1; echo "not ok - R3 há associações além do padrão conhecido do Neon:" >&2; echo "$GOT_M" >&2
      fi
    else
      fails=1
    fi
  fi
  rm -f /tmp/.neon-verify.$$
  [[ "$rc" -eq 0 ]] || fail4 "não foi possível executar db/checks/role_model.sql"
  rc=0
  bash "$ROOT/scripts/check-catalog.sh" --remote-conn-env NEON_ADMIN_URL --app-role "$APP" --executor-role "$MIGRATOR" --psql "$PSQL_BIN" || rc=$?
  [[ "$rc" -eq 0 ]] || fails=1
  [[ "$fails" -eq 0 ]]
}

EXISTING="$(P -c "SELECT coalesce(string_agg(rolname, ' '), '') FROM pg_roles WHERE rolname IN ('$ADMIN','$MIGRATOR','$APP')")"
if [[ -n "$EXISTING" ]]; then
  [[ -n "$NEON_ADMIN_URL" && -n "$NEON_MIGRATOR_URL" && -n "$NEON_APP_URL" ]] \
    || die "já existem papéis ($EXISTING) mas o arquivo de conexão não tem as três URLs: nada é redefinido em silêncio"
  echo "papéis já existem; só verificando o estado real"
  if verify; then echo "neon-bootstrap: ambiente verificado"; exit 0; else echo "neon-bootstrap: a verificação FALHOU" >&2; exit 1; fi
fi
[[ "$VERIFY_ONLY" -eq 0 ]] || die "--verify-only: os papéis ainda não existem"

echo "== Criando papéis e restringindo o banco '$EXPECTED_DB' (Neon, desenvolvimento) =="
gen() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-40; }
PW_ADMIN="$(gen)"; PW_MIG="$(gen)"; PW_APP="$(gen)"
# Senhas só por stdin (nunca na linha de comando).
P -d postgres <<SQL >/dev/null || fail4 "falha ao criar os papéis"
BEGIN;
CREATE ROLE $ADMIN    LOGIN PASSWORD '$PW_ADMIN' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
CREATE ROLE $MIGRATOR LOGIN PASSWORD '$PW_MIG'   NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
CREATE ROLE $APP      LOGIN PASSWORD '$PW_APP'   NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
COMMIT;
SQL
mk_url() { printf 'postgresql://%s:%s@%s/%s?sslmode=require' "$1" "$2" "$OWNER_HOST" "$EXPECTED_DB"; }
env_set NEON_ADMIN_URL "$(mk_url "$ADMIN" "$PW_ADMIN")"
env_set NEON_MIGRATOR_URL "$(mk_url "$MIGRATOR" "$PW_MIG")"
env_set NEON_APP_URL "$(mk_url "$APP" "$PW_APP")"
unset PW_ADMIN PW_MIG PW_APP
NEON_ADMIN_URL="$(env_get NEON_ADMIN_URL)"; NEON_MIGRATOR_URL="$(env_get NEON_MIGRATOR_URL)"; NEON_APP_URL="$(env_get NEON_APP_URL)"
export NEON_ADMIN_URL NEON_MIGRATOR_URL NEON_APP_URL

# Restringe o banco ANTES de passar a posse (o dono ainda tem direito sobre o esquema public).
P -d "$EXPECTED_DB" <<SQL >/dev/null || fail4 "falha ao restringir o banco"
REVOKE ALL ON DATABASE "$EXPECTED_DB" FROM PUBLIC;
GRANT CONNECT ON DATABASE "$EXPECTED_DB" TO $OWNER_ROLE, $MIGRATOR, $APP;
GRANT CREATE, TEMPORARY ON DATABASE "$EXPECTED_DB" TO $MIGRATOR;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT $ADMIN TO $OWNER_ROLE;
ALTER DATABASE "$EXPECTED_DB" OWNER TO $ADMIN;
REVOKE $ADMIN FROM $OWNER_ROLE;
SQL

bash "$ROOT/scripts/db-migrate.sh" --init-ledger --executor "$MIGRATOR" --remote-conn-env NEON_ADMIN_URL --psql "$PSQL_BIN" >/dev/null \
  || fail4 "falha ao inicializar o ledger (--init-ledger)"
echo "== Verificação do estado real =="
if verify; then echo "neon-bootstrap: papéis, banco e ledger provisionados e verificados"; exit 0; else echo "neon-bootstrap: a verificação FALHOU" >&2; exit 1; fi
