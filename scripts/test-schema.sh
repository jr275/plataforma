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
expect "o runner aplica 0001 a 0006 com o gate de segurança ativo (código 0)" eq "$rc" 0
[[ "$rc" -eq 0 ]] || echo "$OUT" | tail -8
expect "o ledger tem exatamente as migrations 1 a 6" eq "$(su "SELECT string_agg(seq::text, ',' ORDER BY seq) FROM plataforma_migrations.ledger")" "1,2,3,4,5,6"
OUT2="$(bash "$RUNNER" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$MIG" --app-role "$APP" 2>&1)"; rc=$?
expect "reaplicar não muda nada (código 0)" eq "$rc" 0
expect "as migrations não semeiam dados de tenant" eq "$(su "SELECT (SELECT count(*) FROM plataforma.tenant) + (SELECT count(*) FROM plataforma.opportunity) + (SELECT count(*) FROM plataforma.import_run) + (SELECT count(*) FROM plataforma.import_record) + (SELECT count(*) FROM plataforma.city) + (SELECT count(*) FROM plataforma.generation_run) + (SELECT count(*) FROM plataforma.page) + (SELECT count(*) FROM plataforma.page_version) + (SELECT count(*) FROM plataforma.generation_item)")" 0

# --- seed de teste (superusuário descartável) ----------------------------------------------------
"${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/db/test-fixtures/product/10_seed.sql" >/dev/null 2>&1
expect "o seed de teste foi carregado (2 tenants, 5 oportunidades)" eq "$(su "SELECT (SELECT count(*) FROM plataforma.tenant) || '/' || (SELECT count(*) FROM plataforma.opportunity)")" "2/5"

"${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/db/test-fixtures/generation/10_tenants.sql" >/dev/null 2>&1
expect "os tenants exclusivos da geração foram carregados (C e D)" eq "$(su "SELECT count(*) FROM plataforma.tenant WHERE slug LIKE 'geracao-%'")" 2

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
expect "tenant inexistente é rejeitado pela chave estrangeira" has "$(su "INSERT INTO plataforma.opportunity (tenant_id, title, summary, next_action, kind, intent, demand, competition, evidence, status, rank) VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 't', '', '', 'page', 'informational', 'high', 'high', 'high', 'candidate', 1)")" "foreign key"
expect "não existe coluna de nota ou pontuação (regra 5)" eq "$(su "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'plataforma' AND table_name = 'opportunity' AND column_name ~* '(score|rating|nota|pontu)'")" 0
expect "RLS está ligada e forçada em opportunity" eq "$(su "SELECT relrowsecurity::text || relforcerowsecurity::text FROM pg_class WHERE oid = 'plataforma.opportunity'::regclass")" "truetrue"
expect "nenhum privilégio para PUBLIC nas tabelas do produto" eq "$(su "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'plataforma' AND grantee = 'PUBLIC'")" 0
# --- importação e cidades (ADR-017): isolamento, imutabilidade e integridade ---------------------
RA=c0000000-0000-4000-8000-00000000000a; RB=c0000000-0000-4000-8000-00000000000b
SHA=$(printf 'a%.0s' $(seq 64))
su "INSERT INTO plataforma.import_run (id, tenant_id, kind, source_name, file_name, file_sha256, origin, mapping, status, total_rows, accepted_rows, finished_at, created_by) VALUES
  ('$RA', '$A', 'csv', 'teste', 'a.csv', '$SHA', 'test', '{}', 'succeeded', 1, 1, now(), 'seed'),
  ('$RB', '$B', 'csv', 'teste', 'b.csv', '$SHA', 'test', '{}', 'succeeded', 1, 1, now(), 'seed');
  INSERT INTO plataforma.import_record (tenant_id, run_id, row_number, raw, outcome) VALUES ('$A', '$RA', 1, '{}', 'accepted'), ('$B', '$RB', 1, '{}', 'accepted');
  INSERT INTO plataforma.city (tenant_id, ibge_code, name, uf, source_run_id) VALUES ('$A', '1100015', 'Cidade A', 'RO', '$RA'), ('$B', '1100015', 'Cidade B', 'RO', '$RB');" >/dev/null
expect "o mesmo código IBGE existe nos dois tenants (único POR tenant)" eq "$(su "SELECT count(*) FROM plataforma.city WHERE ibge_code = '1100015'")" 2
for t in import_run import_record city; do
  expect "$t: tenant A enxerga só a própria linha" eq "$(app_sql "$A" "SELECT count(*) FROM plataforma.$t" | tr '\n' ' ')" "1 "
  expect "$t: tenant B enxerga só a própria linha" eq "$(app_sql "$B" "SELECT count(*) FROM plataforma.$t" | tr '\n' ' ')" "1 "
  expect "$t: sem contexto de tenant, zero linhas" eq "$(app_sql "" "SELECT count(*) FROM plataforma.$t" | tr '\n' ' ')" "0 "
  expect "$t: a aplicação não tem DELETE" has "$(app_sql "$A" "DELETE FROM plataforma.$t")" "permission denied"
  expect "RLS ligada e forçada em $t" eq "$(su "SELECT relrowsecurity::text || relforcerowsecurity::text FROM pg_class WHERE oid = 'plataforma.$t'::regclass")" "truetrue"
done
expect "A não lê a execução de B pelo id" eq "$(app_sql "$A" "SELECT count(*) FROM plataforma.import_run WHERE id = '$RB'" | tr '\n' ' ')" "0 "
expect "INSERT de cidade em outro tenant é rejeitado pela política" has "$(app_sql "$A" "INSERT INTO plataforma.city (tenant_id, ibge_code, name, uf, source_run_id) VALUES ('$B', '1100023', 'x', 'RO', '$RB')")" "row-level security"
expect "cidade de A não pode apontar para a execução de B (FK composta)" has "$(app_sql "$A" "INSERT INTO plataforma.city (tenant_id, ibge_code, name, uf, source_run_id) VALUES ('$A', '1100023', 'x', 'RO', '$RB')")" "foreign key"
expect "registro de A não pode apontar para a execução de B (FK composta)" has "$(app_sql "$A" "INSERT INTO plataforma.import_record (tenant_id, run_id, row_number, raw, outcome) VALUES ('$A', '$RB', 2, '{}', 'accepted')")" "foreign key"
expect "UPDATE de cidade de outro tenant não afeta nenhuma linha" eq "$(app_sql "$A" "WITH u AS (UPDATE plataforma.city SET name = 'hack' WHERE tenant_id = '$B' RETURNING 1) SELECT count(*) FROM u" | tr '\n' ' ')" "0 "
expect "import_record é imutável para a aplicação (sem UPDATE)" has "$(app_sql "$A" "UPDATE plataforma.import_record SET outcome = 'rejected'")" "permission denied"
expect "reimportar o mesmo código no mesmo tenant é recusado (único por tenant)" has "$(app_sql "$A" "INSERT INTO plataforma.city (tenant_id, ibge_code, name, uf, source_run_id) VALUES ('$A', '1100015', 'dup', 'RO', '$RA')")" "duplicate key"
expect "UPSERT por (tenant, ibge_code) atualiza em vez de duplicar" eq "$(app_sql "$A" "INSERT INTO plataforma.city (tenant_id, ibge_code, name, uf, source_run_id) VALUES ('$A', '1100015', 'Novo nome', 'RO', '$RA') ON CONFLICT (tenant_id, ibge_code) DO UPDATE SET name = EXCLUDED.name; SELECT count(*) || name FROM plataforma.city GROUP BY name" | tr '\n' ' ')" "1Novo nome "
expect "contagens inconsistentes na execução são recusadas por CHECK" has "$(su "UPDATE plataforma.import_run SET total_rows = 5 WHERE id = '$RA'")" "violates check constraint"
expect "código IBGE fora de 7 dígitos é recusado por CHECK" has "$(su "INSERT INTO plataforma.city (tenant_id, ibge_code, name, uf, source_run_id) VALUES ('$A', '123', 'x', 'RO', '$RA')")" "violates check constraint"
expect "execução 'failed' exige mensagem de erro" has "$(su "UPDATE plataforma.import_run SET status = 'failed' WHERE id = '$RA'")" "violates check constraint"

c="$(bash "$ROOT/scripts/check-catalog.sh" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$MIG" --app-role "$APP" --executor-role "$MIG" 2>&1)"; rc=$?
expect "as verificações de catálogo de segurança passam com o esquema real" eq "$rc" 0
expect "o gate avalia a tabela real (não é vacuoso)" has "$c" "plataforma.opportunity"
expect "o gate avalia as tabelas de importação e cidade" has "$c" "plataforma.city"
for t in generation_run page page_version generation_item; do
  expect "RLS ligada e forçada em $t" eq "$(su "SELECT relrowsecurity::text || relforcerowsecurity::text FROM pg_class WHERE oid = 'plataforma.$t'::regclass")" "truetrue"
  expect "$t: a aplicação não tem DELETE" has "$(app_sql "$A" "DELETE FROM plataforma.$t")" "permission denied"
  expect "$t: sem contexto de tenant, zero linhas" eq "$(app_sql "" "SELECT count(*) FROM plataforma.$t" | tr '\n' ' ')" "0 "
  expect "o gate avalia a tabela $t" has "$c" "plataforma.$t"
done
expect "page_version é imutável para a aplicação (sem UPDATE)" has "$(app_sql "$A" "UPDATE plataforma.page_version SET content_hash = 'x'")" "permission denied"
expect "generation_item é imutável para a aplicação (sem UPDATE)" has "$(app_sql "$A" "UPDATE plataforma.generation_item SET outcome = 'generated'")" "permission denied"
expect "generation_run: contagens que não somam são recusadas por CHECK" has "$(su "INSERT INTO plataforma.generation_run (tenant_id, template_key, template_version, template_hash, scope, status, total_items, generated_items, finished_at, created_by) VALUES ('$A', 'city-overview', 1, '$SHA', '{}', 'succeeded', 5, 1, now(), 't')")" "violates check constraint"
expect "generation_run: teto de 500 itens por execução" has "$(su "INSERT INTO plataforma.generation_run (tenant_id, template_key, template_version, template_hash, scope, status, total_items, generated_items, finished_at, created_by) VALUES ('$A', 'city-overview', 1, '$SHA', '{}', 'succeeded', 501, 501, now(), 't')")" "violates check constraint"
expect "page: o caminho só aceita o formato de URL esperado" has "$(su "INSERT INTO plataforma.page (tenant_id, entity_kind, entity_id, path, latest_version, status) SELECT '$A', 'city', id, '/Maiuscula Errada', 1, 'draft' FROM plataforma.city WHERE tenant_id = '$A' LIMIT 1")" "violates check constraint"

# --- packages/api: funções de oportunidades por withTenant -----------------------------------------
( cd "$ROOT/packages/api" && PLATAFORMA_TEST_PG_SOCKET_DIR="$TMP" PLATAFORMA_TEST_PG_PORT="$PORT" PLATAFORMA_TEST_PG_DATABASE="$DB" \
    pnpm exec vitest run --config vitest.product.config.ts 2>&1 | tail -25 ); rc=${PIPESTATUS[0]}
expect "as funções de oportunidades (packages/api) passam contra o esquema real" eq "$rc" 0

echo
echo "$((CHECKS - FAILS))/$CHECKS verificações passaram"
[[ "$FAILS" -eq 0 ]] && echo "SCHEMA TESTS: PASSED on PostgreSQL $("${PSQL[@]}" -d postgres -c 'SHOW server_version')" || { echo "SCHEMA TESTS: FAILED ($FAILS)"; exit 1; }
