#!/usr/bin/env bash
# Verifica as decisões de repositório (ADR-011 e ADR-012). Sai com código diferente de zero em caso de violação.
#  - Autoridade única do esquema: nada de geração/aplicação de migrations pelo Drizzle.
#  - Runtime: .nvmrc, engines.node e a versão do pnpm coerentes entre si e com o lockfile.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
FAIL=0
fail() { echo "FALHA: $*" >&2; FAIL=1; }

# --- ADR-011: SQL escrito à mão é a autoridade; o Drizzle não gera nem aplica migrations ---------
while IFS= read -r f; do fail "configuração do drizzle-kit encontrada: $f (ADR-011)"; done < <(
  find . \( -path ./node_modules -o -path '*/node_modules' -o -path '*/.next' -o -path '*/.turbo' \) -prune -o \
    -name 'drizzle.config.*' -print)
while IFS= read -r f; do fail "histórico de migrations do Drizzle encontrado: $f (ADR-011)"; done < <(
  find . \( -path ./node_modules -o -path '*/node_modules' -o -path '*/.next' \) -prune -o \
    \( -path '*/drizzle/meta/_journal.json' -o -path '*/drizzle/meta' \) -print)
SCAN=$(find . \( -path ./node_modules -o -path '*/node_modules' -o -path '*/.next' -o -path '*/.turbo' \) -prune -o \
  \( -name package.json -o -name turbo.json -o -path './.github/*' -o -path './scripts/*.sh' \) -type f -print \
  | grep -v '^./scripts/check-consistency.sh$')
if [[ -n "$SCAN" ]] && grep -n -E 'drizzle-kit[[:space:]]+(generate|migrate|push|up|drop)' $SCAN; then
  fail "comando de migration do drizzle-kit em script/workflow (ADR-011)"
fi

# --- ADR-012: Node 24 ---------------------------------------------------------------------------
[[ -f .nvmrc ]] || fail ".nvmrc ausente"
NVMRC="$(tr -d '[:space:]' < .nvmrc 2>/dev/null || true)"
ENGINE="$(node -p "require('./package.json').engines?.node ?? ''")"
PM="$(node -p "require('./package.json').packageManager ?? ''")"
[[ "$NVMRC" =~ ^[0-9]+$ ]] || fail ".nvmrc deve conter só a versão major (valor: '$NVMRC')"
[[ "$ENGINE" == "^$NVMRC" ]] || fail "engines.node ('$ENGINE') deve ser '^$NVMRC' (igual ao .nvmrc)"
[[ "$PM" == pnpm@* ]] || fail "packageManager deve ser pnpm@<versão> (valor: '$PM')"
LOCK_PNPM="$(awk '/packageManagerDependencies:/{f=1} f&&/pnpm:/{g=1} g&&/version:/{print $2; exit}' pnpm-lock.yaml)"
[[ "${PM#pnpm@}" == "$LOCK_PNPM" ]] || fail "versão do pnpm em packageManager ('${PM#pnpm@}') difere do pnpm-lock.yaml ('$LOCK_PNPM')"
if [[ -d .github/workflows ]]; then
  grep -L -E 'node-version-file:[[:space:]]*\.?/?\.nvmrc' .github/workflows/*.yml | while read -r w; do
    grep -q 'actions/setup-node' "$w" && echo "FALHA: $w usa setup-node sem node-version-file: .nvmrc" >&2 && exit 1
  done || FAIL=1
fi

# --- CI: os testes reais de PostgreSQL precisam realmente rodar no workflow ----------------------
for cmd in "pnpm check:consistency" "pnpm turbo typecheck lint build" "pnpm test:rls" "pnpm test:migrations" "pnpm test:security" "pnpm test:bootstrap" "pnpm test:gate" "pnpm test:hardening" "pnpm test:api" "pnpm test:schema"; do
  grep -q -F -- "run: $cmd" .github/workflows/ci.yml 2>/dev/null || fail "o workflow .github/workflows/ci.yml não executa '$cmd'"
done
for sc in test:rls test:migrations test:security test:bootstrap test:gate test:hardening test:api test:schema check:catalog db:migrate db:bootstrap; do
  [[ -n "$(node -p "require('./package.json').scripts?.['$sc'] ?? ''")" ]] || fail "script '$sc' ausente em package.json"
done

if [[ "$FAIL" -eq 0 ]]; then
  echo "consistência OK: autoridade única do esquema; Node ^$NVMRC; pnpm ${PM#pnpm@} (= lockfile)"
else
  exit 1
fi
