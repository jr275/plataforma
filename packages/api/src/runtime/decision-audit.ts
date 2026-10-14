import type { TenantDb } from "../tenant-context";
import { assertExecutable, type LifecycleState } from "../engine/lifecycle";
import type { Agent4Out } from "../agents/schemas";
import type { CombinationGroupsInput } from "../agents/agents";

// Auditoria de decisão: quem decidiu o quê, a partir de qual recomendação e com quais evidências. O agente RECOMENDA; o CÓDIGO decide e aplica. O histórico é só INSERT.
export interface DecisionAuditEntry { readonly id: string; readonly pipelineRunId: string | null; readonly subjectKind: string; readonly subjectRef: string; readonly decision: string; readonly decidedBy: "code" | "human"; readonly recommendation: Record<string, unknown> | null; readonly recommendationApplied: boolean; readonly reason: string; readonly evidenceRefs: readonly string[]; readonly agentRunId: string | null; readonly createdBy: string; readonly createdAt: Date }
interface Row { id: string; pipeline_run_id: string | null; subject_kind: string; subject_ref: string; decision: string; decided_by: "code" | "human"; recommendation: Record<string, unknown> | null; recommendation_applied: boolean; reason: string; evidence_refs: string[]; agent_run_id: string | null; created_by: string; created_at: Date }
const toEntry = (r: Row): DecisionAuditEntry => ({ id: r.id, pipelineRunId: r.pipeline_run_id, subjectKind: r.subject_kind, subjectRef: r.subject_ref, decision: r.decision, decidedBy: r.decided_by, recommendation: r.recommendation, recommendationApplied: r.recommendation_applied, reason: r.reason, evidenceRefs: r.evidence_refs, agentRunId: r.agent_run_id, createdBy: r.created_by, createdAt: r.created_at });
export async function recordDecision(db: TenantDb, a: { pipelineRunId?: string | null; subjectKind: string; subjectRef: string; decision: string; decidedBy: "code" | "human"; recommendation?: Record<string, unknown> | null; applied: boolean; reason: string; evidenceRefs?: readonly string[]; agentRunId?: string | null; actor: string }): Promise<string> {
  return (await db.query<{ id: string }>(`INSERT INTO plataforma.decision_audit (tenant_id, pipeline_run_id, subject_kind, subject_ref, decision, decided_by, recommendation, recommendation_applied, reason, evidence_refs, agent_run_id, created_by)
    VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, $10, $11) RETURNING id`, [a.pipelineRunId ?? null, a.subjectKind, a.subjectRef.slice(0, 200), a.decision, a.decidedBy, a.recommendation ? JSON.stringify(a.recommendation) : null, a.applied, a.reason.slice(0, 1000), JSON.stringify(a.evidenceRefs ?? []), a.agentRunId ?? null, a.actor])).rows[0]!.id;
}
export async function listDecisionAudit(db: TenantDb, f: { subjectKind?: string; subjectRef?: string; pipelineRunId?: string; limit?: number } = {}): Promise<DecisionAuditEntry[]> {
  return (await db.query<Row>(`SELECT id, pipeline_run_id, subject_kind, subject_ref, decision, decided_by, recommendation, recommendation_applied, reason, evidence_refs, agent_run_id, created_by, created_at FROM plataforma.decision_audit
    WHERE ($1::text IS NULL OR subject_kind = $1) AND ($2::text IS NULL OR subject_ref = $2) AND ($3::uuid IS NULL OR pipeline_run_id = $3) ORDER BY seq DESC LIMIT $4`, [f.subjectKind ?? null, f.subjectRef ?? null, f.pipelineRunId ?? null, Math.min(f.limit ?? 100, 500)])).rows.map(toEntry);
}

// --- Agente 4: o código confirma ou recusa cada recomendação -----------------------------------------------------------------------------------------------------------------
export type CombinationDecision = "KEEP" | "ABSORB";
export interface CombinationVerdict { readonly topicId: string; readonly recommendation: Agent4Out["reviews"][number]["recommendation"]; readonly decision: CombinationDecision; readonly applied: boolean; readonly reason: string }
const REMOVABLE: readonly LifecycleState[] = ["discovered", "validated", "scored", "eligible"];
/**
 * Regras do CÓDIGO (não do agente): só se absorve uma combinação que NÃO tem blocos de dados exclusivos (`exclusive_blocks = 0`); um filho com dado próprio nunca é removido por recomendação.
 * MERGE_WITH_SIBLING exige irmãos nomeados e desempate determinístico (o de maior topic_id é absorvido) para que dois irmãos nunca absorvam um ao outro.
 * KEEP_AS_PAGE mantém. Estados avançados (blueprint em diante) não regridem: a recomendação fica registrada como não aplicada.
 */
export function judgeCombination(review: Agent4Out["reviews"][number], child: { exclusive_blocks: number; count: number }, siblings: ReadonlyMap<string, { exclusive_blocks: number }>, status: LifecycleState | null): CombinationVerdict {
  const base = { topicId: review.topic_id, recommendation: review.recommendation };
  if (review.recommendation === "KEEP_AS_PAGE") return { ...base, decision: "KEEP", applied: true, reason: "mantida como página (recomendação do agente; o código não encontrou impedimento)" };
  if (child.exclusive_blocks > 0) return { ...base, decision: "KEEP", applied: false, reason: `recomendação ${review.recommendation} recusada pelo código: a combinação tem ${child.exclusive_blocks} bloco(s) de dados exclusivos` };
  if (review.recommendation === "MERGE_WITH_SIBLING") {
    if (review.redundant_with_siblings.length === 0) return { ...base, decision: "KEEP", applied: false, reason: "MERGE_WITH_SIBLING sem irmão nomeado: recusada pelo código" };
    const loses = review.redundant_with_siblings.every((s) => { const sib = siblings.get(s); return sib !== undefined && (sib.exclusive_blocks > 0 || s < review.topic_id); });
    if (!loses) return { ...base, decision: "KEEP", applied: false, reason: "desempate determinístico: o irmão absorvido é o de maior topic_id; esta combinação permanece" };
  }
  if (status !== null && !REMOVABLE.includes(status)) return { ...base, decision: "KEEP", applied: false, reason: `a combinação já está em “${status}”; estados avançados não regridem por recomendação` };
  return { ...base, decision: "ABSORB", applied: true, reason: `${review.recommendation} confirmada pelo código: sem blocos de dados exclusivos (exclusive_blocks = 0)` };
}
/** Aplica as recomendações do Agente 4: cada veredito vai para `decision_audit` (histórico) e as absorções viram transição `→ rejected` com evento. Idempotente: tópico já rejeitado não é tocado de novo. */
export async function applyCombinationReviews(db: TenantDb, out: Agent4Out, input: CombinationGroupsInput, ctx: { pipelineRunId: string | null; agentRunId: string; actor: string }): Promise<CombinationVerdict[]> {
  const kids = new Map(input.groups.flatMap((g) => g.children.map((c) => [c.topic_id, c] as const)));
  const verdicts: CombinationVerdict[] = [];
  for (const review of out.reviews) {
    const child = kids.get(review.topic_id)!;
    const row = (await db.query<{ id: string; status: LifecycleState }>(`SELECT id, status FROM plataforma.growth_opportunity WHERE topic_id = $1 FOR UPDATE`, [review.topic_id])).rows[0];
    const v = judgeCombination(review, child, new Map(review.redundant_with_siblings.map((s) => [s, kids.get(s) ?? { exclusive_blocks: 0 }] as const)), row?.status ?? null);
    const verdict: CombinationVerdict = row || v.decision === "KEEP" ? v : { ...v, decision: "KEEP", applied: false, reason: "tópico não encontrado no tenant" };
    if (verdict.decision === "ABSORB" && row && row.status !== "rejected") {
      assertExecutable(row.status, "rejected");
      await db.query(`UPDATE plataforma.growth_opportunity SET status = 'rejected', eligible = false WHERE id = $1`, [row.id]);
      await db.query(`INSERT INTO plataforma.opportunity_event (tenant_id, opportunity_id, event_type, from_status, to_status, actor, reason, data) VALUES (plataforma.current_tenant_id(), $1, 'transition', $2, 'rejected', $3, $4, $5::jsonb)`, [row.id, row.status, ctx.actor, `combinação absorvida: ${verdict.reason}`.slice(0, 500), JSON.stringify({ agentRunId: ctx.agentRunId, recommendation: review.recommendation, appliedByCode: true })]);
    }
    await recordDecision(db, { pipelineRunId: ctx.pipelineRunId, subjectKind: "topic", subjectRef: review.topic_id, decision: verdict.decision, decidedBy: "code", recommendation: { agent: 4, ...review }, applied: verdict.applied, reason: verdict.reason, agentRunId: ctx.agentRunId, actor: ctx.actor });
    verdicts.push(verdict);
  }
  return verdicts;
}
