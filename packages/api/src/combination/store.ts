import { ensurePolicy } from "../catalog/store";
import type { VerifiedIdentity } from "../identity";
import type { VerticalDefinition } from "../engine/vertical";
import type { PoolLike, TenantDb } from "../tenant-context";
import { loadTopicEntities, persistTopics } from "../topics/store";
import { withEngineRun, type RunOutcome } from "../topics/run";
import type { Topic } from "../topics/types";
import { expandCombinations } from "./engine";
import type { CombinationFamily, CombinationPolicy, CompatibilityRule, Dims, LogEntry, Space } from "./types";

// Execução e persistência do Combination Engine (Incremento 3): raízes = tópicos já gerados; filhos mantidos viram tópicos (origem COMBINATION, com `parent_topic_id`);
// o motivo de CADA candidato fica em `combination_log`. A política (mínimos, razão de redundância, teto) é versionada por tenant.
export interface CombinationDeps {
  readonly vertical: VerticalDefinition; readonly families: readonly CombinationFamily[]; readonly rules: readonly CompatibilityRule[]; readonly defaultPolicy: CombinationPolicy;
  /** O pack monta o espaço de dados da família (lendo o banco do tenant). */
  readonly buildSpace: (db: TenantDb, family: CombinationFamily) => Promise<Space>; readonly now?: () => Date;
}
export interface CombinationRunResult { readonly familyId: string; readonly policyVersion: number; readonly roots: number; readonly evaluated: number; readonly kept: number; readonly pruned: Readonly<Record<string, number>>; readonly duplicates: number; readonly capped: boolean; readonly topics: { created: number; existing: number } }

export function validatePolicy(p: CombinationPolicy): string[] {
  const e: string[] = [];
  if (!Number.isInteger(p.maxDimensions) || p.maxDimensions < 1) e.push("maxDimensions inválido");
  if (!Number.isInteger(p.longTailMaxDimensions) || p.longTailMaxDimensions < p.maxDimensions) e.push("longTailMaxDimensions deve ser ≥ maxDimensions");
  if (!(p.redundancyRatio > 0 && p.redundancyRatio < 1)) e.push("redundancyRatio deve ficar entre 0 e 1 (exclusivo)");
  if (!Number.isInteger(p.minExclusiveBlocks) || p.minExclusiveBlocks < 0) e.push("minExclusiveBlocks inválido");
  if (!Number.isInteger(p.maxCandidatesPerRun) || p.maxCandidatesPerRun < 1) e.push("maxCandidatesPerRun inválido");
  for (const [k, v] of Object.entries(p.minItems)) if (!Number.isInteger(v) || v < 1) e.push(`minItems.${k} inválido`);
  return e;
}

export async function runCombinations(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, deps: CombinationDeps, input: { familyId: string; rootLimit?: number }): Promise<RunOutcome<CombinationRunResult>> {
  const family = deps.families.find((f) => f.id === input.familyId);
  if (!family) throw new TypeError(`família de combinação desconhecida: ${input.familyId}`);
  const bad = validatePolicy(deps.defaultPolicy); if (bad.length > 0) throw new TypeError(`política de combinação inválida: ${bad.join("; ")}`);
  return withEngineRun(pool, identity, tenantId, { verticalId: deps.vertical.id, kind: "combinations", params: { family: family.id, rootLimit: input.rootLimit ?? null } }, async (db, runId) => {
    const policy = await ensurePolicy<CombinationPolicy>(db, "combination", deps.defaultPolicy, identity.userId);
    const problems = validatePolicy(policy.content); if (problems.length > 0) throw new TypeError(`política de combinação ativa inválida: ${problems.join("; ")}`);
    const space = await deps.buildSpace(db, family);
    const rootRows = (await db.query<{ topic_id: string; dimensions: Dims; primary_entity_id: string; entity_type: string }>(
      `SELECT o.topic_id, o.dimensions, o.primary_entity_id, e.entity_type FROM plataforma.growth_opportunity o JOIN plataforma.entity e ON e.id = o.primary_entity_id
        WHERE o.topic_id IS NOT NULL AND o.pattern_key = ANY($1::text[]) AND o.status NOT IN ('rejected', 'retired') ORDER BY o.topic_id`, [[...family.rootPatternKeys]])).rows;
    // raízes escolhidas por prioridade do pack (maior primeiro), depois por id: determinístico
    const rank = (d: Dims) => (space as Space & { rank?: (d: Dims) => number }).rank?.(d) ?? 0;
    const roots = [...rootRows].sort((a, b) => rank(b.dimensions) - rank(a.dimensions) || (a.topic_id < b.topic_id ? -1 : 1)).slice(0, input.rootLimit ?? rootRows.length);
    const existing = (await db.query<{ topic_id: string; dimensions: Dims }>(`SELECT topic_id, dimensions FROM plataforma.growth_opportunity WHERE topic_id IS NOT NULL AND candidate_page_family = $1`, [family.pageFamily])).rows;
    const existingIntents = new Map(existing.map((x) => [space.intentKey(x.dimensions), x.topic_id] as const));
    const res = await expandCombinations({ tenantId, family, roots: roots.map((r) => ({ topicId: r.topic_id, dimensions: r.dimensions })), rules: deps.rules, space, policy: policy.content, existingIntents });

    const entities = await loadTopicEntities(db);
    const rootEntity = new Map(roots.map((r) => [r.topic_id, { id: r.primary_entity_id, type: r.entity_type }]));
    const entityOf = (id: string): { id: string; type: string } => { let cur = id; for (let i = 0; i < 10; i++) { const e = rootEntity.get(cur); if (e) return e; const k = res.kept.find((x) => x.topicId === cur); if (!k) break; cur = k.parentTopicId; } throw new Error(`entidade primária não encontrada para ${id}`); };
    const topics: Topic[] = res.kept.map((k) => { const ent = entityOf(k.topicId); const c = family.child;
      return { topicId: k.topicId, tenantId, primaryEntityId: ent.id, primaryEntityType: ent.type, patternId: family.id, queryPatternKey: c.queryPatternKey, dimensions: k.dimensions, attributesUsed: c.attributesUsed, relationshipsUsed: c.relationshipsUsed, geoGranularity: c.geoGranularity, intentType: c.intentType, queryHypothesis: space.describe(k.dimensions), userNeed: c.userNeed, evidenceRequired: c.evidenceRequired,
        dataAvailable: c.attributesUsed, dataMissing: [], candidatePageFamily: family.pageFamily, commercialPotential: c.commercialPotential, refreshDependencies: c.attributesUsed, origin: "COMBINATION", parentTopicId: k.parentTopicId,
        demandSignal: k.demand ?? { value: null, source: null, period: null, method: null, uncertainty: "sem fonte de demanda: hipótese" } }; });
    const saved = await persistTopics(db, { vertical: deps.vertical, runId, actor: identity.userId, entities, reason: "combinação sobrevivente das podas (spec seção 7); segue como hipótese até haver demanda" }, topics);
    await saveLog(db, runId, res.log);
    const pruned: Record<string, number> = {};
    for (const l of res.log) if (l.outcome === "pruned" && l.filter) pruned[l.filter] = (pruned[l.filter] ?? 0) + 1;
    const result: CombinationRunResult = { familyId: family.id, policyVersion: policy.version, roots: roots.length, evaluated: res.evaluated, kept: res.kept.length, pruned, duplicates: res.log.filter((l) => l.outcome === "duplicate").length, capped: res.capped, topics: saved };
    return { result, stats: { ...result } };
  });
}

async function saveLog(db: TenantDb, runId: string, log: readonly LogEntry[]): Promise<void> {
  for (let i = 0; i < log.length; i += 1000) {
    const part = log.slice(i, i + 1000);
    await db.query(`INSERT INTO plataforma.combination_log (tenant_id, run_id, topic_id, parent_topic_id, family, level, dimensions, outcome, filter, reason, details)
      SELECT plataforma.current_tenant_id(), $1, x.topic_id, x.parent_topic_id, x.family, x.level, x.dimensions, x.outcome, x.filter, x.reason, x.details FROM jsonb_to_recordset($2::jsonb) AS x(topic_id text, parent_topic_id text, family text, level int, dimensions jsonb, outcome text, filter text, reason text, details jsonb)`,
      [runId, JSON.stringify(part.map((l) => ({ topic_id: l.topicId, parent_topic_id: l.parentTopicId, family: l.family, level: l.level, dimensions: l.dimensions, outcome: l.outcome, filter: l.filter, reason: l.reason, details: l.details })))]);
  }
}

export interface LogRow { readonly topicId: string; readonly parentTopicId: string | null; readonly family: string; readonly level: number; readonly dimensions: Dims; readonly outcome: string; readonly filter: string | null; readonly reason: string; readonly details: Record<string, unknown> }
export async function listCombinationLog(db: TenantDb, f: { runId?: string; outcome?: string; filter?: string; limit?: number; offset?: number } = {}): Promise<{ total: number; rows: LogRow[]; byFilter: Record<string, number> }> {
  const where = ["($1::uuid IS NULL OR run_id = $1)", "($2::text IS NULL OR outcome = $2)", "($3::text IS NULL OR filter = $3)"]; const args = [f.runId ?? null, f.outcome ?? null, f.filter ?? null];
  const total = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.combination_log WHERE ${where.join(" AND ")}`, args)).rows[0]!.n);
  const rows = (await db.query<{ topic_id: string; parent_topic_id: string | null; family: string; level: number; dimensions: Dims; outcome: string; filter: string | null; reason: string; details: Record<string, unknown> }>(`SELECT topic_id, parent_topic_id, family, level, dimensions, outcome, filter, reason, details FROM plataforma.combination_log WHERE ${where.join(" AND ")} ORDER BY created_at DESC, level, topic_id LIMIT ${Math.min(f.limit ?? 50, 500)} OFFSET ${Math.max(f.offset ?? 0, 0)}`, args)).rows;
  const bf = (await db.query<{ k: string; n: string }>(`SELECT coalesce(filter, outcome) AS k, count(*) AS n FROM plataforma.combination_log WHERE ${where.join(" AND ")} GROUP BY 1`, args)).rows;
  return { total, rows: rows.map((x) => ({ topicId: x.topic_id, parentTopicId: x.parent_topic_id, family: x.family, level: x.level, dimensions: x.dimensions, outcome: x.outcome, filter: x.filter, reason: x.reason, details: x.details })), byFilter: Object.fromEntries(bf.map((x) => [x.k, Number(x.n)])) };
}
