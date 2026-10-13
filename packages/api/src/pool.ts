import pg from "pg";

// Único lugar que cria o pool de conexões da aplicação (ADR-018). TLS com verificação de certificado é obrigatório; a URI vem de
// quem chama (variável de ambiente lida no servidor) e NUNCA é registrada nem entra em mensagem de erro.
export function createAppPool(connectionUri: string, options: { max?: number } = {}): pg.Pool {
  let u: URL;
  try {
    u = new URL(connectionUri);
  } catch {
    throw new TypeError("URI de conexão inválida");
  }
  if ((u.protocol !== "postgres:" && u.protocol !== "postgresql:") || !u.hostname || !u.username || !u.pathname.slice(1)) throw new TypeError("URI de conexão inválida");
  if (u.searchParams.get("sslmode") === "disable") throw new TypeError("TLS é obrigatório");
  const pool = new pg.Pool({
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)),
    ssl: { rejectUnauthorized: true },
    max: options.max ?? 3,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  pool.on("error", () => undefined); // erro de conexão ociosa não pode derrubar o processo; o withTenant descarta a conexão ruim
  return pool;
}
