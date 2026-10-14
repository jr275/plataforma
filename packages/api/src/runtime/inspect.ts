import type { TenantDb } from "../tenant-context";
import { getExplanation } from "../agents/agents";
import { listDecisionHistory, type DecisionRow } from "../eligibility/store";
import { listSpecBlueprints, type SpecBlueprintRecord } from "../blueprint-spec/store";
import { listQaReports, listRecipes, type QaReportRecord, type RecipeRecord } from "../qa/store";
import { listDecisionAudit, type DecisionAuditEntry } from "./decision-audit";
import { listPipelineRuns, type PipelineRunRecord } from "./pipeline";

// Leitura para o Control Plane (somente leitura, sempre por withTenant): execuções de agentes (monitor + inspetor de saída) e a visão do motor por oportunidade.
export interface AgentRunSummary { readonly id: string; readonly seq: number; readonly agent: number; readonly agentName: string; readonly promptVersion: string; readonly promptVersionId: string | null; readonly model: string; readonly status: string; readonly attempts: number; readonly subjectKind: string | null; readonly subjectRef: string | null; readonly pipelineRunId: string | null; readonly correlationId: string | null; readonly durationMs: number | null; readonly failureKind: string | null; readonly transientRetries: number; readonly errorCount: number; readonly createdAt: Date }
export interface AgentRunDetail extends AgentRunSummary { readonly promptSha256: string; readonly input: unknown; readonly output: unknown; readonly errors: readonly string[]; readonly usage: Record<string, unknown>; readonly createdBy: string }
interface Row { id: string; seq: string; agent: number; agent_name: string; prompt_version: string; prompt_version_id: string | null; model: string; status: string; attempts: number; subject_kind: string | null; subject_ref: string | null; pipeline_run_id: string | null; correlation_id: string | null; duration_ms: number | null; usage: Record<string, unknown>; errors: string[]; created_at: Date; prompt_sha256: string; input: unknown; output: unknown; created_by: string }
const SUMMARY = "id, seq, agent, agent_name, prompt_version, prompt_version_id, model, status, attempts, subject_kind, subject_ref, pipeline_run_id, correlation_id, duration_ms, usage, errors, created_at";
const toSummary = (r: Row): AgentRunSummary => ({ id: r.id, seq: Number(r.seq), agent: r.agent, agentName: r.agent_name, promptVersion: r.prompt_version, promptVersionId: r.prompt_version_id, model: r.model, status: r.status, attempts: r.attempts, subjectKind: r.subject_kind, subjectRef: r.subject_ref, pipelineRunId: r.pipeline_run_id, correlationId: r.correlation_id, durationMs: r.duration_ms, failureKind: typeof r.usage?.failureKind === "string" ? r.usage.failureKind : null, transientRetries: typeof r.usage?.transientRetries === "number" ? r.usage.transientRetries : 0, errorCount: Array.isArray(r.errors) ? r.errors.length : 0, createdAt: r.created_at });

export async function listAgentRuns(db: TenantDb, f: { agent?: number; status?: string; pipelineRunId?: string; limit?: number; offset?: number } = {}): Promise<{ total: number; byStatus: Record<string, number>; rows: AgentRunSummary[] }> {
  const where = `($1::int IS NULL OR agent = $1) AND ($2::text IS NULL OR status = $2) AND ($3::uuid IS NULL OR pipeline_run_id = $3)`; const args = [f.agent ?? null, f.status ?? null, f.pipelineRunId ?? null];
  const rows = (await db.query<Row>(`SELECT ${SUMMARY} FROM plataforma.agent_run WHERE ${where} ORDER BY seq DESC LIMIT $4 OFFSET $5`, [...args, Math.min(f.limit ?? 50, 200), f.offset ?? 0])).rows.map(toSummary);
  const by = (await db.query<{ status: string; n: string }>(`SELECT status, count(*) AS n FROM plataforma.agent_run WHERE ($1::int IS NULL OR agent = $1) AND ($2::uuid IS NULL OR pipeline_run_id = $2) GROUP BY status`, [args[0], args[2]])).rows;
  const byStatus = Object.fromEntries(by.map((r) => [r.status, Number(r.n)]));
  const total = f.status ? byStatus[f.status] ?? 0 : Object.values(byStatus).reduce((s, n) => s + n, 0);
  return { total, byStatus, rows };
}
export async function getAgentRun(db: TenantDb, id: string): Promise<AgentRunDetail | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const r = (await db.query<Row>(`SELECT ${SUMMARY}, prompt_sha256, input, output, created_by FROM plataforma.agent_run WHERE id = $1`, [id])).rows[0]; if (!r) return null;
  return { ...toSummary(r), promptSha256: r.prompt_sha256, input: r.input, output: r.output, errors: r.errors, usage: r.usage, createdBy: r.created_by };
}

/** Tudo que o motor sabe de UMA oportunidade (decisões com a explicação do Agente 5, blueprints da especificação, recipes, relatórios de QA, execuções do pipeline, auditoria). Nada é calculado aqui. */
export interface EngineView {
  readonly decisions: readonly (DecisionRow & { explanation: { explanation: string; nextBestAction: string; agentRunId: string } | null })[];
  readonly blueprints: readonly SpecBlueprintRecord[]; readonly recipes: readonly RecipeRecord[]; readonly qaReports: readonly QaReportRecord[];
  readonly pipelines: readonly PipelineRunRecord[]; readonly audit: readonly DecisionAuditEntry[];
}
export async function getEngineView(db: TenantDb, opportunityId: string): Promise<EngineView | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(opportunityId)) return null;
  const exists = (await db.query(`SELECT 1 FROM plataforma.growth_opportunity WHERE id = $1`, [opportunityId])).rows.length > 0; if (!exists) return null;
  const decisions = await listDecisionHistory(db, opportunityId);
  const withExplanation = [];
  for (const d of decisions) withExplanation.push({ ...d, explanation: await getExplanation(db, d.id) });
  return { decisions: withExplanation, blueprints: await listSpecBlueprints(db, opportunityId), recipes: await listRecipes(db, opportunityId), qaReports: await listQaReports(db, opportunityId), pipelines: await listPipelineRuns(db, { opportunityId, limit: 20 }), audit: await listDecisionAudit(db, { subjectKind: "page", subjectRef: opportunityId, limit: 50 }) };
}

export interface TopicDiscoverySummary { readonly total: number; readonly byStatus: Readonly<Record<string, number>>; readonly byPattern: Readonly<Record<string, number>>; readonly intentModeled: number; readonly byDemand: Readonly<Record<string, number>>; readonly withParent: number }
/** Contagens REAIS dos tópicos do tenant (descoberta). Sem tópicos, tudo zero: nada é estimado. */
export async function topicDiscoverySummary(db: TenantDb): Promise<TopicDiscoverySummary> {
  const q = async (sql: string) => (await db.query<{ k: string | null; n: string }>(sql)).rows;
  const rec = (rows: { k: string | null; n: string }[]) => Object.fromEntries(rows.map((r) => [r.k ?? "—", Number(r.n)]));
  const byStatus = rec(await q(`SELECT status AS k, count(*) AS n FROM plataforma.growth_opportunity WHERE topic_id IS NOT NULL GROUP BY status`));
  const byPattern = rec(await q(`SELECT pattern_key AS k, count(*) AS n FROM plataforma.growth_opportunity WHERE topic_id IS NOT NULL GROUP BY pattern_key`));
  const byDemand = rec(await q(`SELECT intent_model ->> 'demandStatus' AS k, count(*) AS n FROM plataforma.growth_opportunity WHERE topic_id IS NOT NULL AND intent_model IS NOT NULL GROUP BY 1`));
  const withParent = Number((await q(`SELECT 'p' AS k, count(*) AS n FROM plataforma.growth_opportunity WHERE topic_id IS NOT NULL AND parent_topic_id IS NOT NULL`))[0]?.n ?? 0);
  return { total: Object.values(byStatus).reduce((s, n) => s + n, 0), byStatus, byPattern, intentModeled: Object.values(byDemand).reduce((s, n) => s + n, 0), byDemand, withParent };
}
