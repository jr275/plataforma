#!/usr/bin/env bash
# Testes do GATE DE SEGURANÇA TRANSACIONAL do runner (db/checks/security_gate.sql dentro da transação de cada migration)
# contra um PostgreSQL 16 DESCARTÁVEL, com os papéis reais criados por scripts/db-bootstrap.sh
# (administrador, executor das migrations e aplicação). Nenhuma tabela de produto: as migrations de teste criam um
# esquema descartável "prod" em bancos descartáveis. Não usa Docker/Neon/DATABASE_URL; apaga tudo ao sair.
# Código de saída: 0 = tudo certo; 1 = falha de teste; 2 = pré-requisito ausente/versão errada.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=lib/disposable-pg.sh
source "$ROOT/scripts/lib/disposable-pg.sh"
set +e

RUNNER="$ROOT/scripts/db-migrate.sh"
BOOT="$ROOT/scripts/db-bootstrap.sh"
ADMIN=plataforma_admin; MIG=plataforma_migrator; APP=menlo_app
FAILS=0; CHECKS=0; N=0; DB=""; DIR=""; OUT=""; RC=0

Q()  { "${PSQL[@]}" -d "$1" -c "$2" 2>&1; }
As() { local u="$1" sql="$2"; "${PSQL[@]}" -U "$u" -d "$DB" -c "$sql" 2>&1; }
expect() { local name="$1"; shift; CHECKS=$((CHECKS + 1))
  if "$@" >/dev/null 2>&1; then echo "ok - $name"; else echo "not ok - $name"; FAILS=$((FAILS + 1)); fi; }
eq()  { [[ "$1" == "$2" ]]; }
has() { [[ "$1" == *"$2"* ]]; }
lacks() { [[ "$1" != *"$2"* ]]; }

fresh() { # banco novo, provisionado e verificado pelo bootstrap; define $DB e $DIR
  [[ -z "$DB" ]] || Q postgres "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1
  N=$((N + 1)); DB="gate$N"; DIR="$TMP/mig/$N"; rm -rf "$DIR"; mkdir -p "$DIR"
  local o; o="$(bash "$BOOT" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --user rls_bootstrap --dbname "$DB" 2>&1)" \
    || { echo "not ok - setup: bootstrap failed for $DB: $(tail -2 <<<"$o")"; FAILS=$((FAILS + 1)); CHECKS=$((CHECKS + 1)); }
}
write() { printf '%s\n' "$2" > "$DIR/$1"; }
run() { # run [opções extras]: o runner como executor, com o gate ATIVO e o papel da aplicação informado
  OUT="$(bash "$RUNNER" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$MIG" --migrations-dir "$DIR" --app-role "$APP" "$@" 2>&1)"; RC=$?
}
ledger_seqs() { Q "$DB" "SELECT coalesce(string_agg(seq::text, ',' ORDER BY seq), '') FROM plataforma_migrations.ledger"; }
fp() { Q "$DB" "SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT 'C:'||n.nspname||'.'||c.relname||':'||c.relkind::text||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'')||':'||c.relowner::regrole::text AS x
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  UNION ALL SELECT 'P:'||polrelid::regclass::text||':'||polname||':'||polcmd::text||':'||coalesce(pg_get_expr(polqual,polrelid),'')||':'||coalesce(pg_get_expr(polwithcheck,polrelid),'')||':'||polroles::text FROM pg_policy
  UNION ALL SELECT 'N:'||nspname||':'||coalesce(nspacl::text,'')||':'||nspowner::regrole::text FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
  UNION ALL SELECT 'D:'||defaclrole::regrole::text||':'||defaclnamespace::text||':'||defaclacl::text FROM pg_default_acl
  UNION ALL SELECT 'R:'||rolname||':'||rolsuper::text||rolbypassrls::text||rolcreaterole::text||rolcreatedb::text||rolreplication::text FROM pg_roles WHERE rolname IN ('$ADMIN','$MIG','$APP')
  UNION ALL SELECT 'M:'||member::regrole::text||':'||roleid::regrole::text FROM pg_auth_members WHERE member::regrole::text IN ('$ADMIN','$MIG','$APP')
  UNION ALL SELECT 'F:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  UNION ALL SELECT 'L:'||seq::text||filename||sha256 FROM plataforma_migrations.ledger) s"; }

# A função auxiliar da política precisa ter o corpo canônico com aspas comuns (o gate confere o corpo normalizado; corpos
# com literais entre aspas de dólar não são aceitos): ver db/checks/README.md, "Forma canônica da política de tenant".
read -r -d '' BASE <<'SQL'
CREATE SCHEMA prod;
CREATE FUNCTION prod.current_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $q$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $q$;
CREATE TABLE prod.items (tenant_id uuid NOT NULL, v text);
ALTER TABLE prod.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE prod.items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON prod.items AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = prod.current_tenant_id()) WITH CHECK (tenant_id = prod.current_tenant_id());
GRANT USAGE ON SCHEMA prod TO menlo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON prod.items TO menlo_app;
GRANT EXECUTE ON FUNCTION prod.current_tenant_id() TO menlo_app;
SQL
FIXED='ALTER TABLE prod.items ADD COLUMN note text;'

# unsafe "nome" "SQL inseguro da 0002" "trecho esperado na saída" "SQL corrigido da 0002"
unsafe() {
  fresh; write 0001_items.sql "$BASE"; run
  if [[ "$RC" -ne 0 ]]; then echo "not ok - $1: setup (valid 0001) failed: $(tail -3 <<<"$OUT" | tr '\n' ' ')"; FAILS=$((FAILS + 1)); CHECKS=$((CHECKS + 1)); return; fi
  local before; before="$(fp)"
  write 0002_change.sql "$2"; run
  expect "GATE-N $1: the runner rejects the migration (exit 1)" eq "$RC" 1
  expect "GATE-N $1: the output names the rejected migration and the reason ($3)" bash -c '[[ "$1" == *0002_change.sql* && "$1" == *"$2"* ]]' _ "$OUT" "$3"
  expect "GATE-N $1: the migration is NOT recorded in the ledger" eq "$(ledger_seqs)" "1"
  expect "GATE-N $1: the catalog is exactly as before (nothing persisted: schema, grants, RLS, policies, defaults, roles)" eq "$(fp)" "$before"
  write 0002_change.sql "$4"; run
  expect "GATE-N $1: after correcting the never-applied migration, the next run succeeds (exit 0)" eq "$RC" 0
  expect "GATE-N $1: and the ledger now holds 1,2" eq "$(ledger_seqs)" "1,2"
}

# ================================================================================================
echo "== Estado inicial vazio e migrations válidas passam pelo gate =="
fresh
run
expect "GATE-P1 empty initial state (no migrations, no product schema): the gate passes (exit 0)" eq "$RC" 0
expect "GATE-P1 the output says the gate is active for the application role" has "$OUT" "gate de segurança: ativo (papel da aplicação: $APP)"
expect "GATE-P1 the ledger is empty and its head is 0" bash -c '[[ "$1" == *"ledger head: 0:-"* ]]' _ "$OUT"
write 0001_items.sql "$BASE"; run
expect "GATE-P2 a valid tenant-scoped migration (RLS enabled and forced, tenant policy, explicit grants) passes the gate and is applied" bash -c '[[ $1 -eq 0 && "$2" == *"gate ok 0001_items.sql"* && "$2" == *"applied 0001_items.sql"* ]]' _ "$RC" "$OUT"
expect "GATE-P2 and is recorded in the ledger" eq "$(ledger_seqs)" "1"
expect "GATE-P2 the real application role sees only its own tenant's rows (behavioral RLS check, the gate does not replace it)" \
  eq "$("${PSQL[@]}" -U $APP -d "$DB" <<'SQL' 2>&1 | tr '\n' ' '
BEGIN;
SELECT set_config('app.tenant_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true) AS c \gset
INSERT INTO prod.items VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a1');
COMMIT;
BEGIN;
SELECT set_config('app.tenant_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true) AS c \gset
SELECT count(*) FROM prod.items;
COMMIT;
SQL
)" "0 "
run
expect "GATE-P3 re-running with nothing pending: the baseline gate still passes and reports the migration current (exit 0)" bash -c '[[ $1 -eq 0 && "$2" == *"current 0001_items.sql"* ]]' _ "$RC" "$OUT"

fresh; write 0001_items.sql "$BASE"
write 0002_ref.sql 'CREATE TABLE prod.ref (k text);
GRANT SELECT ON prod.ref TO menlo_app;'
run
expect "GATE-P4 a global/reference table reachable by the application is REJECTED unless explicitly approved (no tenant_id)" bash -c '[[ $1 -eq 1 && "$2" == *"not ok - C8 prod.ref"* ]]' _ "$RC" "$OUT"
run --global-allow prod.ref
expect "GATE-P4 the same migration passes once the table is explicitly approved as global (read-only for the application)" bash -c '[[ $1 -eq 0 && "$2" == *"applied 0002_ref.sql"* ]]' _ "$RC" "$OUT"
write 0003_ref_write.sql 'GRANT INSERT ON prod.ref TO menlo_app;'
run --global-allow prod.ref
expect "GATE-P4 granting WRITE access on an approved global table is rejected" bash -c '[[ $1 -eq 1 && "$2" == *"approved global/reference table is read-only"* ]]' _ "$RC" "$OUT"
rm "$DIR/0003_ref_write.sql"
write 0003_view.sql 'CREATE VIEW prod.items_v WITH (security_invoker = true) AS SELECT * FROM prod.items;
GRANT SELECT ON prod.items_v TO menlo_app;
CREATE TABLE prod.internal (x int);
CREATE SEQUENCE prod.sq;
GRANT USAGE ON SEQUENCE prod.sq TO menlo_app;'
run --global-allow prod.ref
expect "GATE-P5 a security_invoker view, a table the application cannot reach and a USAGE-only sequence pass the gate" bash -c '[[ $1 -eq 0 && "$2" == *"applied 0003_view.sql"* ]]' _ "$RC" "$OUT"

# ================================================================================================
echo; echo "== Migrations inseguras são rejeitadas ANTES do COMMIT e desfeitas =="
unsafe "disables RLS on a tenant table" 'ALTER TABLE prod.items DISABLE ROW LEVEL SECURITY;' "not ok - C8 prod.items: ROW LEVEL SECURITY" "$FIXED"
unsafe "removes FORCE from a tenant table" 'ALTER TABLE prod.items NO FORCE ROW LEVEL SECURITY;' "not ok - C8 prod.items: ROW LEVEL SECURITY" "$FIXED"
unsafe "drops the tenant policy" 'DROP POLICY tenant_isolation ON prod.items;' "not ok - C8 prod.items: at least one tenant policy" "$FIXED"
unsafe "replaces the tenant policy with USING (true)" 'DROP POLICY tenant_isolation ON prod.items;
CREATE POLICY tenant_isolation ON prod.items FOR ALL TO menlo_app USING (true) WITH CHECK (true);' "not ok - C8 prod.items: at least one tenant policy" "$FIXED"
unsafe "adds an open permissive policy for PUBLIC" 'CREATE POLICY open_read ON prod.items AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);' "not ok - C8 prod.items: at least one tenant policy" "$FIXED"
unsafe "grants protected data to PUBLIC" 'GRANT SELECT ON prod.items TO PUBLIC;' "not ok - G5" "$FIXED"
unsafe "grants PUBLIC USAGE on the product schema" 'GRANT USAGE ON SCHEMA prod TO PUBLIC;' "not ok - G5" "$FIXED"
unsafe "grants TRUNCATE to the application role" 'GRANT TRUNCATE ON prod.items TO menlo_app;' "not ok - C8 prod.items: application role has no TRUNCATE" "$FIXED"
unsafe "grants the application role CREATE on a schema" 'GRANT CREATE ON SCHEMA prod TO menlo_app;' "not ok - C5" "$FIXED"
unsafe "grants UPDATE on a sequence to the application role" 'CREATE SEQUENCE prod.sq; GRANT UPDATE ON SEQUENCE prod.sq TO menlo_app;' "not ok - G6" "$FIXED"
unsafe "introduces default privileges for the application role" 'ALTER DEFAULT PRIVILEGES IN SCHEMA prod GRANT SELECT ON TABLES TO menlo_app;' "not ok - C6" "$FIXED"
unsafe "introduces default privileges for PUBLIC" 'ALTER DEFAULT PRIVILEGES IN SCHEMA prod GRANT SELECT ON TABLES TO PUBLIC;' "not ok - C6" "$FIXED"
unsafe "creates an app-reachable table without tenant_id" 'CREATE TABLE prod.loose (v text); GRANT SELECT ON prod.loose TO menlo_app;' "not ok - C8 prod.loose: tenant-scoped table has a tenant_id" "$FIXED"
unsafe "creates a tenant table with the wrong tenant_id type" 'CREATE TABLE prod.wrongtype (tenant_id text NOT NULL); GRANT SELECT ON prod.wrongtype TO menlo_app;' "not ok - C8 prod.wrongtype: tenant-scoped table has a tenant_id" "$FIXED"
unsafe "creates a reachable tenant table without RLS (finding 3 shape)" 'CREATE TABLE prod.leaky (tenant_id uuid NOT NULL, secret text); GRANT SELECT ON prod.leaky TO menlo_app;' "not ok - C8 prod.leaky: ROW LEVEL SECURITY" "$FIXED"
unsafe "creates a view without security_invoker reachable by the application" 'CREATE VIEW prod.v_open AS SELECT * FROM prod.items; GRANT SELECT ON prod.v_open TO menlo_app;' "not ok - C10" "$FIXED"
unsafe "creates a materialized view reachable by the application" 'CREATE MATERIALIZED VIEW prod.mv_open AS SELECT * FROM prod.items; GRANT SELECT ON prod.mv_open TO menlo_app;' "not ok - C10" "$FIXED"
unsafe "creates a SECURITY DEFINER function executable by the application (PUBLIC default)" 'CREATE FUNCTION prod.definer() RETURNS int LANGUAGE sql SECURITY DEFINER AS $q$ SELECT 1 $q$;' "not ok - C9" 'CREATE FUNCTION prod.definer() RETURNS int LANGUAGE sql SECURITY DEFINER AS $q$ SELECT 1 $q$;
REVOKE ALL ON FUNCTION prod.definer() FROM PUBLIC;'

echo; echo "== O executor não tem autoridade para a mudança proibida: o PostgreSQL a rejeita e nada persiste =="
unsafe "tries to hand a table to the application role (ownership)" 'CREATE TABLE prod.t2 (tenant_id uuid NOT NULL); ALTER TABLE prod.t2 OWNER TO menlo_app;' "ERROR" "$FIXED"
unsafe "tries to make the application role BYPASSRLS" 'ALTER ROLE menlo_app BYPASSRLS;' "ERROR" "$FIXED"
unsafe "tries to make the application role a superuser" 'ALTER ROLE menlo_app SUPERUSER;' "ERROR" "$FIXED"
unsafe "tries to make the application role CREATEROLE" 'ALTER ROLE menlo_app CREATEROLE;' "ERROR" "$FIXED"
unsafe "tries to make the application role a member of the administrator" 'GRANT plataforma_admin TO menlo_app;' "ERROR" "$FIXED"
unsafe "tries to become a member of the application role" 'GRANT menlo_app TO plataforma_migrator;' "ERROR" "$FIXED"
unsafe "tries to hand the migration ledger to the application role" 'ALTER TABLE plataforma_migrations.ledger OWNER TO menlo_app;' "ERROR" "$FIXED"
unsafe "tries to rewrite the ledger from inside a migration" 'DELETE FROM plataforma_migrations.ledger;' "ERROR" "$FIXED"
unsafe "tries to drop the ledger append-only trigger" 'DROP TRIGGER ledger_no_update_delete ON plataforma_migrations.ledger;' "ERROR" "$FIXED"
unsafe "tries to use a session setting reserved to superusers" 'SET LOCAL session_replication_role = replica;' "ERROR" "$FIXED"
# GRANT sem autoridade não dá erro: o PostgreSQL emite um aviso e não concede nada.
fresh; write 0001_items.sql "$BASE"; run
write 0002_meta.sql 'GRANT USAGE ON SCHEMA plataforma_migrations TO menlo_app;
GRANT SELECT, UPDATE ON plataforma_migrations.ledger TO menlo_app;
GRANT SELECT ON plataforma_migrations.ledger TO PUBLIC;'
run
expect "GATE-M the executor lacks authority to grant on migration metadata: PostgreSQL ignores the GRANT (a warning, not an error)" bash -c '[[ "$1" == *"no privileges were granted"* ]]' _ "$OUT"
expect "GATE-M so the migration is harmless and may be applied, and the gate confirms the metadata is still closed to the application and PUBLIC" bash -c '[[ $1 -eq 0 && "$2" == *"gate ok 0002_meta.sql"* ]]' _ "$RC" "$OUT"
expect "GATE-M (catalog) the application role still has no access to the ledger" eq "$(Q "$DB" "SELECT has_schema_privilege('$APP','plataforma_migrations','USAGE') OR has_table_privilege('$APP','plataforma_migrations.ledger','SELECT') OR has_table_privilege('public','plataforma_migrations.ledger','SELECT')")" "f"

echo; echo "== Operações não transacionais: rejeitadas, nunca executadas sem rollback =="
unsafe "CREATE INDEX CONCURRENTLY (cannot run in a transaction)" 'CREATE INDEX CONCURRENTLY items_v ON prod.items (v);' "ERROR" "$FIXED"
unsafe "VACUUM (cannot run in a transaction)" 'VACUUM prod.items;' "ERROR" "$FIXED"
unsafe "CREATE DATABASE (cannot run in a transaction)" 'CREATE DATABASE other_db;' "ERROR" "$FIXED"
unsafe "ALTER SYSTEM (cannot run in a transaction and needs superuser)" 'ALTER SYSTEM SET work_mem = 4096;' "ERROR" "$FIXED"
fresh; write 0001_items.sql "$BASE"; write 0002_commit.sql 'ALTER TABLE prod.items ADD COLUMN note text;
COMMIT;'
run
expect "GATE-T explicit transaction control in a migration is rejected before any connection (exit 1)" bash -c '[[ $1 -eq 1 && "$2" == *"controle de transação"* ]]' _ "$RC" "$OUT"
expect "GATE-T and nothing was applied, not even the valid 0001 (the local validation happens first)" eq "$(ledger_seqs)" ""

echo; echo "== Tentativas de enganar o gate por dentro da migration =="
unsafe "shadows pg_class with a temporary table before disabling RLS" 'CREATE TEMP TABLE pg_class AS SELECT * FROM pg_catalog.pg_class WHERE false;
ALTER TABLE prod.items DISABLE ROW LEVEL SECURITY;' "not ok - C8 prod.items: ROW LEVEL SECURITY" "$FIXED"
unsafe "shadows has_table_privilege and sets search_path before granting to PUBLIC" 'CREATE FUNCTION prod.has_table_privilege(name, oid, text) RETURNS boolean LANGUAGE sql AS $q$ SELECT false $q$;
CREATE FUNCTION prod.has_schema_privilege(name, oid, text) RETURNS boolean LANGUAGE sql AS $q$ SELECT false $q$;
SET LOCAL search_path = prod, pg_catalog;
GRANT SELECT ON prod.items TO PUBLIC;' "not ok - G5" "$FIXED"
unsafe "tampers with the temporary tables the runner uses" 'DROP TABLE IF EXISTS pg_temp._files; CREATE TEMP TABLE _files (seq integer, filename text, sha256 text);
ALTER TABLE prod.items DISABLE ROW LEVEL SECURITY;' "not ok - C8 prod.items: ROW LEVEL SECURITY" "$FIXED"

echo; echo "== Linha de base, papéis do runner e opt-out =="
fresh; write 0001_items.sql "$BASE"; run
Q "$DB" "GRANT SELECT ON prod.items TO PUBLIC" >/dev/null
run
expect "GATE-B1 a database that ALREADY violates the invariants is rejected before any migration (baseline gate, exit 1) even with nothing pending" bash -c '[[ $1 -eq 1 && "$2" == *"antes de aplicar qualquer migration"* && "$2" == *"not ok - G5"* ]]' _ "$RC" "$OUT"
write 0002_ok.sql "$FIXED"; run
expect "GATE-B1 and a new valid migration is NOT applied on top of the violating state" bash -c '[[ $1 -eq 1 ]]' _ "$RC"
expect "GATE-B1 (ledger) nothing was applied" eq "$(ledger_seqs)" "1"
Q "$DB" "REVOKE SELECT ON prod.items FROM PUBLIC" >/dev/null
run
expect "GATE-B1 once the state is repaired the run succeeds" bash -c '[[ $1 -eq 0 ]]' _ "$RC"

fresh; write 0001_items.sql "$BASE"
run --app-role no_such_role
expect "GATE-B2 a nonexistent application role fails closed (exit 1, C1 not ok)" bash -c '[[ $1 -eq 1 && "$2" == *"not ok - C1"* ]]' _ "$RC" "$OUT"
expect "GATE-B2 and nothing was applied" eq "$(ledger_seqs)" ""
OUT="$(bash "$RUNNER" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$MIG" --migrations-dir "$DIR" 2>&1)"; RC=$?
expect "GATE-B3 the gate cannot be forgotten: without --app-role and without an explicit opt-out the runner refuses (exit 2)" bash -c '[[ $1 -eq 2 && "$2" == *"--no-security-gate"* ]]' _ "$RC" "$OUT"
OUT="$(bash "$RUNNER" --no-security-gate --app-role "$APP" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$MIG" --migrations-dir "$DIR" 2>&1)"; RC=$?
expect "GATE-B3 --no-security-gate cannot be combined with --app-role (exit 2)" eq "$RC" 2
Q "$DB" "GRANT $APP TO $MIG" >/dev/null
run
expect "GATE-B4 the runner refuses an executor that became a member of the application role (exit 1)" bash -c '[[ $1 -eq 1 && "$2" == *"membro de outro papel"* ]]' _ "$RC" "$OUT"
Q postgres "REVOKE $APP FROM $MIG" >/dev/null
fresh; write 0001_items.sql "$BASE"; write 0002_bad.sql 'ALTER TABLE prod.items DISABLE ROW LEVEL SECURITY;'
OUT="$(bash "$RUNNER" --no-security-gate --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$MIG" --migrations-dir "$DIR" 2>&1)"; RC=$?
expect "GATE-B5 contrast: with the explicit opt-out the unsafe migration IS applied (this is what the gate prevents) and a warning is printed" bash -c '[[ $1 -eq 0 && "$2" == *"AVISO"* && "$2" == *"applied 0002_bad.sql"* ]]' _ "$RC" "$OUT"
run
expect "GATE-B5 and the next run WITH the gate then refuses the resulting state (baseline gate)" bash -c '[[ $1 -eq 1 && "$2" == *"not ok - C8 prod.items: ROW LEVEL SECURITY"* ]]' _ "$RC" "$OUT"

echo
if [[ "$FAILS" -eq 0 ]]; then
  echo "GATE TESTS: PASSED ($CHECKS checks) on PostgreSQL $("${PSQL[@]}" -d postgres -c 'SHOW server_version')"
else
  echo "GATE TESTS: FAILED ($FAILS of $CHECKS checks failed)" >&2
  exit 1
fi
