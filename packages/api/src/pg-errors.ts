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
