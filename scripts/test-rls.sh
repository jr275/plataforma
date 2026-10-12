#!/usr/bin/env bash
# Harness de RLS: sobe um PostgreSQL 16 DESCARTÁVEL, aplica só a fixture de teste, roda os testes
# e apaga tudo. Não instala nada, não usa Docker/Neon/DATABASE_URL e não toca em outro Postgres.
# Código de saída: 0 = tudo certo; diferente de zero = falha.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
FX="$ROOT/db/test-fixtures/rls"

# shellcheck source=lib/disposable-pg.sh
source "$ROOT/scripts/lib/disposable-pg.sh"

# --- funções ------------------------------------------------------------------------------------
new_db() { # $1 = nome do banco
  "${PSQL[@]}" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $1 OWNER rls_fixture_owner TEMPLATE template0" >/dev/null
  "${PSQL[@]}" -d "$1" -v ON_ERROR_STOP=1 -v dbname="$1" -f "$FX/10_fixture.sql" >/dev/null
}

run_suite() { # $1 = banco, $2 = ON_ERROR_STOP (1|0); imprime as linhas de resultado e erros
  local db="$1" stop="$2"
  "${PSQL[@]}" -d "$db" -U menlo_app -v ON_ERROR_STOP="$stop" -f "$FX/tests/10_app_isolation.sql" 2>&1 || echo "ERROR: psql exited nonzero (app)"
  "${PSQL[@]}" -d "$db" -U rls_fixture_owner -v ON_ERROR_STOP="$stop" -f "$FX/tests/20_owner.sql" 2>&1 || echo "ERROR: psql exited nonzero (owner)"
  "${PSQL[@]}" -d "$db" -U rls_bootstrap -v ON_ERROR_STOP="$stop" -f "$FX/tests/30_superuser_integrity.sql" 2>&1 || echo "ERROR: psql exited nonzero (superuser)"
}

count_matches() { grep -c -E "$1" <<<"$2" || true; }

FAILED=0
reset_roles() { "${PSQL[@]}" -d postgres -v ON_ERROR_STOP=1 -f "$FX/00_roles.sql" >/dev/null; }

# --- execução principal -------------------------------------------------------------------------
reset_roles
new_db rls_main

echo
echo "== Suíte principal (execução 1) =="
OUT1="$(run_suite rls_main 1)"
echo "$OUT1"
PASS1="$(count_matches '^ok - ' "$OUT1")"
BAD1="$(( $(count_matches '^not ok - ' "$OUT1") + $(count_matches 'ERROR|FATAL' "$OUT1") ))"
echo "-- execução 1: $PASS1 ok, $BAD1 falhas"
[[ "$BAD1" -eq 0 && "$PASS1" -gt 0 ]] || FAILED=1

OUT2="$(run_suite rls_main 1)"
if [[ "$OUT1" == "$OUT2" ]]; then
  echo "ok - T8 repeating the run on the same database produces identical results"
else
  echo "not ok - T8 repeating the run produced different results"; FAILED=1
fi

# --- mutações: configurações erradas DEVEM derrubar a suíte -------------------------------------
echo
echo "== Mutações (a suíte precisa FALHAR em cada uma) =="
MUT_TOTAL=0; MUT_DETECTED=0
for m in "$FX"/mutations/*.sql; do
  name="$(basename "$m" .sql)"
  MUT_TOTAL=$((MUT_TOTAL + 1))
  new_db "rls_mut_$name"
  "${PSQL[@]}" -d "rls_mut_$name" -v ON_ERROR_STOP=1 -f "$m" >/dev/null
  OUTM="$(run_suite "rls_mut_$name" 0)"
  reset_roles
  BADM="$(( $(count_matches '^not ok - ' "$OUTM") + $(count_matches 'ERROR|FATAL' "$OUTM") ))"
  if [[ "$BADM" -gt 0 ]]; then
    MUT_DETECTED=$((MUT_DETECTED + 1))
    echo "ok - T9 mutation '$name' is detected ($BADM failing check(s))"
    grep -E '^not ok - ' <<<"$OUTM" | head -3 | sed 's/^/       /' || true
  else
    echo "not ok - T9 mutation '$name' was NOT detected (the suite still passed)"; FAILED=1
  fi
done

# Depois das mutações, os papéis foram restaurados: a suíte principal volta a passar igual.
OUT3="$(run_suite rls_main 1)"
if [[ "$OUT1" == "$OUT3" ]]; then
  echo "ok - T8 after the mutations, roles are restored and the main suite result is unchanged"
else
  echo "not ok - T8 main suite result changed after the mutations"; FAILED=1
fi

echo
if [[ "$FAILED" -eq 0 ]]; then
  echo "RLS HARNESS: PASSED ($PASS1 checks, $MUT_DETECTED/$MUT_TOTAL mutations detected) on PostgreSQL $("${PSQL[@]}" -d postgres -c 'SHOW server_version')"
else
  echo "RLS HARNESS: FAILED" >&2
  exit 1
fi
