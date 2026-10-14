import type { TenantDb } from "../tenant-context";
import { isState, type LifecycleState } from "./lifecycle";
import type { ScoreResult } from "./score";
import type { EvidenceDraft } from "./evidence";
import { normalizeSearchText } from "../ingest/city-search";

const FROM = "áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ";
const TO = "aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN";

// Leitura do motor de oportunidades (ADR-023). Só `SELECT`; o isolamento é do RLS. Nenhum valor é preenchido quando falta: `null` quer dizer "não medido".
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SORTS = ["priority", "commercial", "feasibility", "discovery", "recent", "query"] as const;
export type OpportunitySort = (typeof SORTS)[number];
export const PRIORITY_KINDS = ["overall", "partial", "none"] as const;

export interface OpportunityFilters {
  readonly q?: string; readonly status?: LifecycleState; readonly intent?: string; readonly stage?: string;
  readonly eligible?: boolean; readonly priorityKind?: (typeof PRIORITY_KINDS)[number]; readonly sort?: OpportunitySort;
  readonly limit?: number; readonly offset?: number;
}
export interface OpportunityRow {
  readonly id: string; readonly clusterKey: string; readonly primaryQuery: string; readonly variants: readonly string[]; readonly intent: string; readonly stage: string; readonly experience: string; readonly entityId: string | null; readonly entityKind: string | null;
  readonly location: Record<string, unknown>; readonly status: LifecycleState; readonly hypothesis: boolean; readonly eligible: boolean | null; readonly priority: number | null; readonly priorityKind: string | null;
  readonly commercial: number | null; readonly feasibility: number | null; readonly discovery: number | null; readonly createdAt: Date; readonly updatedAt: Date;
  /** Confiança do score mais recente (0..1) e quantas das 15 dimensões estão desconhecidas; nulos se não há score. Cobertura diferente = score NÃO equivalente. */
  readonly confidence: number | null; readonly unknownDimensions: number | null; /** Quantas evidências estão ligadas à oportunidade. */ readonly evidenceCount: number;
}
export interface OpportunityList { readonly total: number; readonly rows: readonly OpportunityRow[]; readonly byStatus: Readonly<Record<string, number>> }

const num = (v: string | null): number | null => (v === null ? null : Number(v));
interface ListRow { id: string; cluster_key: string; primary_query: string; variants: string[]; intent: string; stage: string; experience: string; entity_id: string | null; entity_kind: string | null; location: Record<string, unknown>; status: string; hypothesis: boolean; eligible: boolean | null; priority_value: string | null; priority_kind: string | null; commercial_value: string | null; feasibility: string | null; discovery: string | null; created_at: Date; updated_at: Date; total: string; confidence: string | null; unknown_dims: number | null; evidence_count: string }
const ORDER: Record<OpportunitySort, string> = {
  priority: "priority_value DESC NULLS LAST, commercial_value DESC NULLS LAST, id",
  commercial: "commercial_value DESC NULLS LAST, id", feasibility: "feasibility DESC NULLS LAST, id", discovery: "discovery DESC NULLS LAST, id",
  recent: "updated_at DESC, id", query: "primary_query ASC, id",
};

export async function searchOpportunities(db: TenantDb, f: OpportunityFilters = {}): Promise<OpportunityList> {
  const limit = Math.min(Math.max(Math.trunc(f.limit ?? 25), 1), 100);
  const offset = Math.max(Math.trunc(f.offset ?? 0), 0);
  const sort = f.sort && SORTS.includes(f.sort) ? f.sort : "priority";
  const where: string[] = []; const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replaceAll("$?", `$${params.length}`)); };
  const q = f.q?.trim();
  if (q) add(`(lower(translate(primary_query, '${FROM}', '${TO}')) LIKE $? ESCAPE '\\' OR cluster_key LIKE $? ESCAPE '\\')`, `%${normalizeSearchText(q).replace(/[\\%_]/g, "\\$&")}%`);
  if (f.status !== undefined) { if (!isState(f.status)) throw new TypeError("estado inválido"); add("status = $?", f.status); }
  if (f.intent) add("intent = $?", f.intent);
  if (f.stage) add("stage = $?", f.stage);
  if (f.eligible !== undefined) add("eligible IS NOT DISTINCT FROM $?", f.eligible);
  if (f.priorityKind) { if (!PRIORITY_KINDS.includes(f.priorityKind)) throw new TypeError("tipo de prioridade inválido"); add("priority_kind = $?", f.priorityKind); }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  // `q` aparece duas vezes no mesmo marcador: reescreve para o mesmo parâmetro.
  const sqlWhere = w;
  const r = await db.query<ListRow>(`SELECT id, cluster_key, primary_query, variants, intent, stage, experience, entity_id, entity_kind, location, status, hypothesis, eligible, priority_value, priority_kind, commercial_value, feasibility, discovery, created_at, updated_at, count(*) OVER () AS total, (SELECT s.confidence FROM plataforma.opportunity_score s WHERE s.id = growth_opportunity.latest_score_id) AS confidence, (SELECT jsonb_array_length(s.result->'missing') FROM plataforma.opportunity_score s WHERE s.id = growth_opportunity.latest_score_id) AS unknown_dims, (SELECT count(*) FROM plataforma.opportunity_evidence oe WHERE oe.opportunity_id = growth_opportunity.id) AS evidence_count FROM plataforma.growth_opportunity ${sqlWhere} ORDER BY ${ORDER[sort]} LIMIT ${limit} OFFSET ${offset}`, params);
  const counts = await db.query<{ status: string; n: string }>(`SELECT status, count(*) AS n FROM plataforma.growth_opportunity GROUP BY status`);
  return {
    total: r.rows[0] ? Number(r.rows[0].total) : offset > 0 ? Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.growth_opportunity ${sqlWhere}`, params)).rows[0]!.n) : 0,
    rows: r.rows.map((x) => ({ id: x.id, clusterKey: x.cluster_key, primaryQuery: x.primary_query, variants: x.variants, intent: x.intent, stage: x.stage, experience: x.experience, entityId: x.entity_id, entityKind: x.entity_kind, location: x.location, status: x.status as LifecycleState, hypothesis: x.hypothesis, eligible: x.eligible, priority: num(x.priority_value), priorityKind: x.priority_kind, commercial: num(x.commercial_value), feasibility: num(x.feasibility), discovery: num(x.discovery), createdAt: x.created_at, updatedAt: x.updated_at, confidence: num(x.confidence), unknownDimensions: x.unknown_dims, evidenceCount: Number(x.evidence_count) })),
    byStatus: Object.fromEntries(counts.rows.map((c) => [c.status, Number(c.n)])),
  };
}

export interface LinkedEvidence { readonly role: string; readonly reason: string; readonly topic: string | null; readonly evidenceId: string; readonly evidence: EvidenceDraft & { readonly id: string } }
export interface ScoreRecord { readonly id: string; readonly createdAt: Date; readonly configVersion: number; readonly configId: string; readonly modelVersion: string; readonly priority: number | null; readonly priorityKind: string; readonly eligible: boolean; readonly confidence: number; readonly result: ScoreResult; readonly dimensions: Record<string, unknown>; readonly strategic: boolean; readonly createdBy: string }
export interface EventRecord { readonly id: string; readonly type: string; readonly from: string | null; readonly to: string | null; readonly actor: string; readonly reason: string | null; readonly data: Record<string, unknown>; readonly at: Date }
export interface OpportunityDetail extends OpportunityRow {
  readonly pattern: string; readonly jtbd: string; readonly expectedOutcome: string; readonly language: string; readonly country: string; readonly demand: Record<string, unknown>; readonly trend: Record<string, unknown>; readonly validation: Record<string, unknown>; readonly firstRunId: string; readonly lastRunId: string;
  readonly evidence: readonly LinkedEvidence[]; readonly scores: readonly ScoreRecord[]; readonly events: readonly EventRecord[];
  /** Cidade (entidade) de origem, quando a oportunidade nasceu de uma. */
  readonly entity: { readonly id: string; readonly name: string; readonly uf: string; readonly ibgeCode: string } | null;
}

export async function getOpportunity(db: TenantDb, id: string): Promise<OpportunityDetail | null> {
  if (!UUID.test(id)) return null;
  const o = await db.query<ListRow & { pattern_key: string; jtbd: string; expected_outcome: string; language: string; country: string; demand: Record<string, unknown>; trend: Record<string, unknown>; validation: Record<string, unknown>; first_run_id: string; last_run_id: string; total: string }>(`SELECT *, 0 AS total FROM plataforma.growth_opportunity WHERE id = $1`, [id]);
  const x = o.rows[0];
  if (!x) return null;
  const ev = await db.query<{ role: string; reason: string; topic: string | null; evidence_id: string; adapter: string; kind: EvidenceDraft["kind"]; source_ref: string; url: string; title: string; summary: string | null; published_at: Date | null; collected_at: Date; valid_until: Date | null; basis: EvidenceDraft["basis"]; payload: Record<string, unknown>; topics: string[]; limitations: string[] }>(
      `SELECT oe.role, oe.reason, oe.topic, e.id AS evidence_id, e.adapter, e.kind, e.source_ref, e.url, e.title, e.summary, e.published_at, e.collected_at, e.valid_until, e.basis, e.payload, e.topics, e.limitations FROM plataforma.opportunity_evidence oe JOIN plataforma.evidence e ON e.id = oe.evidence_id AND e.tenant_id = oe.tenant_id WHERE oe.opportunity_id = $1 ORDER BY e.collected_at DESC, e.id`, [id]);
  const sc = await db.query<{ id: string; created_at: Date; version: number; config_id: string; model_version: string; priority_value: string | null; priority_kind: string; eligible: boolean; confidence: string; result: ScoreResult; dimensions: Record<string, unknown>; strategic: boolean; created_by: string }>(
      `SELECT s.id, s.created_at, c.version, s.config_id, s.model_version, s.priority_value, s.priority_kind, s.eligible, s.confidence, s.result, s.dimensions, s.strategic, s.created_by FROM plataforma.opportunity_score s JOIN plataforma.score_config c ON c.id = s.config_id AND c.tenant_id = s.tenant_id WHERE s.opportunity_id = $1 ORDER BY s.created_at DESC, s.id`, [id]);
  const evs = await db.query<{ id: string; event_type: string; from_status: string | null; to_status: string | null; actor: string; reason: string | null; data: Record<string, unknown>; created_at: Date }>(`SELECT id, event_type, from_status, to_status, actor, reason, data, created_at FROM plataforma.opportunity_event WHERE opportunity_id = $1 ORDER BY seq`, [id]);
  const ent = x.entity_id ? await db.query<{ id: string; name: string; uf: string; ibge_code: string }>(`SELECT id, name, uf, ibge_code FROM plataforma.city WHERE id = $1`, [x.entity_id]) : { rows: [] as { id: string; name: string; uf: string; ibge_code: string }[] };
  const base: OpportunityRow = { id: x.id, clusterKey: x.cluster_key, primaryQuery: x.primary_query, variants: x.variants, intent: x.intent, stage: x.stage, experience: x.experience, entityId: x.entity_id, entityKind: x.entity_kind, location: x.location, status: x.status as LifecycleState, hypothesis: x.hypothesis, eligible: x.eligible, priority: num(x.priority_value), priorityKind: x.priority_kind, commercial: num(x.commercial_value), feasibility: num(x.feasibility), discovery: num(x.discovery), createdAt: x.created_at, updatedAt: x.updated_at, confidence: sc.rows[0] ? Number(sc.rows[0].confidence) : null, unknownDimensions: sc.rows[0] ? (sc.rows[0].result.missing?.length ?? null) : null, evidenceCount: ev.rows.length };
  return {
    ...base, pattern: x.pattern_key, jtbd: x.jtbd, expectedOutcome: x.expected_outcome, language: x.language, country: x.country, demand: x.demand, trend: x.trend, validation: x.validation, firstRunId: x.first_run_id, lastRunId: x.last_run_id,
    entity: ent.rows[0] ? { id: ent.rows[0].id, name: ent.rows[0].name, uf: ent.rows[0].uf, ibgeCode: ent.rows[0].ibge_code } : null,
    evidence: ev.rows.map((e) => ({ role: e.role, reason: e.reason, topic: e.topic, evidenceId: e.evidence_id, evidence: { id: e.evidence_id, adapter: e.adapter, kind: e.kind, sourceRef: e.source_ref, url: e.url, title: e.title, summary: e.summary, publishedAt: e.published_at, collectedAt: e.collected_at, validUntil: e.valid_until, basis: e.basis, payload: e.payload, topics: e.topics, limitations: e.limitations } })),
    scores: sc.rows.map((s) => ({ id: s.id, createdAt: s.created_at, configVersion: s.version, configId: s.config_id, modelVersion: s.model_version, priority: num(s.priority_value), priorityKind: s.priority_kind, eligible: s.eligible, confidence: Number(s.confidence), result: s.result, dimensions: s.dimensions, strategic: s.strategic, createdBy: s.created_by })),
    events: evs.rows.map((e) => ({ id: e.id, type: e.event_type, from: e.from_status, to: e.to_status, actor: e.actor, reason: e.reason, data: e.data, at: e.created_at })),
  };
}

export interface ResearchRunRow { readonly id: string; readonly status: string; readonly startedAt: Date; readonly finishedAt: Date | null; readonly error: string | null; readonly adapters: readonly Record<string, unknown>[]; readonly stats: Record<string, unknown>; readonly createdBy: string }
export async function listResearchRuns(db: TenantDb, limit = 10): Promise<ResearchRunRow[]> {
  const r = await db.query<{ id: string; status: string; started_at: Date; finished_at: Date | null; error: string | null; adapters: Record<string, unknown>[]; stats: Record<string, unknown>; created_by: string }>(`SELECT id, status, started_at, finished_at, error, adapters, stats, created_by FROM plataforma.research_run ORDER BY started_at DESC LIMIT $1`, [Math.min(Math.max(Math.trunc(limit), 1), 50)]);
  return r.rows.map((x) => ({ id: x.id, status: x.status, startedAt: x.started_at, finishedAt: x.finished_at, error: x.error, adapters: x.adapters, stats: x.stats, createdBy: x.created_by }));
}

export interface EvidenceRow { readonly id: string; readonly adapter: string; readonly kind: string; readonly title: string; readonly url: string; readonly summary: string | null; readonly publishedAt: Date | null; readonly collectedAt: Date; readonly basis: string; readonly topics: readonly string[]; readonly linked: number }
export async function searchEvidence(db: TenantDb, f: { kind?: string; adapter?: string; limit?: number } = {}): Promise<EvidenceRow[]> {
  const where: string[] = []; const params: unknown[] = [];
  if (f.kind) { params.push(f.kind); where.push(`e.kind = $${params.length}`); }
  if (f.adapter) { params.push(f.adapter); where.push(`e.adapter = $${params.length}`); }
  params.push(Math.min(Math.max(Math.trunc(f.limit ?? 50), 1), 200));
  const r = await db.query<{ id: string; adapter: string; kind: string; title: string; url: string; summary: string | null; published_at: Date | null; collected_at: Date; basis: string; topics: string[]; linked: string }>(`SELECT e.id, e.adapter, e.kind, e.title, e.url, e.summary, e.published_at, e.collected_at, e.basis, e.topics, (SELECT count(*) FROM plataforma.opportunity_evidence oe WHERE oe.evidence_id = e.id) AS linked FROM plataforma.evidence e ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY coalesce(e.published_at, e.collected_at) DESC, e.id LIMIT $${params.length}`, params);
  return r.rows.map((x) => ({ id: x.id, adapter: x.adapter, kind: x.kind, title: x.title, url: x.url, summary: x.summary, publishedAt: x.published_at, collectedAt: x.collected_at, basis: x.basis, topics: x.topics, linked: Number(x.linked) }));
}
