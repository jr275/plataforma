#!/usr/bin/env bash
# Runner de migrations SQL (ADR-011: SQL escrito à mão é a única autoridade do esquema; ADR-013: papéis).
# Documentação completa: db/migrations/README.md
#
# Dois modos, com papéis diferentes (toda a configuração é EXPLÍCITA; variáveis PG* do ambiente são ignoradas):
#
#   1) Inicializar o ledger, UMA vez, como o dono do ledger (administrador; NÃO é o executor):
#      scripts/db-migrate.sh --init-ledger --executor PAPEL_EXECUTOR \
#          --socket-dir /caminho/absoluto --port 5432 --dbname NOME --user PAPEL_ADMIN
#
#   2) Aplicar migrations, como o executor (sem ser dono do ledger):
#      scripts/db-migrate.sh --socket-dir /caminho/absoluto --port 5432 --dbname NOME --user PAPEL_EXECUTOR \
#          --app-role PAPEL_DA_APLICACAO [--global-allow esq.tab,...] \
#          [--migrations-dir DIR] [--lock-timeout 30s] [--expect-head N[:SHA256]] [--psql /caminho/do/psql]
#      O gate de segurança (db/checks/security_gate.sql) roda DENTRO da transação de cada migration, antes do registro
#      no ledger e do COMMIT; só se desliga com --no-security-gate explícito (nunca em produção).
#
# Só conecta por socket Unix (sem TCP, sem senha): ver "Decisões pendentes" no README. Código de saída:
#   0 ok · 1 falha de integridade, de validação ou de SQL · 2 uso incorreto ou pré-requisito ausente
#   3 timeout ao esperar o lock · 4 falha de conexão ou de execução no banco
set -Eeuo pipefail

die_usage() { echo "ERRO DE USO: $*" >&2; exit 2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
REMOTE_ENV="" SOCKET_DIR="" PORT="" DBNAME="" DBUSER="" LOCK_TIMEOUT="30s" PSQL_BIN="" EXECUTOR="" EXPECT_HEAD="" INIT=0
APP_ROLE="" GLOBAL_ALLOW="" NO_GATE=0 LEDGER_SCHEMA="plataforma_migrations"
MIG_DIR="$ROOT/db/migrations"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --init-ledger)    INIT=1; shift ;;
    --executor)       [[ $# -ge 2 ]] || die_usage "$1 exige valor"; EXECUTOR="$2"; shift 2 ;;
    --app-role)       [[ $# -ge 2 ]] || die_usage "$1 exige valor"; APP_ROLE="$2"; shift 2 ;;
    --global-allow)   [[ $# -ge 2 ]] || die_usage "$1 exige valor"; GLOBAL_ALLOW="$2"; shift 2 ;;
    --no-security-gate) NO_GATE=1; shift ;;
    --expect-head)    [[ $# -ge 2 ]] || die_usage "$1 exige valor"; EXPECT_HEAD="$2"; shift 2 ;;
    --remote-conn-env) [[ $# -ge 2 ]] || die_usage "$1 exige valor"; REMOTE_ENV="$2"; shift 2 ;;
    --socket-dir)     [[ $# -ge 2 ]] || die_usage "$1 exige valor"; SOCKET_DIR="$2"; shift 2 ;;
    --port)           [[ $# -ge 2 ]] || die_usage "$1 exige valor"; PORT="$2"; shift 2 ;;
    --dbname)         [[ $# -ge 2 ]] || die_usage "$1 exige valor"; DBNAME="$2"; shift 2 ;;
    --user)           [[ $# -ge 2 ]] || die_usage "$1 exige valor"; DBUSER="$2"; shift 2 ;;
    --migrations-dir) [[ $# -ge 2 ]] || die_usage "$1 exige valor"; MIG_DIR="$2"; shift 2 ;;
    --lock-timeout)   [[ $# -ge 2 ]] || die_usage "$1 exige valor"; LOCK_TIMEOUT="$2"; shift 2 ;;
    --psql)           [[ $# -ge 2 ]] || die_usage "$1 exige valor"; PSQL_BIN="$2"; shift 2 ;;
    *) die_usage "argumento desconhecido: $1" ;;
  esac
done

if [[ -n "$REMOTE_ENV" ]]; then
  # Modo remoto (ex.: Neon): a conexão vem de uma variável de ambiente NOMEADA (URI libpq com TLS); nada de socket, porta,
  # banco ou usuário na linha de comando, e o bypass do gate nunca é aceito.
  [[ -z "$SOCKET_DIR" && -z "$PORT" && -z "$DBNAME" && -z "$DBUSER" ]] || die_usage "--remote-conn-env não combina com --socket-dir, --port, --dbname nem --user"
  [[ "$NO_GATE" -eq 0 ]] || die_usage "--no-security-gate não é aceito em banco remoto"
else
  [[ -n "$SOCKET_DIR" ]] || die_usage "--socket-dir é obrigatório (diretório do socket Unix, caminho absoluto)"
  [[ "$SOCKET_DIR" == /* ]] || die_usage "--socket-dir deve ser um caminho absoluto de diretório de socket Unix (TCP não é suportado)"
  [[ -d "$SOCKET_DIR" ]] || die_usage "--socket-dir não existe: $SOCKET_DIR"
  [[ "$PORT" =~ ^[0-9]{1,5}$ ]] || die_usage "--port é obrigatório e numérico"
  [[ "$DBNAME" =~ ^[a-z_][a-z0-9_]*$ ]] || die_usage "--dbname é obrigatório (minúsculas, dígitos e _)"
  [[ "$DBUSER" =~ ^[a-z_][a-z0-9_]*$ ]] || die_usage "--user é obrigatório (minúsculas, dígitos e _)"
fi
[[ "$LOCK_TIMEOUT" =~ ^[0-9]+(ms|s|min)$ ]] || die_usage "--lock-timeout inválido (ex.: 30s, 500ms, 2min)"
if [[ "$INIT" -eq 1 ]]; then
  [[ "$EXECUTOR" =~ ^[a-z_][a-z0-9_]*$ ]] || die_usage "--init-ledger exige --executor PAPEL (minúsculas, dígitos e _)"
  [[ -z "$EXPECT_HEAD" && -z "$APP_ROLE" && -z "$GLOBAL_ALLOW" && "$NO_GATE" -eq 0 ]] || die_usage "--expect-head, --app-role, --global-allow e --no-security-gate não se aplicam a --init-ledger"
else
  [[ -z "$EXECUTOR" ]] || die_usage "--executor só se aplica a --init-ledger"
  if [[ "$NO_GATE" -eq 0 ]]; then
    [[ "$APP_ROLE" =~ ^[a-z_][a-z0-9_]*$ ]] || die_usage "o gate de segurança exige --app-role PAPEL (ou, só em testes, --no-security-gate explícito)"
    [[ -z "$GLOBAL_ALLOW" || "$GLOBAL_ALLOW" =~ ^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)*$ ]] || die_usage "--global-allow inválido (esquema.tabela,esquema.tabela)"
  else
    [[ -z "$APP_ROLE" && -z "$GLOBAL_ALLOW" ]] || die_usage "--no-security-gate não combina com --app-role nem com --global-allow"
    echo "AVISO: o gate de segurança está DESABILITADO (--no-security-gate); isto só é aceitável em testes do runner, nunca em produção" >&2
  fi
  [[ -z "$EXPECT_HEAD" || "$EXPECT_HEAD" =~ ^[0-9]{1,4}(:[0-9a-f]{64})?$ ]] || die_usage "--expect-head inválido (use N ou N:SHA256 em hexadecimal minúsculo)"
  [[ -d "$MIG_DIR" ]] || die_usage "diretório de migrations não existe: $MIG_DIR"
  MIG_DIR="$(cd "$MIG_DIR" && pwd -P)"
  [[ "$MIG_DIR" != *"'"* ]] || die_usage "o caminho do diretório de migrations não pode conter aspas simples"
fi
[[ -n "$PSQL_BIN" ]] || PSQL_BIN="$(command -v psql || true)"
[[ -n "$PSQL_BIN" && -x "$PSQL_BIN" ]] || die_usage "psql não encontrado (use --psql)"

# Nada de descoberta silenciosa: ignora qualquer configuração libpq vinda do ambiente.
for v in $(env | sed -n 's/^\(PG[A-Z_]*\)=.*/\1/p'); do unset "$v"; done
unset DATABASE_URL
export PGCONNECT_TIMEOUT=10
if [[ -n "$REMOTE_ENV" ]]; then
  # shellcheck source=lib/remote-conn.sh
  source "$ROOT/scripts/lib/remote-conn.sh"
  remote_conn_export "$REMOTE_ENV" || die_usage "conexão remota inválida (variável $REMOTE_ENV)"
  DBNAME="$PGDATABASE"; DBUSER="$PGUSER"
  [[ "$DBNAME" =~ ^[a-z_][a-z0-9_]*$ && "$DBUSER" =~ ^[a-z_][a-z0-9_]*$ ]] || die_usage "banco e usuário do URI remoto precisam ser minúsculas, dígitos e _"
  CONN=()
else
  CONN=(-h "$SOCKET_DIR" -p "$PORT" -U "$DBUSER" -d "$DBNAME")
fi

# --- bypass explícito do gate: só em cluster descartável COMPROVADO -----------------------------
# O gate é obrigatório. --no-security-gate só é aceito quando o servidor alvo prova ser um cluster descartável criado por
# scripts/lib/disposable-pg.sh: (1) o arquivo .disposable-pg-marker no --socket-dir contém um nonce; (2) o servidor em
# execução foi iniciado com o MESMO nonce (parâmetro plataforma.disposable_nonce) e (3) não escuta em rede. Um arquivo
# comum não basta: ele precisa casar com o servidor ao qual o runner está conectado. Isto protege contra acidente
# (apontar o bypass para outro servidor local); NÃO protege contra um administrador local malicioso, que controla o
# arquivo, o servidor e o runner.
if [[ "$INIT" -eq 0 && "$NO_GATE" -eq 1 ]]; then
  MARKER_FILE="$SOCKET_DIR/.disposable-pg-marker"
  [[ -f "$MARKER_FILE" && ! -L "$MARKER_FILE" ]] || die_usage "--no-security-gate recusado: o servidor alvo não prova ser um cluster descartável (marcador ausente em --socket-dir)"
  MARKER_CONTENT="$(cat "$MARKER_FILE" 2>/dev/null || true)"
  [[ "$MARKER_CONTENT" =~ ^plataforma-disposable-cluster\ v1\ ([0-9a-f]{32})$ ]] || die_usage "--no-security-gate recusado: o marcador de cluster descartável é inválido"
  MARKER_NONCE="${BASH_REMATCH[1]}"
  SERVER_PROOF="$("$PSQL_BIN" -X -q -t -A ${CONN[@]+"${CONN[@]}"} -w -v ON_ERROR_STOP=1 \
      -c "SELECT coalesce(current_setting('plataforma.disposable_nonce', true), '') || '|' || current_setting('listen_addresses')" 2>/dev/null)" \
    || { echo "FALHA [conexão/execução]: não foi possível conectar ao servidor para comprovar que é descartável (--no-security-gate)" >&2; exit 4; }
  [[ "$SERVER_PROOF" == "$MARKER_NONCE|" ]] || die_usage "--no-security-gate recusado: o servidor alvo não corresponde ao marcador de cluster descartável (nonce divergente ou servidor com rede)"
fi

# --- SHA-256 (ferramenta do sistema; checada contra o vetor de teste da entrada vazia) ----------
if command -v sha256sum >/dev/null 2>&1 && [[ "$(printf '' | sha256sum 2>/dev/null | cut -d' ' -f1)" == e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 ]]; then
  hash_file() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1 && [[ "$(printf '' | shasum -a 256 | cut -d' ' -f1)" == e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 ]]; then
  hash_file() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  die_usage "nenhuma ferramenta SHA-256 confiável (sha256sum ou shasum)"
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/plataforma-migrate.XXXXXX")"
WORK="$(cd "$WORK" && pwd -P)"
chmod 700 "$WORK"
: > "$WORK/.migrate-marker"
trap 'if [[ -n "${WORK:-}" && "$WORK" == */plataforma-migrate.* && -f "$WORK/.migrate-marker" ]]; then rm -rf -- "$WORK"; fi' EXIT
[[ "$WORK" != *"'"* ]] || die_usage "TMPDIR não pode conter aspas simples"
mkdir "$WORK/snap"
SORTED="$WORK/sorted.txt"; : > "$SORTED"

# --- descoberta e validação local (só no modo de aplicação; antes de qualquer conexão) ----------
if [[ "$INIT" -eq 0 ]]; then
  LIST="$WORK/list.txt"; : > "$LIST"
  while IFS= read -r -d '' p; do
    name="$(basename "$p")"
    [[ "$name" == "README.md" && -f "$p" && ! -L "$p" ]] && continue
    [[ -f "$p" && ! -L "$p" ]] || { echo "FALHA [validação]: entrada inválida em db/migrations (só arquivos regulares): $name" >&2; exit 1; }
    if [[ ! "$name" =~ ^([0-9]{4})_[a-z0-9][a-z0-9_]*\.sql$ ]]; then
      echo "FALHA [validação]: nome de migration inválido: '$name' (esperado NNNN_descricao.sql: 4 dígitos, minúsculas, dígitos e _)" >&2; exit 1
    fi
    seq="$((10#${BASH_REMATCH[1]}))"
    [[ "$seq" -ge 1 ]] || { echo "FALHA [validação]: a numeração começa em 0001: '$name'" >&2; exit 1; }
    printf '%d %s\n' "$seq" "$name" >> "$LIST"
  done < <(find "$MIG_DIR" -mindepth 1 -maxdepth 1 -print0)

  # Ordem numérica (não lexicográfica), duplicatas e lacunas.
  sort -n -k1,1 -s "$LIST" > "$SORTED"
  expected=1; prev_seq=0; prev_name=""
  while read -r seq name; do
    if [[ "$seq" -eq "$prev_seq" ]]; then
      echo "FALHA [validação]: número de sequência duplicado $(printf '%04d' "$seq"): '$prev_name' e '$name'" >&2; exit 1
    fi
    if [[ "$seq" -ne "$expected" ]]; then
      echo "FALHA [validação]: lacuna na numeração: esperado $(printf '%04d' "$expected"), encontrado '$name'" >&2; exit 1
    fi
    expected=$((expected + 1)); prev_seq="$seq"; prev_name="$name"
  done < "$SORTED"

  # Verificações de ENTRADA. A aplicação das regras de execução NÃO depende delas: a migration é executada como TEXTO
  # (literal entre aspas de dólar dentro de um DO ... EXECUTE), nunca interpretada pelo psql, e controle de transação é
  # recusado pelo próprio PostgreSQL. As duas varreduras por linha abaixo são avisos antecipados e amigáveis, NÃO um
  # analisador SQL, e não são consideradas completas.
  while read -r seq name; do
    f="$MIG_DIR/$name"
    if ! tr -d '\000' < "$f" | cmp -s - "$f"; then
      echo "FALHA [validação]: $name contém bytes nulos" >&2; exit 1
    fi
    if [[ -z "$(tr -d '[:space:]' < "$f")" ]]; then
      echo "FALHA [validação]: $name está vazio" >&2; exit 1
    fi
    if grep -n -E '^[[:space:]]*\\' "$f" >/dev/null 2>&1; then
      echo "FALHA [validação]: $name tem uma linha iniciada por barra invertida (sintaxe de metacomando do psql); migrations são SQL puro e nenhum metacomando é interpretado" >&2; exit 1
    fi
    if grep -n -i -E '^[[:space:]]*(commit|rollback|abort|savepoint|release|start[[:space:]]+transaction|prepare[[:space:]]+transaction|begin[[:space:]]*(;|transaction|work|isolation|read))' "$f" >/dev/null 2>&1; then
      echo "FALHA [validação]: $name tem uma linha que começa com controle de transação (BEGIN/COMMIT/ROLLBACK/SAVEPOINT...); controle de transação não é suportado em migrations (o runner já executa cada migration em uma transação)" >&2; exit 1
    fi
    # Marcadores de aspas de dólar derivados do conteúdo: o texto da migration não pode contê-los.
    h="$(hash_file "$f")"
    if grep -F -q "\$m${h:0:20}\$" "$f" || grep -F -q "\$r${h:20:20}\$" "$f"; then
      echo "FALHA [validação]: $name contém um marcador interno reservado do runner" >&2; exit 1
    fi
  done < "$SORTED"

  # Instantâneo: os bytes que são somados e executados são exatamente os mesmos.
  while read -r seq name; do
    cp "$MIG_DIR/$name" "$WORK/snap/$name"
    chmod 600 "$WORK/snap/$name"
  done < "$SORTED"
fi

# --- SQL compartilhado: estrutura do ledger e da tabela de lock ---------------------------------
LEDGER_STRUCTURE_SQL='
DO $$
DECLARE cols text; ncons int; ntrg int;
BEGIN
  IF to_regclass($q$plataforma_migrations.ledger$q$) IS NULL OR to_regclass($q$plataforma_migrations.run_lock$q$) IS NULL THEN
    RAISE EXCEPTION $q$ledger ausente: o ledger precisa ser inicializado antes, com --init-ledger, pelo administrador dono do ledger$q$;
  END IF;
  IF (SELECT relkind FROM pg_class WHERE oid = $q$plataforma_migrations.ledger$q$::regclass) IS DISTINCT FROM $q$r$q$
     OR (SELECT relkind FROM pg_class WHERE oid = $q$plataforma_migrations.run_lock$q$::regclass) IS DISTINCT FROM $q$r$q$ THEN
    RAISE EXCEPTION $q$ledger inconsistente: ledger e run_lock devem ser tabelas comuns$q$;
  END IF;
  SELECT string_agg(a.attname || $q$:$q$ || format_type(a.atttypid, a.atttypmod) || $q$:$q$ || CASE WHEN a.attnotnull THEN $q$NO$q$ ELSE $q$YES$q$ END, $q$,$q$ ORDER BY a.attnum)
    INTO cols FROM pg_attribute a
   WHERE a.attrelid = $q$plataforma_migrations.ledger$q$::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF cols IS DISTINCT FROM $q$seq:integer:NO,filename:text:NO,sha256:text:NO,applied_at:timestamp with time zone:NO,applied_by:name:NO$q$ THEN
    RAISE EXCEPTION $q$ledger inconsistente: estrutura inesperada (%)$q$, coalesce(cols, $q$ausente$q$);
  END IF;
  SELECT count(*) INTO ncons FROM pg_constraint
   WHERE conrelid = $q$plataforma_migrations.ledger$q$::regclass AND contype IN ($q$p$q$, $q$u$q$, $q$c$q$);
  IF ncons <> 6 THEN
    RAISE EXCEPTION $q$ledger inconsistente: restrições inesperadas (% encontradas, 6 esperadas)$q$, ncons;
  END IF;
  SELECT string_agg(a.attname || $q$:$q$ || format_type(a.atttypid, a.atttypmod), $q$,$q$ ORDER BY a.attnum)
    INTO cols FROM pg_attribute a
   WHERE a.attrelid = $q$plataforma_migrations.run_lock$q$::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF cols IS DISTINCT FROM $q$id:integer$q$ THEN
    RAISE EXCEPTION $q$ledger inconsistente: estrutura inesperada de run_lock (%)$q$, coalesce(cols, $q$ausente$q$);
  END IF;
  SELECT count(*) INTO ntrg FROM pg_trigger
   WHERE tgrelid = $q$plataforma_migrations.ledger$q$::regclass AND NOT tgisinternal AND tgenabled = $q$O$q$
     AND tgname IN ($q$ledger_no_update_delete$q$, $q$ledger_no_truncate$q$);
  IF ntrg <> 2 THEN
    RAISE EXCEPTION $q$ledger inconsistente: gatilhos append-only ausentes ou desabilitados (% ativos, 2 esperados)$q$, ntrg;
  END IF;
END $$;'


# --- gate de segurança: a consulta única de db/checks/security_gate.sql, executada no catálogo real ----------
GATE_CORE=""
if [[ "$INIT" -eq 0 && "$NO_GATE" -eq 0 ]]; then
  GATE_CORE="$(cat "$ROOT/db/checks/security_gate.sql")"
fi
gate_sql() { # gate_sql "mensagem de falha": verifica; se houver "not ok", imprime e levanta exceção (desfaz a transação)
  echo "SELECT (count(*) FILTER (WHERE NOT ok) = 0) AS gate_ok FROM ("
  echo "$GATE_CORE"
  echo ") gq \\gset"
  echo '\if :gate_ok'
  echo '\else'
  echo "SELECT 'not ok - ' || line FROM ("
  echo "$GATE_CORE"
  echo ") gq WHERE NOT ok ORDER BY ord;"
  echo "DO \$\$ BEGIN RAISE EXCEPTION '$1'; END \$\$;"
  echo '\endif'
}

# validate_history(): recriada (CREATE OR REPLACE) no início de cada transação; os dados dos arquivos vão DENTRO da função
# (sem tabela temporária que uma migration pudesse substituir) e o search_path é fixado na própria função.
emit_validate_fn() {
  local values="" seq name
  while read -r seq name; do
    values+="${values:+,}($seq, '$name', '$(hash_file "$WORK/snap/$name")')"
  done < "$SORTED"
  [[ -n "$values" ]] || values="SELECT NULL::integer, NULL::text, NULL::text WHERE false"
  [[ "$values" == SELECT* ]] || values="VALUES $values"
  cat <<SQL
CREATE OR REPLACE FUNCTION pg_temp.validate_history() RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS \$f\$
DECLARE n int; m int; r record;
BEGIN
  SELECT count(*), coalesce(max(seq), 0) INTO n, m FROM plataforma_migrations.ledger;
  IF n <> m THEN
    RAISE EXCEPTION 'ledger inconsistente: lacuna na sequência aplicada (% entradas, maior número %)', n, m;
  END IF;
  FOR r IN
    WITH f(seq, filename, sha256) AS ($values)
    SELECT l.seq, l.filename AS l_name, l.sha256 AS l_sha, f.filename AS f_name, f.sha256 AS f_sha,
           (SELECT f2.filename FROM f f2 WHERE f2.sha256 = l.sha256 LIMIT 1) AS same_content
      FROM plataforma_migrations.ledger l LEFT JOIN f ON f.seq = l.seq
     ORDER BY l.seq
  LOOP
    IF r.f_name IS NULL THEN
      IF r.same_content IS NOT NULL THEN
        RAISE EXCEPTION 'migration aplicada % foi renomeada ou renumerada (mesmo conteúdo agora em %)', r.l_name, r.same_content;
      END IF;
      RAISE EXCEPTION 'migration aplicada % está ausente do diretório', r.l_name;
    ELSIF r.f_name <> r.l_name THEN
      RAISE EXCEPTION 'migration aplicada % foi renomeada ou substituída (agora: %)', r.l_name, r.f_name;
    ELSIF r.f_sha <> r.l_sha THEN
      RAISE EXCEPTION 'migration aplicada % foi editada após a aplicação (sha256 registrado %, atual %)',
        r.l_name, left(r.l_sha, 12), left(r.f_sha, 12);
    END IF;
  END LOOP;
END \$f\$;
SQL
}

# --- script psql: uma ÚNICA sessão -------------------------------------------------------------
SCRIPT="$WORK/run.psql"
{
  echo '\set ON_ERROR_STOP on'
  echo '\set VERBOSITY terse'
  echo '\set SHOW_CONTEXT never'
  echo '\echo ##stage connect-check'
  # Todos os comandos do runner usam search_path fixo; o catálogo vem sempre primeiro, pg_temp por último.
  echo 'SET search_path = pg_catalog, pg_temp;'
  cat <<'SQL'
SELECT current_setting('server_version_num')::int >= 150000 AS pg_ok \gset
\if :pg_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'PostgreSQL 15 ou superior é exigido (encontrado %)', current_setting('server_version'); END $$;
\endif
SELECT current_setting('server_version') AS server_version \gset
\echo ##server :server_version
SQL
  if [[ "$INIT" -eq 0 && "$NO_GATE" -eq 0 ]]; then
    echo "\\set app_role '$APP_ROLE'"
    echo "\\set ledger_schema '$LEDGER_SCHEMA'"
    echo "\\set global_allow '$GLOBAL_ALLOW'"
    echo '\set check_stale on'
    echo 'SELECT current_user AS executor_role \gset'
  fi
  if [[ "$INIT" -eq 1 ]]; then
    echo '\echo ##stage init-ledger'
    echo "\\set executor '$EXECUTOR'"
    cat <<'SQL'
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'executor') AS executor_exists \gset
\if :executor_exists
\else
  DO $$ BEGIN RAISE EXCEPTION 'o papel executor informado em --executor não existe'; END $$;
\endif
SELECT (:'executor' <> current_user) AS executor_differs \gset
\if :executor_differs
\else
  DO $$ BEGIN RAISE EXCEPTION 'o executor não pode ser o próprio dono do ledger: o ledger precisa pertencer a outro papel (administrador)'; END $$;
\endif
BEGIN;
CREATE SCHEMA IF NOT EXISTS plataforma_migrations;
CREATE TABLE IF NOT EXISTS plataforma_migrations.ledger (
  seq        integer     PRIMARY KEY CHECK (seq BETWEEN 1 AND 9999),
  filename   text        NOT NULL UNIQUE CHECK (filename ~ '^[0-9]{4}_[a-z0-9][a-z0-9_]*\.sql$'),
  sha256     text        NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  applied_by name        NOT NULL DEFAULT current_user,
  CHECK (substr(filename, 1, 4)::integer = seq)
);
-- Tabela só para serializar execuções (LOCK TABLE); nunca tem linhas. O executor só tem UPDATE nela.
CREATE TABLE IF NOT EXISTS plataforma_migrations.run_lock (
  id integer PRIMARY KEY CHECK (id = 1)
);
CREATE OR REPLACE FUNCTION plataforma_migrations.ledger_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog
AS $f$
BEGIN
  RAISE EXCEPTION 'o ledger de migrations é append-only: % não é permitido', TG_OP;
END
$f$;
CREATE OR REPLACE TRIGGER ledger_no_update_delete BEFORE UPDATE OR DELETE ON plataforma_migrations.ledger
  FOR EACH ROW EXECUTE FUNCTION plataforma_migrations.ledger_append_only();
CREATE OR REPLACE TRIGGER ledger_no_truncate BEFORE TRUNCATE ON plataforma_migrations.ledger
  FOR EACH STATEMENT EXECUTE FUNCTION plataforma_migrations.ledger_append_only();
REVOKE ALL ON SCHEMA plataforma_migrations FROM PUBLIC;
REVOKE ALL ON TABLE plataforma_migrations.ledger, plataforma_migrations.run_lock FROM PUBLIC;
REVOKE ALL ON FUNCTION plataforma_migrations.ledger_append_only() FROM PUBLIC;
REVOKE ALL ON SCHEMA plataforma_migrations FROM :"executor";
REVOKE ALL ON TABLE plataforma_migrations.ledger, plataforma_migrations.run_lock FROM :"executor";
GRANT USAGE ON SCHEMA plataforma_migrations TO :"executor";
GRANT SELECT, INSERT ON plataforma_migrations.ledger TO :"executor";
GRANT UPDATE ON plataforma_migrations.run_lock TO :"executor";
COMMIT;
SQL
    echo '\echo ##stage ledger-check'
    echo "$LEDGER_STRUCTURE_SQL"
    cat <<'SQL'
DO $$
BEGIN
  IF (SELECT relowner FROM pg_class WHERE oid = 'plataforma_migrations.ledger'::regclass) <> (SELECT oid FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'ledger inconsistente: o ledger existente não pertence ao papel que executou --init-ledger';
  END IF;
END $$;
\echo ledger inicializado
\echo ##stage done
\echo ##done
SQL
  else
    echo '\echo ##stage ledger-check'
    echo "$LEDGER_STRUCTURE_SQL"
    cat <<'SQL'
DO $$
DECLARE me oid; owner_oid oid;
BEGIN
  SELECT oid INTO me FROM pg_roles WHERE rolname = current_user;
  SELECT relowner INTO owner_oid FROM pg_class WHERE oid = 'plataforma_migrations.ledger'::regclass;
  IF (SELECT rolsuper FROM pg_roles WHERE oid = me) THEN
    RAISE EXCEPTION 'o papel executor (%) é superusuário; migrations não podem rodar com superusuário', current_user;
  END IF;
  IF (SELECT rolbypassrls FROM pg_roles WHERE oid = me) THEN
    RAISE EXCEPTION 'o papel executor (%) tem BYPASSRLS; migrations não podem rodar com esse atributo', current_user;
  END IF;
  IF owner_oid = me OR pg_has_role(current_user, owner_oid, 'USAGE') THEN
    RAISE EXCEPTION 'o papel executor (%) é dono ou membro do dono do ledger; o ledger precisa pertencer a outro papel (administrador)', current_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = me) THEN
    RAISE EXCEPTION 'o papel executor (%) é membro de outro papel; o executor não pode herdar privilégios nem ter papéis alvo de SET ROLE', current_user;
  END IF;
  IF NOT has_database_privilege(current_database(), 'TEMPORARY') THEN
    RAISE EXCEPTION 'o papel executor (%) não tem TEMP no banco (necessário às tabelas temporárias do runner)', current_user;
  END IF;
  IF has_table_privilege('plataforma_migrations.ledger', 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'o papel executor (%) tem privilégio de alteração sobre o ledger (UPDATE, DELETE, TRUNCATE, REFERENCES ou TRIGGER); só SELECT e INSERT são permitidos', current_user;
  END IF;
  IF NOT (has_table_privilege('plataforma_migrations.ledger', 'SELECT') AND has_table_privilege('plataforma_migrations.ledger', 'INSERT')
          AND has_schema_privilege('plataforma_migrations', 'USAGE')
          AND has_table_privilege('plataforma_migrations.run_lock', 'UPDATE')) THEN
    RAISE EXCEPTION 'o papel executor (%) não tem os privilégios mínimos (USAGE no esquema, SELECT e INSERT no ledger, UPDATE em run_lock)', current_user;
  END IF;
END $$;
\echo ##stage history
SQL
    emit_validate_fn
    cat <<'SQL'
DO $$ BEGIN PERFORM pg_temp.validate_history(); END $$;
SQL
    if [[ -n "$EXPECT_HEAD" ]]; then
      exp_seq="${EXPECT_HEAD%%:*}"; exp_sha=""; [[ "$EXPECT_HEAD" == *:* ]] && exp_sha="${EXPECT_HEAD#*:}"
      echo '\echo ##stage expect-head'
      echo "SELECT coalesce(max(seq), 0) AS hs, coalesce((SELECT sha256 FROM plataforma_migrations.ledger ORDER BY seq DESC LIMIT 1), '-') AS hsha FROM plataforma_migrations.ledger \\gset"
      if [[ -n "$exp_sha" ]]; then
        echo "SELECT (:hs = $((10#$exp_seq)) AND :'hsha' = '$exp_sha') AS head_ok \\gset"
      else
        echo "SELECT (:hs = $((10#$exp_seq))) AS head_ok \\gset"
      fi
      echo '\if :head_ok'
      echo '\else'
      echo '  \echo cabeça do ledger encontrada: :hs :hsha'
      echo "  DO \$\$ BEGIN RAISE EXCEPTION 'a cabeça do ledger difere da esperada (--expect-head $EXPECT_HEAD): possível remoção de entradas recentes do ledger'; END \$\$;"
      echo '\endif'
    fi
    if [[ "$NO_GATE" -eq 0 ]]; then
      echo '\echo ##stage gate-baseline'
      echo 'BEGIN;'
      echo 'SET LOCAL search_path = pg_catalog, pg_temp;'
      echo '\set check_stale off'
      gate_sql "o banco já viola invariantes de segurança antes de aplicar qualquer migration (gate de linha de base)"
      echo '\set check_stale on'
      echo 'ROLLBACK;'
    fi
    while read -r seq name; do
      sha="$(hash_file "$WORK/snap/$name")"
      tagm="m${sha:0:20}"; tagr="r${sha:20:20}"
      printf '\\echo ##stage apply %s\n' "$name"
      # Isola o estado de sessão deixado pela migration anterior: DISCARD ALL (fora de transação) zera GUCs, objetos
      # temporários, cursores, instruções preparadas e locks de sessão; depois o search_path do runner é refixado.
      echo 'DISCARD ALL;'
      echo 'SET search_path = pg_catalog, pg_temp;'
      printf "SELECT EXISTS (SELECT 1 FROM plataforma_migrations.ledger WHERE seq = %d) AS done \\\\gset\n" "$seq"
      echo '\if :done'
      printf '\\echo current %s\n' "$name"
      echo '\else'
      # Pendente: serializa por tabela (o executor só tem UPDATE nela; a aplicação não tem acesso), revalida o
      # histórico e reconfere a migration SOB O LOCK, na mesma transação que a aplica e a registra.
      echo 'BEGIN;'
      echo "SET LOCAL lock_timeout = '$LOCK_TIMEOUT';"
      echo 'LOCK TABLE plataforma_migrations.run_lock IN EXCLUSIVE MODE;'
      echo 'SET LOCAL lock_timeout = DEFAULT;'
      echo '\echo ##stage history'
      emit_validate_fn
      echo 'DO $$ BEGIN PERFORM pg_temp.validate_history(); END $$;'
      printf '\\echo ##stage apply %s\n' "$name"
      printf "SELECT EXISTS (SELECT 1 FROM plataforma_migrations.ledger WHERE seq = %d) AS done_locked \\\\gset\n" "$seq"
      echo '\if :done_locked'
      echo 'ROLLBACK;'
      printf '\\echo current %s\n' "$name"
      echo '\else'
      echo "SELECT pg_catalog.pg_current_xact_id()::text AS xid_before \\gset"
      # A migration roda com o search_path PADRÃO do servidor e como TEXTO: o conteúdo fica num literal entre aspas de
      # dólar dentro de um DO ... EXECUTE. O psql não o interpreta (nenhum metacomando, nenhuma interpolação de variável),
      # o servidor o executa como SQL dentro da transação do runner, e COMMIT/ROLLBACK/SAVEPOINT/BEGIN/PREPARE TRANSACTION
      # e comandos que não rodam em transação são recusados pelo PostgreSQL num contexto atômico.
      echo 'SET LOCAL search_path = DEFAULT;'
      printf 'DO $%s$ BEGIN EXECUTE $%s$\n' "$tagr" "$tagm"
      cat "$WORK/snap/$name"
      printf '\n$%s$; END $%s$;\n' "$tagm" "$tagr"
      # Antes do gate: descarta o estado de sessão que a migration possa ter alterado e fixa o search_path do runner.
      echo 'RESET ALL;'
      echo 'SET LOCAL search_path = pg_catalog, pg_temp;'
      echo "SELECT (pg_catalog.pg_current_xact_id()::text = :'xid_before') AS same_tx \\gset"
      echo '\if :same_tx'
      echo '\else'
      printf "  DO \$\$ BEGIN RAISE EXCEPTION '%s alterou a transação do runner; migration recusada'; END \$\$;\n" "$name"
      echo '\endif'
      if [[ "$NO_GATE" -eq 0 ]]; then
        printf '\\echo ##stage gate %s\n' "$name"
        gate_sql "o gate de segurança rejeitou a migration $name: ela foi desfeita e não será registrada"
        printf '\\echo gate ok %s\n' "$name"
      fi
      printf "INSERT INTO plataforma_migrations.ledger (seq, filename, sha256) VALUES (%d, '%s', '%s');\n" "$seq" "$name" "$sha"
      echo 'COMMIT;'
      printf '\\echo applied %s\n' "$name"
      echo '\endif'
      echo '\endif'
    done < "$SORTED"
    cat <<'SQL'
\echo ##stage done
\echo ##done
SQL
  fi
} > "$SCRIPT"

# --- execução -----------------------------------------------------------------------------------
OUT="$WORK/out.txt"; ERR="$WORK/err.txt"
rc=0
"$PSQL_BIN" -X -q -t -A ${CONN[@]+"${CONN[@]}"} -w -f "$SCRIPT" >"$OUT" 2>"$ERR" || rc=$?

sanitize() { sed "s#$WORK/snap/#<migrations>/#g; s#$WORK/run.psql#<runner-script>#g"; }
sanitize < "$ERR" >&2 || true

# O sucesso NÃO vem de marcadores impressos: exige código de saída 0 do psql E o estado CONFIRMADO no banco, lido numa
# conexão nova depois que o psql terminou. O que a saída diz ("applied"/"current") só é aceito se o ledger no banco
# contiver exatamente as migrations do diretório, com os mesmos nomes e checksums.
verify_committed() {
  local got expected="" seq name reported names
  if [[ "$INIT" -eq 1 ]]; then
    got="$("$PSQL_BIN" -X -q -t -A ${CONN[@]+"${CONN[@]}"} -w -v ON_ERROR_STOP=1 \
        -c "SET search_path = pg_catalog, pg_temp" -c "SELECT to_regclass('plataforma_migrations.ledger') IS NOT NULL AND to_regclass('plataforma_migrations.run_lock') IS NOT NULL" 2>/dev/null)" \
      || { echo "FALHA [conexão/execução]: não foi possível verificar o ledger no banco depois da execução" >&2; exit 4; }
    [[ "$got" == "t" ]] || { echo "FALHA [verificação]: o ledger não existe no banco depois de --init-ledger" >&2; exit 1; }
    return 0
  fi
  got="$("$PSQL_BIN" -X -q -t -A ${CONN[@]+"${CONN[@]}"} -w -v ON_ERROR_STOP=1 \
      -c "SET search_path = pg_catalog, pg_temp" \
      -c "SELECT coalesce(string_agg(seq::text || ':' || filename || ':' || sha256, '|' ORDER BY seq), '') FROM plataforma_migrations.ledger" 2>/dev/null)" \
    || { echo "FALHA [conexão/execução]: não foi possível verificar o ledger no banco depois da execução" >&2; exit 4; }
  while read -r seq name; do expected+="${expected:+|}$seq:$name:$(hash_file "$WORK/snap/$name")"; done < "$SORTED"
  if [[ "$got" != "$expected" ]]; then
    echo "FALHA [verificação]: o ledger confirmado no banco não corresponde às migrations do diretório; o resultado reportado pela execução NÃO é confiável (nada foi dado como aplicado)" >&2
    exit 1
  fi
  reported="$(sed -n -E 's/^(applied|current) (.*)$/\2/p' "$OUT" | sort)"
  names="$(awk '{print $2}' "$SORTED" | sort)"
  [[ "$reported" == "$names" ]] || { echo "FALHA [verificação]: a execução não reportou exatamente cada migration do diretório uma vez" >&2; exit 1; }
  HEAD_SEQ="${got##*|}"; HEAD_SEQ="${HEAD_SEQ%%:*}"
  HEAD_SHA="${got##*:}"
  if [[ -z "$got" ]]; then HEAD_SEQ=0; HEAD_SHA="-"; fi
}

if [[ "$rc" -eq 0 ]] && grep -q '^##done$' "$OUT"; then
  SERVER="$(sed -n 's/^##server //p' "$OUT")"
  verify_committed
  grep -v '^##' "$OUT" || true
  if [[ "$INIT" -eq 1 ]]; then
    echo "ledger: inicializado para o executor '$EXECUTOR' (PostgreSQL $SERVER)"
  else
    APPLIED="$(grep -c '^applied ' "$OUT" || true)"; CURRENT="$(grep -c '^current ' "$OUT" || true)"
    echo "ledger head: $HEAD_SEQ:$HEAD_SHA"
    if [[ "$NO_GATE" -eq 0 ]]; then GATE_NOTE="gate de segurança: ativo (papel da aplicação: $APP_ROLE)"; else GATE_NOTE="gate de segurança: DESABILITADO"; fi
    echo "migrations: $APPLIED aplicada(s), $CURRENT já atualizada(s) (PostgreSQL $SERVER; $GATE_NOTE)"
  fi
  exit 0
fi

# Falha: mantém o código de saída diferente de zero e diz em que etapa e em qual migration. As linhas "applied"/"current"
# da execução NÃO são repetidas aqui: só o estado confirmado no banco pode dar uma migration por aplicada.
grep -v -E '^(##|applied |current |gate ok )' "$OUT" || true
STAGE="$(sed -n 's/^##stage //p' "$OUT" | tail -1)"
[[ -n "$STAGE" ]] || STAGE="connect"
if grep -q -i 'lock timeout' "$ERR"; then
  echo "FALHA [lock]: não foi possível obter o lock de migrations em $LOCK_TIMEOUT (outro runner em execução?)" >&2
  exit 3
fi
if [[ "$STAGE" == "connect" ]] || grep -q -i -E 'could not connect|connection to server|server closed the connection|terminating connection|connection .* lost|no such file or directory' "$ERR"; then
  echo "FALHA [conexão/execução]: falha de conexão ou perda da conexão com o banco (etapa: $STAGE); nenhuma migration em andamento foi registrada" >&2
  exit 4
fi
case "$STAGE" in
  gate-baseline) echo "FALHA [security gate]: o banco já viola invariantes de segurança antes de aplicar qualquer migration; nada foi aplicado" >&2 ;;
  gate\ *)      echo "FALHA [security gate]: a migration ${STAGE#gate } foi rejeitada pelo gate de segurança e desfeita (rollback); não foi registrada e nada depois dela foi aplicado" >&2 ;;
  apply\ *)     echo "FALHA [aplicação]: migration ${STAGE#apply } falhou e foi desfeita (rollback); nada depois dela foi aplicado" >&2 ;;
  history)      echo "FALHA [histórico]: o histórico de migrations é inconsistente com o diretório; nada foi aplicado" >&2 ;;
  ledger-check) echo "FALHA [ledger]: o ledger ou o papel executor não atende aos requisitos de integridade; nada foi aplicado" >&2 ;;
  init-ledger)  echo "FALHA [init-ledger]: não foi possível inicializar o ledger; verifique o papel administrador e o executor" >&2 ;;
  expect-head)  echo "FALHA [cabeça do ledger]: o ledger não corresponde à cabeça esperada; nada foi aplicado" >&2 ;;
  *)            echo "FALHA [$STAGE]: o runner parou; nada foi aplicado depois desta etapa" >&2 ;;
esac
exit 1
