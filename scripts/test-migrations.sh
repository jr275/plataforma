#!/usr/bin/env bash
# Testes do runner de migrations (scripts/db-migrate.sh) contra um PostgreSQL 16 DESCARTÁVEL.
# Separado do harness de RLS (scripts/test-rls.sh): aqui o que se testa é integridade do histórico,
# transacionalidade, falhas e concorrência. Não usa Docker/Neon/DATABASE_URL; apaga tudo ao sair.
# Código de saída: 0 = tudo certo; 1 = falha de teste; 2 = pré-requisito ausente/versão errada.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=lib/disposable-pg.sh
source "$ROOT/scripts/lib/disposable-pg.sh"
set +e # a partir daqui cada teste decide o que é falha

# O gate de segurança é coberto por scripts/test-gate.sh; aqui o runner roda com --no-security-gate explícito para
# isolar integridade do histórico, transações, lock e concorrência (as migrations de teste não são tabelas de produto).
RUNNER="$ROOT/scripts/db-migrate.sh"
OWNER=mig_test_exec   # executor das migrations (NÃO é dono do ledger)
ADMIN=mig_test_admin  # dono do ledger (administrador); também dono do banco de teste
FAILS=0; CHECKS=0
DB=""; DIR=""; OUT=""; RC=0; N=0

# --- infraestrutura de teste ---------------------------------------------------------------------
Q() { "${PSQL[@]}" -d "$1" -c "$2"; } # SQL como superusuário do cluster descartável (só para preparar/inspecionar)
# SHA-256 INDEPENDENTE do runner: o runner usa sha256sum ou shasum; aqui usa-se o openssl (outra implementação, outro
# código de saída a interpretar), presente no macOS e no Linux, para que um defeito comum à ferramenta do runner não passe
# despercebido. Pré-requisito explícito: openssl, conferido contra o vetor de teste da entrada vazia.
sha_indep() { # imprime o SHA-256 (64 hex minúsculos) do arquivo $1; se falhar, retorna 1 e NÃO imprime nada
  local out
  out="$(openssl dgst -sha256 "$1" 2>/dev/null)" || { echo "# sha_indep: o openssl falhou para '$1'" >&2; return 1; }
  out="${out##* }"
  [[ "$out" =~ ^[0-9a-f]{64}$ ]] || { echo "# sha_indep: saída do openssl não é um SHA-256 válido para '$1'" >&2; return 1; }
  printf '%s\n' "$out"
}
# eq_sha ESPERADO CALCULADO: os DOIS precisam ser SHA-256 válidos (64 hex) e iguais; vazio ou malformado nunca casa,
# nem quando os dois lados vêm vazios (a substituição de comando descarta o status de sha_indep, então a validação é aqui).
eq_sha() { [[ "$1" =~ ^[0-9a-f]{64}$ && "$2" =~ ^[0-9a-f]{64}$ && "$1" == "$2" ]]; }
[[ "$(printf '' | openssl dgst -sha256 2>/dev/null | awk '{print $NF}')" == e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 ]] || {
  echo "PRE-REQUISITO AUSENTE: openssl (usado para o SHA-256 independente dos testes MIG-N2 e MIG-L10). Instale o openssl (macOS: já vem no sistema; Ubuntu: apt install openssl)." >&2
  exit 2
}

expect() { # $1 = nome; demais = comando (ou função) que deve retornar 0
  local name="$1"; shift
  CHECKS=$((CHECKS + 1))
  if "$@" >/dev/null 2>&1; then echo "ok - $name"; else echo "not ok - $name"; FAILS=$((FAILS + 1)); fi
}
eq()      { [[ "$1" == "$2" ]]; }
has()     { [[ "$1" == *"$2"* ]]; }
nonzero() { [[ "$1" -ne 0 ]]; }
# failed_with RC OUT trecho...: falhou (RC != 0) e a saída contém todos os trechos
failed_with() { local rc="$1" out="$2" n; shift 2; [[ "$rc" -ne 0 ]] || return 1
  for n in "$@"; do [[ "$out" == *"$n"* ]] || return 1; done; }
# succeeded_with RC OUT trecho...: RC == 0 e a saída contém todos os trechos
succeeded_with() { local rc="$1" out="$2" n; shift 2; [[ "$rc" -eq 0 ]] || return 1
  for n in "$@"; do [[ "$out" == *"$n"* ]] || return 1; done; }
count_prefix() { local c; c="$(grep -c "^$2 " <<<"$1")"; echo "$c"; }

setup() { # setup [noinit]: cria um banco e um diretório descartáveis; define $DB e $DIR; inicializa o ledger como administrador
  # Apaga o banco do teste anterior (só um banco de teste existe por vez: o disco do cluster é pequeno).
  [[ -z "$DB" ]] || "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1
  N=$((N + 1)); DB="mt$N"; DIR="$TMP/mig/$N"
  "${PSQL[@]}" -d postgres -c "CREATE DATABASE $DB OWNER $ADMIN TEMPLATE template0" >/dev/null
  "${PSQL[@]}" -d "$DB" -c "GRANT CREATE ON SCHEMA public TO $OWNER" >/dev/null
  "${PSQL[@]}" -d postgres -c "GRANT CONNECT ON DATABASE $DB TO $OWNER" >/dev/null
  rm -rf "$DIR"; mkdir -p "$DIR"
  [[ "${1:-}" == "noinit" ]] || init_ledger >/dev/null 2>&1
}
init_ledger() { # como administrador (dono do ledger)
  bash "$RUNNER" --init-ledger --executor "$OWNER" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$ADMIN" "$@" 2>&1
}
run() { # run [opções extras]; usa $DB e $DIR; saída combinada em $OUT e código em $RC
  OUT="$(bash "$RUNNER" --no-security-gate --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$OWNER" --migrations-dir "$DIR" "$@" 2>&1)"
  RC=$?
}
run_bg() { # run_bg PREFIXO [opções]: roda em segundo plano gravando $TMP/PREFIXO.out e .rc
  local p="$1"; shift
  ( bash "$RUNNER" --no-security-gate --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$OWNER" --migrations-dir "$DIR" "$@" >"$TMP/$p.out" 2>&1; echo $? >"$TMP/$p.rc" ) &
}
ledger_count() { Q "$DB" "SELECT count(*) FROM plataforma_migrations.ledger"; }
ledger_seqs()  { Q "$DB" "SELECT coalesce(string_agg(seq::text, ',' ORDER BY seq), '') FROM plataforma_migrations.ledger"; }
tbl_absent()   { [[ "$(Q "$DB" "SELECT to_regclass('public.$1') IS NULL")" == "t" ]]; }
tbl_present()  { [[ "$(Q "$DB" "SELECT to_regclass('public.$1') IS NOT NULL")" == "t" ]]; }
ns_absent()    { [[ "$(Q "$DB" "SELECT to_regnamespace('plataforma_migrations') IS NULL")" == "t" ]]; }
fingerprint()  { Q "$DB" "SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
    SELECT 'T:' || schemaname || '.' || tablename AS x FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')
    UNION ALL SELECT 'L:' || seq || filename || sha256 || applied_at::text FROM plataforma_migrations.ledger) s"; }
advisory_locks() { Q postgres "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND granted"; }
run_locks()    { Q "$DB" "SELECT count(*) FROM pg_locks WHERE locktype='relation' AND relation='plataforma_migrations.run_lock'::regclass AND granted"; }
wait_for_lock() { local i; for i in $(seq 1 200); do [[ "$(run_locks)" -ge 1 ]] && return 0; sleep 0.1; done; return 1; }
QS() { "${PSQL[@]}" -d "$1" -c "$2" 2>&1; }                  # como superusuário do cluster, capturando mensagens de erro
QAD() { "${PSQL[@]}" -U "$ADMIN" -d "$DB" -c "$1" 2>&1; }      # como administrador (dono do ledger)
QE() { "${PSQL[@]}" -U "$OWNER" -d "$DB" -c "$1" 2>&1; }       # como executor
QAPP() { "${PSQL[@]}" -U menlo_app -d "$DB" -c "$1" 2>&1; }    # como menlo_app
nothing_applied() { [[ "$(ledger_count)" -eq 0 ]]; }
write() { printf '%b' "$2" > "$DIR/$1"; } # write ARQUIVO CONTEÚDO (com \n interpretado)

echo "== Preparação do cluster descartável =="
"${PSQL[@]}" -d postgres -v ON_ERROR_STOP=1 -f "$ROOT/db/test-fixtures/rls/00_roles.sql" >/dev/null
"${PSQL[@]}" -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE $OWNER LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE" >/dev/null
"${PSQL[@]}" -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE $ADMIN LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE" >/dev/null
mkdir -p "$TMP/mig"

# ================================================================================================
echo; echo "== Execução normal =="
setup
run
expect "MIG-N1 empty directory: runner exits 0" eq "$RC" 0
expect "MIG-N1 only the migration metadata tables exist (ledger and run_lock; no product tables)" \
  eq "$(Q "$DB" "SELECT string_agg(schemaname||'.'||tablename, ',' ORDER BY 1) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")" "plataforma_migrations.ledger,plataforma_migrations.run_lock"
expect "MIG-N1 ledger starts empty" eq "$(ledger_count)" 0
run
expect "MIG-N1 an empty directory is a valid state on a second run" eq "$RC" 0
echo '# notas' > "$DIR/README.md"
run
expect "MIG-N1 README.md in the directory is ignored" eq "$RC" 0

setup
write 0001_create_one.sql 'CREATE TABLE mt_one (id int PRIMARY KEY);\nINSERT INTO mt_one VALUES (1);\n'
run
expect "MIG-N2 one valid migration: exit 0" eq "$RC" 0
expect "MIG-N2 reports it as applied" has "$OUT" "applied 0001_create_one.sql"
expect "MIG-N2 schema change happened" tbl_present mt_one
expect "MIG-N2 ledger has exactly one row" eq "$(ledger_count)" 1
expect "MIG-N2 ledger sha256 equals an independently computed SHA-256 of the file bytes" \
  eq_sha "$(Q "$DB" "SELECT sha256 FROM plataforma_migrations.ledger WHERE seq = 1")" "$(sha_indep "$DIR/0001_create_one.sql")"
expect "MIG-N2 ledger records filename, applied_at and applied_by" \
  eq "$(Q "$DB" "SELECT filename||'|'||(applied_at IS NOT NULL)||'|'||applied_by FROM plataforma_migrations.ledger")" "0001_create_one.sql|true|$OWNER"
expect "MIG-N2 the application role (menlo_app) has no privilege on the ledger" \
  eq "$(Q "$DB" "SELECT has_schema_privilege('menlo_app','plataforma_migrations','USAGE') OR has_table_privilege('menlo_app','plataforma_migrations.ledger','SELECT')")" "f"

setup
write 0001_start.sql 'CREATE TABLE mt_order (id serial PRIMARY KEY, n int);\nINSERT INTO mt_order (n) VALUES (1);\n'
for i in 12 11 10 9 8 7 6 5 4 3 2; do # criados em ordem decrescente de propósito
  write "$(printf '%04d' "$i")_step.sql" "INSERT INTO mt_order (n) VALUES ($i);\n"
done
run
expect "MIG-N3 12 migrations created out of order: exit 0" eq "$RC" 0
expect "MIG-N3 applied in numeric order" eq "$(Q "$DB" "SELECT string_agg(n::text, ',' ORDER BY id) FROM mt_order")" "1,2,3,4,5,6,7,8,9,10,11,12"
expect "MIG-N3 ledger holds 1..12 in order of application time" \
  eq "$(Q "$DB" "SELECT string_agg(seq::text, ',' ORDER BY applied_at, seq) FROM plataforma_migrations.ledger")" "1,2,3,4,5,6,7,8,9,10,11,12"
before="$(fingerprint)"
run
expect "MIG-N4 second run: exit 0" eq "$RC" 0
expect "MIG-N4 second run: all 12 reported as current" eq "$(count_prefix "$OUT" current)" 12
expect "MIG-N4 second run: none applied again" eq "$(count_prefix "$OUT" applied)" 0
expect "MIG-N4 second run changes no schema object and no ledger entry (matching checksums are skipped)" eq "$(fingerprint)" "$before"

# ================================================================================================
echo; echo "== Violações de integridade =="
# Nome inválido, duplicata e lacuna são rejeitados antes de qualquer conexão: o banco fica intocado.
for bn in "1_x.sql" "0001-x.sql" "0001_X.sql" "0001_x.SQL" "0001_.sql" "abc.sql" "0000_x.sql" "00001_x.sql" "0001_x.sql.bak" "notes.txt" "0001 x.sql"; do
  setup
  write 0001_ok.sql 'SELECT 1;\n'; write "$bn" 'SELECT 1;\n'
  run
  expect "MIG-I1 invalid file name rejected (exit nonzero): '$bn'" nonzero "$RC"
  expect "MIG-I1 '$bn': nothing was applied (ledger still empty)" nothing_applied
done
setup; mkdir "$DIR/0001_sub"; write 0002_ok.sql 'SELECT 1;\n'
run; expect "MIG-I1 a sub-directory in the migrations directory is rejected" nonzero "$RC"
setup; write 0001_ok.sql 'SELECT 1;\n'; ln -s "$DIR/0001_ok.sql" "$DIR/0002_link.sql"
run; expect "MIG-I1 a symbolic link is rejected" nonzero "$RC"

setup; write 0001_a.sql 'SELECT 1;\n'; write 0001_b.sql 'SELECT 2;\n'
run
expect "MIG-I2 duplicate sequence number rejected, both files named" failed_with "$RC" "$OUT" "duplicado" "0001_a.sql" "0001_b.sql"
expect "MIG-I2 nothing was applied (ledger still empty)" nothing_applied

setup; write 0001_a.sql 'SELECT 1;\n'; write 0003_c.sql 'SELECT 3;\n'
run; expect "MIG-I3 numbering gap (0001, 0003) rejected" failed_with "$RC" "$OUT" "lacuna"
setup; write 0002_b.sql 'SELECT 1;\n'
run; expect "MIG-I3 a sequence that does not start at 0001 is rejected" failed_with "$RC" "$OUT" "lacuna"
expect "MIG-I3 nothing was applied (ledger still empty)" nothing_applied

setup
write 0001_a.sql 'CREATE TABLE mt_i4a (id int);\n'; write 0002_b.sql 'CREATE TABLE mt_i4b (id int);\n'
run; expect "MIG-I4 setup: two migrations applied" eq "$RC" 0
write 0001_a.sql 'CREATE TABLE mt_i4a (id int); \n' # um espaço a mais: o checksum não normaliza nada
write 0003_c.sql 'CREATE TABLE mt_i4c (id int);\n'
before="$(fingerprint)"
run
expect "MIG-I4 whitespace-only edit of an applied migration is detected (names the file)" failed_with "$RC" "$OUT" "0001_a.sql" "editada"
expect "MIG-I4 the pending migration after it was not applied" tbl_absent mt_i4c
expect "MIG-I4 schema and ledger unchanged by the failed run" eq "$(fingerprint)" "$before"

setup
write 0001_a.sql 'CREATE TABLE mt_i5a (id int);\n'; write 0002_b.sql 'CREATE TABLE mt_i5b (id int);\n'
run; rm "$DIR/0002_b.sql"; run
expect "MIG-I5 applied migration missing from the directory is detected (names it)" failed_with "$RC" "$OUT" "0002_b.sql" "ausente"
expect "MIG-I5 the ledger still has both rows (nothing altered)" eq "$(ledger_count)" 2

setup
write 0001_a.sql 'CREATE TABLE mt_i6a (id int);\n'; write 0002_b.sql 'CREATE TABLE mt_i6b (id int);\n'
run; mv "$DIR/0002_b.sql" "$DIR/0002_renamed.sql"; run
expect "MIG-I6 applied migration renamed (same content) is detected" failed_with "$RC" "$OUT" "0002_b.sql" "renomeada"
mv "$DIR/0002_renamed.sql" "$DIR/0003_b.sql"; run
expect "MIG-I6 applied migration renumbered (0002 -> 0003) is rejected" nonzero "$RC"
rm "$DIR/0003_b.sql"; write 0002_other.sql 'CREATE TABLE mt_i6other (id int);\n'; run
expect "MIG-I6 applied migration replaced by a different file with the same number is detected" failed_with "$RC" "$OUT" "0002_b.sql"
expect "MIG-I6 the replacement was never applied" tbl_absent mt_i6other

setup; write 0001_a.sql 'CREATE TABLE mt_i7a (id int);\n'; write 0002_b.sql 'CREATE TABLE mt_i7b (id int);\n'
run; Q "$DB" "SET session_replication_role = replica; DELETE FROM plataforma_migrations.ledger WHERE seq = 1" >/dev/null; run
expect "MIG-I7 corrupt ledger (gap in the applied sequence) fails closed" failed_with "$RC" "$OUT" "ledger inconsistente"
setup; write 0001_a.sql 'CREATE TABLE mt_i7c (id int);\n'
run; Q "$DB" "INSERT INTO plataforma_migrations.ledger (seq, filename, sha256) VALUES (2, '0002_ghost.sql', repeat('a', 64))" >/dev/null; run
expect "MIG-I7 ledger entry with no file (ghost migration) fails closed" failed_with "$RC" "$OUT" "0002_ghost.sql"
setup; write 0001_a.sql 'CREATE TABLE mt_i7d (id int);\n'
run; Q "$DB" "ALTER TABLE plataforma_migrations.ledger DROP COLUMN applied_by" >/dev/null; run
expect "MIG-I7 ledger with a different structure fails closed" failed_with "$RC" "$OUT" "estrutura inesperada"
setup; write 0001_a.sql 'SELECT 1;\n'
run
Q "$DB" "INSERT INTO plataforma_migrations.ledger (seq, filename, sha256) VALUES (9, '0009_x.sql', 'nothex')" >/dev/null 2>&1; rc=$?
expect "MIG-I7 the database itself rejects a malformed checksum in the ledger" nonzero "$rc"

setup; write 0001_ok.sql 'CREATE TABLE mt_i8a (id int);\n'; write 0002_syntax.sql 'CREATE TABEL mt_i8b (id int);\n'
run
expect "MIG-I8 SQL syntax error: exit nonzero" nonzero "$RC"
expect "MIG-I8 the failure names the migration and the stage" failed_with "$RC" "$OUT" "0002_syntax.sql" "aplicação"
expect "MIG-I8 the earlier migration stays applied; the failed one is not in the ledger" eq "$(ledger_seqs)" "1"

setup; write 0001_a.sql 'SELECT 1;\n'
OUT="$(bash "$RUNNER" --no-security-gate --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname no_such_db_here --user "$OWNER" --migrations-dir "$DIR" 2>&1)"; RC=$?
expect "MIG-I9 nonexistent database: exit 4 (connection failure), no false success" eq "$RC" 4
expect "MIG-I9 nonexistent database: reported as a connection failure" has "$OUT" "conexão"
OUT="$(bash "$RUNNER" --no-security-gate --socket-dir "$TMP" --port 1 --psql "$PGBIN/psql" --dbname "$DB" --user "$OWNER" --migrations-dir "$DIR" 2>&1)"; RC=$?
expect "MIG-I9 wrong port (server unreachable): exit 4" eq "$RC" 4
OUT="$(bash "$RUNNER" --no-security-gate --socket-dir "$TMP/nope" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$OWNER" --migrations-dir "$DIR" 2>&1)"; RC=$?
expect "MIG-I9 nonexistent socket directory: exit 2 (usage error)" eq "$RC" 2
OUT="$(bash "$RUNNER" --no-security-gate --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user no_such_role --migrations-dir "$DIR" 2>&1)"; RC=$?
expect "MIG-I9 nonexistent role: nonzero exit" nonzero "$RC"
expect "MIG-I9 no connection string or password appears in the message" bash -c '[[ "$1" != *postgres://* && "$1" != *password=* ]]' _ "$OUT"

# ================================================================================================
echo; echo "== Transacionalidade e recuperação =="
setup; write 0001_partial.sql 'CREATE TABLE mt_t1 (a int);\nINSERT INTO mt_t1 VALUES (1);\nSELECT 1/0;\n'
run
expect "MIG-T1 failure after earlier statements: exit nonzero" nonzero "$RC"
expect "MIG-T1 no partial schema change (table rolled back)" tbl_absent mt_t1
expect "MIG-T1 no ledger entry" eq "$(ledger_count)" 0

setup; write 0001_t2.sql 'CREATE TABLE mt_t2 (a int);\n'
run
expect "MIG-T2 ledger row and schema change were written by the same transaction (same xmin)" \
  eq "$(Q "$DB" "SELECT (SELECT xmin::text FROM pg_class WHERE oid = 'public.mt_t2'::regclass) = (SELECT xmin::text FROM plataforma_migrations.ledger WHERE seq = 1)")" "t"

setup
write 0001_ok.sql 'CREATE TABLE mt_t3a (a int);\n'
write 0002_boom.sql 'CREATE TABLE mt_t3b (a int);\nSELECT 1/0;\n'
write 0003_later.sql 'CREATE TABLE mt_t3c (a int);\n'
run
expect "MIG-T3 a failing migration in the middle: exit nonzero" nonzero "$RC"
expect "MIG-T3 the failed migration left no partial table" tbl_absent mt_t3b
expect "MIG-T3 the runner did not advance to the migration after the failure" tbl_absent mt_t3c
expect "MIG-T3 ledger contains only the migration applied before the failure" eq "$(ledger_seqs)" "1"
write 0002_boom.sql 'CREATE TABLE mt_t3b (a int);\n' # a migration que falhou nunca foi aplicada, então pode ser corrigida
run
expect "MIG-T4 after fixing the failed (never applied) migration, the rerun succeeds" eq "$RC" 0
expect "MIG-T4 the first migration is current; the other two are applied" succeeded_with "$RC" "$OUT" "current 0001_ok.sql" "applied 0002_boom.sql" "applied 0003_later.sql"
expect "MIG-T4 ledger holds 1,2,3" eq "$(ledger_seqs)" "1,2,3"

setup; write 0001_commit.sql 'CREATE TABLE mt_t5 (a int);\nCOMMIT;\n'
run
expect "MIG-T5 COMMIT at line start is rejected before any connection" failed_with "$RC" "$OUT" "controle de transação"
expect "MIG-T5 nothing was applied (ledger still empty, table absent)" nothing_applied
setup; write 0001_inline.sql 'CREATE TABLE mt_t5b (a int); COMMIT;\n'
run
expect "MIG-T5 a hidden COMMIT (on the same line as other SQL) is rejected (exit nonzero): migrations run inside an atomic context where PostgreSQL refuses transaction control" nonzero "$RC"
expect "MIG-T5 and nothing persisted: the table created before the hidden COMMIT was rolled back (the earlier 'known limitation' no longer exists)" tbl_absent mt_t5b
expect "MIG-T5 and the migration has no ledger entry" eq "$(ledger_count)" 0

setup; canary="$TMP/pwned.$N"
write 0001_meta.sql "SELECT 1;\n\\\\! touch $canary\n"
run
expect "MIG-T6 a psql meta-command (shell escape) in a migration is rejected" nonzero "$RC"
expect "MIG-T6 the shell command never ran" bash -c '[[ ! -e "$1" ]]' _ "$canary"

setup; write 0001_concurrently.sql 'CREATE TABLE mt_t7 (a int);\nCREATE INDEX CONCURRENTLY mt_t7_a ON mt_t7 (a);\n'
run
expect "MIG-T7 CREATE INDEX CONCURRENTLY (cannot run in a transaction) fails: no silent non-transactional fallback" nonzero "$RC"
expect "MIG-T7 the table was rolled back" tbl_absent mt_t7
expect "MIG-T7 no ledger entry" eq "$(ledger_count)" 0

setup; write 0001_killme.sql 'CREATE TABLE mt_t8 (a int);\nSELECT pg_terminate_backend(pg_backend_pid());\n'
run
expect "MIG-T8 connection lost in the middle of a migration: exit nonzero" nonzero "$RC"
expect "MIG-T8 nothing partial: no table" tbl_absent mt_t8
expect "MIG-T8 nothing partial: no ledger entry" eq "$(ledger_count)" 0
expect "MIG-T8 the migration lock was released together with the lost connection (no lock on run_lock)" eq "$(run_locks)" 0
expect "MIG-T8 no advisory lock exists either (the runner does not use advisory locks)" eq "$(advisory_locks)" 0
write 0001_killme.sql 'CREATE TABLE mt_t8 (a int);\n'
run
expect "MIG-T8 the rerun after the failure succeeds" eq "$RC" 0

# ================================================================================================
echo; echo "== Concorrência =="
setup; write 0001_c1.sql 'CREATE TABLE mt_c1 (a int);\nSELECT pg_sleep(1);\n'
rm -f "$TMP"/c1a.* "$TMP"/c1b.*
run_bg c1a; run_bg c1b
wait
expect "MIG-C1 two simultaneous runners: both exit 0" bash -c '[[ $(cat "$1/c1a.rc") -eq 0 && $(cat "$1/c1b.rc") -eq 0 ]]' _ "$TMP"
APPL="$(cat "$TMP/c1a.out" "$TMP/c1b.out" | grep -c '^applied ')"; CURR="$(cat "$TMP/c1a.out" "$TMP/c1b.out" | grep -c '^current ')"
expect "MIG-C1 the migration was applied exactly once across both runners" eq "$APPL" 1
expect "MIG-C1 the other runner saw it as current" eq "$CURR" 1
expect "MIG-C1 the ledger has one row and the table exists" eq "$(ledger_count)" 1
expect "MIG-C1 no lock left behind on run_lock" eq "$(run_locks)" 0
expect "MIG-C1 no advisory lock used or left behind" eq "$(advisory_locks)" 0

setup; write 0001_c2.sql 'CREATE TABLE mt_c2 (a int);\nSELECT pg_sleep(3);\n'
rm -f "$TMP"/c2a.*
run_bg c2a
if wait_for_lock; then
  expect "MIG-C2 runner A holds the advisory lock while its migration runs" eq 1 1
  run
  wait
  expect "MIG-C2 runner B waited for A (default policy: wait up to 30s) and exits 0" succeeded_with "$RC" "$OUT" "current 0001_c2.sql"
  expect "MIG-C2 runner A applied it and exited 0" succeeded_with "$(cat "$TMP/c2a.rc")" "$(cat "$TMP/c2a.out")" "applied 0001_c2.sql"
  expect "MIG-C2 final ledger has a single row" eq "$(ledger_count)" 1
else
  wait; expect "MIG-C2 runner A holds the advisory lock while its migration runs" eq "lock-seen" "no-lock-seen"
fi

setup; write 0001_c3.sql 'CREATE TABLE mt_c3 (a int);\nSELECT pg_sleep(4);\n'
rm -f "$TMP"/c3a.*
run_bg c3a
if wait_for_lock; then
  run --lock-timeout 1s
  wait
  expect "MIG-C3 runner B with --lock-timeout 1s fails with exit 3 (documented lock-timeout policy)" eq "$RC" 3
  expect "MIG-C3 the message says the lock could not be obtained" has "$OUT" "lock de migrations"
  expect "MIG-C3 runner A still succeeded" eq "$(cat "$TMP/c3a.rc")" 0
  expect "MIG-C3 ledger and schema consistent: one row, applied once" eq "$(ledger_count)" 1
else
  wait; expect "MIG-C3 runner A holds the advisory lock while its migration runs" eq "lock-seen" "no-lock-seen"
fi

# ================================================================================================
echo; echo "== Integridade do ledger: dono separado do executor, append-only, cabeça esperada =="
LD=plataforma_migrations
setup
expect "MIG-L1 the ledger schema and table are owned by the administrator, not by the executor" \
  eq "$(Q "$DB" "SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = '$LD.ledger'::regclass")|$(Q "$DB" "SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = '$LD'")" "$ADMIN|$ADMIN"
expect "MIG-L1 the executor holds exactly SELECT and INSERT on the ledger (no UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER)" \
  eq "$(Q "$DB" "SELECT concat(has_table_privilege('$OWNER','$LD.ledger','SELECT'), has_table_privilege('$OWNER','$LD.ledger','INSERT'), has_table_privilege('$OWNER','$LD.ledger','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))")" "ttf"
expect "MIG-L1 the executor holds only UPDATE on run_lock (what LOCK TABLE needs), not SELECT or INSERT" \
  eq "$(Q "$DB" "SELECT concat(has_table_privilege('$OWNER','$LD.run_lock','UPDATE'), has_table_privilege('$OWNER','$LD.run_lock','SELECT,INSERT,DELETE,TRUNCATE'))")" "tf"
expect "MIG-L1 the application role has no privilege on the migration schema, the ledger or run_lock" \
  eq "$(Q "$DB" "SELECT concat(has_schema_privilege('menlo_app','$LD','USAGE,CREATE'), has_table_privilege('menlo_app','$LD.ledger','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), has_table_privilege('menlo_app','$LD.run_lock','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))")" "fff"
expect "MIG-L1 PUBLIC has no privilege on the ledger objects" \
  eq "$(Q "$DB" "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = '$LD' AND grantee = 'PUBLIC'")" 0
expect "MIG-L1 run_lock is empty and can never hold a row" eq "$(Q "$DB" "SELECT count(*) FROM $LD.run_lock")" 0
setup noinit; write 0001_a.sql 'CREATE TABLE mt_l2 (a int);\n'
run
expect "MIG-L2 without an initialized ledger the executor does NOT create one (fails closed, exit 1)" failed_with "$RC" "$OUT" "ledger ausente" "--init-ledger"
expect "MIG-L2 nothing was created: no ledger schema, no product table" bash -c '[[ "$1" == t ]]' _ "$(Q "$DB" "SELECT to_regnamespace('$LD') IS NULL AND to_regclass('public.mt_l2') IS NULL")"

setup
write 0001_a.sql 'CREATE TABLE mt_l3 (a int);\n'; run
expect "MIG-L3 setup: one migration applied by the executor" eq "$RC" 0
for stmt in "DELETE FROM $LD.ledger" "UPDATE $LD.ledger SET sha256 = repeat('b', 64)" "TRUNCATE $LD.ledger" "INSERT INTO $LD.run_lock VALUES (1)" "DROP TABLE $LD.ledger" "ALTER TABLE $LD.ledger DISABLE TRIGGER ALL" "DROP SCHEMA $LD CASCADE" "ALTER TABLE $LD.ledger OWNER TO $OWNER" "GRANT DELETE ON $LD.ledger TO $OWNER"; do
  r="$(QE "$stmt")"
  expect "MIG-L3 the executor cannot rewrite or remove migration history: $stmt" bash -c '[[ "$1" == *ERROR* || "$1" == *"no privileges were granted"* ]]' _ "$r"
done
expect "MIG-L3 the executor still lacks DELETE after trying to grant it to itself" eq "$(Q "$DB" "SELECT has_table_privilege('$OWNER','$LD.ledger','DELETE')")" "f"
expect "MIG-L3 the ledger is unchanged after all those attempts" eq "$(ledger_seqs)" "1"
expect "MIG-L4 append-only trigger: even the ledger OWNER cannot DELETE (defense in depth)" has "$(QAD "DELETE FROM $LD.ledger")" "append-only"
expect "MIG-L4 append-only trigger: even a superuser cannot UPDATE (privileges are bypassed, triggers are not)" has "$(QS "$DB" "UPDATE $LD.ledger SET sha256 = repeat('b', 64)")" "append-only"
expect "MIG-L4 append-only trigger: even a superuser cannot TRUNCATE" has "$(QS "$DB" "TRUNCATE $LD.ledger")" "append-only"
expect "MIG-L4 the ledger is still intact" eq "$(ledger_seqs)" "1"

# Achado 1 (Fase 5): apagar a última entrada do ledger fazia o runner reaplicar a migration e duplicar dados.
setup
write 0001_t.sql 'CREATE TABLE mt_audit (a int);\n'; write 0002_ins.sql 'INSERT INTO mt_audit VALUES (1);\n'
run; expect "MIG-L5 setup: two migrations applied" eq "$RC" 0
r="$(QE "DELETE FROM $LD.ledger WHERE seq = 2")"
expect "MIG-L5 (finding 1) the executor can no longer delete the latest ledger entry" has "$r" "permission denied"
run
expect "MIG-L5 (finding 1) the rerun finds both migrations current: nothing reapplied" eq "$(count_prefix "$OUT" current)" 2
expect "MIG-L5 (finding 1) no duplicated data" eq "$(Q "$DB" "SELECT count(*) FROM mt_audit")" 1

# Limitação documentada: um dono privilegiado que contorna o gatilho ainda consegue apagar a última entrada.
HEAD_LINE="$(grep '^ledger head:' <<<"$OUT")"; HEAD="${HEAD_LINE#ledger head: }"
expect "MIG-L10 the runner prints the ledger head as N:SHA256 (independent integrity evidence for the operator)" bash -c '[[ "$1" =~ ^2:[0-9a-f]{64}$ ]]' _ "$HEAD"
expect "MIG-L10 the printed head equals the checksum of the last migration file" eq_sha "${HEAD#2:}" "$(sha_indep "$DIR/0002_ins.sql")"
run --expect-head "$HEAD"
expect "MIG-L9 --expect-head with the true head: succeeds" eq "$RC" 0
Q "$DB" "SET session_replication_role = replica; DELETE FROM $LD.ledger WHERE seq = 2" >/dev/null
run --expect-head "$HEAD"
expect "MIG-L6 --expect-head detects a deleted latest entry (exit nonzero, says the head differs)" failed_with "$RC" "$OUT" "cabeça do ledger"
expect "MIG-L6 and nothing was reapplied" eq "$(Q "$DB" "SELECT count(*) FROM mt_audit")" 1
run --expect-head "2"
expect "MIG-L6 --expect-head with only the sequence number also detects it" failed_with "$RC" "$OUT" "cabeça do ledger"
run
expect "MIG-L6 LIMITATION (documented): WITHOUT --expect-head, a privileged owner that bypasses the trigger and deletes the latest entry is NOT detected and the migration is reapplied" \
  bash -c '[[ $1 -eq 0 && "$2" == *"applied 0002_ins.sql"* ]]' _ "$RC" "$OUT"
run --expect-head 9:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
expect "MIG-L9 --expect-head with a wrong head fails (exit nonzero)" nonzero "$RC"
run --expect-head "xyz"
expect "MIG-L9 --expect-head with an invalid value is a usage error (exit 2)" eq "$RC" 2
setup; write 0001_a.sql 'SELECT 1;\n'; run --expect-head 0
expect "MIG-L9 --expect-head 0 on an empty ledger passes the check, then applies" succeeded_with "$RC" "$OUT" "applied 0001_a.sql"

# O executor é recusado quando a separação de papéis foi violada.
refuse() { # refuse NOME "SQL de sabotagem (superusuário)" "trecho esperado" "SQL de restauração"
  setup; write 0001_a.sql 'CREATE TABLE mt_refuse (a int);\n'
  Q "$DB" "$2" >/dev/null 2>&1
  run
  expect "MIG-L7 the runner refuses to run when $1" failed_with "$RC" "$OUT" "$3"
  expect "MIG-L7 ($1) and applied nothing" tbl_absent mt_refuse
  [[ -z "$4" ]] || Q postgres "$4" >/dev/null 2>&1
}
refuse "the executor owns the ledger" "ALTER TABLE $LD.ledger OWNER TO $OWNER" "dono ou membro do dono" ""
refuse "the executor is a member of the ledger owner" "GRANT $ADMIN TO $OWNER" "dono ou membro do dono" "REVOKE $ADMIN FROM $OWNER"
refuse "the executor holds UPDATE on the ledger" "GRANT UPDATE ON $LD.ledger TO $OWNER" "privilégio de alteração" ""
refuse "the executor holds DELETE on the ledger" "GRANT DELETE ON $LD.ledger TO $OWNER" "privilégio de alteração" ""
refuse "the executor holds TRUNCATE on the ledger" "GRANT TRUNCATE ON $LD.ledger TO $OWNER" "privilégio de alteração" ""
refuse "the executor is a superuser" "ALTER ROLE $OWNER SUPERUSER" "superusuário" "ALTER ROLE $OWNER NOSUPERUSER"
refuse "the executor has BYPASSRLS" "ALTER ROLE $OWNER BYPASSRLS" "BYPASSRLS" "ALTER ROLE $OWNER NOBYPASSRLS"
refuse "the append-only trigger is disabled" "ALTER TABLE $LD.ledger DISABLE TRIGGER ledger_no_truncate" "gatilhos append-only" ""
refuse "the append-only trigger is missing" "DROP TRIGGER ledger_no_update_delete ON $LD.ledger" "gatilhos append-only" ""
refuse "the executor lacks UPDATE on run_lock" "REVOKE UPDATE ON $LD.run_lock FROM $OWNER" "privilégios mínimos" ""
refuse "the executor lacks INSERT on the ledger" "REVOKE INSERT ON $LD.ledger FROM $OWNER" "privilégios mínimos" ""

setup
r="$(init_ledger)"; rc=$?
expect "MIG-L8 --init-ledger is idempotent (a second run succeeds)" eq "$rc" 0
Q "$DB" "REVOKE INSERT ON $LD.ledger FROM $OWNER" >/dev/null; init_ledger >/dev/null
expect "MIG-L8 --init-ledger re-asserts the executor's grants" eq "$(Q "$DB" "SELECT has_table_privilege('$OWNER','$LD.ledger','INSERT')")" "t"
r="$(init_ledger --user "$OWNER" 2>&1 | tail -1)"
setup noinit
OUT="$(bash "$RUNNER" --init-ledger --executor "$OWNER" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$OWNER" 2>&1)"; RC=$?
expect "MIG-L8 --init-ledger run by the executor itself is refused (executor cannot own the ledger)" nonzero "$RC"
expect "MIG-L8 and creates nothing" bash -c '[[ "$1" == t ]]' _ "$(Q "$DB" "SELECT to_regnamespace('$LD') IS NULL")"
OUT="$(bash "$RUNNER" --init-ledger --executor no_such_role --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$ADMIN" 2>&1)"; RC=$?
expect "MIG-L8 --init-ledger with a nonexistent executor role fails" failed_with "$RC" "$OUT" "não existe"
OUT="$(bash "$RUNNER" --init-ledger --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$ADMIN" 2>&1)"; RC=$?
expect "MIG-L8 --init-ledger without --executor is a usage error (exit 2)" eq "$RC" 2

# ================================================================================================
echo; echo "== Lock de migrations: a aplicação não consegue tomá-lo nem interferir (finding 2) =="
setup; write 0001_k1.sql 'CREATE TABLE mt_k1 (a int);\n'
OLDKEY="hashtextextended('plataforma_migrations', 0)"
( "${PSQL[@]}" -U menlo_app -d "$DB" -c "SELECT pg_advisory_lock($OLDKEY), pg_advisory_lock(1), pg_advisory_lock_shared(2); SELECT pg_sleep(5)" >/dev/null 2>&1 & )
for _ in $(seq 1 50); do [[ "$(advisory_locks)" -ge 3 ]] && break; sleep 0.1; done
expect "MIG-K1 setup: menlo_app holds the old advisory lock key and others" bash -c '[[ $1 -ge 3 ]]' _ "$(advisory_locks)"
t0=$(date +%s)
run --lock-timeout 2s
t1=$(date +%s)
expect "MIG-K1 (finding 2) the runner is not blocked by application-held advisory locks: applied, exit 0" succeeded_with "$RC" "$OUT" "applied 0001_k1.sql"
expect "MIG-K1 it did not wait for the application to release anything (finished well before the 5 s hold)" bash -c '[[ $(( $2 - $1 )) -lt 4 ]]' _ "$t0" "$t1"
sleep 4

setup; write 0001_k2.sql 'CREATE TABLE mt_k2 (a int);\nSELECT pg_sleep(3);\n'
rm -f "$TMP"/k2a.*
run_bg k2a
if wait_for_lock; then
  expect "MIG-K2 while the runner holds its lock, menlo_app cannot lock run_lock: denied immediately, not queued behind it" \
    has "$(QAPP "SET lock_timeout = '1s'; LOCK TABLE $LD.run_lock IN EXCLUSIVE MODE")" "permission denied"
  expect "MIG-K2 menlo_app cannot take any weaker lock on it either" has "$(QAPP "SELECT 1; LOCK TABLE $LD.run_lock IN ACCESS SHARE MODE")" "permission denied"
  expect "MIG-K2 menlo_app cannot read, insert or update it" bash -c '[[ "$1" == *denied* && "$2" == *denied* && "$3" == *denied* ]]' _ "$(QAPP "SELECT * FROM $LD.run_lock")" "$(QAPP "INSERT INTO $LD.run_lock VALUES (1)")" "$(QAPP "UPDATE $LD.run_lock SET id = 1")"
  expect "MIG-K2 menlo_app cannot read the ledger while the runner works" has "$(QAPP "SELECT * FROM $LD.ledger")" "permission denied"
  wait
  expect "MIG-K2 the runner finished normally despite those attempts" eq "$(cat "$TMP/k2a.rc")" 0
else
  wait; expect "MIG-K2 the runner holds its lock while its migration runs" eq "lock-seen" "no-lock-seen"
fi

setup; write 0001_ok.sql 'CREATE TABLE mt_k3 (a int);\n'
run
expect "MIG-K3 lock released after a successful run" eq "$(run_locks)" 0
setup; write 0001_bad.sql 'CREATE TABLE mt_k3b (a int);\nSELECT 1/0;\n'
run --lock-timeout 1s
expect "MIG-K3 lock released after a failed run (SQL error)" eq "$(run_locks)" 0
write 0001_bad.sql 'CREATE TABLE mt_k3b (a int);\n'
run --lock-timeout 1s
expect "MIG-K3 the next run (a new connection) gets the lock immediately and succeeds" eq "$RC" 0
setup; write 0001_k.sql 'CREATE TABLE mt_k3c (a int);\nSELECT pg_terminate_backend(pg_backend_pid());\n'
run
expect "MIG-K3 lock released when the connection is lost (backend terminated mid-migration)" eq "$(run_locks)" 0
write 0001_k.sql 'CREATE TABLE mt_k3c (a int);\n'
run --lock-timeout 1s
expect "MIG-K3 and the next run succeeds at once" eq "$RC" 0
expect "MIG-K4 each run uses its own connection and nothing session-level survives it (no advisory locks, no run_lock lock)" bash -c '[[ $1 -eq 0 && $2 -eq 0 ]]' _ "$(advisory_locks)" "$(run_locks)"

setup
write 0001_k5.sql 'CREATE TABLE mt_k5 (n int);\nINSERT INTO mt_k5 VALUES (1);\n'
write 0002_k5.sql 'INSERT INTO mt_k5 VALUES (2);\nSELECT pg_sleep(1);\n'
write 0003_k5.sql 'INSERT INTO mt_k5 VALUES (3);\nSELECT pg_sleep(1);\n'
rm -f "$TMP"/k5*.out "$TMP"/k5*.rc
run_bg k5a; run_bg k5b; run_bg k5c
wait
expect "MIG-K5 three concurrent runners with three pending migrations: all exit 0" bash -c '[[ $(cat "$1/k5a.rc") -eq 0 && $(cat "$1/k5b.rc") -eq 0 && $(cat "$1/k5c.rc") -eq 0 ]]' _ "$TMP"
expect "MIG-K5 each migration was applied exactly once across the three runners (3 'applied' lines in total)" eq "$(cat "$TMP"/k5a.out "$TMP"/k5b.out "$TMP"/k5c.out | grep -c '^applied ')" 3
expect "MIG-K5 the data shows exactly one execution of each migration" eq "$(Q "$DB" "SELECT string_agg(n::text, ',' ORDER BY n) FROM mt_k5")" "1,2,3"
expect "MIG-K5 the ledger holds 1,2,3 and no lock remains" bash -c '[[ "$1" == "1,2,3" && $2 -eq 0 ]]' _ "$(ledger_seqs)" "$(run_locks)"

# ================================================================================================
echo; echo "== Revisão do lock de tabela: SQL exato, privilégio necessário, exclusão mútua, liberação =="
# SQL de aquisição (por migration pendente, dentro da transação da própria migration):
#   BEGIN; SET LOCAL lock_timeout = '<--lock-timeout>'; LOCK TABLE plataforma_migrations.run_lock IN EXCLUSIVE MODE;
#   SET LOCAL lock_timeout = DEFAULT; ... valida o histórico, aplica, registra ... COMMIT;
expect "MIG-K0 the exact lock SQL is in the generated runner script: LOCK TABLE ... IN EXCLUSIVE MODE inside BEGIN, bounded by lock_timeout, and no advisory lock" \
  bash -c 'grep -q "LOCK TABLE plataforma_migrations.run_lock IN EXCLUSIVE MODE" "$1" && grep -q "SET LOCAL lock_timeout" "$1" && ! grep -q -i "advisory" "$1"' _ "$ROOT/scripts/db-migrate.sh"
setup
Q postgres "DROP ROLE IF EXISTS mig_probe_ins; DROP ROLE IF EXISTS mig_probe_upd" >/dev/null 2>&1
Q postgres "CREATE ROLE mig_probe_ins LOGIN; CREATE ROLE mig_probe_upd LOGIN" >/dev/null
Q "$DB" "GRANT USAGE ON SCHEMA $LD TO mig_probe_ins, mig_probe_upd; GRANT SELECT, INSERT ON $LD.run_lock TO mig_probe_ins; GRANT UPDATE ON $LD.run_lock TO mig_probe_upd" >/dev/null
QP() { "${PSQL[@]}" -U "$1" -d "$DB" -c "$2" 2>&1; }
expect "MIG-K6 PostgreSQL privilege matrix: with only SELECT+INSERT on run_lock a role CANNOT take the EXCLUSIVE lock (permission denied)" has "$(QP mig_probe_ins "SELECT 1; LOCK TABLE $LD.run_lock IN EXCLUSIVE MODE")" "permission denied"
expect "MIG-K6 ... nor SHARE ROW EXCLUSIVE" has "$(QP mig_probe_ins "SELECT 1; LOCK TABLE $LD.run_lock IN SHARE ROW EXCLUSIVE MODE")" "permission denied"
expect "MIG-K6 ... it can only take ROW EXCLUSIVE, which does not conflict with itself, so INSERT alone could never serialize runners" bash -c '[[ "$1" != *ERROR* ]]' _ "$(QP mig_probe_ins "SELECT 1; LOCK TABLE $LD.run_lock IN ROW EXCLUSIVE MODE")"
expect "MIG-K6 with UPDATE (the executor's privilege) the EXCLUSIVE lock is granted" bash -c '[[ "$1" != *ERROR* ]]' _ "$(QP mig_probe_upd "SELECT 1; LOCK TABLE $LD.run_lock IN EXCLUSIVE MODE")"
( "${PSQL[@]}" -U mig_probe_upd -d "$DB" -c "BEGIN; LOCK TABLE $LD.run_lock IN EXCLUSIVE MODE; SELECT pg_sleep(3); COMMIT" >/dev/null 2>&1 & )
if wait_for_lock; then
  expect "MIG-K7 mutual exclusion at the SQL level: while one session holds the EXCLUSIVE lock, another session that is allowed to lock waits and times out" \
    has "$(QP mig_probe_upd "BEGIN; SET LOCAL lock_timeout = '500ms'; LOCK TABLE $LD.run_lock IN EXCLUSIVE MODE; COMMIT")" "lock timeout"
  sleep 3
  expect "MIG-K7 and gets the lock as soon as the holder commits" bash -c '[[ "$1" != *ERROR* ]]' _ "$(QP mig_probe_upd "BEGIN; SET LOCAL lock_timeout = '2s'; LOCK TABLE $LD.run_lock IN EXCLUSIVE MODE; COMMIT")"
else
  expect "MIG-K7 mutual exclusion at the SQL level" eq "lock-seen" "no-lock-seen"
fi
Q "$DB" "REVOKE ALL ON $LD.run_lock FROM mig_probe_ins, mig_probe_upd; REVOKE ALL ON SCHEMA $LD FROM mig_probe_ins, mig_probe_upd" >/dev/null 2>&1
Q postgres "DROP ROLE IF EXISTS mig_probe_ins; DROP ROLE IF EXISTS mig_probe_upd" >/dev/null 2>&1

setup; write 0001_k8.sql 'CREATE TABLE mt_k8 (a int);\nSELECT pg_sleep(4);\n'
rm -f "$TMP"/k8a.*
run_bg k8a
if wait_for_lock; then
  s1="$(run_locks)"; sleep 1; s2="$(run_locks)"; sleep 1; s3="$(run_locks)"
  expect "MIG-K9 the runner holds one open connection and one transaction (and the lock) for the whole migration: sampled at 3 instants" bash -c '[[ $1 -eq 1 && $2 -eq 1 && $3 -eq 1 ]]' _ "$s1" "$s2" "$s3"
  expect "MIG-K9 the lock holder is a single backend in an open transaction" eq "$(Q postgres "SELECT count(DISTINCT l.pid) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE l.locktype='relation' AND l.granted AND a.datname = '$DB' AND a.xact_start IS NOT NULL AND l.mode = 'ExclusiveLock'")" 1
  wait
  expect "MIG-K9 the lock is gone after the successful commit" eq "$(run_locks)" 0
else
  wait; expect "MIG-K9 the runner holds the lock while its migration runs" eq "lock-seen" "no-lock-seen"
fi

setup; write 0001_k10.sql 'CREATE TABLE mt_k10 (a int);\nSELECT pg_sleep(6);\n'
rm -f "$TMP"/k10a.*
run_bg k10a
if wait_for_lock; then
  # O lock é o LOCK TABLE ... EXCLUSIVE MODE em plataforma_migrations.run_lock, tomado pelo backend que atende o psql do
  # runner. O SIGKILL mata o CLIENTE (psql), não o backend: com client_connection_check_interval = 0 (padrão) o servidor só
  # percebe o cliente morto quando a instrução em andamento (o pg_sleep da migration) termina; só então a transação é
  # abortada (nada é confirmado) e o lock é liberado. Por isso a liberação leva até a duração restante da instrução, e a
  # espera é por CONDIÇÃO com prazo em segundos (não por número de iterações, cuja duração depende da latência do fork/exec
  # de cada plataforma). O observador é independente: o superusuário do cluster, em outra conexão.
  K10_DEADLINE=20 # a instrução dura 6 s; o prazo cobre isso com folga e impede espera indefinida
  holder="$(Q "$DB" "SELECT l.pid FROM pg_locks l WHERE l.locktype='relation' AND l.relation='plataforma_migrations.run_lock'::regclass AND l.granted LIMIT 1")"
  pid="$(pgrep -f "psql.* -d $DB .*run.psql" | head -1)"
  killed=1; [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null && killed=0
  wait
  expect "MIG-K10 the runner's psql process is killed (SIGKILL) in the middle of a migration: the runner exits nonzero" \
    bash -c '[[ "$1" == 0 && $(cat "$2/k10a.rc") -ne 0 ]] && ! kill -0 "$3" 2>/dev/null' _ "$killed" "$TMP" "$pid"
  t0=$SECONDS; polls=0
  while [[ "$(run_locks)" -ne 0 ]]; do
    polls=$((polls + 1)); [[ $((SECONDS - t0)) -ge $K10_DEADLINE ]] && break; sleep 0.1
  done
  waited=$((SECONDS - t0)); released="$(run_locks)"
  echo "# MIG-K10 observed: killed client pid=${pid:-none}; lock-holder backend pid=${holder:-?}; lock released=$([[ "$released" == 0 ]] && echo yes || echo NO) after ~${waited}s (deadline ${K10_DEADLINE}s, ${polls} polls)"
  expect "MIG-K10 the server released the lock when the client died" eq "$released" 0
  if [[ "$released" != 0 ]]; then
    echo "# MIG-K10 diag: run_lock locks (pid:mode:granted): $(Q "$DB" "SELECT coalesce(string_agg(pid || ':' || mode || ':' || granted, ', '), '-') FROM pg_locks WHERE relation = 'plataforma_migrations.run_lock'::regclass")"
    echo "# MIG-K10 diag: backends in $DB (pid:state:wait_event): $(Q postgres "SELECT coalesce(string_agg(pid || ':' || coalesce(state, '-') || ':' || coalesce(wait_event, '-'), ', '), '-') FROM pg_stat_activity WHERE datname = '$DB'")"
  fi
  expect "MIG-K10 nothing partial: no table and no ledger entry" bash -c '[[ "$1" == t && "$2" -eq 0 ]]' _ "$(Q "$DB" "SELECT to_regclass('public.mt_k10') IS NULL")" "$(ledger_count)"
  write 0001_k10.sql 'CREATE TABLE mt_k10 (a int);\n'
  run --lock-timeout 1s
  expect "MIG-K10 the next runner acquires the lock at once and applies the migration" succeeded_with "$RC" "$OUT" "applied 0001_k10.sql"
else
  wait; expect "MIG-K10 the runner holds the lock while its migration runs" eq "lock-seen" "no-lock-seen"
fi

# ================================================================================================
echo; echo "== Segurança e configuração explícita =="
setup; write 0001_s1.sql 'CREATE TABLE mt_s1 (a int);\n'
OUT="$(PGHOST=/nonexistent PGPORT=1 PGDATABASE=wrong_db PGUSER=wrong_user PGPASSWORD=x DATABASE_URL=ambient-dsn-that-must-be-ignored \
  bash "$RUNNER" --no-security-gate --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$OWNER" --migrations-dir "$DIR" 2>&1)"; RC=$?
expect "MIG-S1 ambient PG*/DATABASE_URL variables are ignored; the explicit flags win" succeeded_with "$RC" "$OUT" "applied 0001_s1.sql"
OUT="$(bash "$RUNNER" --no-security-gate --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --user "$OWNER" --migrations-dir "$DIR" 2>&1)"; RC=$?
expect "MIG-S2 a missing --dbname is a usage error (exit 2): nothing is guessed from the environment" eq "$RC" 2
OUT="$(bash "$RUNNER" --no-security-gate --socket-dir localhost --port 5432 --psql "$PGBIN/psql" --dbname "$DB" --user "$OWNER" --migrations-dir "$DIR" 2>&1)"; RC=$?
expect "MIG-S2 a network host is refused (only absolute Unix socket directories are accepted)" eq "$RC" 2

echo
if [[ "$FAILS" -eq 0 ]]; then
  echo "MIGRATION TESTS: PASSED ($CHECKS checks) on PostgreSQL $("${PSQL[@]}" -d postgres -c 'SHOW server_version')"
else
  echo "MIGRATION TESTS: FAILED ($FAILS of $CHECKS checks failed)" >&2
  exit 1
fi
