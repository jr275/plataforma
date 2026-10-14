import { ensurePolicy } from "../catalog/store";
import type { AttributeDefinition } from "../catalog/types";
import type { VerifiedIdentity } from "../identity";
import { assertExecutable, type LifecycleState } from "../engine/lifecycle";
import type { PoolLike, TenantDb } from "../tenant-context";
import { withEngineRun, type RunOutcome } from "../topics/run";
import { evaluate, snapshotHash } from "./evaluate";
import { DECISIONS, GATES, validatePolicy, type Decision, type EligibilityDecision, type EligibilityPolicy, type EligibilitySnapshot, type FactRef } from "./types";

// Avaliação de elegibilidade dos tópicos (Incremento 4): monta o SNAPSHOT congelado, chama a função pura, grava a decisão IMUTÁVEL e leva o tópico pelo ciclo de vida existente
// (transições auditadas, uma por passo). Reavaliar com o mesmo snapshot e a mesma política não faz nada; com dados ou política novos grava uma nova decisão.
export interface EligibilityDeps {
  readonly verticalId: string; readonly attributes: readonly AttributeDefinition[]; readonly defaultPolicy: EligibilityPolicy; readonly now?: () => Date;
  /** Conflitos geográficos/semânticos de um tópico (G6), definidos pelo pack a partir dos fatos das entidades. */
  readonly coherence?: (t: { readonly dimensions: Readonly<Record<string, string>>; readonly family: string }, factsOf: (sourceKey: string, attributeId: string) => unknown) => string[];
}
interface TopicRow { required_attributes: string[]; id: string; status: LifecycleState; topic_id: string; primary_entity_id: string; dimensions: Record<string, string>; attributes_used: string[]; data_available: string[]; data_missing: string[]; candidate_page_family: string; intent_type: string; geo_granularity: string | null; commercial_potential: string; primary_query: string; parent_topic_id: string | null; topic_origin: string; demand_signal: { value: number | null; source: string | null } | null; pattern_key: string }

/** Plano de transições para a decisão, a partir do estado atual. `null` = o tópico já avançou além (blueprint etc.): a decisão é registrada, o estado não regride. */
export function planTransitions(from: LifecycleState, decision: Decision): LifecycleState[] | null {
  const to: LifecycleState = decision === "READY_FOR_BLUEPRINT" ? "eligible" : decision === "REJECTED" ? "rejected" : "scored";
  const chain: Record<string, Partial<Record<LifecycleState, LifecycleState[]>>> = {
    eligible: { discovered: ["validated", "scored", "eligible"], validated: ["scored", "eligible"], scored: ["eligible"], eligible: [], rejected: ["discovered", "validated", "scored", "eligible"] },
    scored: { discovered: ["validated", "scored"], validated: ["scored"], scored: [], eligible: ["scored"], rejected: ["discovered", "validated", "scored"] },
    rejected: { discovered: ["validated", "rejected"], validated: ["rejected"], scored: ["rejected"], eligible: ["rejected"], rejected: [] },
  };
  return chain[to]![from] ?? null;
}

interface Ctx {
  readonly entities: Map<string, { status: string; resolution: number; sourceKey: string }>;
  readonly factsByEntity: Map<string, FactRef[]>; readonly valueByEntityAttr: Map<string, unknown>;
  readonly catalog: Map<string, string>; readonly defs: Map<string, AttributeDefinition>;
  readonly topics: TopicRow[]; readonly all: TopicRow[];
}
async function loadContext(db: TenantDb, deps: EligibilityDeps, only?: readonly string[]): Promise<Ctx> {
  const topics = (await db.query<TopicRow>(`SELECT id, status, required_attributes, topic_id, primary_entity_id, dimensions, attributes_used, data_available, data_missing, candidate_page_family, intent_type, geo_granularity, commercial_potential, primary_query, parent_topic_id, topic_origin, demand_signal, pattern_key FROM plataforma.growth_opportunity WHERE topic_id IS NOT NULL ORDER BY topic_id`)).rows;
  const ents = new Map((await db.query<{ id: string; status: string; resolution_confidence: string; source_key: string }>(`SELECT id, status, resolution_confidence, source_key FROM plataforma.entity`)).rows.map((e) => [e.id, { status: e.status, resolution: Number(e.resolution_confidence), sourceKey: e.source_key }]));
  const defs = new Map(deps.attributes.map((a) => [a.attributeId, a]));
  const facts = (await db.query<{ id: string; entity_id: string; attribute_id: string; value: unknown; confidence: string; observed_at: Date; source_name: string }>(`SELECT id, entity_id, attribute_id, value, confidence, observed_at, source_name FROM plataforma.fact WHERE superseded_at IS NULL`)).rows;
  const factsByEntity = new Map<string, FactRef[]>(); const valueByEntityAttr = new Map<string, unknown>();
  for (const f of facts) {
    const l = factsByEntity.get(f.entity_id) ?? []; l.push({ factId: f.id, attributeId: f.attribute_id, confidence: Number(f.confidence), observedAt: f.observed_at.toISOString(), sourceName: f.source_name, maxAgeDays: defs.get(f.attribute_id)?.maxAgeDays ?? null }); factsByEntity.set(f.entity_id, l);
    valueByEntityAttr.set(`${f.entity_id}|${f.attribute_id}`, f.value);
  }
  const cat = (await db.query<{ attribute_id: string; validation_status: string }>(`SELECT attribute_id, validation_status FROM plataforma.attribute_catalog WHERE catalog_run_id = (SELECT id FROM plataforma.catalog_run ORDER BY computed_at DESC, id LIMIT 1)`)).rows;
  const evaluable = new Set(["discovered", "validated", "scored", "eligible", "rejected", "serp_analyzed", "blueprinted"]);
  const sel = topics.filter((t) => evaluable.has(t.status) && (!only || only.includes(t.topic_id)));
  return { entities: ents, factsByEntity, valueByEntityAttr, catalog: new Map(cat.map((c) => [c.attribute_id, c.validation_status])), defs, topics: sel, all: topics };
}

function buildSnapshot(c: Ctx, t: TopicRow, tenantId: string, ref: Date, deps: EligibilityDeps): EligibilitySnapshot {
  const ent = c.entities.get(t.primary_entity_id);
  // entidades do tópico: a primária e as citadas nas dimensões (por chave da fonte)
  const bySource = new Map([...c.entities].map(([id, e]) => [e.sourceKey, id]));
  const entityIds = [t.primary_entity_id, ...Object.values(t.dimensions).map((v) => bySource.get(v)).filter((x): x is string => !!x && x !== t.primary_entity_id)];
  const used = new Set(t.attributes_used);
  const facts = entityIds.flatMap((id) => c.factsByEntity.get(id) ?? []).filter((f) => used.has(f.attributeId));
  // disponibilidade RECALCULADA dos fatos correntes (o tópico pode ter sido gerado antes de novos fatos): um bloco só está disponível se TODAS as entidades do tópico têm o fato
  const has = (a: string) => entityIds.every((id) => c.valueByEntityAttr.has(`${id}|${a}`));
  const dataAvailable = t.attributes_used.filter(has); const dataMissing = t.required_attributes.filter((a) => !has(a));
  // blocos que VARIAM entre as instâncias da família: valores distintos (> 1) do atributo entre as entidades primárias das instâncias
  const group = c.all.filter((x) => x.pattern_key === t.pattern_key && x.candidate_page_family === t.candidate_page_family && x.topic_origin === t.topic_origin);
  const varying = dataAvailable.filter((a) => new Set(group.map((x) => JSON.stringify(c.valueByEntityAttr.get(`${x.primary_entity_id}|${a}`) ?? null)).filter((v) => v !== "null")).size > 1).length;
  // Similaridade de INTENÇÃO entre tópicos da mesma família e da mesma entidade primária: Jaccard dos pares dimensão=valor (duas comparações da mesma cidade com cidades diferentes diferem no valor; a mesma intenção
  // com faixas de preço diferentes divide quase todos os pares). Tópico pai/filho não disputa com o próprio pai (o filho é a página específica).
  const pairs = (d: Record<string, string>) => new Set(Object.entries(d).map(([k, v]) => `${k}=${v}`));
  const mine = pairs(t.dimensions);
  const jacc = (d: Record<string, string>) => { const o = pairs(d); const i = [...mine].filter((x) => o.has(x)).length; const u = new Set([...mine, ...o]).size; return u === 0 ? 0 : i / u; };
  const conflicts = c.all.filter((x) => x.topic_id !== t.topic_id && x.primary_entity_id === t.primary_entity_id && x.candidate_page_family === t.candidate_page_family && !["rejected", "retired"].includes(x.status) && x.parent_topic_id !== t.topic_id && t.parent_topic_id !== x.topic_id)
    .map((x) => ({ topicId: x.topic_id, similarity: Number(jacc(x.dimensions).toFixed(4)), resolved: false }));
  const coherence = deps.coherence?.({ dimensions: t.dimensions, family: t.candidate_page_family }, (sk, a) => { const id = bySource.get(sk); return id ? c.valueByEntityAttr.get(`${id}|${a}`) : undefined; }) ?? [];
  return {
    referenceTime: ref.toISOString(), tenantId,
    topic: { topicId: t.topic_id, origin: t.topic_origin, family: t.candidate_page_family, intentType: t.intent_type as never, geoGranularity: t.geo_granularity as never, commercialPotential: t.commercial_potential, queryHypothesis: t.primary_query, parentTopicId: t.parent_topic_id, demand: { value: t.demand_signal?.value ?? null, source: t.demand_signal?.source ?? null }, attributesUsed: t.attributes_used, dataAvailable, dataMissing },
    entity: ent ? { id: t.primary_entity_id, status: ent.status, resolutionConfidence: ent.resolution } : null,
    attributes: t.attributes_used.map((a) => { const d = c.defs.get(a); return { attributeId: a, status: c.catalog.get(a) ?? "DATA_PENDING", usableAsFact: d ? d.origin !== "INFERRED" : false, semanticCategory: d?.semanticCategory ?? "desconhecida", derivationMethod: d?.derivationMethod ?? null }; }),
    facts, varyingBlocks: varying, coherenceConflicts: coherence, conflicts,
    graph: { siblings: group.length - 1, children: c.all.filter((x) => x.parent_topic_id === t.topic_id).length },
    serp: { opportunity: null },
  };
}

export interface EvaluationResult { readonly evaluated: number; readonly created: number; readonly unchanged: number; readonly byDecision: Readonly<Record<string, number>>; readonly gateFailures: Readonly<Record<string, number>>; readonly transitions: number; readonly skippedTransition: number; readonly policyVersion: number }

export async function runEvaluation(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, deps: EligibilityDeps, input: { topicIds?: readonly string[] } = {}): Promise<RunOutcome<EvaluationResult>> {
  const bad = validatePolicy(deps.defaultPolicy); if (bad.length > 0) throw new TypeError(`política de elegibilidade inválida: ${bad.join("; ")}`);
  const ref = (deps.now ?? (() => new Date()))();
  return withEngineRun(pool, identity, tenantId, { verticalId: deps.verticalId, kind: "evaluation", params: { topics: input.topicIds?.length ?? "todos" } }, async (db, runId) => {
    const policy = await ensurePolicy<EligibilityPolicy>(db, "eligibility", deps.defaultPolicy, identity.userId);
    const problems = validatePolicy(policy.content); if (problems.length > 0) throw new TypeError(`política de elegibilidade ativa inválida: ${problems.join("; ")}`);
    const ctx = await loadContext(db, deps, input.topicIds);
    let created = 0, unchanged = 0, transitions = 0, skipped = 0; const byDecision: Record<string, number> = {}; const gateFailures: Record<string, number> = {};
    for (const t of ctx.topics) {
      const snap = buildSnapshot(ctx, t, tenantId, ref, deps);
      const hash = snapshotHash(snap);
      const dec = evaluate(snap, policy.content, policy.version);
      const ins = await db.query<{ id: string }>(
        `INSERT INTO plataforma.eligibility_decision (tenant_id, opportunity_id, topic_id, run_id, policy_id, policy_version, snapshot_hash, snapshot, reference_time, decision, eligible, gate_results, gate_details, blocking_reasons, missing_requirements, scores, total_score, weight_coverage, evidence_refs, recommended_action, evaluated_at, created_by)
         VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16, $17, $18::jsonb, $19, $8, $20)
         ON CONFLICT (tenant_id, opportunity_id, snapshot_hash, policy_id) DO NOTHING RETURNING id`,
        [t.id, t.topic_id, runId, policy.id, policy.version, hash, JSON.stringify(snap), ref, dec.decision, dec.eligible, JSON.stringify(dec.gateResults), JSON.stringify(dec.gateDetails), JSON.stringify(dec.blockingReasons), JSON.stringify(dec.missingRequirements), JSON.stringify(dec.scores ?? {}), dec.totalScore, dec.weightCoverage, JSON.stringify(dec.evidenceRefs), dec.recommendedAction, identity.userId]);
      if (JSON.stringify(snap.topic.dataAvailable) !== JSON.stringify(t.data_available) || JSON.stringify(snap.topic.dataMissing) !== JSON.stringify(t.data_missing)) await db.query(`UPDATE plataforma.growth_opportunity SET data_available = $2, data_missing = $3 WHERE id = $1`, [t.id, snap.topic.dataAvailable, snap.topic.dataMissing]);
      byDecision[dec.decision] = (byDecision[dec.decision] ?? 0) + 1;
      for (const g of GATES) if (dec.gateResults[g] === "FAIL") gateFailures[g] = (gateFailures[g] ?? 0) + 1;
      const isNew = ins.rows.length > 0;
      if (isNew) created++; else unchanged++;
      // a decisão já existia (mesmo snapshot e política): ainda assim o ESTADO do tópico é reconciliado com ela (ex.: a entidade voltou a ficar ativa depois de uma rejeição)
      const decisionId = isNew ? ins.rows[0]!.id : (await db.query<{ id: string }>(`SELECT id FROM plataforma.eligibility_decision WHERE opportunity_id = $1 AND snapshot_hash = $2 AND policy_id = $3`, [t.id, hash, policy.id])).rows[0]!.id;
      const plan = planTransitions(t.status, dec.decision);
      let status: LifecycleState = t.status;
      if (!isNew && (plan === null || plan.length === 0)) continue;
      if (plan === null) { skipped++; await db.query(`INSERT INTO plataforma.opportunity_event (tenant_id, opportunity_id, event_type, actor, reason, data, run_id) VALUES (plataforma.current_tenant_id(), $1, 'note', $2, $3, $4::jsonb, $5)`, [t.id, identity.userId, `decisão ${dec.decision} registrada; o tópico já está em “${t.status}” e o estado não regride`, JSON.stringify({ decisionId, decision: dec.decision }), runId]); }
      else for (const next of plan) {
        assertExecutable(status, next);
        const u = await db.query<{ id: string }>(`UPDATE plataforma.growth_opportunity SET status = $2 WHERE id = $1 AND status = $3 RETURNING id`, [t.id, next, status]);
        if (u.rows.length === 0) throw new Error(`o estado de ${t.topic_id.slice(0, 8)} mudou durante a avaliação`);
        await db.query(`INSERT INTO plataforma.opportunity_event (tenant_id, opportunity_id, event_type, from_status, to_status, actor, reason, data, run_id) VALUES (plataforma.current_tenant_id(), $1, 'transition', $2, $3, $4, $5, $6::jsonb, $7)`,
          [t.id, status, next, identity.userId, `${isNew ? "avaliação de elegibilidade" : "reconciliação com a decisão vigente"}: ${dec.decision}`, JSON.stringify({ decisionId, decision: dec.decision, snapshotHash: hash, policyVersion: policy.version, gates: dec.gateResults, totalScore: dec.totalScore }), runId]);
        status = next; transitions++;
      }
      await db.query(`UPDATE plataforma.growth_opportunity SET eligible = $2, priority_value = $3, priority_kind = $4 WHERE id = $1`, [t.id, dec.eligible, dec.totalScore, dec.totalScore === null ? "none" : dec.weightCoverage === 1 ? "overall" : "partial"]);
      await db.query(`INSERT INTO plataforma.opportunity_event (tenant_id, opportunity_id, event_type, actor, reason, data, run_id) VALUES (plataforma.current_tenant_id(), $1, 'score', $2, $3, $4::jsonb, $5)`, [t.id, identity.userId, `decisão ${dec.decision}`, JSON.stringify({ decisionId, decision: dec.decision, totalScore: dec.totalScore, weightCoverage: dec.weightCoverage, policyVersion: policy.version }), runId]);
    }
    const result: EvaluationResult = { evaluated: ctx.topics.length, created, unchanged, byDecision, gateFailures, transitions, skippedTransition: skipped, policyVersion: policy.version };
    return { result, stats: { ...result } };
  });
}

export interface DecisionRow { readonly id: string; readonly opportunityId: string; readonly topicId: string; readonly decision: Decision; readonly eligible: boolean; readonly policyVersion: number; readonly gateResults: Record<string, string>; readonly gateDetails: Record<string, { result: string; kind: string | null; detail: string; missing: string[]; hypothesis?: boolean }>; readonly blockingReasons: string[]; readonly missingRequirements: string[]; readonly scores: Record<string, unknown>; readonly totalScore: number | null; readonly weightCoverage: number | null; readonly evidenceRefs: string[]; readonly recommendedAction: string; readonly evaluatedAt: Date; readonly snapshotHash: string; readonly referenceTime: Date }
const COLS = "id, opportunity_id, topic_id, decision, eligible, policy_version, gate_results, gate_details, blocking_reasons, missing_requirements, scores, total_score, weight_coverage, evidence_refs, recommended_action, evaluated_at, snapshot_hash, reference_time";
interface Row { id: string; opportunity_id: string; topic_id: string; decision: Decision; eligible: boolean; policy_version: number; gate_results: Record<string, string>; gate_details: DecisionRow["gateDetails"]; blocking_reasons: string[]; missing_requirements: string[]; scores: Record<string, unknown>; total_score: string | null; weight_coverage: string | null; evidence_refs: string[]; recommended_action: string; evaluated_at: Date; snapshot_hash: string; reference_time: Date }
const toRow = (r: Row): DecisionRow => ({ id: r.id, opportunityId: r.opportunity_id, topicId: r.topic_id, decision: r.decision, eligible: r.eligible, policyVersion: r.policy_version, gateResults: r.gate_results, gateDetails: r.gate_details, blockingReasons: r.blocking_reasons, missingRequirements: r.missing_requirements, scores: r.scores, totalScore: r.total_score === null ? null : Number(r.total_score), weightCoverage: r.weight_coverage === null ? null : Number(r.weight_coverage), evidenceRefs: r.evidence_refs, recommendedAction: r.recommended_action, evaluatedAt: r.evaluated_at, snapshotHash: r.snapshot_hash, referenceTime: r.reference_time });
export async function listDecisionHistory(db: TenantDb, opportunityId: string): Promise<DecisionRow[]> {
  return (await db.query<Row>(`SELECT ${COLS} FROM plataforma.eligibility_decision WHERE opportunity_id = $1 ORDER BY seq DESC`, [opportunityId])).rows.map(toRow);
}
/** Decisão mais recente por tópico, com filtro e paginação (Control Plane). */
export async function listLatestDecisions(db: TenantDb, f: { decision?: Decision; family?: string; gate?: string; limit?: number; offset?: number } = {}): Promise<{ total: number; byDecision: Record<string, number>; rows: (DecisionRow & { primaryQuery: string; status: string; family: string })[] }> {
  const base = `FROM (SELECT DISTINCT ON (d.opportunity_id) d.*, o.primary_query, o.status, o.candidate_page_family AS family FROM plataforma.eligibility_decision d JOIN plataforma.growth_opportunity o ON o.id = d.opportunity_id AND o.tenant_id = d.tenant_id ORDER BY d.opportunity_id, d.seq DESC) x`;
  const where = `WHERE ($1::text IS NULL OR decision = $1) AND ($2::text IS NULL OR family = $2) AND ($3::text IS NULL OR gate_results ->> $3 = 'FAIL')`; const args = [f.decision ?? null, f.family ?? null, f.gate ?? null];
  const total = Number((await db.query<{ n: string }>(`SELECT count(*) AS n ${base} ${where}`, args)).rows[0]!.n);
  const by = (await db.query<{ decision: string; n: string }>(`SELECT decision, count(*) AS n ${base} WHERE ($1::text IS NULL OR family = $1) GROUP BY decision`, [f.family ?? null])).rows;
  const rows = (await db.query<Row & { primary_query: string; status: string; family: string }>(`SELECT ${COLS}, primary_query, status, family ${base} ${where} ORDER BY total_score DESC NULLS LAST, topic_id LIMIT ${Math.min(f.limit ?? 25, 200)} OFFSET ${Math.max(f.offset ?? 0, 0)}`, args)).rows;
  return { total, byDecision: Object.fromEntries(by.map((x) => [x.decision, Number(x.n)])), rows: rows.map((r) => ({ ...toRow(r), primaryQuery: r.primary_query, status: r.status, family: r.family })) };
}
export { DECISIONS };
export type { EligibilityDecision };
