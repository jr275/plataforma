#!/usr/bin/env bash
# Ambiente de DESENVOLVIMENTO LOCAL com dados reais, sem tocar no Neon nem em nenhum banco persistente.
#
#   pnpm dev:local                     sobe tudo e liga o aplicativo (Ctrl+C encerra e apaga tudo)
#   scripts/dev-local.sh --setup-only  prepara, mostra o resultado e encerra (para conferir sem abrir o aplicativo)
#   scripts/dev-local.sh --tenant UUID usa outro tenant (padrão: o tenant `remax` do login)
#
# O que faz, nesta ordem:
#   1. PostgreSQL 16 DESCARTÁVEL (só socket Unix, em pasta temporária; ver scripts/lib/disposable-pg.sh);
#   2. papéis e banco (scripts/db-bootstrap.sh) e TODAS as migrations pelo runner, com o gate de segurança ativo;
#   3. cria o tenant (o MESMO uuid da claim do seu login, para o seu usuário enxergar estes dados);
#   4. importa o extrato REAL do IBGE de SP (db/test-fixtures/generation, 645 municípios, origem real);
#   5. gera os 20 rascunhos do piloto (as 20 maiores populações), com os 6 gates;
#   5b. semeia 4 oportunidades de TESTE (títulos "[teste local]") só neste banco descartável, para ver a tela Opportunity Discovery real;
#   6. escreve apps/web/.env.development.local (só enquanto roda) apontando o aplicativo para este banco local;
#   7. liga o aplicativo (`next dev`). Ao sair, apaga o arquivo .env.development.local, para o servidor e remove o banco.
# Nada aqui usa senha, URL de rede ou o Neon. O socket local só é aceito fora de produção (packages/api/src/pool.ts).
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
TENANT="fce17b74-dd74-42cf-bd4e-daec979c06be"
SETUP_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --setup-only) SETUP_ONLY=1; shift ;;
    --tenant) TENANT="${2:-}"; shift 2 ;;
    *) echo "argumento desconhecido: $1" >&2; exit 2 ;;
  esac
done
[[ "$TENANT" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "ERRO: --tenant deve ser um UUID" >&2; exit 2; }

ENVF="$ROOT/apps/web/.env.development.local"
[[ ! -e "$ENVF" ]] || { echo "ERRO: $ENVF já existe (outra execução em andamento ou arquivo seu). Não vou sobrescrevê-lo." >&2; exit 2; }

# shellcheck source=lib/disposable-pg.sh
source "$ROOT/scripts/lib/disposable-pg.sh"
WEB=""
finish() {
  # Encerra o aplicativo (e os filhos dele), apaga o arquivo de ambiente e deixa a biblioteca parar o banco e remover a pasta temporária.
  if [[ -n "$WEB" ]]; then pkill -TERM -P "$WEB" 2>/dev/null || true; kill -TERM "$WEB" 2>/dev/null || true; wait "$WEB" 2>/dev/null || true; fi
  rm -f "$ENVF"
  cleanup
}
trap finish EXIT INT TERM

DB=plataforma; MIG=plataforma_migrator; APP=menlo_app
say() { printf '\n== %s\n' "$*"; }

say "1/5 banco local descartável e papéis"
bash "$ROOT/scripts/db-bootstrap.sh" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --user rls_bootstrap --dbname "$DB" >/dev/null
echo "ok"

say "2/5 migrations (gate de segurança ativo)"
bash "$ROOT/scripts/db-migrate.sh" --socket-dir "$TMP" --port "$PORT" --psql "$PGBIN/psql" --dbname "$DB" --user "$MIG" --app-role "$APP" | tail -2

say "3/5 tenant"
"${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -c "INSERT INTO plataforma.tenant (id, slug, name) VALUES ('$TENANT', 'remax', 'RE/MAX (piloto, banco local)')" >/dev/null
echo "tenant remax = $TENANT"

URL="postgresql:///$DB?host=$(python3 -c 'import sys,urllib.parse as u; print(u.quote(sys.argv[1], safe=""))' "$TMP")&port=$PORT&user=$APP"
export PLATAFORMA_LOCAL_URL="$URL" NODE_ENV=development

say "4/5 importação REAL do IBGE (SP, 645 municípios)"
( cd "$ROOT/packages/api" && pnpm exec tsx src/ingest/cli.ts --env-var PLATAFORMA_LOCAL_URL --tenant "$TENANT" --file "$ROOT/db/test-fixtures/generation/sp-ibge-2026-10-12.csv" --origin real --source IBGE )

say "5/5 geração do piloto (20 maiores populações de SP)"
( cd "$ROOT/packages/api" && pnpm exec tsx src/pages/cli.ts --env-var PLATAFORMA_LOCAL_URL --tenant "$TENANT" --uf SP --limit 20 )

say "5b/5 oportunidades de TESTE (somente neste banco descartável, como menlo_app, no tenant)"
# Dados de tenant NÃO entram por migration (ADR-013). São registros fictícios para ver a tela real: o título leva "[teste local]" para nunca
# serem confundidos com dado de produção. Nada disto toca o Neon.
"${PSQL[@]}" -U "$APP" -d "$DB" -v ON_ERROR_STOP=1 >/dev/null <<SQL
BEGIN;
SELECT set_config('app.tenant_id', '$TENANT', true) IS NOT NULL;
INSERT INTO plataforma.opportunity (tenant_id, title, summary, next_action, kind, intent, demand, competition, evidence, status, rank, rationale, gaps) VALUES
 ('$TENANT', '[teste local] Guia de imóveis por município', 'Registro de teste para exercitar a tela real.', 'Montar o blueprint da página.', 'page', 'informational', 'high', 'medium', 'high', 'candidate', 1, ARRAY['Demanda local alta (registro de teste).'], ARRAY['Falta fonte de preços (registro de teste).']),
 ('$TENANT', '[teste local] Comparativo: alugar ou comprar', 'Registro de teste para exercitar a tela real.', 'Reunir as fontes antes de redigir.', 'comparison', 'comparison', 'medium', 'high', 'medium', 'in_review', 2, ARRAY['Tema recorrente (registro de teste).'], ARRAY[]::text[]),
 ('$TENANT', '[teste local] FAQ de financiamento', 'Registro de teste para exercitar a tela real.', 'Validar as respostas com um especialista.', 'faq', 'informational', 'medium', 'low', 'low', 'blocked', 3, ARRAY[]::text[], ARRAY['Sem fonte oficial conectada (registro de teste).']),
 ('$TENANT', '[teste local] Cluster de bairros', 'Registro de teste para exercitar a tela real.', 'Definir as entidades do cluster.', 'cluster', 'transactional', 'low', 'medium', 'medium', 'ready', 4, ARRAY['Cobertura local (registro de teste).'], ARRAY[]::text[]);
COMMIT;
SQL
echo "4 oportunidades de teste criadas neste banco local"

say "conferência (somente leitura, como menlo_app, no tenant)"
"${PSQL[@]}" -U "$APP" -d "$DB" -v ON_ERROR_STOP=1 <<SQL
BEGIN READ ONLY;
SELECT set_config('app.tenant_id', '$TENANT', true) IS NOT NULL;
SELECT 'cidades', count(*) FROM plataforma.city;
SELECT 'páginas em rascunho', count(*) FROM plataforma.page WHERE status = 'draft';
SELECT 'versões', count(*) FROM plataforma.page_version;
SELECT 'execuções de geração', count(*) FROM plataforma.generation_run;
SELECT 'oportunidades (teste local)', count(*) FROM plataforma.opportunity;
COMMIT;
SQL

if [[ "$SETUP_ONLY" -eq 1 ]]; then echo; echo "(--setup-only: encerrando e removendo o banco local)"; exit 0; fi

umask 077
printf 'PLATAFORMA_APP_DATABASE_URL=%s\n' "$URL" > "$ENVF"
cat <<MSG

==============================================================================================
Pronto. O aplicativo vai subir apontando para o BANCO LOCAL (dados reais do IBGE, só nesta máquina).
  1. Abra http://localhost:3000, entre com o seu usuário e clique em "Geração de páginas" ou em "Opportunity Discovery" (4 oportunidades de TESTE).
  2. Ctrl+C encerra tudo e apaga o banco e o arquivo apps/web/.env.development.local.
O Neon não é usado nem alterado.
==============================================================================================
MSG
( cd "$ROOT/apps/web" && exec pnpm exec next dev ) &
WEB=$!
wait "$WEB" || true
