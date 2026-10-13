#!/usr/bin/env bash
# Conexão REMOTA (por exemplo, o Neon) para os scripts de banco: lê um URI libpq de uma variável de ambiente NOMEADA (o nome vai
# na linha de comando; o valor, com a senha, nunca) e exporta as variáveis PG* do libpq. Assim nenhum segredo aparece em `ps`.
# Para ser lida com `source`. Exige TLS e recusa socket Unix. Não imprime o URI nem a senha.
remote_conn_export() { # remote_conn_export NOME_DA_VARIAVEL
  local name="$1" out
  [[ "$name" =~ ^[A-Z_][A-Z0-9_]*$ && "$name" != DATABASE_URL && "$name" != PG* ]] || { echo "nome de variável inválido: $name" >&2; return 2; }
  [[ -n "${!name:-}" ]] || { echo "variável $name vazia ou ausente" >&2; return 2; }
  out="$(REMOTE_URI="${!name}" python3 - <<'PY'
import os, sys, shlex, urllib.parse as u
p = u.urlparse(os.environ["REMOTE_URI"])
if p.scheme not in ("postgres", "postgresql") or not p.hostname or not p.username or not p.password or not p.path.strip("/"):
    sys.exit(3)
q = dict(u.parse_qsl(p.query))
vals = {
    "PGHOST": p.hostname,
    "PGPORT": str(p.port or 5432),
    "PGUSER": u.unquote(p.username),
    "PGPASSWORD": u.unquote(p.password),
    "PGDATABASE": u.unquote(p.path.lstrip("/")),
    "PGSSLMODE": q.get("sslmode", "require"),
}
if q.get("channel_binding"):
    vals["PGCHANNELBINDING"] = q["channel_binding"]
for k, v in vals.items():
    print("export %s=%s" % (k, shlex.quote(v)))
PY
)" || { echo "URI inválido em $name (esperado postgresql://usuario:senha@host/banco?sslmode=require)" >&2; return 3; }
  eval "$out"
  [[ "$PGHOST" != /* ]] || { echo "socket Unix não é aceito em modo remoto" >&2; return 4; }
  [[ "$PGSSLMODE" =~ ^(require|verify-ca|verify-full)$ ]] || { echo "TLS é obrigatório em modo remoto (sslmode=require, verify-ca ou verify-full)" >&2; return 4; }
}
