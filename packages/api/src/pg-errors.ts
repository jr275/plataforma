// Classificação de erros do PostgreSQL por SQLSTATE, com a cadeia de `cause` (withTenant e outros camadas podem embrulhar o erro original).
// Função PURA, sem acesso a banco: usada pela interface para distinguir "migrations pendentes" de qualquer outra falha.

/** SQLSTATE 42P01: relação (tabela) inexistente. */
export const PG_UNDEFINED_TABLE = "42P01";

function hasCode(e: unknown, code: string, depth = 4): boolean {
  let x: unknown = e;
  for (let i = 0; i < depth && x !== null && typeof x === "object"; i++) {
    if ((x as { code?: unknown }).code === code) return true;
    x = (x as { cause?: unknown }).cause;
  }
  return false;
}

/** O erro é "tabela inexistente" (migrations pendentes)? Qualquer outro erro, inclusive de conexão, permissão ou dado, é `false`. */
export function isUndefinedTable(e: unknown): boolean {
  return hasCode(e, PG_UNDEFINED_TABLE);
}

/** Códigos que significam "o banco não pôde atender agora" (e não "a consulta está errada ou não é permitida"). */
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set(["57P01", "57P02", "57P03", "53300", "57014", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EPIPE"]);
/** O driver `pg` falha sem código em dois casos conhecidos; só estas mensagens exatas contam. */
const UNAVAILABLE_MESSAGES: readonly RegExp[] = [/^timeout exceeded when trying to connect$/i, /^Connection terminated( unexpectedly| due to connection timeout)?$/i];

function isUnavailableNode(x: object): boolean {
  const code = (x as { code?: unknown }).code;
  if (typeof code === "string" && (code.startsWith("08") && code.length === 5 || UNAVAILABLE_CODES.has(code))) return true;
  return x instanceof Error && UNAVAILABLE_MESSAGES.some((m) => m.test(x.message));
}

/** O banco está indisponível (conexão recusada ou perdida, desligamento, excesso de conexões, timeout)? Permissão, dado e tabela ausente são `false`. */
export function isDatabaseUnavailable(e: unknown, depth = 4): boolean {
  let x: unknown = e;
  for (let i = 0; i < depth && x !== null && typeof x === "object"; i++) {
    if (isUnavailableNode(x as object)) return true;
    x = (x as { cause?: unknown }).cause;
  }
  return false;
}
