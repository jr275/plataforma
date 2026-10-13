#!/usr/bin/env bash
# Operação ADMINISTRATIVA (fora das migrations, ADR-013/ADR-017): cria um tenant no banco de DESENVOLVIMENTO do Neon. Idempotente:
# se o slug já existe, só mostra o id. Usa o papel executor (dono da tabela `tenant`; a aplicação não tem acesso a ela).
#
#   scripts/neon-create-tenant.sh --slug remax --name "RE/MAX (piloto)"
#
# A URL vem de NEON_MIGRATOR_URL em .env.neon.local (nunca é impressa). Recusa banco que não seja `plataforma` em PostgreSQL 16.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=lib/remote-conn.sh
source "$ROOT/scripts/lib/remote-conn.sh"
die() { echo "ERRO: $*" >&2; exit 2; }
SLUG=""; NAME=""
while [[ $# -gt 0 ]]; do case "$1" in --slug) SLUG="$2"; shift 2 ;; --name) NAME="$2"; shift 2 ;; *) die "argumento desconhecido: $1" ;; esac; done
[[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]{0,38}$ ]] || die "--slug inválido (minúsculas, dígitos e hífen, até 39)"
[[ -n "$NAME" && ${#NAME} -le 120 ]] || die "--name é obrigatório (até 120 caracteres)"
ENV_FILE="${NEON_ENV_FILE:-$ROOT/.env.neon.local}"
[[ -f "$ENV_FILE" ]] || die "arquivo de conexão ausente"
git -C "$ROOT" check-ignore -q "$ENV_FILE" || die "arquivo de conexão fora do .gitignore"
NEON_MIGRATOR_URL="$(sed -n 's/^NEON_MIGRATOR_URL=//p' "$ENV_FILE" | head -1)"; export NEON_MIGRATOR_URL
remote_conn_export NEON_MIGRATOR_URL
P=(psql -X -q -t -A -w -v ON_ERROR_STOP=1)
[[ "$("${P[@]}" -c "SELECT current_database() || ':' || (current_setting('server_version_num')::int / 10000)")" == "plataforma:16" ]] || die "banco ou versão inesperados"
"${P[@]}" -v slug="$SLUG" -v tname="$NAME" <<'SQL'
INSERT INTO plataforma.tenant (id, slug, name) VALUES (gen_random_uuid(), :'slug', :'tname') ON CONFLICT (slug) DO NOTHING;
SELECT 'tenant ' || slug || ' = ' || id FROM plataforma.tenant WHERE slug = :'slug';
SQL
