/** Id único para registros criados no navegador (mensagens, execuções simuladas). */
export function newId(prefix: string): string {
  const unique = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${prefix}-${String(performance.now()).replace(".", "")}`;
  return `${prefix}-${unique}`;
}
