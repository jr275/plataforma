#!/usr/bin/env bash
# Verificação AO VIVO do motor de oportunidades: banco descartável (nunca o Neon) + consultas REAIS às fontes públicas (BCB, IBGE, Agência Brasil).
#   scripts/verify-engine-live.sh
# Roda a pesquisa DUAS vezes (a segunda prova a idempotência) e confere o resultado por SQL como `menlo_app`. Precisa de internet. Apaga tudo ao terminar.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
TENANT="fb333333-3333-4333-8333-333333333333"
# shellcheck source=lib/disposable-pg.sh
source "$ROOT/scripts/lib/disposable-pg.sh"
trap cleanup EXIT INT TERM
DB=plataforma; MIG=plataforma_migrator; APP=menlo_app
say() { printf '\n== %s\n' "$*"; }

say "banco descartável, papéis e migrations (gate ativo)"
bash "$ROOT/scripts/db-bootstrap.sh" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --user rls_bootstrap --dbname "$DB" >/dev/null
bash "$ROOT/scripts/db-migrate.sh" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$MIG" --app-role "$APP" | tail -2
"${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -c "INSERT INTO plataforma.tenant (id, slug, name) VALUES ('$TENANT', 'verificacao', 'Verificação ao vivo')" >/dev/null

URL="postgresql:///$DB?host=$(python3 -c 'import sys,urllib.parse as u; print(u.quote(sys.argv[1], safe=""))' "$TMP")&port=$PORT&user=$APP"
export PLATAFORMA_LOCAL_URL="$URL" NODE_ENV=development

say "importação REAL do IBGE (SP, 645 municípios)"
( cd "$ROOT/packages/api" && pnpm exec tsx src/ingest/cli.ts --env-var PLATAFORMA_LOCAL_URL --tenant "$TENANT" --file "$ROOT/db/test-fixtures/generation/sp-ibge-2026-10-12.csv" --origin real --source IBGE | cut -c1-200 )

for n in 1 2; do
  say "pesquisa $n (fontes reais, ao vivo)"
  ( cd "$ROOT/packages/api" && pnpm exec tsx ../../packs/real-estate/src/research-cli.ts --env-var PLATAFORMA_LOCAL_URL --tenant "$TENANT" --entities 20 ) | python3 -c '
import json,sys
r=json.loads(sys.stdin.read())
print("status:", r["status"], "| duração:", r["durationMs"], "ms")
for a in r["adapters"]: print("  fonte", a["adapter"], a["status"], "| requisições", a["requests"], "| bytes", a["bytes"], "| vistos", a["seen"], "| guardados", a["kept"], "| novos", a["inserted"], "| já existiam", a["existing"], "| erros", [e["code"] for e in a["errors"]])
print("evidência:", r["evidence"], "| oportunidades:", r["opportunities"], "| scores:", r["scores"], "| transições:", r["transitions"], "| sem classe:", r["unclassified"])
'
done

for n in 1 2; do
  say "blueprint e roadmap $n (a 2ª execução prova a idempotência)"
  ( cd "$ROOT/packages/api" && pnpm exec tsx ../../packs/real-estate/src/blueprint-cli.ts --env-var PLATAFORMA_LOCAL_URL --tenant "$TENANT" ) | python3 -c '
import json,sys
r=json.loads(sys.stdin.read())
for b in r["blueprints"]: print("  blueprint:", b["query"], "| criado:", b["created"], "| v", b["version"], "| pronto:", b["ready"], "| template:", b["template"], "| avançou:", b["transitioned"], "| bloqueios:", b["blockers"])
print("  gates:", r["blueprints"][0]["gates"] if r["blueprints"] else "-")
print("  roadmap:", r["roadmap"]["counts"], "| total:", r["roadmap"]["total"])
for b in r["roadmap"]["blockers"]: print("   ", b["count"], b["lane"], "-", b["label"])
'
done

say "conferência (somente leitura, como menlo_app, no tenant)"
"${PSQL[@]}" -U "$APP" -d "$DB" -v ON_ERROR_STOP=1 <<SQL
BEGIN READ ONLY;
SELECT set_config('app.tenant_id', '$TENANT', true) IS NOT NULL AS ctx;
SELECT 'execuções', status, count(*) FROM plataforma.research_run GROUP BY status;
SELECT 'evidência por fonte e tipo', adapter, kind, basis, count(*) FROM plataforma.evidence GROUP BY 2,3,4 ORDER BY 2,3;
SELECT 'oportunidades por estado', status, count(*) FROM plataforma.growth_opportunity GROUP BY status ORDER BY 3 DESC;
SELECT 'prioridade', priority_kind, count(*) FROM plataforma.growth_opportunity GROUP BY 2;
SELECT 'scores (histórico)', count(*) FROM plataforma.opportunity_score;
SELECT 'eventos', event_type, count(*) FROM plataforma.opportunity_event GROUP BY 2 ORDER BY 3 DESC;
SELECT 'top 5 por prioridade parcial', primary_query, intent, status, priority_kind, priority_value FROM plataforma.growth_opportunity ORDER BY priority_value DESC NULLS LAST, id LIMIT 5;
SELECT 'blueprints', ready, template_key, count(*) FROM plataforma.page_blueprint GROUP BY 2,3;
SELECT 'amostra de evidência', title, url, published_at::date FROM plataforma.evidence WHERE kind = 'news_item' ORDER BY published_at DESC LIMIT 3;
COMMIT;
SQL
