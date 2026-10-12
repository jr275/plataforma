#!/usr/bin/env bash
# Testes de regressão da Fase 9 (achados F1 a F8 da auditoria da Fase 8) contra um PostgreSQL 16 DESCARTÁVEL, com os
# papéis reais criados por scripts/db-bootstrap.sh. Cada teste observa ESTADO do banco (catálogo, ledger, tabelas), não só
# mensagens. As entradas são fixtures inofensivas (sem comandos de shell, sem payloads): o objetivo é provar invariantes do
# runner e do gate, não demonstrar abusos. Nenhuma tabela de produto; não usa Docker/Neon/DATABASE_URL; apaga tudo ao sair.
# Código de saída: 0 = tudo certo; 1 = falha de teste; 2 = pré-requisito ausente/versão errada.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=lib/disposable-pg.sh
source "$ROOT/scripts/lib/disposable-pg.sh"
set +e

RUNNER="$ROOT/scripts/db-migrate.sh"
BOOT="$ROOT/scripts/db-bootstrap.sh"
ADMIN=plataforma_admin; MIG=plataforma_migrator; APP=menlo_app
FAILS=0; CHECKS=0; N=0; DB=""; DIR=""; OUT=""; STDOUT=""; ERR=""; RC=0

Q()  { "${PSQL[@]}" -d "$1" -c "$2" 2>&1; }
expect() { local name="$1"; shift; CHECKS=$((CHECKS + 1))
  if "$@" >/dev/null 2>&1; then echo "ok - $name"; else echo "not ok - $name"; FAILS=$((FAILS + 1)); fi; }
eq()  { [[ "$1" == "$2" ]]; }
has() { [[ "$1" == *"$2"* ]]; }
lacks() { [[ "$1" != *"$2"* ]]; }
nonzero() { [[ "$1" -ne 0 ]]; }

fresh() { # banco novo provisionado e verificado pelo bootstrap; define $DB e $DIR
  [[ -z "$DB" ]] || Q postgres "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1
  N=$((N + 1)); DB="hard$N"; DIR="$TMP/mig/$N"; rm -rf "$DIR"; mkdir -p "$DIR"
  local o; o="$(bash "$BOOT" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --user rls_bootstrap --dbname "$DB" 2>&1)" \
    || { echo "not ok - setup: bootstrap failed for $DB: $(tail -2 <<<"$o")"; FAILS=$((FAILS + 1)); CHECKS=$((CHECKS + 1)); }
}
write() { printf '%s\n' "$2" > "$DIR/$1"; }
run() { # run [opções extras]: o runner como executor com o gate ATIVO; $STDOUT só com a saída padrão, $ERR só com o stderr
  STDOUT="$(bash "$RUNNER" --socket-dir "$TMP" --port "$PORT" --psql "${PSQL_OVERRIDE:-$PGBIN/psql}" --dbname "$DB" --user "$MIG" --migrations-dir "$DIR" --app-role "$APP" "$@" 2>"$TMP/h.err")"; RC=$?
  ERR="$(cat "$TMP/h.err")"; OUT="$STDOUT"$'\n'"$ERR"
}
run_nogate() { # o runner com o bypass explícito do gate
  STDOUT="$(bash "$RUNNER" --no-security-gate --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$MIG" --migrations-dir "$DIR" "$@" 2>"$TMP/h.err")"; RC=$?
  ERR="$(cat "$TMP/h.err")"; OUT="$STDOUT"$'\n'"$ERR"
}
ledger_seqs() { Q "$DB" "SELECT coalesce(string_agg(seq::text, ',' ORDER BY seq), '') FROM plataforma_migrations.ledger"; }
tbl_absent() { [[ "$(Q "$DB" "SELECT to_regclass('$1') IS NULL")" == "t" ]]; }
fp() { Q "$DB" "SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT 'C:'||n.nspname||'.'||c.relname||':'||c.relkind::text||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'')||':'||c.relowner::regrole::text AS x
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  UNION ALL SELECT 'A:'||attrelid::regclass::text||'.'||attname||':'||coalesce(attacl::text,'') FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND attnum > 0 AND NOT attisdropped
  UNION ALL SELECT 'P:'||polrelid::regclass::text||':'||polname||':'||polcmd::text||':'||coalesce(pg_get_expr(polqual,polrelid),'')||':'||coalesce(pg_get_expr(polwithcheck,polrelid),'')||':'||polroles::text FROM pg_policy
  UNION ALL SELECT 'W:'||ev_class::regclass::text||':'||rulename FROM pg_rewrite r JOIN pg_class c ON c.oid = r.ev_class JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  UNION ALL SELECT 'T:'||tgrelid::regclass::text||':'||tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT tgisinternal AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  UNION ALL SELECT 'N:'||nspname||':'||coalesce(nspacl::text,'')||':'||nspowner::regrole::text FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
  UNION ALL SELECT 'D:'||defaclrole::regrole::text||':'||defaclnamespace::text||':'||defaclacl::text FROM pg_default_acl
  UNION ALL SELECT 'R:'||rolname||':'||rolsuper::text||rolbypassrls::text||rolcreaterole::text||rolcreatedb::text||rolreplication::text FROM pg_roles WHERE rolname IN ('$ADMIN','$MIG','$APP')
  UNION ALL SELECT 'S:'||coalesce(setrole::regrole::text,'0')||':'||setconfig::text FROM pg_db_role_setting
  UNION ALL SELECT 'F:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  UNION ALL SELECT 'L:'||seq::text||filename||sha256 FROM plataforma_migrations.ledger) s"; }

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
read -r -d '' FIXED <<'SQL'
ALTER TABLE prod.items ADD COLUMN note text;
SQL

base_env() { fresh; write 0001_items.sql "$BASE"; run
  [[ "$RC" -eq 0 ]] || { echo "not ok - setup: valid 0001 failed: $(tail -3 <<<"$OUT" | tr '\n' ' ')"; FAILS=$((FAILS + 1)); CHECKS=$((CHECKS + 1)); return 1; }; }

# ================================================================================================
echo "== F1: o conteúdo da migration é SQL para o servidor, nunca um script de controle do psql =="
base_env && { before="$(fp)"
  write 0002_meta.sql 'CREATE TABLE prod.h1a (a int);
SELECT 1; \echo runner-injected-marker'
  run
  expect "HARD-F1a a psql meta-command placed after SQL on the same line is not interpreted by psql: the migration is rejected (exit nonzero)" nonzero "$RC"
  expect "HARD-F1a the meta-command produced no output on the runner stdout" lacks "$STDOUT" "runner-injected-marker"
  expect "HARD-F1a nothing persisted: no table, ledger unchanged, catalog identical" bash -c '[[ "$1" == t && "$2" == "1" && "$3" == "$4" ]]' _ "$(Q "$DB" "SELECT to_regclass('prod.h1a') IS NULL")" "$(ledger_seqs)" "$(fp)" "$before"
}
base_env && { before="$(fp)"
  write 0002_flow.sql 'SELECT 1; \set ON_ERROR_STOP off
SELECT 1/0;
CREATE TABLE prod.h1b (a int);'
  run
  expect "HARD-F1b a psql meta-command that tries to disable error stopping is not honored: exit nonzero" nonzero "$RC"
  expect "HARD-F1b nothing persisted: no table, ledger unchanged" bash -c '[[ "$1" == t && "$2" == "1" ]]' _ "$(Q "$DB" "SELECT to_regclass('prod.h1b') IS NULL")" "$(ledger_seqs)"
  expect "HARD-F1b the reported outcome matches the committed state (success reported only if the ledger holds 1,2)" bash -c 'if [[ $1 -eq 0 ]]; then [[ "$2" == "1,2" ]]; else [[ "$2" == "1" ]]; fi' _ "$RC" "$(ledger_seqs)"
}
base_env && { write 0002_quit.sql 'SELECT 1; \q'
  run
  expect "HARD-F1c a psql quit command inside a migration is not honored: exit nonzero, nothing recorded" bash -c '[[ $1 -ne 0 && "$2" == "1" ]]' _ "$RC" "$(ledger_seqs)"
}
base_env && { write 0002_ok.sql 'CREATE TABLE prod.h1d (a int);
-- a comment with a backslash \ and a colon :name is just text
INSERT INTO prod.h1d VALUES (1);
SELECT $b$ a dollar-quoted string with \ and :name $b$;'
  run
  expect "HARD-F1d a valid migration (comments, dollar-quoted text with backslash and colon) still applies: exit 0, ledger 1,2" bash -c '[[ $1 -eq 0 && "$2" == "1,2" ]]' _ "$RC" "$(ledger_seqs)"
  expect "HARD-F1d and its data is committed" eq "$(Q "$DB" "SELECT count(*) FROM prod.h1d")" 1
}

base_env && { : > "$DIR/0002_empty.sql"; run
  expect "HARD-F1e an empty migration file is rejected before any execution (exit nonzero, ledger unchanged)" bash -c '[[ $1 -ne 0 && "$2" == "1" ]]' _ "$RC" "$(ledger_seqs)"
}
base_env && { printf '   \n\n\t\n' > "$DIR/0002_blank.sql"; run
  expect "HARD-F1e a whitespace-only migration file is rejected (exit nonzero, ledger unchanged)" bash -c '[[ $1 -ne 0 && "$2" == "1" ]]' _ "$RC" "$(ledger_seqs)"
}
base_env && { printf 'SELECT 1;\000SELECT 2;\n' > "$DIR/0002_nul.sql"; run
  expect "HARD-F1e a migration file with a NUL byte is rejected (exit nonzero, ledger unchanged)" bash -c '[[ $1 -ne 0 && "$2" == "1" ]]' _ "$RC" "$(ledger_seqs)"
}
base_env && { printf -- '-- only a comment, no statement\n' > "$DIR/0002_comment.sql"; run
  expect "HARD-F1e a comment-only migration is a valid no-op: exit 0 and recorded (documented behavior)" bash -c '[[ $1 -eq 0 && "$2" == "1,2" ]]' _ "$RC" "$(ledger_seqs)"
}
base_env && { write 0002_multi.sql 'CREATE SCHEMA prod2;
CREATE TABLE prod2.a (x int);
CREATE TABLE prod2.b AS SELECT 1 AS y;
INSERT INTO prod2.a SELECT y FROM prod2.b;
DO $d$ BEGIN PERFORM 1; END $d$;'
  run
  expect "HARD-F1f a multi-statement migration where later statements depend on earlier ones (schema, tables, DML, nested DO) runs as text inside the atomic context" bash -c '[[ $1 -eq 0 && "$2" == "1,2" && "$3" == 1 ]]' _ "$RC" "$(ledger_seqs)" "$(Q "$DB" "SELECT count(*) FROM prod2.a")"
}

echo; echo "== F2: o sucesso vem do estado confirmado no banco, não de marcadores impressos =="
base_env && { write 0002_pending.sql "$FIXED"
  cat > "$TMP/fakepsql.sh" <<'EOS'
#!/usr/bin/env bash
# Dublê de teste: simula um psql que imprime os marcadores do runner e sai com 0 sem ter confirmado nada no banco.
for a in "$@"; do [[ "$a" == */run.psql ]] && FORGE=1; done
if [[ -n "${FORGE:-}" ]]; then
  echo "##server 16.0"; echo "current 0001_items.sql"; echo "applied 0002_pending.sql"; echo "##head 2 0000000000000000000000000000000000000000000000000000000000000000"; echo "##done"; exit 0
fi
exec "$REAL_PSQL" "$@"
EOS
  chmod +x "$TMP/fakepsql.sh"
  REAL_PSQL="$PGBIN/psql" PSQL_OVERRIDE="$TMP/fakepsql.sh" run
  expect "HARD-F2a markers and exit status 0 printed by the client are NOT enough: the runner verifies the ledger and fails (exit nonzero)" nonzero "$RC"
  expect "HARD-F2a and it does not report the forged migration as applied" lacks "$STDOUT" "applied 0002_pending.sql"
  expect "HARD-F2a the database state is untouched (ledger still 1)" eq "$(ledger_seqs)" "1"
  run
  expect "HARD-F2b the real run succeeds and the reported head equals the committed ledger head" bash -c '[[ $1 -eq 0 && "$2" == *"ledger head: 2:"* ]]' _ "$RC" "$STDOUT"
  expect "HARD-F2b the reported head equals the head read back from the database" eq "$(grep '^ledger head:' <<<"$STDOUT" | sed 's/^ledger head: //')" "$(Q "$DB" "SELECT seq || ':' || sha256 FROM plataforma_migrations.ledger ORDER BY seq DESC LIMIT 1")"
}

echo; echo "== F3: nenhuma migration aceita pode confirmar, desfazer ou alterar as fronteiras de transação do runner =="
for stmt in "COMMIT;" "END;" "ROLLBACK;" "ABORT;" "COMMIT AND CHAIN;" "COMMIT; BEGIN;" "SAVEPOINT s1;" "START TRANSACTION;" "BEGIN;" "PREPARE TRANSACTION 'x1';"; do
  base_env && { before="$(fp)"
    write 0002_tc.sql "CREATE TABLE prod.h3 (a int); $stmt"
    run
    expect "HARD-F3 inline '$stmt' after a statement: rejected (exit nonzero)" nonzero "$RC"
    expect "HARD-F3 inline '$stmt': the table the migration created did NOT persist, the ledger is unchanged and the catalog is identical" bash -c '[[ "$1" == t && "$2" == "1" && "$3" == "$4" ]]' _ "$(Q "$DB" "SELECT to_regclass('prod.h3') IS NULL")" "$(ledger_seqs)" "$(fp)" "$before"
  }
done
base_env && { before="$(fp)"
  write 0002_unsafe.sql 'ALTER TABLE prod.items DISABLE ROW LEVEL SECURITY; COMMIT;'
  run
  expect "HARD-F3 an unsafe change followed by an inline COMMIT is rejected and the unsafe change does NOT persist (RLS still enabled and forced)" bash -c '[[ $1 -ne 0 && "$2" == "$3" && "$4" == "t|t" ]]' _ "$RC" "$(fp)" "$before" "$(Q "$DB" "SELECT relrowsecurity::text || '|' || relforcerowsecurity::text FROM pg_class WHERE oid = 'prod.items'::regclass" | sed 's/true/t/g')"
}
base_env && { write 0002_proc.sql 'CREATE PROCEDURE prod.p_commit() LANGUAGE plpgsql AS $q$ BEGIN COMMIT; END $q$;
CALL prod.p_commit();'
  run
  expect "HARD-F3 a procedure that commits, called from the migration, is rejected and nothing persists" bash -c '[[ $1 -ne 0 && "$2" == "1" ]]' _ "$RC" "$(ledger_seqs)"
  expect "HARD-F3 (and the procedure it tried to create did not persist)" bash -c '[[ "$1" == t ]]' _ "$(Q "$DB" "SELECT to_regprocedure('prod.p_commit()') IS NULL")"
}
base_env && { write 0002_concurrently.sql 'CREATE INDEX CONCURRENTLY items_v ON prod.items (v);'
  run
  expect "HARD-F3 statements that cannot run in a transaction still fail closed (exit nonzero, nothing recorded, no index)" bash -c '[[ $1 -ne 0 && "$2" == "1" && "$3" == t ]]' _ "$RC" "$(ledger_seqs)" "$(Q "$DB" "SELECT to_regclass('prod.items_v') IS NULL")"
}

echo; echo "== F4: o estado de sessão deixado por uma migration não vaza para os comandos do runner nem para a próxima =="
base_env && {
  write 0002_state.sql 'SET search_path = pg_temp;
SET statement_timeout = 12345;
CREATE TEMP TABLE h4_temp (a int);'
  write 0003_probe.sql "CREATE TABLE prod.h4_probe AS SELECT current_setting('search_path') AS sp, current_setting('statement_timeout') AS st, (to_regclass('pg_temp.h4_temp') IS NOT NULL) AS temp_visible;"
  run
  expect "HARD-F4 a run with two migrations where the first leaves session settings and a temp table: exit 0, ledger 1,2,3" bash -c '[[ $1 -eq 0 && "$2" == "1,2,3" ]]' _ "$RC" "$(ledger_seqs)"
  expect "HARD-F4 the next migration does not inherit the previous migration's search_path" eq "$(Q "$DB" "SELECT sp FROM prod.h4_probe")" '"$user", public'
  expect "HARD-F4 the next migration does not inherit its statement_timeout" eq "$(Q "$DB" "SELECT st FROM prod.h4_probe")" "0"
  expect "HARD-F4 the next migration does not see the previous migration's temporary objects" eq "$(Q "$DB" "SELECT temp_visible FROM prod.h4_probe")" "f"
}

echo; echo "== F5: política de tenant em forma canônica (RLS configurado ≠ isolamento provado) =="
polcase() { # polcase NOME "SQL da 0002" esperado(accept|reject)
  base_env && { before="$(fp)"
    write 0002_pol.sql "$2"; run
    if [[ "$3" == reject ]]; then
      expect "HARD-F5 $1: rejected by the gate (exit 1, 'not ok - C8')" bash -c '[[ $1 -eq 1 && "$2" == *"not ok - C8"* ]]' _ "$RC" "$OUT"
      expect "HARD-F5 $1: nothing persisted (ledger 1, catalog identical)" bash -c '[[ "$1" == "1" && "$2" == "$3" ]]' _ "$(ledger_seqs)" "$(fp)" "$before"
    else
      expect "HARD-F5 $1: accepted (exit 0, ledger 1,2)" bash -c '[[ $1 -eq 0 && "$2" == "1,2" ]]' _ "$RC" "$(ledger_seqs)"
    fi
  }
}
POLHEAD='CREATE TABLE prod.pol (tenant_id uuid NOT NULL, v text);
ALTER TABLE prod.pol ENABLE ROW LEVEL SECURITY; ALTER TABLE prod.pol FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON prod.pol TO menlo_app;'
polcase "policy that only mentions tenant_id (IS NOT NULL)" "$POLHEAD
CREATE POLICY p ON prod.pol FOR ALL TO menlo_app USING (tenant_id IS NOT NULL) WITH CHECK (tenant_id IS NOT NULL);" reject
polcase "policy comparing tenant_id with itself" "$POLHEAD
CREATE POLICY p ON prod.pol FOR ALL TO menlo_app USING (tenant_id = tenant_id) WITH CHECK (tenant_id = tenant_id);" reject
polcase "policy widened with OR true" "$POLHEAD
CREATE POLICY p ON prod.pol FOR ALL TO menlo_app USING (true OR tenant_id = prod.current_tenant_id()) WITH CHECK (tenant_id = prod.current_tenant_id());" reject
polcase "canonical USING but open WITH CHECK" "$POLHEAD
CREATE POLICY p ON prod.pol FOR ALL TO menlo_app USING (tenant_id = prod.current_tenant_id()) WITH CHECK (true);" reject
polcase "canonical policy with an extra AND condition" "$POLHEAD
CREATE POLICY p ON prod.pol FOR ALL TO menlo_app USING (tenant_id = prod.current_tenant_id() AND v IS NOT NULL) WITH CHECK (tenant_id = prod.current_tenant_id());" reject
polcase "helper function replaced by a constant tenant" "CREATE OR REPLACE FUNCTION prod.current_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS \$q\$ SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid \$q\$;" reject
polcase "helper function turned SECURITY DEFINER" "CREATE OR REPLACE FUNCTION prod.current_tenant_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS \$q\$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid \$q\$;" reject
polcase "canonical inline policy (no helper function)" "$POLHEAD
CREATE POLICY p ON prod.pol FOR ALL TO menlo_app USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);" accept
polcase "canonical policy through the helper function, USING only" "$POLHEAD
CREATE POLICY p ON prod.pol FOR ALL TO menlo_app USING (tenant_id = prod.current_tenant_id());" accept
polcase "per-command canonical policies (SELECT and INSERT)" "$POLHEAD
CREATE POLICY ps ON prod.pol FOR SELECT TO menlo_app USING (tenant_id = prod.current_tenant_id());
CREATE POLICY pi ON prod.pol FOR INSERT TO menlo_app WITH CHECK (tenant_id = prod.current_tenant_id());" accept

echo; echo "== F6: caminhos de privilégio e objetos que o gate precisa enxergar =="
unsafe() { # unsafe NOME "SQL da 0002" "trecho esperado da linha not ok" ["--global-allow x"]
  base_env && { before="$(fp)"
    write 0002_x.sql "$2"; run ${4:+--global-allow "$4"}
    expect "HARD-F6 $1: rejected by the gate (exit 1)" bash -c '[[ $1 -eq 1 && "$2" == *"$3"* ]]' _ "$RC" "$OUT" "$3"
    expect "HARD-F6 $1: nothing persisted (ledger 1, catalog identical)" bash -c '[[ "$1" == "1" && "$2" == "$3" ]]' _ "$(ledger_seqs)" "$(fp)" "$before"
  }
}
unsafe "column-level SELECT grant on a table without RLS" 'CREATE TABLE prod.col (tenant_id uuid NOT NULL, secret text);
GRANT SELECT (secret) ON prod.col TO menlo_app;' "not ok - C8 prod.col"
unsafe "column-level UPDATE grant on an approved global table" 'CREATE TABLE prod.ref2 (k text);
GRANT SELECT ON prod.ref2 TO menlo_app;
GRANT UPDATE (k) ON prod.ref2 TO menlo_app;' "not ok - C8 prod.ref2: approved global/reference table is read-only" prod.ref2
unsafe "column-level REFERENCES grant on an approved global table" 'CREATE TABLE prod.ref3 (k text PRIMARY KEY);
GRANT SELECT ON prod.ref3 TO menlo_app;
GRANT REFERENCES (k) ON prod.ref3 TO menlo_app;' "not ok - C8 prod.ref3: approved global/reference table is read-only" prod.ref3
base_env && { Q "$DB" "CREATE FOREIGN DATA WRAPPER h_fdw; CREATE SERVER h_srv FOREIGN DATA WRAPPER h_fdw; GRANT USAGE ON FOREIGN SERVER h_srv TO $MIG" >/dev/null; before="$(fp)"
  write 0002_ft.sql 'CREATE FOREIGN TABLE prod.ft (tenant_id uuid, v text) SERVER h_srv;
GRANT SELECT ON prod.ft TO menlo_app;'
  run
  expect "HARD-F6 a foreign table reachable by the application (RLS does not apply to foreign tables): rejected (exit 1)" bash -c '[[ $1 -eq 1 && "$2" == *"not ok - C11"* ]]' _ "$RC" "$OUT"
  expect "HARD-F6 foreign table: nothing persisted" bash -c '[[ "$1" == "1" && "$2" == "$3" ]]' _ "$(ledger_seqs)" "$(fp)" "$before"
}
unsafe "a rule on a table reachable by the application" 'CREATE RULE r_noop AS ON INSERT TO prod.items DO ALSO NOTHING;' "not ok - C12"
unsafe "a SECURITY DEFINER trigger function on a table reachable by the application" 'CREATE FUNCTION prod.trg() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $q$ BEGIN RETURN NEW; END $q$;
REVOKE ALL ON FUNCTION prod.trg() FROM PUBLIC;
CREATE TRIGGER t_def BEFORE INSERT ON prod.items FOR EACH ROW EXECUTE FUNCTION prod.trg();' "not ok - C13"
base_env && { write 0002_trg.sql 'CREATE FUNCTION prod.trg_ok() RETURNS trigger LANGUAGE plpgsql AS $q$ BEGIN RETURN NEW; END $q$;
CREATE TRIGGER t_inv BEFORE INSERT ON prod.items FOR EACH ROW EXECUTE FUNCTION prod.trg_ok();'
  run
  expect "HARD-F6 a plain SECURITY INVOKER trigger on a tenant table is legitimate and accepted (the gate is not an indiscriminate scan)" bash -c '[[ $1 -eq 0 && "$2" == "1,2" ]]' _ "$RC" "$(ledger_seqs)"
}
base_env && { Q postgres "ALTER ROLE $APP SET app.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'" >/dev/null
  write 0002_ok.sql "$FIXED"; run
  expect "HARD-F6 a role-level setting that pre-selects a tenant context for the application role makes the gate refuse (exit 1, C14)" bash -c '[[ $1 -eq 1 && "$2" == *"not ok - C14"* ]]' _ "$RC" "$OUT"
  expect "HARD-F6 and nothing was applied" eq "$(ledger_seqs)" "1"
  Q postgres "ALTER ROLE $APP RESET app.tenant_id" >/dev/null
  Q "$DB" "ALTER DATABASE $DB SET app.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'" >/dev/null
  run
  expect "HARD-F6 the same through a database-level setting" bash -c '[[ $1 -eq 1 && "$2" == *"not ok - C14"* ]]' _ "$RC" "$OUT"
  Q "$DB" "ALTER DATABASE $DB RESET app.tenant_id" >/dev/null
  run
  expect "HARD-F6 once the settings are removed the run succeeds" bash -c '[[ $1 -eq 0 ]]' _ "$RC"
}

echo; echo "== F7: o bypass explícito do gate só vale num cluster descartável comprovado =="
MARKER="$TMP/.disposable-pg-marker"; MARKER_SAVED="$(cat "$MARKER")"
base_env && { write 0002_ok.sql "$FIXED"
  run_nogate
  expect "HARD-F7a --no-security-gate is accepted in the verified disposable cluster, with a warning (exit 0)" bash -c '[[ $1 -eq 0 && "$2" == *AVISO* ]]' _ "$RC" "$ERR"
  printf 'forged\n' > "$MARKER"
  write 0003_ok.sql 'ALTER TABLE prod.items ADD COLUMN extra text;'
  run_nogate
  expect "HARD-F7b a marker whose content does not match this server is refused (exit 2)" eq "$RC" 2
  expect "HARD-F7b and nothing was applied by the refused run" eq "$(ledger_seqs)" "1,2"
  printf 'plataforma-disposable-cluster v1 00000000000000000000000000000000\n' > "$MARKER"
  run_nogate
  expect "HARD-F7b' a well-formed marker whose nonce does NOT match the running server is refused (a file alone is not proof, exit 2)" eq "$RC" 2
  rm -f "$MARKER"
  run_nogate
  expect "HARD-F7c without a marker the bypass is refused (exit 2)" eq "$RC" 2
  printf '%s\n' "$MARKER_SAVED" > "$MARKER"
  run
  expect "HARD-F7d the NORMAL run (gate enabled) does not depend on the marker and still works" eq "$RC" 0
  printf 'forged\n' > "$MARKER"; run
  expect "HARD-F7d (with a forged marker the gate-enabled run is unaffected)" eq "$RC" 0
  printf '%s\n' "$MARKER_SAVED" > "$MARKER"
}

echo; echo "== F8: o bootstrap verifica o alvo antes de mudar o estado e não deixa estado parcial =="
newdbname() { N=$((N + 1)); echo "boot$N"; }
for forged in 'forged' 'plataforma-disposable-cluster v1 00000000000000000000000000000000'; do
  printf '%s\n' "$forged" > "$MARKER"
  d="$(newdbname)"
  o="$(bash "$BOOT" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --user rls_bootstrap --dbname "$d" 2>&1)"; rc=$?
  printf '%s\n' "$MARKER_SAVED" > "$MARKER"
  expect "HARD-F8a a marker with the wrong content or the wrong nonce ('${forged:0:30}...') is not proof of a disposable server: the bootstrap refuses (exit 2)" eq "$rc" 2
  expect "HARD-F8a and no database was created" eq "$(Q postgres "SELECT count(*) FROM pg_database WHERE datname = '$d'")" 0
done
cat > "$TMP/failpsql.sh" <<'EOS'
#!/usr/bin/env bash
# Dublê de teste: falha só ao executar o script gerado pelo runner (a etapa --init-ledger do bootstrap).
for a in "$@"; do [[ "$a" == */run.psql ]] && exit 1; done
exec "$REAL_PSQL" "$@"
EOS
chmod +x "$TMP/failpsql.sh"
d="$(newdbname)"
Q postgres "DROP ROLE IF EXISTS hard_adm; DROP ROLE IF EXISTS hard_mig; DROP ROLE IF EXISTS hard_app" >/dev/null 2>&1
o="$(REAL_PSQL="$PGBIN/psql" bash "$BOOT" --socket-dir "$TMP" --port "$PORT" --psql "$TMP/failpsql.sh" --user rls_bootstrap --dbname "$d" --admin-role hard_adm --migrator-role hard_mig --app-role hard_app 2>&1)"; rc=$?
expect "HARD-F8b a failure after the database was created makes the bootstrap exit nonzero" nonzero "$rc"
expect "HARD-F8b and the partially configured database is removed (no unsafe partial state)" eq "$(Q postgres "SELECT count(*) FROM pg_database WHERE datname = '$d'")" 0
expect "HARD-F8b and the roles created by THIS run are removed too" eq "$(Q postgres "SELECT count(*) FROM pg_roles WHERE rolname IN ('hard_adm','hard_mig','hard_app')")" 0
expect "HARD-F8b the output says what was cleaned up" has "$o" "limpeza"

echo
if [[ "$FAILS" -eq 0 ]]; then
  echo "HARDENING TESTS: PASSED ($CHECKS checks) on PostgreSQL $("${PSQL[@]}" -d postgres -c 'SHOW server_version')"
else
  echo "HARDENING TESTS: FAILED ($FAILS of $CHECKS checks failed)" >&2
  exit 1
fi
