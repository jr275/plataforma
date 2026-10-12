#!/usr/bin/env bash
# Testes de packages/api contra um PostgreSQL 16 DESCARTÁVEL (cluster novo, só socket Unix), usando a fixture do harness de
# RLS (db/test-fixtures/rls). Roda os testes de banco (*.db.test.ts) como o papel menlo_app. Não usa Docker/Neon/
# DATABASE_URL, não instala nada e apaga tudo ao sair. Código de saída: 0 = tudo certo; diferente de zero = falha.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
FX="$ROOT/db/test-fixtures/rls"
# shellcheck source=lib/disposable-pg.sh
source "$ROOT/scripts/lib/disposable-pg.sh"

DBN=api_test
"${PSQL[@]}" -d postgres -v ON_ERROR_STOP=1 -f "$FX/00_roles.sql" >/dev/null
"${PSQL[@]}" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DBN OWNER rls_fixture_owner TEMPLATE template0" >/dev/null
"${PSQL[@]}" -d "$DBN" -v ON_ERROR_STOP=1 -v dbname="$DBN" -f "$FX/10_fixture.sql" >/dev/null

cd "$ROOT/packages/api"
PLATAFORMA_TEST_PG_SOCKET_DIR="$TMP" PLATAFORMA_TEST_PG_PORT="$PORT" PLATAFORMA_TEST_PG_DATABASE="$DBN" \
  pnpm exec vitest run --config vitest.db.config.ts
echo "API TESTS: PASSED on PostgreSQL $("${PSQL[@]}" -d postgres -c 'SHOW server_version')"
