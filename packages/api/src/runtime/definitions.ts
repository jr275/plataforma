import type { TenantDb } from "../tenant-context";
import { AGENT_DEFINITIONS, definitionHash, type AgentDefinition } from "../agents/registry";
import { DEFAULT_AGENT_MODEL } from "../agents/runner";

// Espelha o registro de agentes (código) em `agent_definition`: uma linha nova só quando algo operacional muda (hash). Nada é sobrescrito.
export async function syncAgentDefinitions(db: TenantDb, actor: string, model: string = DEFAULT_AGENT_MODEL): Promise<{ inserted: number; unchanged: number }> {
  let inserted = 0; let unchanged = 0;
  for (const d of AGENT_DEFINITIONS) {
    const r = await db.query<{ id: string }>(`INSERT INTO plataforma.agent_definition (tenant_id, agent, version, slug, name, stage, input_schema_version, output_schema_version, model, timeout_ms, max_retries, batch_min, batch_max, depends_on, definition_hash, created_by)
      VALUES (plataforma.current_tenant_id(), $1, (SELECT COALESCE(max(version), 0) + 1 FROM plataforma.agent_definition WHERE agent = $1), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::int[], $13, $14)
      ON CONFLICT (tenant_id, agent, definition_hash) DO NOTHING RETURNING id`, [d.agent, d.slug, d.name, d.stage, d.inputSchemaVersion, d.outputSchemaVersion, model, d.timeoutMs, d.maxRetries, d.batch.min, d.batch.max, `{${d.dependsOn.join(",")}}`, definitionHash(d, model), actor]);
    if (r.rows.length > 0) inserted += 1; else unchanged += 1;
  }
  return { inserted, unchanged };
}

export interface AgentRegistryRow { readonly definition: AgentDefinition; readonly version: number | null; readonly model: string | null; readonly runs: number; readonly byStatus: Readonly<Record<string, number>>; readonly lastRunAt: Date | null; readonly activePrompt: { readonly version: string; readonly source: string } | null }
/** Visão do Control Plane: definição vigente + execuções reais por estado + prompt ATIVO. Nada é inventado: sem execuções, zero. */
export async function listAgentRegistry(db: TenantDb, domainPackId: string): Promise<AgentRegistryRow[]> {
  const defs = (await db.query<{ agent: number; version: number; model: string }>(`SELECT DISTINCT ON (agent) agent, version, model FROM plataforma.agent_definition ORDER BY agent, version DESC`)).rows;
  const runs = (await db.query<{ agent: number; status: string; n: string; last: Date }>(`SELECT agent, status, count(*) AS n, max(created_at) AS last FROM plataforma.agent_run GROUP BY agent, status`)).rows;
  const prompts = (await db.query<{ agent: number; version: string; source: string }>(`SELECT agent, version, source FROM plataforma.prompt_version WHERE domain_pack_id = $1 AND status = 'ACTIVE'`, [domainPackId])).rows;
  return AGENT_DEFINITIONS.map((d) => {
    const mine = runs.filter((r) => r.agent === d.agent); const sd = defs.find((x) => x.agent === d.agent);
    const p = prompts.find((x) => x.agent === d.agent);
    return { definition: d, version: sd?.version ?? null, model: sd?.model ?? null, runs: mine.reduce((s, r) => s + Number(r.n), 0), byStatus: Object.fromEntries(mine.map((r) => [r.status, Number(r.n)])), lastRunAt: mine.reduce<Date | null>((m, r) => (m === null || r.last > m ? r.last : m), null), activePrompt: p ? { version: p.version, source: p.source } : null };
  });
}
