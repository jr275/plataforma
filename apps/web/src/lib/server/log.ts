import "server-only";

/** Registro INTERNO de falhas de servidor. Guarda só o tipo e o código (SQLSTATE ou de rede): a mensagem pode trazer host, usuário ou URL. */
export function logServerError(scope: string, e: unknown): void {
  let name: string = typeof e;
  let code = "";
  let x: unknown = e;
  for (let i = 0; i < 4 && x !== null && typeof x === "object"; i++) {
    if (i === 0) name = (x as { name?: unknown }).name === undefined ? "objeto" : String((x as { name?: unknown }).name);
    const c = (x as { code?: unknown }).code;
    if (!code && typeof c === "string") code = c;
    x = (x as { cause?: unknown }).cause;
  }
  console.error(`[plataforma:${scope}] falha do servidor: tipo=${name}${code ? ` codigo=${code}` : ""}`);
}
