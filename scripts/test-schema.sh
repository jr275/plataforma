#!/usr/bin/env bash
# Testes da PRIMEIRA FATIA do esquema de produto (ADR-014: db/migrations/0001_tenant.sql e 0002_opportunity.sql) contra um
# PostgreSQL 16 DESCARTÁVEL, com os papéis reais do bootstrap (administrador, executor, aplicação). Aplica as migrations REAIS
# com o runner e o gate de segurança ATIVO; semeia dois tenants como superusuário do cluster descartável (os testes semeiam;
# migrations nunca semeiam dados de tenant); prova o isolamento como `menlo_app` e roda as funções de packages/api (opportunities)
# por withTenant. Não usa Docker/Neon/DATABASE_URL; apaga tudo ao sair. Código de saída: 0 = tudo certo; 1 = falha; 2 = pré-requisito.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=lib/disposable-pg.sh
source "$ROOT/scripts/lib/disposable-pg.sh"
set +e

RUNNER="$ROOT/scripts/db-migrate.sh"
BOOT="$ROOT/scripts/db-bootstrap.sh"
MIG=plataforma_migrator; APP=menlo_app; DB=product_test
A=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa; B=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb
FAILS=0; CHECKS=0

expect() { local name="$1"; shift; CHECKS=$((CHECKS + 1))
  if "$@" >/dev/null 2>&1; then echo "ok - $name"; else echo "not ok - $name"; FAILS=$((FAILS + 1)); fi; }
eq()  { [[ "$1" == "$2" ]]; }
has() { [[ "$1" == *"$2"* ]]; }
# Como menlo_app, numa transação com o contexto do tenant dado (ou nenhum), sempre desfeita ao final: app_sql TENANT|"" "SQL".
app_sql() {
  local ctx=""; [[ -n "$1" ]] && ctx="SELECT set_config('app.tenant_id', '$1', true);"
  "${PSQL[@]}" -U "$APP" -d "$DB" -c "BEGIN; $ctx $2; ROLLBACK;" 2>&1 | grep -v '^$' | grep -v '^BEGIN$' | grep -v '^ROLLBACK$' | grep -v '^set_config$' | grep -v -E '^[0-9a-f]{8}-[0-9a-f-]{27}$'
}
su() { "${PSQL[@]}" -d "$DB" -c "$1" 2>&1; }

# --- aplica as migrations reais ------------------------------------------------------------------
o="$(bash "$BOOT" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --user rls_bootstrap --dbname "$DB" 2>&1)"; rc=$?
expect "bootstrap provisiona e verifica o ambiente" eq "$rc" 0
OUT="$(bash "$RUNNER" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$MIG" --app-role "$APP" 2>&1)"; rc=$?
expect "o runner aplica 0001 e 0002 com o gate de segurança ativo (código 0)" eq "$rc" 0
[[ "$rc" -eq 0 ]] || echo "$OUT" | tail -8
expect "o ledger tem exatamente as migrations 1 e 2" eq "$(su "SELECT string_agg(seq::text, ',' ORDER BY seq) FROM plataforma_migrations.ledger")" "1,2"
OUT2="$(bash "$RUNNER" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$MIG" --app-role "$APP" 2>&1)"; rc=$?
expect "reaplicar não muda nada (código 0)" eq "$rc" 0
expect "as migrations não semeiam dados de tenant" eq "$(su "SELECT (SELECT count(*) FROM plataforma.tenant) + (SELECT count(*) FROM plataforma.opportunity)")" 0

# --- seed de teste (superusuário descartável) ----------------------------------------------------
"${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/db/test-fixtures/product/10_seed.sql" >/dev/null 2>&1
expect "o seed de teste foi carregado (2 tenants, 5 oportunidades)" eq "$(su "SELECT (SELECT count(*) FROM plataforma.tenant) || '/' || (SELECT count(*) FROM plataforma.opportunity)")" "2/5"

# --- isolamento entre tenants, como menlo_app ----------------------------------------------------
expect "tenant A só enxerga as 3 oportunidades de A" eq "$(app_sql "$A" "SELECT count(*) FROM plataforma.opportunity WHERE tenant_id = '$A'; SELECT count(*) FROM plataforma.opportunity" | tr '\n' ' ')" "3 3 "
expect "tenant B só enxerga as 2 oportunidades de B" eq "$(app_sql "$B" "SELECT count(*) FROM plataforma.opportunity" | tr '\n' ' ')" "2 "
expect "sem contexto de tenant: zero linhas (falha fechada)" eq "$(app_sql "" "SELECT count(*) FROM plataforma.opportunity" | tr '\n' ' ')" "0 "
expect "A não lê a linha de B nem pelo id" eq "$(app_sql "$A" "SELECT count(*) FROM plataforma.opportunity WHERE id = 'b0000000-0000-4000-8000-000000000001'" | tr '\n' ' ')" "0 "
expect "INSERT com tenant_id de outro tenant é rejeitado pela política" has "$(app_sql "$A" "INSERT INTO plataforma.opportunity (tenant_id, title, summary, next_action, kind, intent, demand, competition, evidence, status, rank) VALUES ('$B', 't', '', '', 'page', 'informational', 'high', 'high', 'high', 'candidate', 9)")" "row-level security"
expect "INSERT no próprio tenant funciona" has "$(app_sql "$A" "INSERT INTO plataforma.opportunity (tenant_id, title, summary, next_action, kind, intent, demand, competition, evidence, status, rank) VALUES ('$A', 't', '', '', 'page', 'informational', 'high', 'high', 'high', 'candidate', 9) RETURNING rank")" "9"
expect "UPDATE de linha de outro tenant não afeta nenhuma linha" eq "$(app_sql "$A" "WITH u AS (UPDATE plataforma.opportunity SET status = 'dismissed' WHERE tenant_id = '$B' RETURNING 1) SELECT count(*) FROM u" | tr '\n' ' ')" "0 "
expect "e as linhas de B continuam intactas" eq "$(su "SELECT count(*) FROM plataforma.opportunity WHERE tenant_id = '$B' AND status = 'dismissed'")" 0
expect "UPDATE não consegue mover uma linha para outro tenant" has "$(app_sql "$A" "UPDATE plataforma.opportunity SET tenant_id = '$B' WHERE id = 'a0000000-0000-4000-8000-000000000001'")" "row-level security"
expect "a aplicação não tem DELETE" has "$(app_sql "$A" "DELETE FROM plataforma.opportunity")" "permission denied"
expect "a aplicação não acessa a tabela tenant" has "$(app_sql "$A" "SELECT * FROM plataforma.tenant")" "permission denied"
expect "a aplicação não acessa o ledger de migrations" has "$(app_sql "$A" "SELECT * FROM plataforma_migrations.ledger")" "permission denied"
expect "updated_at é mantido pelo gatilho" eq "$(app_sql "$A" "UPDATE plataforma.opportunity SET status = 'ready' WHERE id = 'a0000000-0000-4000-8000-000000000001'; SELECT updated_at > created_at FROM plataforma.opportunity WHERE id = 'a0000000-0000-4000-8000-000000000001'" | tail -1)" "t"

# --- integridade do esquema ----------------------------------------------------------------------
expect "status inválido é rejeitado por CHECK" has "$(su "UPDATE plataforma.opportunity SET status = 'lixo' WHERE id = 'a0000000-0000-4000-8000-000000000001'")" "violates check constraint"
expect "tenant inexistente é rejeitado pela chave estrangeira" has "$(su "INSERT INTO plataforma.opportunity (tenant_id, title, summary, next_action, kind, intent, demand, competition, evidence, status, rank) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 't', '', '', 'page', 'informational', 'high', 'high', 'high', 'candidate', 1)")" "foreign key"
expect "não existe coluna de nota ou pontuação (regra 5)" eq "$(su "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'plataforma' AND table_name = 'opportunity' AND column_name ~* '(score|rating|nota|pontu)'")" 0
expect "RLS está ligada e forçada em opportunity" eq "$(su "SELECT relrowsecurity::text || relforcerowsecurity::text FROM pg_class WHERE oid = 'plataforma.opportunity'::regclass")" "truetrue"
expect "nenhum privilégio para PUBLIC nas tabelas do produto" eq "$(su "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'plataforma' AND grantee = 'PUBLIC'")" 0
c="$(bash "$ROOT/scripts/check-catalog.sh" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$MIG" --app-role "$APP" --executor-role "$MIG" 2>&1)"; rc=$?
expect "as verificações de catálogo de segurança passam com o esquema real" eq "$rc" 0
expect "o gate avalia a tabela real (não é vacuoso)" has "$c" "plataforma.opportunity"

# --- packages/api: funções de oportunidades por withTenant -----------------------------------------
( cd "$ROOT/packages/api" && PLATAFORMA_TEST_PG_SOCKET_DIR="$TMP" PLATAFORMA_TEST_PG_PORT="$PORT" PLATAFORMA_TEST_PG_DATABASE="$DB" \
    pnpm exec vitest run --config vitest.product.config.ts 2>&1 | tail -25 ); rc=${PIPESTATUS[0]}
expect "as funções de oportunidades (packages/api) passam contra o esquema real" eq "$rc" 0

echo
echo "$((CHECKS - FAILS))/$CHECKS verificações passaram"
[[ "$FAILS" -eq 0 ]] && echo "SCHEMA TESTS: PASSED on PostgreSQL $("${PSQL[@]}" -d postgres -c 'SHOW server_version')" || { echo "SCHEMA TESTS: FAILED ($FAILS)"; exit 1; }
