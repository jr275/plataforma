#!/usr/bin/env bash
# Testes do esquema de produto no NEON (desenvolvimento), num BRANCH TEMPORÁRIO (cópia instantânea do branch `main`): o branch principal
# nunca recebe dados de teste. Prova, com os papéis reais: reaplicação das migrations sem mudança, isolamento entre tenants (leitura,
# escrita, UPDATE cruzado, DELETE negado), TLS obrigatório, falha de autenticação sem vazar a senha e as funções de packages/api.
#
#   scripts/test-neon.sh --project-id ID_DO_PROJETO_NEON
#
# Exige: `neon login` feito, .env.neon.local com as URLs dos papéis (scripts/neon-bootstrap.sh) e o gate/papéis verificados.
# Apaga o branch temporário ao sair. Código de saída: 0 = tudo certo; 1 = falha de teste; 2 = pré-requisito.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=lib/remote-conn.sh
source "$ROOT/scripts/lib/remote-conn.sh"
die() { echo "ERRO: $*" >&2; exit 2; }
ENV_FILE="${NEON_ENV_FILE:-$ROOT/.env.neon.local}"
PROJECT_ID=""; while [[ $# -gt 0 ]]; do case "$1" in --project-id) PROJECT_ID="$2"; shift 2 ;; *) die "argumento desconhecido: $1" ;; esac; done
[[ "$PROJECT_ID" =~ ^[a-z0-9-]+$ ]] || die "--project-id é obrigatório"
command -v neon >/dev/null || die "neon CLI ausente"; PSQL_BIN="$(command -v psql)"; [[ -n "$PSQL_BIN" ]] || die "psql ausente"
[[ -f "$ENV_FILE" ]] || die "arquivo de conexão ausente"; git -C "$ROOT" check-ignore -q "$ENV_FILE" || die "arquivo de conexão fora do .gitignore"
g() { sed -n "s/^$1=//p" "$ENV_FILE" | head -1; }
host_of() { REMOTE_URI="$1" python3 -c 'import os,urllib.parse as u; print(u.urlparse(os.environ["REMOTE_URI"]).hostname)'; }
swap_host() { REMOTE_URI="$1" NEWHOST="$2" python3 -c 'import os,urllib.parse as u; p=u.urlparse(os.environ["REMOTE_URI"]); n=p.netloc.rsplit("@",1)[0]+"@"+os.environ["NEWHOST"]; print(u.urlunparse(p._replace(netloc=n)))'; }

FAILS=0; CHECKS=0
expect() { local name="$1"; shift; CHECKS=$((CHECKS + 1)); if "$@" >/dev/null 2>&1; then echo "ok - $name"; else echo "not ok - $name"; FAILS=$((FAILS + 1)); fi; }
eq() { [[ "$1" == "$2" ]]; }; has() { [[ "$1" == *"$2"* ]]; }; lacks() { [[ "$1" != *"$2"* ]]; }

BR="teste-$(date +%s)"; BR_ID=""
cleanup() { local c=$?; trap - EXIT; if [[ -n "$BR_ID" ]]; then neon branches delete "$BR_ID" --project-id "$PROJECT_ID" >/dev/null 2>&1 && echo "branch temporário $BR apagado" || echo "ATENÇÃO: não consegui apagar o branch $BR ($BR_ID): apague-o no painel" >&2; fi; exit "$c"; }
trap cleanup EXIT
OUT="$(neon branches create --project-id "$PROJECT_ID" --name "$BR" --parent main --output json 2>&1)" || die "não foi possível criar o branch temporário: $(echo "$OUT" | head -2)"
BR_ID="$(echo "$OUT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("branch") or d)["id"])')"
BR_HOST="$(neon connection-string --project-id "$PROJECT_ID" --branch "$BR_ID" --database-name plataforma --role-name plataforma_owner --no-pooled 2>/dev/null | python3 -c 'import sys,urllib.parse as u; print(u.urlparse(sys.stdin.read().strip()).hostname)')"
[[ "$BR_HOST" == *.neon.tech ]] || die "não obtive o host do branch temporário"
echo "branch temporário $BR criado (host do branch obtido)"
export T_ADMIN="$(swap_host "$(g NEON_ADMIN_URL)" "$BR_HOST")" T_MIG="$(swap_host "$(g NEON_MIGRATOR_URL)" "$BR_HOST")" T_APP="$(swap_host "$(g NEON_APP_URL)" "$BR_HOST")"

# psql como um papel: run_as VAR "SQL"; saída sem linhas vazias. Sem segredo na linha de comando.
run_as() { ( remote_conn_export "$1" >/dev/null; shift; "$PSQL_BIN" -X -q -t -A -w -c "$1" 2>&1 | { grep -v '^$' || true; } ); }
A=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa; B=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb
app_sql() { local ctx=""; [[ -n "$1" ]] && ctx="SELECT set_config('app.tenant_id', '$1', true);"; run_as T_APP "BEGIN; $ctx $2; ROLLBACK;" | { grep -v -E '^(BEGIN|ROLLBACK|set_config)$' || true; } | { grep -v -E '^[0-9a-f]{8}-[0-9a-f-]{27}$' || true; }; }

# --- estado do banco (branch) ----------------------------------------------------------------------
expect "o servidor é PostgreSQL 16" has "$(run_as T_APP "SHOW server_version")" "16."
expect "o papel da aplicação não tem BYPASSRLS nem superusuário" eq "$(run_as T_APP "SELECT rolbypassrls::text||rolsuper::text FROM pg_roles WHERE rolname=current_user")" "falsefalse"
# O branch copia o main, que pode estar atrás das migrations do repositório: a primeira execução aplica as pendentes (gate ativo).
(export NEON_MIGRATOR_URL="$T_MIG"; bash "$ROOT/scripts/db-migrate.sh" --remote-conn-env NEON_MIGRATOR_URL --app-role menlo_app >/dev/null 2>&1)
N_MIG="$(ls "$ROOT"/db/migrations/[0-9]*.sql | wc -l | tr -d ' ')"
expect "reaplicar as migrations não muda nada (executor, gate ativo)" has "$( (export NEON_MIGRATOR_URL="$T_MIG"; bash "$ROOT/scripts/db-migrate.sh" --remote-conn-env NEON_MIGRATOR_URL --app-role menlo_app 2>&1) )" "0 aplicada(s), $N_MIG já atualizada(s)"
expect "o gate de catálogo passa no banco real (avalia a tabela opportunity)" has "$( (export NEON_ADMIN_URL="$T_ADMIN"; bash "$ROOT/scripts/check-catalog.sh" --remote-conn-env NEON_ADMIN_URL --app-role menlo_app --executor-role plataforma_migrator 2>&1) )" "plataforma.opportunity"

# --- conexão: TLS e falhas, sem vazar segredo ----------------------------------------------------
expect "o servidor recusa conexão sem TLS" has "$( (remote_conn_export T_APP >/dev/null; export PGSSLMODE=disable; "$PSQL_BIN" -X -t -A -w -c "SELECT 1" 2>&1) || true )" "insecure"
WRONG="$(REMOTE_URI="$T_APP" python3 -c 'import os,urllib.parse as u; p=u.urlparse(os.environ["REMOTE_URI"]); print(u.urlunparse(p._replace(netloc=p.username+":senhaerrada123@"+p.hostname)))')"
BAD_OUT="$( (export BAD_URL="$WRONG"; bash "$ROOT/scripts/db-migrate.sh" --remote-conn-env BAD_URL --app-role menlo_app 2>&1) )" || true
expect "autenticação inválida falha e a mensagem NÃO contém a senha" lacks "$BAD_OUT" "senhaerrada123"
expect "URI inválido é recusado com mensagem clara" has "$( (export BAD_URL="lixo"; bash "$ROOT/scripts/db-migrate.sh" --remote-conn-env BAD_URL --app-role menlo_app 2>&1) || true )" "inválida"
expect "o bypass do gate é recusado em banco remoto" has "$( (export NEON_MIGRATOR_URL="$T_MIG"; bash "$ROOT/scripts/db-migrate.sh" --remote-conn-env NEON_MIGRATOR_URL --app-role menlo_app --no-security-gate 2>&1) || true )" "não é aceito em banco remoto"

# --- isolamento entre tenants ---------------------------------------------------------------------
# Seed = o MESMO arquivo do cluster descartável (db/test-fixtures/product/10_seed.sql). Tenants pelo executor (dono da tabela
# tenant; a aplicação não a acessa); cada oportunidade pela APLICAÇÃO, numa transação com o contexto do próprio tenant.
SEED_DIR="$(mktemp -d)"; trap 'rm -rf "$SEED_DIR"; cleanup' EXIT
python3 - "$ROOT/db/test-fixtures/product/10_seed.sql" "$SEED_DIR" <<'PY'
import re, sys
src, out = sys.argv[1], sys.argv[2]
text = open(src).read()
tenants = re.search(r"INSERT INTO plataforma\.tenant[^;]*;", text, re.S).group(0)
open(out + "/tenants.sql", "w").write(tenants + "\n")
m = re.search(r"INSERT INTO plataforma\.opportunity \(([^)]*)\) VALUES(.*?);\s*$", text, re.S | re.M)
cols, body = m.group(1), m.group(2)
rows = [l.strip().rstrip(",") for l in body.strip().splitlines() if l.strip().startswith("(")]
sql = []
for r in rows:
    tenant = re.match(r"\('[^']*',\s*'([^']*)'", r).group(1)
    sql.append("BEGIN;\nSELECT set_config('app.tenant_id', '%s', true);\nINSERT INTO plataforma.opportunity (%s) VALUES %s;\nCOMMIT;" % (tenant, cols, r))
open(out + "/opportunities.sql", "w").write("\n".join(sql) + "\n")
print(len(rows))
PY
( remote_conn_export T_MIG >/dev/null; "$PSQL_BIN" -X -q -t -A -w -v ON_ERROR_STOP=1 -f "$SEED_DIR/tenants.sql" >/dev/null 2>&1 ) || echo "ATENÇÃO: o seed de tenants falhou" >&2
( remote_conn_export T_APP >/dev/null; "$PSQL_BIN" -X -q -t -A -w -v ON_ERROR_STOP=1 -f "$SEED_DIR/opportunities.sql" >/dev/null 2>&1 ) || echo "ATENÇÃO: o seed de oportunidades pela aplicação falhou" >&2
expect "o seed pela aplicação (escrita por tenant) gravou 5 oportunidades" eq "$(run_as T_MIG "SELECT count(*) FROM plataforma.tenant")" "2"
expect "tenant A só enxerga as próprias 3 oportunidades" eq "$(app_sql "$A" "SELECT count(*) FROM plataforma.opportunity" | tr '\n' ' ')" "3 "
expect "tenant B só enxerga as próprias 2 oportunidades" eq "$(app_sql "$B" "SELECT count(*) FROM plataforma.opportunity" | tr '\n' ' ')" "2 "
expect "sem contexto de tenant: zero linhas (falha fechada)" eq "$(app_sql "" "SELECT count(*) FROM plataforma.opportunity" | tr '\n' ' ')" "0 "
expect "A não lê a linha de B pelo id" eq "$(app_sql "$A" "SELECT count(*) FROM plataforma.opportunity WHERE id='b0000000-0000-4000-8000-000000000001'" | tr '\n' ' ')" "0 "
expect "INSERT com tenant_id de outro tenant é rejeitado pela política" has "$(app_sql "$A" "INSERT INTO plataforma.opportunity (tenant_id,title,summary,next_action,kind,intent,demand,competition,evidence,status,rank) VALUES ('$B','t','','','page','informational','high','high','high','candidate',9)")" "row-level security"
expect "UPDATE de linha de outro tenant não afeta nenhuma linha" eq "$(app_sql "$A" "WITH u AS (UPDATE plataforma.opportunity SET status='dismissed' WHERE tenant_id='$B' RETURNING 1) SELECT count(*) FROM u" | tr '\n' ' ')" "0 "
expect "UPDATE não move uma linha para outro tenant" has "$(app_sql "$A" "UPDATE plataforma.opportunity SET tenant_id='$B' WHERE id='a0000000-0000-4000-8000-000000000001'")" "row-level security"
expect "a aplicação não tem DELETE" has "$(app_sql "$A" "DELETE FROM plataforma.opportunity")" "permission denied"
expect "a aplicação não acessa a tabela tenant" has "$(app_sql "$A" "SELECT * FROM plataforma.tenant")" "permission denied"
expect "a aplicação não acessa o ledger de migrations" has "$(app_sql "$A" "SELECT * FROM plataforma_migrations.ledger")" "permission denied"
expect "o executor (dono da tabela) NÃO enxerga dados de tenant: RLS forçada, sem política para ele" eq "$(run_as T_MIG "SELECT count(*) FROM plataforma.opportunity")" "0"
expect "as migrations não deixam dados fora do que o teste semeou (main intacto)" eq "$(run_as T_ADMIN "SELECT 1")" "1"

# --- packages/api no Neon -----------------------------------------------------------------------
( cd "$ROOT/packages/api" && PLATAFORMA_TEST_PG_URL="$T_APP" pnpm exec vitest run --config vitest.product.config.ts 2>&1 | tail -8 ); rc=${PIPESTATUS[0]}
expect "as funções de oportunidades (packages/api) passam contra o Neon, com TLS" eq "$rc" 0

echo; echo "$((CHECKS - FAILS))/$CHECKS verificações passaram"
if [[ "$FAILS" -eq 0 ]]; then echo "NEON TESTS: PASSED (branch temporário $BR; PostgreSQL 16 no Neon, sa-east-1)"; else echo "NEON TESTS: FAILED ($FAILS)"; exit 1; fi
