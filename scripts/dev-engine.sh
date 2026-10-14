#!/usr/bin/env bash
# BANCADA do Control Plane do motor (somente desenvolvimento): banco PostgreSQL DESCARTÁVEL (nunca o Neon) com TODAS as migrations, importação REAL do IBGE (SP), SIDRA real para os N municípios mais
# populosos e o fluxo do motor (tópicos, combinações, elegibilidade) com dados reais; liga o aplicativo SEM login em /engine, pelo MESMO código de produção (RLS, versões, ações). Sem ANTHROPIC_API_KEY os
# agentes ficam "não configurados" e isso aparece como bloqueio externo. Precisa de internet. Ctrl+C encerra e apaga tudo.   Uso:  bash scripts/dev-engine.sh [porta] [n-municipios-sidra]
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PORT_WEB="${1:-3108}"; SIDRA="${2:-6}"
TENANT="fc444444-4444-4444-8444-444444444444"
# shellcheck source=lib/disposable-pg.sh
source "$ROOT/scripts/lib/disposable-pg.sh"
WEB=""
finish() { if [[ -n "$WEB" ]]; then pkill -TERM -P "$WEB" 2>/dev/null || true; kill -TERM "$WEB" 2>/dev/null || true; wait "$WEB" 2>/dev/null || true; fi; cleanup; }
trap finish EXIT INT TERM
DB=plataforma; MIG=plataforma_migrator; APP=menlo_app
echo "== banco descartável e migrations (gate ativo)"
bash "$ROOT/scripts/db-bootstrap.sh" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --user rls_bootstrap --dbname "$DB" >/dev/null
bash "$ROOT/scripts/db-migrate.sh" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$MIG" --app-role "$APP" | tail -1
"${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -c "INSERT INTO plataforma.tenant (id, slug, name) VALUES ('$TENANT', 'bancada-motor', 'Bancada do motor')" >/dev/null
URL="postgresql:///$DB?host=$(python3 -c 'import sys,urllib.parse as u; print(u.quote(sys.argv[1], safe=""))' "$TMP")&port=$PORT&user=$APP"
export PLATAFORMA_LOCAL_URL="$URL" NODE_ENV=development
( cd "$ROOT/packages/api" && pnpm exec tsx src/ingest/cli.ts --env-var PLATAFORMA_LOCAL_URL --tenant "$TENANT" --file "$ROOT/db/test-fixtures/generation/sp-ibge-2026-10-12.csv" --origin real --source IBGE | cut -c1-160 )
echo "== fluxo do motor com dados reais (SIDRA para $SIDRA municípios)"
( cd "$ROOT/packages/api" && pnpm exec tsx ../../packs/real-estate/src/engine-cli.ts --env-var PLATAFORMA_LOCAL_URL --tenant "$TENANT" --sidra "$SIDRA" | tail -25 )
echo "== aplicativo em http://localhost:$PORT_WEB/engine (sem login; banco descartável)"
cd "$ROOT/apps/web"
NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= PLATAFORMA_APP_DATABASE_URL= ANTHROPIC_API_KEY= PLATAFORMA_DEV_EDITOR_DATABASE_URL="$URL" PLATAFORMA_DEV_EDITOR_TENANT="$TENANT" pnpm exec next dev --port "$PORT_WEB" &
WEB=$!
wait "$WEB"
