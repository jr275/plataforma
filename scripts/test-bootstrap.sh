#!/usr/bin/env bash
# Testes do bootstrap de papéis (scripts/db-bootstrap.sh + db/checks/role_model.sql) contra um PostgreSQL 16 DESCARTÁVEL.
# Os atributos e privilégios são conferidos aqui por consultas e por TENTATIVAS REAIS de cada papel, independentes
# das verificações do próprio bootstrap. Não usa Docker/Neon/DATABASE_URL; apaga tudo ao sair.
# Código de saída: 0 = tudo certo; 1 = falha de teste; 2 = pré-requisito ausente/versão errada.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=lib/disposable-pg.sh
source "$ROOT/scripts/lib/disposable-pg.sh"
set +e

BOOT="$ROOT/scripts/db-bootstrap.sh"
ADMIN=plataforma_admin; MIG=plataforma_migrator; APP=menlo_app
FAILS=0; CHECKS=0; N=0; DB=""; OUT=""; RC=0

Q()  { "${PSQL[@]}" -d "$1" -c "$2" 2>&1; }                                  # superusuário do cluster descartável
As() { local u="$1" sql="$2"; "${PSQL[@]}" -U "$u" -d "$DB" -c "$sql" 2>&1; } # um papel do ambiente
expect() { local name="$1"; shift; CHECKS=$((CHECKS + 1))
  if "$@" >/dev/null 2>&1; then echo "ok - $name"; else echo "not ok - $name"; FAILS=$((FAILS + 1)); fi; }
eq()  { [[ "$1" == "$2" ]]; }
has() { [[ "$1" == *"$2"* ]]; }
denied() { [[ "$1" == *"permission denied"* || "$1" == *"must be owner"* || "$1" == *"must have"* || "$1" == *"permission to"* ]]; }
boot() { # boot DBNAME [opções]; saída em $OUT, código em $RC
  OUT="$(bash "$BOOT" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --user rls_bootstrap --dbname "$1" "${@:2}" 2>&1)"; RC=$?
}
newdb() { N=$((N + 1)); DB="plat$N"; }
restore_roles() { # desfaz sabotagens em atributos e associações (papéis são globais no cluster descartável)
  Q postgres "ALTER ROLE $APP LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
              ALTER ROLE $MIG LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
              ALTER ROLE $ADMIN LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
              REVOKE $MIG FROM $APP; REVOKE $ADMIN FROM $MIG; REVOKE $ADMIN FROM $APP; REVOKE $APP FROM $MIG" >/dev/null 2>&1
}
drop_db() { Q postgres "DROP DATABASE IF EXISTS $1 WITH (FORCE)" >/dev/null 2>&1; }

# ================================================================================================
echo "== Provisionamento e estado real =="
newdb; boot "$DB"
expect "BOOT-1 bootstrap provisions and verifies a disposable environment (exit 0)" eq "$RC" 0
expect "BOOT-1 it reports the verified environment" has "$OUT" "ambiente provisionado e verificado"
expect "BOOT-1 no verification line is 'not ok'" bash -c '! grep -q "^not ok - " <<<"$1"' _ "$OUT"
expect "BOOT-1 it ran on PostgreSQL 16 (R4)" has "$OUT" "ok - R4 the server is PostgreSQL 16"

# Atributos reais, conferidos aqui diretamente no catálogo
for r in $ADMIN $MIG $APP; do
  expect "BOOT-2 role $r: LOGIN, and NOT superuser, createdb, createrole, replication, bypassrls (catalog)" \
    eq "$(Q postgres "SELECT rolcanlogin AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) FROM pg_roles WHERE rolname = '$r'")" "t"
  expect "BOOT-2 role $r: no membership in any role and no role is a member of it (catalog)" \
    eq "$(Q postgres "SELECT count(*) FROM pg_auth_members m JOIN pg_roles x ON x.oid IN (m.member, m.roleid) WHERE x.rolname = '$r'")" 0
done
expect "BOOT-2 the application role does not own any object in the database (catalog)" \
  eq "$(Q "$DB" "SELECT (SELECT count(*) FROM pg_class WHERE relowner = '$APP'::regrole) + (SELECT count(*) FROM pg_namespace WHERE nspowner = '$APP'::regrole) + (SELECT count(*) FROM pg_proc WHERE proowner = '$APP'::regrole)")" 0
expect "BOOT-2 the migration ledger, the lock and their schema belong to the administrator (catalog)" \
  eq "$(Q "$DB" "SELECT string_agg(DISTINCT pg_get_userbyid(o), ',') FROM (SELECT relowner o FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'plataforma_migrations' UNION ALL SELECT nspowner FROM pg_namespace WHERE nspname = 'plataforma_migrations') s")" "$ADMIN"

# Tentativas reais da aplicação
expect "BOOT-3 application role cannot create a table in public" denied "$(As $APP "CREATE TABLE public.x (a int)")"
expect "BOOT-3 application role cannot create a schema" denied "$(As $APP "CREATE SCHEMA s1")"
expect "BOOT-3 application role cannot create a temporary table (no TEMP)" denied "$(As $APP "CREATE TEMP TABLE t (a int)")"
expect "BOOT-3 application role cannot read the ledger" denied "$(As $APP "SELECT * FROM plataforma_migrations.ledger")"
expect "BOOT-3 application role cannot lock or touch the migration lock table" denied "$(As $APP "SELECT 1; LOCK TABLE plataforma_migrations.run_lock IN EXCLUSIVE MODE")"
expect "BOOT-3 application role cannot create roles" denied "$(As $APP "CREATE ROLE r1")"
expect "BOOT-3 application role cannot switch to the migration executor or the administrator" bash -c '[[ "$1" == *"permission denied"* && "$2" == *"permission denied"* ]]' _ "$(As $APP "SET ROLE $MIG")" "$(As $APP "SET ROLE $ADMIN")"
expect "BOOT-3 application role cannot alter its own attributes" denied "$(As $APP "ALTER ROLE $APP BYPASSRLS")"

# Tentativas reais do executor
expect "BOOT-4 migration executor CAN create a product schema and a table (the authority it needs)" bash -c '[[ "$1" != *ERROR* ]]' _ "$(As $MIG "CREATE SCHEMA prod; CREATE TABLE prod.t (a int)")"
expect "BOOT-4 the executor owns what it created (not the application role)" eq "$(Q "$DB" "SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'prod.t'::regclass")" "$MIG"
expect "BOOT-4 migration executor cannot create or alter roles" bash -c '[[ "$1" == *denied* && "$2" == *denied* ]]' _ "$(As $MIG "CREATE ROLE r2")" "$(As $MIG "ALTER ROLE $APP BYPASSRLS")"
expect "BOOT-4 migration executor cannot make itself or the application a member of another role" bash -c '[[ "$1" == *ERROR* && "$2" == *ERROR* ]]' _ "$(As $MIG "GRANT $ADMIN TO $MIG")" "$(As $MIG "GRANT $MIG TO $APP")"
expect "BOOT-4 migration executor cannot hand ownership of an object to the application role" bash -c '[[ "$1" == *ERROR* ]]' _ "$(As $MIG "ALTER TABLE prod.t OWNER TO $APP")"
for stmt in "DELETE FROM plataforma_migrations.ledger" "UPDATE plataforma_migrations.ledger SET sha256 = repeat('c', 64)" "TRUNCATE plataforma_migrations.ledger" "DROP TABLE plataforma_migrations.ledger" "ALTER TABLE plataforma_migrations.ledger DISABLE TRIGGER ALL"; do
  expect "BOOT-4 migration executor cannot rewrite migration history: $stmt" bash -c '[[ "$1" == *ERROR* ]]' _ "$(As $MIG "$stmt")"
done
expect "BOOT-4 migration executor can take the migration lock (UPDATE on run_lock) and cannot read it" \
  bash -c '[[ "$1" != *ERROR* && "$2" == *denied* ]]' _ "$(As $MIG "SELECT 1; LOCK TABLE plataforma_migrations.run_lock IN EXCLUSIVE MODE")" "$(As $MIG "SELECT * FROM plataforma_migrations.run_lock")"
expect "BOOT-4 the administrator cannot create roles either" denied "$(As $ADMIN "CREATE ROLE r3")"
expect "BOOT-4 PUBLIC has no CONNECT: a role that is not granted it cannot connect (checked as a fresh role)" \
  bash -c '[[ "$1" == *"permission denied for database"* || "$1" == *"not permitted to log in"* || "$1" == *"permission denied"* ]]' _ "$(Q postgres "CREATE ROLE outsider LOGIN" >/dev/null; "${PSQL[@]}" -U outsider -d "$DB" -c "SELECT 1" 2>&1)"
Q postgres "DROP ROLE IF EXISTS outsider" >/dev/null 2>&1
drop_db "$DB"

# ================================================================================================
echo; echo "== Idempotência, recusas e ambiente descartável =="
newdb; boot "$DB"; first="$DB"
newdb; boot "$DB"
expect "BOOT-5 a second disposable database reuses the existing roles (idempotent) and verifies" eq "$RC" 0
boot "$first" --verify-only
expect "BOOT-5 --verify-only on an existing environment passes without changing anything" eq "$RC" 0
boot "$first"
expect "BOOT-6 the bootstrap refuses to touch an existing database (exit 2)" eq "$RC" 2
expect "BOOT-6 and says so" has "$OUT" "já existe"
drop_db "$first"; drop_db "$DB"

newdb; mv "$TMP/.disposable-pg-marker" "$TMP/.marker.away"
boot "$DB"
mv "$TMP/.marker.away" "$TMP/.disposable-pg-marker"
expect "BOOT-6 without the disposable-cluster marker the bootstrap refuses to provision (exit 2)" eq "$RC" 2
expect "BOOT-6 and nothing was created: no database" eq "$(Q postgres "SELECT count(*) FROM pg_database WHERE datname = '$DB'")" 0
boot "x" --admin-role same --migrator-role same --app-role other
expect "BOOT-6 the three roles must be distinct (exit 2)" eq "$RC" 2
OUT="$(bash "$BOOT" --socket-dir localhost --port "$PORT" --user rls_bootstrap --dbname zz 2>&1)"; RC=$?
expect "BOOT-6 a network host is refused (exit 2)" eq "$RC" 2
OUT="$(bash "$BOOT" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --user rls_bootstrap 2>&1)"; RC=$?
expect "BOOT-6 a missing --dbname is a usage error (exit 2)" eq "$RC" 2
OUT="$(PGHOST=/nonexistent PGDATABASE=wrong PGUSER=wrong bash "$BOOT" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --user rls_bootstrap --dbname zz1 2>&1)"; RC=$?
expect "BOOT-6 ambient PG* variables are ignored; explicit flags win" eq "$RC" 0
drop_db zz1
OUT="$(bash "$BOOT" --socket-dir "$TMP" --port 1 --psql "$PGBIN/psql" --user rls_bootstrap --dbname zz2 2>&1)"; RC=$?
expect "BOOT-6 an unreachable server is a connection failure (exit 4), never a false success" eq "$RC" 4
OUT="$(bash "$BOOT" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --user plataforma_admin --dbname zz3 2>&1)"; RC=$?
expect "BOOT-6 provisioning requires the cluster superuser (exit 2 for a normal role)" eq "$RC" 2

# Papéis preexistentes fora do modelo NÃO são alterados em silêncio: o bootstrap recusa ANTES de mudar qualquer estado
newdb; Q postgres "ALTER ROLE $APP SUPERUSER BYPASSRLS CREATEROLE" >/dev/null
boot "$DB"
expect "BOOT-7 a pre-existing application role with dangerous attributes is REFUSED, not silently reset (exit 1)" eq "$RC" 1
expect "BOOT-7 and the message names the role" has "$OUT" "$APP"
expect "BOOT-7 and it was refused by the PRE-FLIGHT, before any change (not after provisioning and cleanup)" has "$OUT" "RECUSADO: papéis preexistentes"
expect "BOOT-7 and nothing was created: no database" eq "$(Q postgres "SELECT count(*) FROM pg_database WHERE datname = '$DB'")" 0
expect "BOOT-7 and the role was NOT changed (still dangerous: the operator must fix it explicitly)" eq "$(Q postgres "SELECT rolsuper AND rolbypassrls AND rolcreaterole FROM pg_roles WHERE rolname = '$APP'")" "t"
restore_roles
newdb; Q postgres "GRANT $MIG TO $APP" >/dev/null
boot "$DB"
expect "BOOT-7 a pre-existing role MEMBERSHIP is refused before any change (exit 1)" eq "$RC" 1
expect "BOOT-7 and the message names the membership problem (R3)" has "$OUT" "R3"
expect "BOOT-7 and it was refused by the PRE-FLIGHT, before any change" has "$OUT" "RECUSADO: papéis com associações"
expect "BOOT-7 and no database was created" eq "$(Q postgres "SELECT count(*) FROM pg_database WHERE datname = '$DB'")" 0
expect "BOOT-7 and the membership was not silently removed" eq "$(Q postgres "SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = '$APP'")" 1
restore_roles

# ================================================================================================
echo; echo "== A verificação detecta sabotagens do estado real (--verify-only) =="
sabotage() { # sabotage "descrição" "SQL no cluster (postgres)|banco" "SQL no banco" "id esperado (R/C/G...)"
  newdb; boot "$DB"
  [[ "$RC" -eq 0 ]] || { echo "not ok - BOOT-8 setup failed for: $1"; FAILS=$((FAILS + 1)); CHECKS=$((CHECKS + 1)); return; }
  local c="${2//@DB@/$DB}" d="${3//@DB@/$DB}"
  [[ -z "$c" ]] || Q postgres "$c" >/dev/null 2>&1
  [[ -z "$d" ]] || Q "$DB" "$d" >/dev/null 2>&1
  boot "$DB" --verify-only
  expect "BOOT-8 sabotage '$1': verification fails (exit 1)" eq "$RC" 1
  expect "BOOT-8 sabotage '$1': the failing line is $4" bash -c 'grep -q "^not ok - $2" <<<"$1"' _ "$OUT" "$4"
  restore_roles; drop_db "$DB"
}
sabotage "application role becomes superuser" "ALTER ROLE $APP SUPERUSER" "" "R2"
sabotage "application role gets BYPASSRLS" "ALTER ROLE $APP BYPASSRLS" "" "R2"
sabotage "application role gets CREATEROLE" "ALTER ROLE $APP CREATEROLE" "" "R2"
sabotage "migration executor gets CREATEROLE" "ALTER ROLE $MIG CREATEROLE" "" "R2"
sabotage "migration executor gets REPLICATION" "ALTER ROLE $MIG REPLICATION" "" "R2"
sabotage "application role joins the migration executor" "GRANT $MIG TO $APP" "" "R3"
sabotage "migration executor joins the administrator" "GRANT $ADMIN TO $MIG" "" "R3"
sabotage "PUBLIC gets CONNECT on the database" "" "GRANT CONNECT ON DATABASE @DB@ TO PUBLIC" "R5"
sabotage "application role gets TEMP on the database" "" "GRANT TEMPORARY ON DATABASE @DB@ TO $APP" "R5"
sabotage "application role gets CREATE on the database" "" "GRANT CREATE ON DATABASE @DB@ TO $APP" "R5"
sabotage "migration executor loses TEMP" "" "REVOKE TEMPORARY ON DATABASE @DB@ FROM $MIG" "R5"
sabotage "the database changes owner" "" "ALTER DATABASE @DB@ OWNER TO $MIG" "R5"
sabotage "PUBLIC regains USAGE on schema public" "" "GRANT USAGE ON SCHEMA public TO PUBLIC" "R6"
sabotage "ledger ownership moves to the executor" "" "ALTER TABLE plataforma_migrations.ledger OWNER TO $MIG" "R7"
sabotage "the executor gets DELETE on the ledger" "" "GRANT DELETE ON plataforma_migrations.ledger TO $MIG" "R8"
sabotage "the executor loses UPDATE on run_lock" "" "REVOKE UPDATE ON plataforma_migrations.run_lock FROM $MIG" "R8"
sabotage "the application role gets USAGE on the metadata schema" "" "GRANT USAGE ON SCHEMA plataforma_migrations TO $APP" "R8"
sabotage "the application role gets SELECT on the ledger" "" "GRANT USAGE ON SCHEMA plataforma_migrations TO $APP; GRANT SELECT ON plataforma_migrations.ledger TO $APP" "R8"
sabotage "an append-only trigger is disabled" "" "ALTER TABLE plataforma_migrations.ledger DISABLE TRIGGER ledger_no_truncate" "R9"
sabotage "the application role gets default privileges" "" "ALTER DEFAULT PRIVILEGES FOR ROLE $MIG IN SCHEMA public GRANT SELECT ON TABLES TO $APP" "C6"

echo
if [[ "$FAILS" -eq 0 ]]; then
  echo "BOOTSTRAP TESTS: PASSED ($CHECKS checks) on PostgreSQL $("${PSQL[@]}" -d postgres -c 'SHOW server_version')"
else
  echo "BOOTSTRAP TESTS: FAILED ($FAILS of $CHECKS checks failed)" >&2
  exit 1
fi
