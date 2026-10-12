#!/usr/bin/env bash
# Biblioteca compartilhada dos testes: sobe um PostgreSQL 16 DESCARTÁVEL (cluster novo em diretório
# temporário próprio, só socket Unix, sem TCP) e garante a limpeza. Para ser lida com `source`.
# Define: PGBIN, VERSION, TMP, PORT, PSQL. Instala o trap de limpeza (só remove o próprio $TMP).
# Não instala nada, não usa Docker/Neon/DATABASE_URL e não toca em outro Postgres.
# Requer que o script que a usa já tenha executado `set -Eeuo pipefail`.

PORT=54329 # só dá nome ao socket dentro do diretório temporário; não há TCP.

# --- binários do PostgreSQL 16 (já instalados) --------------------------------------------------
find_bin_dir() {
  if [[ -n "${RLS_HARNESS_PG_BIN_DIR:-}" ]]; then echo "$RLS_HARNESS_PG_BIN_DIR"; return; fi
  if command -v initdb >/dev/null 2>&1; then dirname "$(command -v initdb)"; return; fi
  for d in /opt/homebrew/opt/postgresql@16/bin /usr/local/opt/postgresql@16/bin /usr/lib/postgresql/16/bin; do
    [[ -x "$d/initdb" ]] && { echo "$d"; return; }
  done
}
PGBIN="$(find_bin_dir || true)"
if [[ -z "$PGBIN" || ! -x "$PGBIN/initdb" || ! -x "$PGBIN/pg_ctl" || ! -x "$PGBIN/psql" ]]; then
  echo "PRE-REQUISITO AUSENTE: initdb, pg_ctl e psql do PostgreSQL 16 (defina RLS_HARNESS_PG_BIN_DIR)." >&2
  exit 2
fi
VERSION="$("$PGBIN/initdb" --version)"
if [[ "$VERSION" != *" 16."* ]]; then
  echo "PostgreSQL 16 exigido; encontrado: $VERSION" >&2
  exit 2
fi

# --- diretório temporário próprio + limpeza garantida -------------------------------------------
TMP="$(mktemp -d "${RLS_HARNESS_TMPDIR:-/tmp}/plataforma-pg.XXXXXX")"
TMP="$(cd "$TMP" && pwd -P)"
chmod 700 "$TMP"
# Marcador com nonce: o MESMO nonce é passado ao servidor (plataforma.disposable_nonce), de modo que o arquivo só vale como
# prova para o servidor que o criou (scripts/db-migrate.sh --no-security-gate e scripts/db-bootstrap.sh conferem os dois).
# Um arquivo comum, copiado ou criado à mão, não casa com nenhum outro servidor. Isto evita acidentes; não protege contra
# um administrador local malicioso, que controla o arquivo, o servidor e os scripts.
NONCE="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
printf 'plataforma-disposable-cluster v1 %s\n' "$NONCE" > "$TMP/.disposable-pg-marker"

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  if [[ -n "${TMP:-}" && "$TMP" == */plataforma-pg.* && -f "$TMP/.disposable-pg-marker" ]]; then
    if [[ -f "$TMP/data/postmaster.pid" ]]; then
      "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true
    fi
    rm -rf -- "$TMP"
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM

# O postmaster no macOS aborta ("became multithreaded") sem uma locale válida no ambiente.
# No Linux o ambiente já basta; não forçamos uma locale que pode não existir no runner.
if [[ "$(uname -s)" == "Darwin" ]]; then
  export LC_ALL="${RLS_HARNESS_LC_ALL:-en_US.UTF-8}"
fi

# --- cluster descartável: só socket Unix dentro de $TMP -----------------------------------------
"$PGBIN/initdb" -D "$TMP/data" -U rls_bootstrap -A trust --no-locale -E UTF8 --no-sync >"$TMP/initdb.log" 2>&1
"$PGBIN/pg_ctl" -D "$TMP/data" -l "$TMP/pg.log" -w \
  -o "-c listen_addresses='' -c unix_socket_directories='$TMP' -c port=$PORT -c fsync=off -c max_connections=20 -c plataforma.disposable_nonce=$NONCE" \
  start >/dev/null

unset PGSERVICE PGSERVICEFILE DATABASE_URL PGPASSWORD PGOPTIONS PGHOSTADDR PGDATABASE
export PGHOST="$TMP" PGPORT="$PORT" PGUSER=rls_bootstrap PGPASSFILE="$TMP/.no-pgpass" PGSSLMODE=disable

PSQL=("$PGBIN/psql" -X -q -t -A)

# Trava de segurança: só prossegue se for POSITIVAMENTE o cluster descartável.
[[ "$("${PSQL[@]}" -d postgres -c 'SHOW data_directory')" == "$TMP/data" ]] \
  || { echo "ABORTADO: o servidor não é o cluster descartável." >&2; exit 3; }
[[ -z "$("${PSQL[@]}" -d postgres -c 'SHOW listen_addresses')" ]] \
  || { echo "ABORTADO: o cluster descartável escuta em rede." >&2; exit 3; }

echo "PostgreSQL (servidor): $("${PSQL[@]}" -d postgres -c 'SELECT version()')"
echo "Cluster descartável: socket Unix em diretório temporário (sem TCP); autenticação trust apenas para este teste"
