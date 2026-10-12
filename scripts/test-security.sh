#!/usr/bin/env bash
# Testes das verificações de catálogo (db/checks/catalog_security.sql + scripts/check-catalog.sh) contra um
# PostgreSQL 16 DESCARTÁVEL, e reprodução comportamental dos achados 3 e 4 da Fase 5.
# Separado de scripts/test-rls.sh (comportamento do RLS) e de scripts/test-migrations.sh (runner).
# Não cria tabelas de produto: só a fixture de teste de db/test-fixtures/rls/ e tabelas de teste descartáveis.
# Código de saída: 0 = tudo certo; 1 = falha de teste; 2 = pré-requisito ausente/versão errada.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
FX="$ROOT/db/test-fixtures/rls"
# shellcheck source=lib/disposable-pg.sh
source "$ROOT/scripts/lib/disposable-pg.sh"
set +e

RUNNER="$ROOT/scripts/db-migrate.sh"
CHECK="$ROOT/scripts/check-catalog.sh"
EXEC=mig_test_exec
ADMIN=mig_test_admin
FAILS=0; CHECKS=0; N=0; DB=""; OUT=""; RC=0

Q()  { "${PSQL[@]}" -d "$1" -c "$2" 2>&1; }                       # superusuário do cluster descartável
QO() { "${PSQL[@]}" -U rls_fixture_owner -d "$DB" -c "$1" 2>&1; }  # dono dos objetos da fixture
QA() { "${PSQL[@]}" -U menlo_app -d "$DB" -c "$1" 2>&1; }          # aplicação
expect() { local name="$1"; shift; CHECKS=$((CHECKS + 1))
  if "$@" >/dev/null 2>&1; then echo "ok - $name"; else echo "not ok - $name"; FAILS=$((FAILS + 1)); fi; }
eq()  { [[ "$1" == "$2" ]]; }
has() { [[ "$1" == *"$2"* ]]; }
nonzero() { [[ "$1" -ne 0 ]]; }
notok_line() { grep -q "^not ok - $1" <<<"$OUT"; }   # existe uma linha "not ok" que começa com o trecho
all_ok()     { ! grep -q '^not ok - ' <<<"$OUT" && grep -q '^ok - ' <<<"$OUT"; }

reset_roles() { # desfaz mutações de papéis (globais no cluster)
  "${PSQL[@]}" -d postgres -v ON_ERROR_STOP=1 -f "$FX/00_roles.sql" >/dev/null
  "${PSQL[@]}" -d postgres -c "ALTER ROLE menlo_app NOCREATEROLE NOCREATEDB NOREPLICATION; REVOKE rls_fixture_owner FROM menlo_app" >/dev/null 2>&1
}
fixture_db() { # banco novo com a fixture de RLS e o ledger (inicializado pelo administrador); define $DB
  [[ -z "$DB" ]] || "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1
  N=$((N + 1)); DB="sec$N"
  "${PSQL[@]}" -d postgres -c "CREATE DATABASE $DB OWNER $ADMIN TEMPLATE template0" >/dev/null
  "${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -v dbname="$DB" -f "$FX/10_fixture.sql" >/dev/null
  bash "$RUNNER" --init-ledger --executor "$EXEC" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$ADMIN" >/dev/null 2>&1
}
check() { # check [opções extras do check-catalog]; usa $DB; saída em $OUT e código em $RC
  OUT="$(bash "$CHECK" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user rls_bootstrap "$@" 2>&1)"; RC=$?
}
# Tabela de teste CORRETA (do tenant): coluna, RLS ligado e forçado, política que cita tenant_id, grants explícitos.
good_table_sql() { cat <<SQL
SET ROLE rls_fixture_owner;
CREATE TABLE rls_fixture.$1 (tenant_id uuid NOT NULL, v text);
ALTER TABLE rls_fixture.$1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE rls_fixture.$1 FORCE ROW LEVEL SECURITY;
CREATE POLICY p ON rls_fixture.$1 AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = rls_fixture.current_tenant_id()) WITH CHECK (tenant_id = rls_fixture.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON rls_fixture.$1 TO menlo_app;
RESET ROLE;
SQL
}
# mutate NOME "SQL (superusuário)" "início esperado da linha 'not ok'" — cada mutação em um banco novo
mutate() {
  fixture_db
  "${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -c "$2" >/dev/null 2>"$TMP/mut.err" || { echo "not ok - $1 (setup da mutação falhou: $(head -1 "$TMP/mut.err"))"; FAILS=$((FAILS + 1)); CHECKS=$((CHECKS + 1)); return; }
  check
  expect "SEC-M $1: the catalog check fails (exit 1)" eq "$RC" 1
  expect "SEC-M $1: and the failing line is '$3'" notok_line "$3"
  reset_roles
}

echo "== Preparação do cluster descartável =="
"${PSQL[@]}" -d postgres -v ON_ERROR_STOP=1 -f "$FX/00_roles.sql" >/dev/null
"${PSQL[@]}" -d postgres -c "CREATE ROLE $EXEC LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE" >/dev/null
"${PSQL[@]}" -d postgres -c "CREATE ROLE $ADMIN LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE" >/dev/null

# ================================================================================================
echo; echo "== Estado correto: a verificação passa =="
fixture_db
check
expect "SEC-B1 baseline fixture: every catalog check passes (exit 0, no 'not ok')" bash -c '[[ $1 -eq 0 ]]' _ "$RC"
expect "SEC-B1 baseline: all of C1..C10 are present" bash -c 'for c in C1 C2 C3 C4 C5 C6 C7 C8 C9 C10; do grep -q "^ok - $c " <<<"$1" || exit 1; done' _ "$OUT"
expect "SEC-B1 baseline: the tenant table is checked for column, RLS and policy" bash -c '[[ $(grep -c "^ok - C8 rls_fixture.tenant_item" <<<"$1") -eq 4 ]]' _ "$OUT"
BASE="$OUT"
OUT="$(bash "$CHECK" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user menlo_app 2>&1)"; RC=$?
expect "SEC-B2 the check also runs as the least-privileged application role itself, with the same result" bash -c '[[ $1 -eq 0 && "$2" == "$3" ]]' _ "$RC" "$OUT" "$BASE"
N=$((N + 1)); DB="sec$N"
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $DB OWNER $ADMIN TEMPLATE template0" >/dev/null
"${PSQL[@]}" -d postgres -c "REVOKE ALL ON DATABASE $DB FROM PUBLIC; GRANT CONNECT ON DATABASE $DB TO menlo_app" >/dev/null
"${PSQL[@]}" -d "$DB" -c "REVOKE ALL ON SCHEMA public FROM PUBLIC" >/dev/null
check
expect "SEC-B3 a database with no application-accessible tables yet: passes and says the table check is vacuous" bash -c '[[ $1 -eq 0 && "$2" == *"nothing to check; this is vacuous"* ]]' _ "$RC" "$OUT"

N=$((N + 1)); DB="sec$N"
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $DB OWNER $ADMIN TEMPLATE template0" >/dev/null
check
expect "SEC-B4b the same default database is also flagged for PUBLIC privileges on the database and on the public schema (G4, G5)" bash -c 'grep -q "^not ok - G4 " <<<"$1" && grep -q "^not ok - G5 " <<<"$1"' _ "$OUT"
expect "SEC-B4 a database that keeps PostgreSQL's default PUBLIC TEMP privilege is flagged (C5): the default is not hardened enough" notok_line "C5"

# ================================================================================================
echo; echo "== Achado 3: default privileges expõem tabela sem RLS (reprodução + detecção) =="
fixture_db
Q "$DB" "ALTER DEFAULT PRIVILEGES FOR ROLE rls_fixture_owner IN SCHEMA rls_fixture GRANT SELECT ON TABLES TO menlo_app" >/dev/null
QO "CREATE TABLE rls_fixture.leaky (tenant_id uuid NOT NULL, secret text)" >/dev/null
Q "$DB" "INSERT INTO rls_fixture.leaky VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'dado do tenant B')" >/dev/null
expect "SEC-F3 (finding 3) reproduced: with default privileges, a new table WITHOUT RLS is readable by the application role" has "$(QA "SELECT secret FROM rls_fixture.leaky")" "dado do tenant B"
check
expect "SEC-F3 the catalog check fails (exit 1)" eq "$RC" 1
expect "SEC-F3 it flags the unexpected default privileges (C6)" notok_line "C6"
expect "SEC-F3 it flags the table without RLS enabled and forced" notok_line "C8 rls_fixture.leaky: ROW LEVEL SECURITY"
expect "SEC-F3 it flags the table without any tenant policy" notok_line "C8 rls_fixture.leaky: at least one tenant policy"
Q "$DB" "ALTER DEFAULT PRIVILEGES FOR ROLE rls_fixture_owner IN SCHEMA rls_fixture REVOKE SELECT ON TABLES FROM menlo_app; DROP TABLE rls_fixture.leaky; SET ROLE rls_fixture_owner; CREATE TABLE rls_fixture.quiet (tenant_id uuid NOT NULL, secret text)" >/dev/null
expect "SEC-F3 without default privileges a new table is NOT accessible to the application role (explicit GRANT is required)" has "$(QA "SELECT * FROM rls_fixture.quiet")" "permission denied"
check
expect "SEC-F3 and the catalog check is clean again (an inaccessible table is not an exposure)" bash -c '[[ $1 -eq 0 ]]' _ "$RC"

# ================================================================================================
echo; echo "== Achado 4: o dono da tabela com FORCE ainda altera a configuração de RLS =="
fixture_db
OUT4="$("${PSQL[@]}" -U menlo_app -d "$DB" <<'SQL' 2>&1
BEGIN;
SELECT set_config('app.tenant_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true) AS c \gset
SELECT 'before: ' || count(*) FROM rls_fixture.tenant_item WHERE payload LIKE 'B-%';
COMMIT;
SQL
)"
expect "SEC-F4 setup: tenant A cannot see tenant B rows while RLS is configured correctly" has "$OUT4" "before: 0"
expect "SEC-F4 (finding 4) reproduced: the table OWNER can disable FORCE and RLS even though FORCE is set (FORCE does not protect against the owner)" \
  bash -c '[[ "$1" != *ERROR* ]]' _ "$(QO "ALTER TABLE rls_fixture.tenant_item NO FORCE ROW LEVEL SECURITY; ALTER TABLE rls_fixture.tenant_item DISABLE ROW LEVEL SECURITY")"
OUT4="$("${PSQL[@]}" -U menlo_app -d "$DB" <<'SQL' 2>&1
BEGIN;
SELECT set_config('app.tenant_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true) AS c \gset
SELECT 'after: ' || count(*) FROM rls_fixture.tenant_item WHERE payload LIKE 'B-%';
COMMIT;
SQL
)"
expect "SEC-F4 and the consequence is real: tenant A now reads tenant B rows" has "$OUT4" "after: 2"
check
expect "SEC-F4 what protects the platform is detection: the catalog check fails when RLS is off" bash -c '[[ $1 -eq 1 ]]' _ "$RC"
expect "SEC-F4 the failing line is the RLS enabled-and-forced check" notok_line "C8 rls_fixture.tenant_item: ROW LEVEL SECURITY"
fixture_db
expect "SEC-F4 the application role cannot do the same (it does not own the table)" has "$(QA "ALTER TABLE rls_fixture.tenant_item DISABLE ROW LEVEL SECURITY")" "must be owner"

# ================================================================================================
echo; echo "== Mutações: cada configuração insegura é detectada pela verificação certa =="
mutate "default privileges for the application role" "ALTER DEFAULT PRIVILEGES FOR ROLE rls_fixture_owner IN SCHEMA rls_fixture GRANT SELECT ON TABLES TO menlo_app" "C6"
mutate "default privileges granted to PUBLIC" "ALTER DEFAULT PRIVILEGES FOR ROLE rls_fixture_owner IN SCHEMA rls_fixture GRANT SELECT ON TABLES TO PUBLIC" "C6"
mutate "tenant table without RLS" "$(good_table_sql t1); ALTER TABLE rls_fixture.t1 NO FORCE ROW LEVEL SECURITY; ALTER TABLE rls_fixture.t1 DISABLE ROW LEVEL SECURITY" "C8 rls_fixture.t1: ROW LEVEL SECURITY"
mutate "tenant table with RLS enabled but not forced" "$(good_table_sql t2); ALTER TABLE rls_fixture.t2 NO FORCE ROW LEVEL SECURITY" "C8 rls_fixture.t2: ROW LEVEL SECURITY"
mutate "tenant table with RLS but no policy" "$(good_table_sql t3); DROP POLICY p ON rls_fixture.t3" "C8 rls_fixture.t3: at least one tenant policy"
mutate "tenant policy USING (true)" "$(good_table_sql t4); DROP POLICY p ON rls_fixture.t4; CREATE POLICY p ON rls_fixture.t4 FOR ALL TO menlo_app USING (true) WITH CHECK (true)" "C8 rls_fixture.t4: at least one tenant policy"
mutate "extra permissive policy USING (true) next to a correct one" "$(good_table_sql t5); CREATE POLICY open_read ON rls_fixture.t5 AS PERMISSIVE FOR SELECT TO menlo_app USING (true)" "C8 rls_fixture.t5: at least one tenant policy"
mutate "policy that does not mention tenant_id" "$(good_table_sql t6); DROP POLICY p ON rls_fixture.t6; CREATE POLICY p ON rls_fixture.t6 FOR ALL TO menlo_app USING (v = 'x') WITH CHECK (v = 'x')" "C8 rls_fixture.t6: at least one tenant policy"
mutate "policy for PUBLIC that is too open" "$(good_table_sql t7); CREATE POLICY pub ON rls_fixture.t7 AS PERMISSIVE FOR ALL TO PUBLIC USING (true)" "C8 rls_fixture.t7: at least one tenant policy"
mutate "WITH CHECK that ignores tenant_id" "$(good_table_sql t8); DROP POLICY p ON rls_fixture.t8; CREATE POLICY p ON rls_fixture.t8 FOR ALL TO menlo_app USING (tenant_id = rls_fixture.current_tenant_id()) WITH CHECK (true)" "C8 rls_fixture.t8: at least one tenant policy"
mutate "accessible table without a tenant_id column" "SET ROLE rls_fixture_owner; CREATE TABLE rls_fixture.t9 (v text); GRANT SELECT ON rls_fixture.t9 TO menlo_app" "C8 rls_fixture.t9: tenant-scoped table has a tenant_id"
mutate "tenant_id with the wrong type" "SET ROLE rls_fixture_owner; CREATE TABLE rls_fixture.t10 (tenant_id text NOT NULL); GRANT SELECT ON rls_fixture.t10 TO menlo_app" "C8 rls_fixture.t10: tenant-scoped table has a tenant_id"
mutate "TRUNCATE granted to the application" "GRANT TRUNCATE ON rls_fixture.tenant_item TO menlo_app" "C8 rls_fixture.tenant_item: application role has no TRUNCATE"
mutate "TRIGGER granted to the application" "GRANT TRIGGER ON rls_fixture.tenant_item TO menlo_app" "C8 rls_fixture.tenant_item: application role has no TRUNCATE"
mutate "application can read the migration ledger" "GRANT USAGE ON SCHEMA plataforma_migrations TO menlo_app; GRANT SELECT ON plataforma_migrations.ledger TO menlo_app" "C7"
mutate "application can lock the migration lock table" "GRANT USAGE ON SCHEMA plataforma_migrations TO menlo_app; GRANT UPDATE ON plataforma_migrations.run_lock TO menlo_app" "C7"
mutate "table privilege on the ledger without schema USAGE" "GRANT SELECT ON plataforma_migrations.ledger TO menlo_app" "C7"
mutate "EXECUTE on a migration-schema function" "GRANT EXECUTE ON FUNCTION plataforma_migrations.ledger_append_only() TO menlo_app" "C7"
mutate "PUBLIC can read the migration ledger" "GRANT USAGE ON SCHEMA plataforma_migrations TO PUBLIC; GRANT SELECT ON plataforma_migrations.ledger TO PUBLIC" "C7"
mutate "application role is a superuser" "ALTER ROLE menlo_app SUPERUSER" "C2"
mutate "application role has BYPASSRLS" "ALTER ROLE menlo_app BYPASSRLS" "C2"
mutate "application role has CREATEROLE" "ALTER ROLE menlo_app CREATEROLE" "C2"
mutate "application role has CREATEDB" "ALTER ROLE menlo_app CREATEDB" "C2"
mutate "application role is a member of the fixture owner" "GRANT rls_fixture_owner TO menlo_app" "C3"
mutate "application role owns a table" "ALTER TABLE rls_fixture.tenant_item OWNER TO menlo_app" "C4"
mutate "application role can create objects in a schema" "GRANT CREATE ON SCHEMA rls_fixture TO menlo_app" "C5"
mutate "application role has TEMP on the database" "GRANT TEMPORARY ON DATABASE sec$((N + 1)) TO menlo_app" "C5"
mutate "a SECURITY DEFINER function is executable by the application" "SET ROLE rls_fixture_owner; CREATE FUNCTION rls_fixture.definer() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'; GRANT EXECUTE ON FUNCTION rls_fixture.definer() TO menlo_app" "C9"
mutate "a view without security_invoker is reachable" "SET ROLE rls_fixture_owner; CREATE VIEW rls_fixture.v_leaky AS SELECT * FROM rls_fixture.tenant_item; GRANT SELECT ON rls_fixture.v_leaky TO menlo_app" "C10"
mutate "a materialized view is reachable" "SET ROLE rls_fixture_owner; CREATE MATERIALIZED VIEW rls_fixture.mv_leaky AS SELECT * FROM rls_fixture.tenant_item; GRANT SELECT ON rls_fixture.mv_leaky TO menlo_app" "C10"
fixture_db; check --app-role no_such_role
expect "SEC-M a nonexistent application role makes the check fail (exit 1)" eq "$RC" 1
expect "SEC-M and the failing line is 'C1'" notok_line "C1"

# ================================================================================================
echo; echo "== Tabelas globais aprovadas, vistas seguras e entradas obsoletas da lista =="
fixture_db
Q "$DB" "SET ROLE rls_fixture_owner; CREATE TABLE rls_fixture.ref_data (k text); GRANT SELECT ON rls_fixture.ref_data TO menlo_app" >/dev/null
check
expect "SEC-G1 a global/reference table that is NOT on the allowlist fails" bash -c '[[ $1 -eq 1 ]]' _ "$RC"
check --global-allow rls_fixture.ref_data
expect "SEC-G1 the same table passes once it is explicitly allowlisted (read-only for the application)" bash -c '[[ $1 -eq 0 ]]' _ "$RC"
expect "SEC-G1 and it is reported as an approved global table, not as a tenant table" bash -c '[[ "$1" == *"ok - C8 rls_fixture.ref_data: approved global/reference table is read-only"* ]]' _ "$OUT"
Q "$DB" "GRANT INSERT ON rls_fixture.ref_data TO menlo_app" >/dev/null
check --global-allow rls_fixture.ref_data
expect "SEC-G2 an allowlisted table that the application can WRITE fails" notok_line "C8 rls_fixture.ref_data: approved global/reference table is read-only"
check --global-allow rls_fixture.no_such_table
expect "SEC-G3 a stale allowlist entry (table does not exist) fails" notok_line "C8 rls_fixture.no_such_table: allowlisted global table exists"
check --global-allow plataforma_migrations.ledger
expect "SEC-G4 the migration ledger can never be allowlisted" notok_line "C8 plataforma_migrations.ledger: allowlisted global table exists"
fixture_db
Q "$DB" "SET ROLE rls_fixture_owner; CREATE VIEW rls_fixture.v_ok WITH (security_invoker = true) AS SELECT * FROM rls_fixture.tenant_item; GRANT SELECT ON rls_fixture.v_ok TO menlo_app" >/dev/null
check
expect "SEC-V1 a security_invoker view over a tenant table passes" bash -c '[[ $1 -eq 0 ]]' _ "$RC"

# ================================================================================================
echo; echo "== Uso do verificador e segurança =="
OUT="$(bash "$CHECK" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --user rls_bootstrap 2>&1)"; RC=$?
expect "SEC-S1 a missing --dbname is a usage error (exit 2)" eq "$RC" 2
OUT="$(bash "$CHECK" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname no_such_db --user rls_bootstrap 2>&1)"; RC=$?
expect "SEC-S2 a nonexistent database is a connection failure (exit 4), never a false success" eq "$RC" 4
OUT="$(PGHOST=/nonexistent PGDATABASE=wrong PGUSER=wrong bash "$CHECK" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user rls_bootstrap 2>&1)"; RC=$?
expect "SEC-S3 ambient PG* variables are ignored; explicit flags win" eq "$RC" 0
OUT="$(bash "$CHECK" --socket-dir localhost --port "$PORT" --dbname "$DB" --user rls_bootstrap 2>&1)"; RC=$?
expect "SEC-S4 a network host is refused (exit 2)" eq "$RC" 2

echo
if [[ "$FAILS" -eq 0 ]]; then
  echo "SECURITY CATALOG TESTS: PASSED ($CHECKS checks) on PostgreSQL $("${PSQL[@]}" -d postgres -c 'SHOW server_version')"
else
  echo "SECURITY CATALOG TESTS: FAILED ($FAILS of $CHECKS checks failed)" >&2
  exit 1
fi
