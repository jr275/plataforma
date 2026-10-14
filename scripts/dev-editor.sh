#!/usr/bin/env bash
# BANCADA do editor visual de rascunho (somente desenvolvimento): banco PostgreSQL DESCARTÁVEL (nunca o Neon) com TODAS as migrations, cidades reais do IBGE, pesquisa com respostas
# reais capturadas das fontes e um blueprint pronto; liga o aplicativo SEM login (variáveis do Supabase vazias) em /dev/editor, que fala com este banco pelo MESMO código de produção
# (savePageDraft, RLS, versões). Ctrl+C encerra e apaga tudo.   Uso:  bash scripts/dev-editor.sh [porta]
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PORT_WEB="${1:-3107}"
TENANT="fb666666-6666-4666-8666-666666666666"
# shellcheck source=lib/disposable-pg.sh
source "$ROOT/scripts/lib/disposable-pg.sh"
WEB=""
finish() { if [[ -n "$WEB" ]]; then pkill -TERM -P "$WEB" 2>/dev/null || true; kill -TERM "$WEB" 2>/dev/null || true; wait "$WEB" 2>/dev/null || true; fi; cleanup; }
trap finish EXIT INT TERM
DB=plataforma; MIG=plataforma_migrator; APP=menlo_app
echo "== banco descartável e migrations (gate ativo)"
bash "$ROOT/scripts/db-bootstrap.sh" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --user rls_bootstrap --dbname "$DB" >/dev/null
bash "$ROOT/scripts/db-migrate.sh" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$MIG" --app-role "$APP" | tail -1
"${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -c "INSERT INTO plataforma.tenant (id, slug, name) VALUES ('$TENANT', 'bancada', 'Bancada do editor')" >/dev/null
URL="postgresql:///$DB?host=$(python3 -c 'import sys,urllib.parse as u; print(u.quote(sys.argv[1], safe=""))' "$TMP")&port=$PORT&user=$APP"
export PLATAFORMA_LOCAL_URL="$URL" NODE_ENV=development
( cd "$ROOT/packages/api" && pnpm exec tsx src/ingest/cli.ts --env-var PLATAFORMA_LOCAL_URL --tenant "$TENANT" --file "$ROOT/db/test-fixtures/generation/sp-ibge-2026-10-12.csv" --origin real --source IBGE | cut -c1-160 )
echo "== pesquisa (respostas reais capturadas) e blueprint"
( cd "$ROOT/packages/api" && pnpm exec tsx ../../packs/real-estate/src/dev-editor-seed.ts --env-var PLATAFORMA_LOCAL_URL --tenant "$TENANT" --waive ) | tee "$TMP/seed.json"
echo "== aplicativo em http://localhost:$PORT_WEB/dev/editor (sem login; banco descartável)"
cd "$ROOT/apps/web"
NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= PLATAFORMA_APP_DATABASE_URL= PLATAFORMA_DEV_EDITOR_DATABASE_URL="$URL" PLATAFORMA_DEV_EDITOR_TENANT="$TENANT" pnpm exec next dev --port "$PORT_WEB" &
WEB=$!
wait "$WEB"
