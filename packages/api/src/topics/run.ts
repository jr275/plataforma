import type { VerifiedIdentity } from "../identity";
import { withTenant, type PoolLike, type TenantDb } from "../tenant-context";
import { ResearchBusyError } from "../engine/store";

// Execução rastreável do motor de páginas: toda etapa em lote abre uma `research_run` (tipo em `params.kind`), roda e a fecha; falha é explícita (nada parcial silencioso).
// Uma execução por tenant por vez (índice parcial da migration 0008). O trabalho roda em UMA transação: ou grava tudo ou nada.
export interface RunOutcome<T> { readonly runId: string; readonly status: "succeeded" | "failed"; readonly result?: T; readonly error?: string }
const isUnique = (e: unknown, constraint: string): boolean => { const x = e as { code?: string; constraint?: string; cause?: unknown } | null; if (!x) return false; if (x.code === "23505" && x.constraint === constraint) return true; return x.cause !== undefined && x.cause !== e ? isUnique(x.cause, constraint) : false; };
const safe = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/postgres(ql)?:\/\/\S+/gi, "[url removida]").slice(0, 1000);

export async function withEngineRun<T>(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, o: { verticalId: string; kind: string; params?: Record<string, unknown> }, fn: (db: TenantDb, runId: string) => Promise<{ result: T; stats: Record<string, unknown> }>): Promise<RunOutcome<T>> {
  let runId: string;
  try {
    runId = await withTenant(pool, identity, tenantId, async (db) => (await db.query<{ id: string }>(`INSERT INTO plataforma.research_run (tenant_id, vertical_id, params, created_by) VALUES (plataforma.current_tenant_id(), $1, $2::jsonb, $3) RETURNING id`, [o.verticalId, JSON.stringify({ kind: o.kind, ...(o.params ?? {}) }), identity.userId])).rows[0]!.id);
  } catch (e) {
    if (isUnique(e, "research_run_one_running_idx")) throw new ResearchBusyError("em andamento");
    throw e;
  }
  try {
    return await withTenant(pool, identity, tenantId, async (db) => {
      const { result, stats } = await fn(db, runId);
      await db.query(`UPDATE plataforma.research_run SET status = 'succeeded', stats = $2::jsonb, error = NULL, finished_at = now() WHERE id = $1 AND status = 'running'`, [runId, JSON.stringify(stats)]);
      return { runId, status: "succeeded" as const, result };
    });
  } catch (e) {
    const error = safe(e);
    await withTenant(pool, identity, tenantId, async (db) => { await db.query(`UPDATE plataforma.research_run SET status = 'failed', error = $2, finished_at = now() WHERE id = $1 AND status = 'running'`, [runId, error]); });
    return { runId, status: "failed", error };
  }
}
