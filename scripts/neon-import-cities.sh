#!/usr/bin/env bash
# Carga REAL de municípios do IBGE no Neon de DESENVOLVIMENTO, para um tenant (ADR-017). Baixa o CSV numa pasta temporária (fora
# do Git, apagada ao sair) e importa com a credencial da aplicação (NEON_APP_URL de .env.neon.local; nunca é impressa).
#
#   scripts/neon-import-cities.sh --tenant UUID [--file CSV_PRONTO]
#
# Idempotente: reimportar atualiza as cidades e cria uma nova execução no histórico.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
die() { echo "ERRO: $*" >&2; exit 2; }
TENANT=""; FILE=""
while [[ $# -gt 0 ]]; do case "$1" in --tenant) TENANT="$2"; shift 2 ;; --file) FILE="$2"; shift 2 ;; *) die "argumento desconhecido: $1" ;; esac; done
[[ "$TENANT" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || die "--tenant deve ser um UUID"
ENV_FILE="${NEON_ENV_FILE:-$ROOT/.env.neon.local}"
[[ -f "$ENV_FILE" ]] || die "arquivo de conexão ausente"
git -C "$ROOT" check-ignore -q "$ENV_FILE" || die "arquivo de conexão fora do .gitignore"
NEON_APP_URL="$(sed -n 's/^NEON_APP_URL=//p' "$ENV_FILE" | head -1)"; export NEON_APP_URL
[[ "$NEON_APP_URL" == postgres*://*sslmode=require* ]] || die "NEON_APP_URL ausente ou sem sslmode=require"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
if [[ -z "$FILE" ]]; then FILE="$TMP/ibge-municipios.csv"; node "$ROOT/scripts/fetch-ibge-cities.mjs" "$FILE"; fi
[[ -f "$FILE" ]] || die "arquivo CSV não encontrado"
cd "$ROOT/packages/api"
NODE_ENV=development pnpm exec tsx src/ingest/cli.ts --env-var NEON_APP_URL --tenant "$TENANT" --file "$FILE" --origin real --source IBGE
