#!/usr/bin/env bash
# PILOTO LOCAL do Opportunity Engine (Unidade 2): banco PostgreSQL DESCARTÁVEL (nunca o Neon, nunca o banco do aplicativo), importação REAL do IBGE (SP), pesquisa com fontes públicas REAIS
# (BCB, IBGE, Agência Brasil), SIDRA real, blueprint e geração até QA. Precisa de internet. Apaga tudo ao terminar.   Uso:  bash scripts/pilot-local.sh [escopo] [--waive]
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SCOPE="${1:-pilot-sao-paulo}"; WAIVE=""; [[ "${2:-}" == "--waive" ]] && WAIVE="--waive"
TENANT="fb777777-7777-4777-8777-777777777777"
# shellcheck source=lib/disposable-pg.sh
source "$ROOT/scripts/lib/disposable-pg.sh"
trap cleanup EXIT INT TERM
DB=plataforma; MIG=plataforma_migrator; APP=menlo_app
bash "$ROOT/scripts/db-bootstrap.sh" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --user rls_bootstrap --dbname "$DB" >/dev/null
bash "$ROOT/scripts/db-migrate.sh" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$MIG" --app-role "$APP" | tail -1
"${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -c "INSERT INTO plataforma.tenant (id, slug, name) VALUES ('$TENANT', 'piloto-local', 'Piloto local')" >/dev/null
URL="postgresql:///$DB?host=$(python3 -c 'import sys,urllib.parse as u; print(u.quote(sys.argv[1], safe=""))' "$TMP")&port=$PORT&user=$APP"
export PLATAFORMA_LOCAL_URL="$URL" NODE_ENV=development
( cd "$ROOT/packages/api" && pnpm exec tsx src/ingest/cli.ts --env-var PLATAFORMA_LOCAL_URL --tenant "$TENANT" --file "$ROOT/db/test-fixtures/generation/sp-ibge-2026-10-12.csv" --origin real --source IBGE | cut -c1-160 )
( cd "$ROOT/packages/api" && pnpm exec tsx ../../packs/real-estate/src/pilot-cli.ts --env-var PLATAFORMA_LOCAL_URL --tenant "$TENANT" --scope "$SCOPE" --entities 5 $WAIVE )
