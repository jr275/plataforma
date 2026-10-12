#!/usr/bin/env bash
# Bootstrap reproduzível dos papéis e do banco (ADR-013) para um PostgreSQL 16 DESCARTÁVEL, com verificação do estado real.
#
#   scripts/db-bootstrap.sh --socket-dir /abs --port N --user SUPERUSUARIO_DO_CLUSTER_DESCARTAVEL --dbname NOVO_BANCO \
#       [--admin-role plataforma_admin] [--migrator-role plataforma_migrator] [--app-role menlo_app] [--psql /caminho]
#   scripts/db-bootstrap.sh ... --verify-only      # só verifica o ambiente já existente (somente leitura)
#
# Provisionamento (modo padrão) só roda em cluster descartável COMPROVADO: o diretório que contém o data_directory precisa
# ter o marcador .disposable-pg-marker (criado por scripts/lib/disposable-pg.sh) cujo nonce case com o nonce com que o
# servidor em execução foi iniciado (plataforma.disposable_nonce); o servidor não pode escutar em rede; o banco NÃO pode
# existir; e papéis preexistentes com os mesmos nomes precisam já estar conformes (nada é redefinido em silêncio). Os papéis são globais no cluster (por isso só em cluster descartável); as mudanças de
# privilégio do banco (REVOKE de PUBLIC) valem apenas para o banco recém-criado. Se qualquer etapa falhar depois da
# criação do banco, o banco e os papéis criados por ESTA execução são removidos (limpeza); papéis que já existiam nunca são
# alterados nem removidos. --verify-only abre as conexões com default_transaction_read_only=on. Não é um procedimento de produção:
# produção exige um procedimento próprio, revisado, com papéis reais e autenticação (ver ADR-013). Só socket Unix, sem senha.
# Códigos: 0 verificado · 1 verificação falhou · 2 uso incorreto ou ambiente não descartável · 4 falha de conexão/execução
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
die() { echo "ERRO DE USO: $*" >&2; exit 2; }
SOCKET_DIR="" PORT="" BUSER="" DBNAME="" ADMIN="plataforma_admin" MIGRATOR="plataforma_migrator" APP="menlo_app" PSQL_BIN="" VERIFY_ONLY=0
LEDGER_SCHEMA="plataforma_migrations"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --verify-only) VERIFY_ONLY=1; shift; continue ;;
  esac
  [[ $# -ge 2 ]] || die "$1 exige valor"
  case "$1" in
    --socket-dir) SOCKET_DIR="$2" ;; --port) PORT="$2" ;; --user) BUSER="$2" ;; --dbname) DBNAME="$2" ;;
    --admin-role) ADMIN="$2" ;; --migrator-role) MIGRATOR="$2" ;; --app-role) APP="$2" ;; --psql) PSQL_BIN="$2" ;;
    *) die "argumento desconhecido: $1" ;;
  esac
  shift 2
done
[[ "$SOCKET_DIR" == /* && -d "$SOCKET_DIR" ]] || die "--socket-dir deve ser um diretório de socket Unix existente (caminho absoluto)"
[[ "$PORT" =~ ^[0-9]{1,5}$ ]] || die "--port é obrigatório e numérico"
for n in "$BUSER" "$DBNAME" "$ADMIN" "$MIGRATOR" "$APP"; do [[ "$n" =~ ^[a-z_][a-z0-9_]*$ ]] || die "nomes inválidos (minúsculas, dígitos e _): '$n'"; done
[[ "$ADMIN" != "$MIGRATOR" && "$ADMIN" != "$APP" && "$MIGRATOR" != "$APP" ]] || die "os três papéis precisam ser distintos"
[[ -n "$PSQL_BIN" ]] || PSQL_BIN="$(command -v psql || true)"
[[ -n "$PSQL_BIN" && -x "$PSQL_BIN" ]] || die "psql não encontrado (use --psql)"
for v in $(env | sed -n 's/^\(PG[A-Z_]*\)=.*/\1/p'); do unset "$v"; done
unset DATABASE_URL
export PGCONNECT_TIMEOUT=10
P() { "$PSQL_BIN" -X -q -t -A -h "$SOCKET_DIR" -p "$PORT" -U "$BUSER" -w -v ON_ERROR_STOP=1 "$@"; }
fail4() { echo "FALHA [conexão/execução]: $*" >&2; exit 4; }

verify() { # verify DB USER: roda as verificações de papéis e do gate (sem executor de teste) e retorna 1 se houver "not ok"
  local out rc=0 fails=0
  out="$(PGOPTIONS='-c default_transaction_read_only=on' "$PSQL_BIN" -X -q -t -A -h "$SOCKET_DIR" -p "$PORT" -U "$2" -d "$1" -w -v ON_ERROR_STOP=1 \
        -v "admin_role=$ADMIN" -v "migrator_role=$MIGRATOR" -v "app_role=$APP" -v "ledger_schema=$LEDGER_SCHEMA" \
        -f "$ROOT/db/checks/role_model.sql" 2>&1)" || rc=$?
  [[ "$rc" -eq 0 ]] || { echo "$out" >&2; fail4 "não foi possível executar db/checks/role_model.sql"; }
  echo "$out"
  grep -q '^not ok - ' <<<"$out" && fails=1
  rc=0
  out="$(bash "$ROOT/scripts/check-catalog.sh" --socket-dir "$SOCKET_DIR" --port "$PORT" --psql "$PSQL_BIN" --dbname "$1" --user "$2" \
        --app-role "$APP" --executor-role "$MIGRATOR" 2>&1)" || rc=$?
  [[ "$rc" -eq 0 || "$rc" -eq 1 ]] || { echo "$out" >&2; fail4 "não foi possível executar as verificações de catálogo"; }
  echo "$out"
  [[ "$rc" -eq 0 ]] || fails=1
  [[ "$fails" -eq 0 ]]
}

# --- servidor: só PostgreSQL 16 e, no provisionamento, só cluster descartável -----------------------
VERSION_NUM="$(P -d postgres -c "SHOW server_version_num" 2>/dev/null)" || fail4 "não foi possível conectar ao servidor"
[[ "$VERSION_NUM" -ge 160000 && "$VERSION_NUM" -lt 170000 ]] || die "PostgreSQL 16 exigido (server_version_num=$VERSION_NUM)"
if [[ "$VERIFY_ONLY" -eq 1 ]]; then
  echo "== Verificação (somente leitura) de $DBNAME =="
  if verify "$DBNAME" "$BUSER"; then echo "bootstrap: ambiente verificado"; exit 0; else echo "bootstrap: a verificação FALHOU" >&2; exit 1; fi
fi

IS_SUPER="$(P -d postgres -c "SELECT rolsuper FROM pg_roles WHERE rolname = current_user")" || fail4 "não foi possível consultar o papel de conexão"
[[ "$IS_SUPER" == "t" ]] || die "--user precisa ser o superusuário do cluster descartável (cria papéis e o banco)"
DATA_DIR="$(P -d postgres -c "SHOW data_directory")" || fail4 "não foi possível ler data_directory"
LISTEN="$(P -d postgres -c "SHOW listen_addresses")" || fail4 "não foi possível ler listen_addresses"
MARKER_FILE="$(dirname "$DATA_DIR")/.disposable-pg-marker"
[[ -f "$MARKER_FILE" && ! -L "$MARKER_FILE" ]] \
  || die "o servidor não é um cluster descartável comprovado (marcador .disposable-pg-marker ausente ao lado do data_directory); este bootstrap só provisiona ambientes de teste descartáveis"
MARKER_CONTENT="$(cat "$MARKER_FILE" 2>/dev/null || true)"
[[ "$MARKER_CONTENT" =~ ^plataforma-disposable-cluster\ v1\ ([0-9a-f]{32})$ ]] || die "o marcador de cluster descartável é inválido"
MARKER_NONCE="${BASH_REMATCH[1]}"
SERVER_NONCE="$(P -d postgres -c "SELECT coalesce(current_setting('plataforma.disposable_nonce', true), '')")" || fail4 "não foi possível ler o nonce do servidor"
[[ "$SERVER_NONCE" == "$MARKER_NONCE" ]] \
  || die "o marcador não corresponde ao servidor em execução (nonce divergente): um arquivo comum não prova que o servidor é descartável"
[[ -z "$LISTEN" ]] || die "o servidor escuta em rede ($LISTEN); este bootstrap só provisiona clusters descartáveis sem TCP"
[[ "$(P -d postgres -c "SELECT count(*) FROM pg_database WHERE datname = '$DBNAME'")" == "0" ]] \
  || die "o banco '$DBNAME' já existe: o bootstrap só cria bancos novos (use --verify-only para verificar um existente)"

# Papéis preexistentes com os mesmos nomes: nada é redefinido em silêncio. Atributos perigosos ou associações a papéis
# recusam o bootstrap ANTES de qualquer mudança de estado.
BAD_ROLES="$(P -d postgres -v "admin=$ADMIN" -v "migrator=$MIGRATOR" -v "app=$APP" <<'SQL'
SELECT coalesce(string_agg(rolname, ', '), '') FROM pg_roles
 WHERE rolname IN (:'admin', :'migrator', :'app')
   AND NOT (rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls);
SQL
)" || fail4 "não foi possível verificar os papéis existentes"
[[ -z "$BAD_ROLES" ]] || { echo "RECUSADO: papéis preexistentes com atributos fora do modelo (superusuário, BYPASSRLS, CREATEROLE, CREATEDB, REPLICATION ou sem login): $BAD_ROLES. O bootstrap não os altera em silêncio; corrija-os explicitamente ou use outros nomes." >&2; exit 1; }
BAD_MEMBERS="$(P -d postgres -v "admin=$ADMIN" -v "migrator=$MIGRATOR" -v "app=$APP" <<'SQL'
SELECT coalesce(string_agg(DISTINCT r.rolname, ', '), '') FROM pg_auth_members m JOIN pg_roles r ON r.oid IN (m.member, m.roleid)
 WHERE r.rolname IN (:'admin', :'migrator', :'app');
SQL
)" || fail4 "não foi possível verificar as associações existentes"
[[ -z "$BAD_MEMBERS" ]] || { echo "RECUSADO: papéis com associações a outros papéis (R3): $BAD_MEMBERS. O bootstrap não remove associações em silêncio." >&2; exit 1; }
CREATED_ROLES="$(P -d postgres -v "admin=$ADMIN" -v "migrator=$MIGRATOR" -v "app=$APP" <<'SQL'
SELECT coalesce(string_agg(r, ' '), '') FROM (VALUES (:'admin'), (:'migrator'), (:'app')) v(r)
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
SQL
)" || fail4 "não foi possível listar os papéis a criar"

# Limpeza: se algo falhar DEPOIS de o banco existir, remove o banco e os papéis criados por ESTA execução.
DB_CREATED=0; SUCCESS=0
cleanup_partial() {
  local code=$?
  trap - EXIT
  if [[ "$SUCCESS" -ne 1 && "$DB_CREATED" -eq 1 ]]; then
    echo "limpeza: a execução falhou depois de criar o banco; removendo '$DBNAME' e os papéis criados por esta execução (${CREATED_ROLES:-nenhum})" >&2
    P -d postgres -c "DROP DATABASE IF EXISTS \"$DBNAME\" WITH (FORCE)" >/dev/null 2>&1 || echo "limpeza: não foi possível remover o banco '$DBNAME'" >&2
    for r in $CREATED_ROLES; do P -d postgres -c "DROP ROLE IF EXISTS \"$r\"" >/dev/null 2>&1 || echo "limpeza: não foi possível remover o papel '$r'" >&2; done
  fi
  exit "$code"
}
trap cleanup_partial EXIT

echo "== Provisionando papéis e banco descartável '$DBNAME' =="
P -d postgres -v "admin=$ADMIN" -v "migrator=$MIGRATOR" -v "app=$APP" -v "dbname=$DBNAME" <<'SQL' >/dev/null || fail4 "falha ao criar papéis"
BEGIN;
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT', r)
  FROM (VALUES (:'admin'), (:'migrator'), (:'app')) v(r)
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) \gexec
COMMIT;
SQL
P -d postgres -v "admin=$ADMIN" -v "migrator=$MIGRATOR" -v "app=$APP" -v "dbname=$DBNAME" <<'SQL' >/dev/null || { DB_CREATED=1; fail4 "falha ao criar o banco"; }
CREATE DATABASE :"dbname" OWNER :"admin" TEMPLATE template0;
SQL
DB_CREATED=1
P -d postgres -v "admin=$ADMIN" -v "migrator=$MIGRATOR" -v "app=$APP" -v "dbname=$DBNAME" <<'SQL' >/dev/null || fail4 "falha ao restringir o banco novo"
REVOKE ALL ON DATABASE :"dbname" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"dbname" TO :"migrator", :"app";
GRANT CREATE, TEMPORARY ON DATABASE :"dbname" TO :"migrator";
SQL
P -d "$DBNAME" <<'SQL' >/dev/null || fail4 "falha ao endurecer o esquema public do banco novo"
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SQL
bash "$ROOT/scripts/db-migrate.sh" --init-ledger --executor "$MIGRATOR" --socket-dir "$SOCKET_DIR" --port "$PORT" --psql "$PSQL_BIN" \
  --dbname "$DBNAME" --user "$ADMIN" >/dev/null || fail4 "falha ao inicializar o ledger (--init-ledger)"

echo "== Verificação do estado real =="
if verify "$DBNAME" "$ADMIN"; then SUCCESS=1; echo "bootstrap: ambiente provisionado e verificado ($DBNAME)"; exit 0; else echo "bootstrap: a verificação FALHOU" >&2; exit 1; fi
