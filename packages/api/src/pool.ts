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
  if ((u.protocol !== "postgres:" && u.protocol !== "postgresql:") || !u.pathname.slice(1)) throw new TypeError("URI de conexão inválida");
  // Na forma de socket (libpq) o usuário vem em `?user=`; na de rede, em `usuario:senha@`.
  const user = u.username ? decodeURIComponent(u.username) : (u.searchParams.get("user") ?? "");
  if (!user) throw new TypeError("URI de conexão inválida");
  const common = { user, password: u.password ? decodeURIComponent(u.password) : undefined, database: decodeURIComponent(u.pathname.slice(1)), max: options.max ?? 3, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 };

  // Socket Unix local (banco de DESENVOLVIMENTO na própria máquina): sem rede, então TLS não se aplica. Nunca em produção.
  if (!u.hostname) {
    const dir = u.searchParams.get("host") ?? "";
    if (!dir.startsWith("/")) throw new TypeError("URI de conexão inválida");
    if (process.env.NODE_ENV === "production") throw new TypeError("socket local não é permitido em produção");
    const pool = new pg.Pool({ ...common, host: dir, port: Number(u.searchParams.get("port") || 5432) });
    pool.on("error", () => undefined);
    return pool;
  }

  if (u.searchParams.get("sslmode") === "disable") throw new TypeError("TLS é obrigatório");
  const pool = new pg.Pool({ ...common, host: u.hostname, port: Number(u.port || 5432), ssl: { rejectUnauthorized: true } });
  pool.on("error", () => undefined); // erro de conexão ociosa não pode derrubar o processo; o withTenant descarta a conexão ruim
  return pool;
}

/** Descrição SEM segredos de onde o pool aponta (para a interface mostrar a origem dos dados): "local" (socket) ou o host de rede. */
export function describeConnection(connectionUri: string): { kind: "local" | "remote"; host: string } | undefined {
  try {
    const u = new URL(connectionUri);
    return u.hostname ? { kind: "remote", host: u.hostname } : { kind: "local", host: "socket local" };
  } catch {
    return undefined;
  }
}
