#!/usr/bin/env bash
# Executa db/checks/security_gate.sql (somente leitura; a mesma consulta usada pelo gate transacional do runner) e
# retorna código diferente de zero se houver "not ok".
# Toda a configuração é explícita; variáveis PG* do ambiente são ignoradas. Só socket Unix, sem senha.
#   scripts/check-catalog.sh --socket-dir /abs --port 5432 --dbname NOME --user PAPEL \
#       [--app-role menlo_app] [--ledger-schema plataforma_migrations] [--global-allow esq.tab,esq.tab] \
#       [--executor-role PAPEL] [--psql /caminho]
# Códigos: 0 tudo ok · 1 há verificação que falhou · 2 uso incorreto · 4 falha de conexão ou execução
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
die() { echo "ERRO DE USO: $*" >&2; exit 2; }
SOCKET_DIR="" PORT="" DBNAME="" DBUSER="" APP_ROLE="menlo_app" LEDGER_SCHEMA="plataforma_migrations" GLOBAL_ALLOW="" EXECUTOR_ROLE="" PSQL_BIN=""
while [[ $# -gt 0 ]]; do
  [[ $# -ge 2 ]] || die "$1 exige valor"
  case "$1" in
    --socket-dir) SOCKET_DIR="$2" ;; --port) PORT="$2" ;; --dbname) DBNAME="$2" ;; --user) DBUSER="$2" ;;
    --app-role) APP_ROLE="$2" ;; --ledger-schema) LEDGER_SCHEMA="$2" ;; --global-allow) GLOBAL_ALLOW="$2" ;; --executor-role) EXECUTOR_ROLE="$2" ;; --psql) PSQL_BIN="$2" ;;
    *) die "argumento desconhecido: $1" ;;
  esac
  shift 2
done
[[ "$SOCKET_DIR" == /* && -d "$SOCKET_DIR" ]] || die "--socket-dir deve ser um diretório de socket Unix existente (caminho absoluto)"
[[ "$PORT" =~ ^[0-9]{1,5}$ ]] || die "--port é obrigatório e numérico"
[[ "$DBNAME" =~ ^[a-z_][a-z0-9_]*$ && "$DBUSER" =~ ^[a-z_][a-z0-9_]*$ ]] || die "--dbname e --user são obrigatórios (minúsculas, dígitos e _)"
[[ "$APP_ROLE" =~ ^[a-z_][a-z0-9_]*$ && "$LEDGER_SCHEMA" =~ ^[a-z_][a-z0-9_]*$ ]] || die "--app-role e --ledger-schema inválidos"
[[ -z "$EXECUTOR_ROLE" || "$EXECUTOR_ROLE" =~ ^[a-z_][a-z0-9_]*$ ]] || die "--executor-role inválido"
[[ -z "$GLOBAL_ALLOW" || "$GLOBAL_ALLOW" =~ ^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)*$ ]] || die "--global-allow inválido (esquema.tabela,esquema.tabela)"
[[ -n "$PSQL_BIN" ]] || PSQL_BIN="$(command -v psql || true)"
[[ -n "$PSQL_BIN" && -x "$PSQL_BIN" ]] || die "psql não encontrado (use --psql)"
for v in $(env | sed -n 's/^\(PG[A-Z_]*\)=.*/\1/p'); do unset "$v"; done
unset DATABASE_URL
export PGCONNECT_TIMEOUT=10
# Somente leitura por construção: qualquer escrita nesta conexão falha.
export PGOPTIONS="-c default_transaction_read_only=on"
OUT="$(mktemp "${TMPDIR:-/tmp}/plataforma-catalog.XXXXXX")"; trap 'rm -f -- "$OUT" "$OUT.err" "$OUT.sql"' EXIT
# A consulta de db/checks/security_gate.sql é embutida em um único SELECT; search_path fixo (ver o comentário do arquivo).
{
  echo 'SET search_path = pg_catalog, pg_temp;'
  echo "SELECT CASE WHEN ok THEN 'ok - ' ELSE 'not ok - ' END || line FROM ("
  cat "$ROOT/db/checks/security_gate.sql"
  echo ') q ORDER BY ord;'
} > "$OUT.sql"
rc=0
"$PSQL_BIN" -X -q -t -A -h "$SOCKET_DIR" -p "$PORT" -U "$DBUSER" -d "$DBNAME" -w -v ON_ERROR_STOP=1 \
  -v "app_role=$APP_ROLE" -v "ledger_schema=$LEDGER_SCHEMA" -v "global_allow=$GLOBAL_ALLOW" -v "executor_role=$EXECUTOR_ROLE" -v "check_stale=on" \
  -f "$OUT.sql" >"$OUT" 2>"$OUT.err" || rc=$?
cat "$OUT"
if [[ "$rc" -ne 0 ]]; then cat "$OUT.err" >&2; echo "FALHA [conexão/execução]: não foi possível executar as verificações de catálogo" >&2; exit 4; fi
if grep -q '^not ok - ' "$OUT"; then exit 1; fi
if ! grep -q '^ok - ' "$OUT"; then echo "FALHA: nenhuma verificação foi executada" >&2; exit 4; fi
exit 0
