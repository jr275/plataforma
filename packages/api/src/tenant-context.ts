import { TenantAccessDeniedError, UnsafeConnectionError } from "./errors";
import type { VerifiedIdentity } from "./identity";
import { parseTenantId } from "./tenant-id";

/** Resultado mínimo de uma consulta (compatível com `pg` e com o Pool do driver do Neon). */
export interface QueryResultLike<R> {
  rows: R[];
  rowCount: number | null;
}

export interface ClientLike {
  query(text: string, values?: unknown[]): Promise<QueryResultLike<any>>;
  release(error?: Error | boolean): void;
}

export interface PoolLike {
  connect(): Promise<ClientLike>;
}

/** O que o código de negócio enxerga dentro de `withTenant`: só consultas, sempre no contexto do tenant. */
export interface TenantDb {
  query<R = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResultLike<R>>;
}

/**
 * ÚNICO ponto do repositório que estabelece o contexto de tenant (ADR-013, opção A endurecida):
 *  1. valida o tenant e confere que a identidade verificada pertence a ele, ANTES de abrir qualquer conexão;
 *  2. abre uma transação e define app.tenant_id só para ela (terceiro argumento `true`: some no COMMIT/ROLLBACK);
 *  3. recusa uma conexão de superusuário ou com BYPASSRLS (falha fechada se o papel não puder ser verificado);
 *  4. executa a função, confirma ou desfaz, e devolve a conexão ao pool.
 * Limite documentado: o RLS só aplica o valor de app.tenant_id; SQL arbitrário dentro da função ainda pode trocar o
 * tenant (L1 do harness de RLS). Um teste estático impede qualquer outro arquivo de definir o contexto.
 */
export async function withTenant<T>(
  pool: PoolLike,
  identity: VerifiedIdentity,
  requestedTenantId: string,
  fn: (db: TenantDb) => Promise<T>,
): Promise<T> {
  const tenantId = parseTenantId(requestedTenantId);
  if (!identity.tenantIds.includes(tenantId)) throw new TenantAccessDeniedError();

  const client = await pool.connect();
  let broken = false;
  try {
    await client.query("BEGIN");
    const ctx = await client.query(
      "SELECT set_config('app.tenant_id', $1, true) AS ctx, " +
        "(SELECT rolsuper OR rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = current_user) AS privileged",
      [tenantId],
    );
    if (ctx.rows[0]?.privileged !== false) throw new UnsafeConnectionError();
    const db: TenantDb = { query: (text, values) => client.query(text, values ? [...values] : undefined) };
    const result = await fn(db);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      broken = true; // a conexão não pôde desfazer: é descartada em vez de voltar ao pool
    }
    throw error;
  } finally {
    client.release(broken);
  }
}
