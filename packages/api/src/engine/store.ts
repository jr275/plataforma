import type { VerifiedIdentity } from "../identity";
import { withTenant, type PoolLike, type TenantDb } from "../tenant-context";
import { evidenceHash, type EvidenceDraft } from "./evidence";
import type { FetchLike } from "./http";
import { buildOpportunities, hashInputs, type EvidenceInput, type OpportunityDraft } from "./discovery";
import type { EntityRecord } from "./entities";
import { LifecycleError, RESCORABLE, STATES, assertExecutable, assertTransition, isState, type LifecycleState } from "./lifecycle";
import { compareScores, type ScoreComparison } from "./compare";
import { computeScore, validateInput, type DimensionMap, type ScoreResult } from "./score";
import { configHash, validateScoreConfig, type ScoreConfig } from "./score-config";
import { matchSignals } from "./signals";
import type { AdapterContext, AdapterResult, SourceAdapter } from "./adapters/types";
import { validateVertical, type ScopeDef, type VerticalDefinition } from "./vertical";

// Pesquisa de oportunidades e persistência (ADR-023, seção 9). Três transações curtas, como a geração (ADR-020): (1) abre a execução; (2) coleta nas fontes
// FORA do banco; (3) grava tudo ou nada e fecha. Repetir é idempotente: evidência por conteúdo, oportunidade por cluster, score por entradas.
export const DEFAULT_STALE_AFTER_MINUTES = 15;
export const USER_AGENT = "plataforma-research/0.1 (pesquisa de oportunidades; contato do administrador do tenant)";

export class ResearchBusyError extends Error {
  readonly code = "RESEARCH_BUSY";
  constructor(readonly activeRunId: string) { super(`já existe uma pesquisa em andamento neste tenant (${activeRunId})`); this.name = "ResearchBusyError"; }
}
export class OpportunityNotFoundError extends Error { readonly code = "OPPORTUNITY_NOT_FOUND"; constructor() { super("oportunidade não encontrada neste tenant"); this.name = "OpportunityNotFoundError"; } }
export class StaleStateError extends Error { readonly code = "STALE_STATE"; constructor(readonly expected: string, readonly actual: string) { super(`o estado mudou: esperado ${expected}, atual ${actual}`); this.name = "StaleStateError"; } }
export class ConfigError extends Error { readonly code = "INVALID_CONFIG"; constructor(readonly problems: readonly string[]) { super(`configuração de score inválida: ${problems.join("; ")}`); this.name = "ConfigError"; } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUnique = (e: unknown, constraint: string): boolean => { const x = e as { code?: string; constraint?: string; cause?: unknown } | null; return !!x && ((x.code === "23505" && x.constraint === constraint) || (x.cause !== undefined && x.cause !== e && isUnique(x.cause, constraint))); };
const safe = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/postgres(ql)?:\/\/\S+/gi, "[url removida]").slice(0, 1000);

export interface ResearchDeps {
  readonly vertical: VerticalDefinition; readonly adapters: readonly SourceAdapter[]; readonly fetch: FetchLike;
  readonly now?: () => Date; readonly sleep?: (ms: number) => Promise<void>; readonly userAgent?: string;
}
export interface ResearchInput { readonly entityLimit?: number; /** Id de um escopo da vertical (ex.: piloto de uma cidade). */ readonly scopeId?: string; readonly adapterIds?: readonly string[]; readonly staleAfterMinutes?: number }
export interface AdapterSummary { readonly adapter: string; readonly status: AdapterResult["status"]; readonly requests: number; readonly bytes: number; readonly seen: number; readonly kept: number; readonly inserted: number; readonly existing: number; readonly errors: AdapterResult["errors"]; readonly limitations: readonly string[]; readonly durationMs: number }
export interface ResearchResult {
  readonly runId: string; readonly status: "succeeded" | "partial" | "failed"; readonly error?: string;
  readonly adapters: readonly AdapterSummary[];
  readonly evidence: { readonly inserted: number; readonly existing: number };
  readonly opportunities: { readonly created: number; readonly existing: number; readonly rejected: number };
  readonly scores: { readonly inserted: number }; readonly transitions: number; readonly unclassified: number; readonly durationMs: number;
  /** Quando houve escopo: o que foi pedido, o que existe no tenant e o que falta (entidade não importada: nada é inventado). */
  readonly scope?: ScopeReport;
}
export interface ScopeReport { readonly id: string; readonly label: string; readonly requested: readonly string[]; readonly found: readonly string[]; readonly missing: readonly string[] }

export interface ActiveConfig { readonly id: string; readonly version: number; readonly hash: string; readonly config: ScoreConfig; readonly note: string | null; readonly createdAt: Date }
interface ConfigRow { id: string; version: number; config: ScoreConfig; config_hash: string; note: string | null; created_at: Date }
const toConfig = (r: ConfigRow): ActiveConfig => ({ id: r.id, version: r.version, hash: r.config_hash, config: r.config, note: r.note, createdAt: r.created_at });

/** Execuções `running` há mais que o prazo viram `failed` (processo que morreu entre abrir e fechar). */
export async function recoverStaleResearchRuns(db: TenantDb, staleAfterMinutes = DEFAULT_STALE_AFTER_MINUTES): Promise<string[]> {
  if (!Number.isInteger(staleAfterMinutes) || staleAfterMinutes < 1) throw new TypeError("staleAfterMinutes deve ser inteiro >= 1");
  const r = await db.query<{ id: string }>(`UPDATE plataforma.research_run SET status = 'failed', finished_at = now(), error = 'abandonada: sem fechamento em ' || $1::text || ' minutos' WHERE status = 'running' AND started_at < now() - make_interval(mins => $1) RETURNING id`, [staleAfterMinutes]);
  return r.rows.map((x) => x.id);
}

/** A versão ativa é a mais recente do tenant e da vertical; se não existe, a versão 1 nasce da configuração padrão da vertical. */
export async function ensureActiveConfig(db: TenantDb, vertical: VerticalDefinition, actor: string): Promise<ActiveConfig> {
  const sel = () => db.query<ConfigRow>(`SELECT id, version, config, config_hash, note, created_at FROM plataforma.score_config WHERE vertical_id = $1 ORDER BY version DESC LIMIT 1`, [vertical.id]);
  let r = await sel();
  if (r.rows.length === 0) {
    await db.query(`INSERT INTO plataforma.score_config (tenant_id, vertical_id, version, config, config_hash, note, created_by) VALUES (plataforma.current_tenant_id(), $1, 1, $2::jsonb, $3, 'versão inicial: configuração padrão da vertical', $4) ON CONFLICT DO NOTHING`, [vertical.id, JSON.stringify(vertical.scoring), configHash(vertical.scoring), actor]);
    r = await sel();
  }
  const cfg = toConfig(r.rows[0]!);
  const problems = validateScoreConfig(cfg.config);
  if (problems.length > 0) throw new ConfigError(problems);
  return cfg;
}

export async function loadEntities(db: TenantDb): Promise<EntityRecord[]> {
  const r = await db.query<{ id: string; name: string; uf: string; population: string | null; ibge_code: string }>(`SELECT id, name, uf, population, ibge_code FROM plataforma.city`);
  return r.rows.map((x) => ({ kind: "city", id: x.id, name: x.name, qualifier: x.uf, code: x.ibge_code, weight: x.population === null ? null : Number(x.population) }));
}
/** Páginas geradas (a última versão de cada uma) e o template que as produziu. */
export async function loadPages(db: TenantDb): Promise<{ entityId: string; templateKey: string }[]> {
  const r = await db.query<{ entity_id: string; template_key: string }>(`SELECT p.entity_id, pv.template_key FROM plataforma.page p JOIN plataforma.page_version pv ON pv.page_id = p.id AND pv.version = p.latest_version`);
  return r.rows.map((x) => ({ entityId: x.entity_id, templateKey: x.template_key }));
}

interface EvidenceRow { id: string; adapter: string; kind: EvidenceDraft["kind"]; source_ref: string; url: string; title: string; summary: string | null; published_at: Date | null; collected_at: Date; valid_until: Date | null; basis: EvidenceDraft["basis"]; payload: Record<string, unknown>; topics: string[]; limitations: string[] }
const toDraft = (x: EvidenceRow): EvidenceDraft => ({ adapter: x.adapter, kind: x.kind, sourceRef: x.source_ref, url: x.url, title: x.title, summary: x.summary, publishedAt: x.published_at, collectedAt: x.collected_at, validUntil: x.valid_until, basis: x.basis, payload: x.payload, topics: x.topics, limitations: x.limitations });
/** Evidência ATUAL para o pipeline: a mais recente de cada fonte e identificador que ainda vale. */
export async function loadCurrentEvidence(db: TenantDb, now: Date): Promise<EvidenceInput[]> {
  const r = await db.query<EvidenceRow>(`SELECT DISTINCT ON (adapter, source_ref) id, adapter, kind, source_ref, url, title, summary, published_at, collected_at, valid_until, basis, payload, topics, limitations FROM plataforma.evidence WHERE valid_until IS NULL OR valid_until > $1 ORDER BY adapter, source_ref, collected_at DESC, created_at DESC`, [now]);
  return r.rows.map((x) => ({ key: x.id, draft: toDraft(x) }));
}

export async function runAdapters(adapters: readonly SourceAdapter[], ctx: AdapterContext): Promise<AdapterResult[]> {
  const out: AdapterResult[] = [];
  for (const a of adapters) {
    const started = Date.now();
    try { out.push(await a.run(ctx)); }
    catch (e) { out.push({ adapter: a.id, status: "failed", evidence: [], errors: [{ target: a.id, code: "unexpected", message: safe(e), retryable: true }], requests: 0, bytes: 0, seen: 0, kept: 0, limitations: [], durationMs: Date.now() - started }); }
  }
  return out;
}

export async function runResearch(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, deps: ResearchDeps, input: ResearchInput = {}): Promise<ResearchResult> {
  const started = Date.now();
  const problems = validateVertical(deps.vertical);
  if (problems.length > 0) throw new TypeError(`vertical inválida: ${problems.join("; ")}`);
  const entityLimit = Math.min(Math.max(Math.trunc(input.entityLimit ?? 20), 1), 100);
  const scopeDef = input.scopeId === undefined ? undefined : deps.vertical.scopes?.find((s) => s.id === input.scopeId);
  if (input.scopeId !== undefined && !scopeDef) throw new TypeError(`escopo desconhecido: ${input.scopeId}`);
  const unknownIds = (input.adapterIds ?? []).filter((id) => !deps.adapters.some((a) => a.id === id));
  if (unknownIds.length > 0) throw new TypeError(`adaptador desconhecido: ${unknownIds.join(", ")}`);
  const adapters = deps.adapters.filter((a) => !input.adapterIds || input.adapterIds.includes(a.id));
  const now = deps.now ?? (() => new Date());
  const actor = identity.userId;

  // 1. abre a execução (recupera abandonadas; uma só `running` por tenant)
  let runId: string;
  try {
    runId = await withTenant(pool, identity, tenantId, async (db) => {
      await recoverStaleResearchRuns(db, input.staleAfterMinutes);
      const r = await db.query<{ id: string }>(`INSERT INTO plataforma.research_run (tenant_id, vertical_id, params, created_by) VALUES (plataforma.current_tenant_id(), $1, $2::jsonb, $3) RETURNING id`, [deps.vertical.id, JSON.stringify({ entityLimit, adapters: adapters.map((a) => a.id), ...(scopeDef ? { scope: scopeDef.id } : {}) }), actor]);
      return r.rows[0]!.id;
    });
  } catch (e) {
    if (isUnique(e, "research_run_one_running_idx")) {
      const active = await withTenant(pool, identity, tenantId, async (db) => (await db.query<{ id: string }>(`SELECT id FROM plataforma.research_run WHERE status = 'running' LIMIT 1`)).rows[0]?.id);
      throw new ResearchBusyError(active ?? "desconhecida");
    }
    throw e;
  }

  try {
    // 2. coleta nas fontes, fora de qualquer transação
    const results = await runAdapters(adapters, { fetch: deps.fetch, now: now(), userAgent: deps.userAgent ?? USER_AGENT, vertical: deps.vertical, sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))), robots: new Map() });
    // 3. grava tudo ou nada e fecha
    return await withTenant(pool, identity, tenantId, async (db) => {
      const p = await persist(db, { runId, vertical: deps.vertical, entityLimit, scope: scopeDef, results, now: now(), actor });
      const adapterStatuses = results.map((r) => r.status);
      const status: ResearchResult["status"] = adapterStatuses.every((s) => s === "succeeded") ? "succeeded" : "partial";
      const adaptersJson = p.adapters;
      await db.query(`UPDATE plataforma.research_run SET status = $2, adapters = $3::jsonb, stats = $4::jsonb, error = NULL, finished_at = now() WHERE id = $1 AND status = 'running'`, [runId, status, JSON.stringify(adaptersJson), JSON.stringify({ evidence: p.evidence, opportunities: p.opportunities, scores: p.scores, transitions: p.transitions, unclassified: p.unclassified })]);
      return { runId, status, adapters: adaptersJson, evidence: p.evidence, opportunities: p.opportunities, scores: p.scores, transitions: p.transitions, unclassified: p.unclassified, durationMs: Date.now() - started, ...(p.scope ? { scope: p.scope } : {}) };
    });
  } catch (e) {
    const error = safe(e);
    await withTenant(pool, identity, tenantId, async (db) => { await db.query(`UPDATE plataforma.research_run SET status = 'failed', error = $2, finished_at = now() WHERE id = $1 AND status = 'running'`, [runId, error]); });
    return { runId, status: "failed", error, adapters: [], evidence: { inserted: 0, existing: 0 }, opportunities: { created: 0, existing: 0, rejected: 0 }, scores: { inserted: 0 }, transitions: 0, unclassified: 0, durationMs: Date.now() - started };
  }
}

interface Persisted { scope?: ScopeReport; adapters: AdapterSummary[]; evidence: { inserted: number; existing: number }; opportunities: { created: number; existing: number; rejected: number }; scores: { inserted: number }; transitions: number; unclassified: number }
interface Step { id: string; from: LifecycleState; to: LifecycleState; reason: string }

async function persist(db: TenantDb, a: { runId: string; vertical: VerticalDefinition; entityLimit: number; scope: ScopeDef | undefined; results: readonly AdapterResult[]; now: Date; actor: string }): Promise<Persisted> {
  const { runId, vertical, now, actor } = a;
  const config = await ensureActiveConfig(db, vertical, actor);

  // evidência: tema por regra da vertical; gravação idempotente por conteúdo
  const rows = a.results.flatMap((r) => r.evidence.map((e) => ({ r: r.adapter, e })));
  const insertedBy = new Map<string, number>();
  let inserted = 0;
  if (rows.length > 0) {
    const payload = rows.map(({ e }) => ({ adapter: e.adapter, kind: e.kind, source_ref: e.sourceRef, url: e.url, title: e.title, summary: e.summary, published_at: e.publishedAt, collected_at: e.collectedAt, valid_until: e.validUntil, basis: e.basis, payload: e.payload, topics: [...new Set([...e.topics, ...matchSignals(vertical, e).map((m) => m.topic)])], limitations: e.limitations, content_hash: evidenceHash(e) }));
    const r = await db.query<{ adapter: string }>(`INSERT INTO plataforma.evidence (tenant_id, run_id, adapter, kind, source_ref, url, title, summary, published_at, collected_at, valid_until, basis, payload, topics, limitations, content_hash)
      SELECT plataforma.current_tenant_id(), $1, x.adapter, x.kind, x.source_ref, x.url, x.title, x.summary, x.published_at, x.collected_at, x.valid_until, x.basis, x.payload, x.topics, x.limitations, x.content_hash
        FROM jsonb_to_recordset($2::jsonb) AS x(adapter text, kind text, source_ref text, url text, title text, summary text, published_at timestamptz, collected_at timestamptz, valid_until timestamptz, basis text, payload jsonb, topics text[], limitations text[], content_hash text)
      ON CONFLICT (tenant_id, adapter, source_ref, content_hash) DO NOTHING RETURNING adapter`, [runId, JSON.stringify(payload)]);
    inserted = r.rows.length;
    for (const x of r.rows) insertedBy.set(x.adapter, (insertedBy.get(x.adapter) ?? 0) + 1);
  }
  const adapters: AdapterSummary[] = a.results.map((r) => ({ adapter: r.adapter, status: r.status, requests: r.requests, bytes: r.bytes, seen: r.seen, kept: r.kept, inserted: insertedBy.get(r.adapter) ?? 0, existing: r.evidence.length - (insertedBy.get(r.adapter) ?? 0), errors: r.errors, limitations: r.limitations, durationMs: r.durationMs }));

  // pipeline sobre os dados reais do tenant e a evidência atual
  // Em série: uma transação tem um único cliente, e consultas simultâneas nele são enfileiradas com aviso de descontinuação do `pg`.
  const entities = await loadEntities(db);
  const pages = await loadPages(db);
  const evidence = await loadCurrentEvidence(db, now);
  const entityCodes = a.scope ? new Set(a.scope.entityCodes) : undefined;
  const { drafts, stats } = buildOpportunities({ def: vertical, entities, evidence, pages, config: config.config, now, entityLimit: a.entityLimit, ...(entityCodes ? { entityCodes } : {}) });
  const have = new Set(entities.filter((x) => x.kind === a.scope?.entityKind).map((x) => x.code));
  const scope: ScopeReport | undefined = a.scope ? { id: a.scope.id, label: a.scope.label, requested: a.scope.entityCodes, found: a.scope.entityCodes.filter((c) => have.has(c)), missing: a.scope.entityCodes.filter((c) => !have.has(c)) } : undefined;
  const out = await saveOpportunities(db, { runId, vertical, drafts, config, actor });
  return { ...(scope ? { scope } : {}), adapters, evidence: { inserted, existing: rows.length - inserted }, opportunities: out.opportunities, scores: out.scores, transitions: out.transitions, unclassified: stats.unclassified.length };
}

async function saveOpportunities(db: TenantDb, a: { runId: string; vertical: VerticalDefinition; drafts: readonly OpportunityDraft[]; config: ActiveConfig; actor: string }): Promise<{ opportunities: Persisted["opportunities"]; scores: { inserted: number }; transitions: number }> {
  const { runId, vertical, drafts, config, actor } = a;
  if (drafts.length === 0) return { opportunities: { created: 0, existing: 0, rejected: 0 }, scores: { inserted: 0 }, transitions: 0 };
  const demand = { value: null, basis: "unknown", source: null, note: "Demanda de busca não medida: não há fonte (Search Console, Trends ou provedor autorizado). A query é uma hipótese gerada pela vertical." };
  const payload = drafts.map((d) => ({ cluster_key: d.clusterKey, pattern_key: d.pattern.key, primary_query: d.primaryQuery, variants: d.variants, language: d.language, country: d.country, location: d.location, entity_kind: d.entity?.kind ?? null, entity_id: d.entity?.id ?? null, intent: d.intent, stage: d.stage, jtbd: d.jtbd, experience: d.experience, expected_outcome: d.expectedOutcome, hypothesis: true, demand, trend: d.trend, validation: d.validation }));
  const up = await db.query<{ id: string; cluster_key: string; status: string; inserted: boolean }>(
    `INSERT INTO plataforma.growth_opportunity (tenant_id, vertical_id, cluster_key, pattern_key, primary_query, variants, language, country, location, entity_kind, entity_id, intent, stage, jtbd, experience, expected_outcome, hypothesis, demand, trend, status, validation, first_run_id, last_run_id)
     SELECT plataforma.current_tenant_id(), $1, x.cluster_key, x.pattern_key, x.primary_query, x.variants, x.language, x.country, x.location, x.entity_kind, x.entity_id, x.intent, x.stage, x.jtbd, x.experience, x.expected_outcome, x.hypothesis, x.demand, x.trend, 'discovered', x.validation, $2, $2
       FROM jsonb_to_recordset($3::jsonb) AS x(cluster_key text, pattern_key text, primary_query text, variants text[], language text, country text, location jsonb, entity_kind text, entity_id uuid, intent text, stage text, jtbd text, experience text, expected_outcome text, hypothesis boolean, demand jsonb, trend jsonb, validation jsonb)
     ON CONFLICT (tenant_id, vertical_id, cluster_key) DO UPDATE SET last_run_id = EXCLUDED.last_run_id, variants = EXCLUDED.variants, trend = EXCLUDED.trend, validation = EXCLUDED.validation
     RETURNING id, cluster_key, status, (xmax = 0) AS inserted`, [vertical.id, runId, JSON.stringify(payload)]);
  const byKey = new Map(drafts.map((d) => [d.clusterKey, d]));
  const events: { opportunity_id: string; event_type: string; from_status: string | null; to_status: string | null; actor: string; reason: string | null; data: unknown; run_id: string }[] = [];
  const steps: Step[][] = []; // rodadas de transição
  const addStep = (round: number, s: Step) => { (steps[round] ??= []).push(s); };
  let created = 0, rejected = 0;
  const live: { id: string; d: OpportunityDraft; status: LifecycleState; isNew: boolean }[] = [];
  for (const row of up.rows) {
    const d = byKey.get(row.cluster_key)!;
    const st = row.status as LifecycleState;
    if (row.inserted) { created++; events.push({ opportunity_id: row.id, event_type: "discovered", from_status: null, to_status: "discovered", actor, reason: "hipótese gerada pela vertical a partir de uma entidade real do tenant", data: { pattern: d.pattern.key, hypothesis: true }, run_id: runId }); }
    if (st === "discovered" || row.inserted) {
      if (d.validation.ok) { addStep(0, { id: row.id, from: "discovered", to: "validated", reason: "validação de aderência à vertical: ok" }); live.push({ id: row.id, d, status: "validated", isNew: row.inserted }); }
      else { rejected++; addStep(0, { id: row.id, from: "discovered", to: "rejected", reason: `rejeitada: ${d.validation.reasons.join("; ")}` }); }
    } else if (st !== "rejected") live.push({ id: row.id, d, status: st, isNew: false });
  }

  // scores: só para o que pode ser reavaliado sem mudar de estado ou que acabou de ser validado
  const scoring = live.filter((x) => x.status === "validated" || RESCORABLE.includes(x.status));
  const sc = scoring.map((x) => ({ opportunity_id: x.id, config_id: config.id, model_version: x.d.score.model, inputs_hash: x.d.inputsHash, strategic: x.d.strategic, dimensions: x.d.dimensions, result: x.d.score, priority_value: x.d.score.priority.value, priority_kind: x.d.score.priority.kind, eligible: x.d.score.eligibility.eligible, confidence: Math.round(x.d.score.confidence * 10000) / 10000, created_by: actor }));
  const newScores = new Map<string, string>();
  if (sc.length > 0) {
    const r = await db.query<{ id: string; opportunity_id: string }>(
      `INSERT INTO plataforma.opportunity_score (tenant_id, opportunity_id, config_id, model_version, inputs_hash, strategic, dimensions, result, priority_value, priority_kind, eligible, confidence, created_by)
       SELECT plataforma.current_tenant_id(), x.opportunity_id, x.config_id, x.model_version, x.inputs_hash, x.strategic, x.dimensions, x.result, x.priority_value, x.priority_kind, x.eligible, x.confidence, x.created_by
         FROM jsonb_to_recordset($1::jsonb) AS x(opportunity_id uuid, config_id uuid, model_version text, inputs_hash text, strategic boolean, dimensions jsonb, result jsonb, priority_value numeric, priority_kind text, eligible boolean, confidence numeric, created_by text)
       ON CONFLICT (opportunity_id, config_id, inputs_hash) DO NOTHING RETURNING id, opportunity_id`, [JSON.stringify(sc)]);
    for (const x of r.rows) newScores.set(x.opportunity_id, x.id);
  }
  // transições posteriores ao score (validated → scored → eligible; ajustes scored <-> eligible)
  for (const x of scoring) {
    const eligible = x.d.score.eligibility.eligible;
    if (x.status === "validated") { addStep(1, { id: x.id, from: "validated", to: "scored", reason: "primeiro score calculado" }); if (eligible) addStep(2, { id: x.id, from: "scored", to: "eligible", reason: "elegível: " + x.d.score.eligibility.checks.map((c) => c.detail).join("; ") }); }
    else if (x.status === "scored" && eligible && newScores.has(x.id)) addStep(0, { id: x.id, from: "scored", to: "eligible", reason: "passou a ser elegível" });
    else if (x.status === "eligible" && !eligible && newScores.has(x.id)) addStep(0, { id: x.id, from: "eligible", to: "scored", reason: "deixou de ser elegível: " + x.d.score.eligibility.checks.filter((c) => !c.ok).map((c) => c.detail).join("; ") });
  }
  // Ordem coerente do histórico: descoberta, validação, SCORE, e só então as transições que dependem do score.
  const scoreEvents: typeof events = [];
  // denormalização do score mais recente + evento de score
  const upd = scoring.filter((x) => newScores.has(x.id)).map((x) => ({ id: x.id, score_id: newScores.get(x.id)!, priority_value: x.d.score.priority.value, priority_kind: x.d.score.priority.kind, eligible: x.d.score.eligibility.eligible, commercial: x.d.score.objectives.commercial_value.adjusted, feasibility: x.d.score.objectives.execution_feasibility.adjusted, discovery: x.d.score.objectives.discovery_opportunity.adjusted }));
  if (upd.length > 0) {
    await db.query(`UPDATE plataforma.growth_opportunity o SET latest_score_id = x.score_id, priority_value = x.priority_value, priority_kind = x.priority_kind, eligible = x.eligible, commercial_value = x.commercial, feasibility = x.feasibility, discovery = x.discovery
      FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, score_id uuid, priority_value numeric, priority_kind text, eligible boolean, commercial numeric, feasibility numeric, discovery numeric) WHERE o.id = x.id`, [JSON.stringify(upd)]);
    for (const x of upd) scoreEvents.push({ opportunity_id: x.id, event_type: "score", from_status: null, to_status: null, actor, reason: `score calculado com a configuração v${config.version}`, data: { configVersion: config.version, priority: x.priority_value, kind: x.priority_kind, eligible: x.eligible }, run_id: runId });
  }
  let transitions = 0;
  for (let i = 0; i < steps.length; i++) {
    const round = steps[i];
    if (i === 1) events.push(...scoreEvents);
    if (!round) continue;
    const groups = new Map<string, Step[]>();
    for (const s of round) { assertExecutable(s.from, s.to); groups.set(`${s.from}>${s.to}`, [...(groups.get(`${s.from}>${s.to}`) ?? []), s]); }
    for (const [k, list] of groups) {
      const [from, to] = k.split(">") as [LifecycleState, LifecycleState];
      const r = await db.query<{ id: string }>(`UPDATE plataforma.growth_opportunity SET status = $2 WHERE id = ANY($3::uuid[]) AND status = $1 RETURNING id`, [from, to, list.map((s) => s.id)]);
      if (r.rows.length !== list.length) throw new StaleStateError(`${list.length} em ${from}`, `${r.rows.length} atualizadas`);
      transitions += list.length;
      for (const s of list) events.push({ opportunity_id: s.id, event_type: "transition", from_status: from, to_status: to, actor, reason: s.reason, data: {}, run_id: runId });
    }
  }
  if (steps.length < 2) events.push(...scoreEvents);
  // vínculos com a evidência (histórico: um novo conteúdo da mesma fonte cria novo vínculo, o antigo permanece)
  const links = live.flatMap((x) => x.d.links.map((l) => ({ opportunity_id: x.id, evidence_id: l.evidenceKey, role: l.role, reason: l.reason, topic: l.topic })));
  const seen = new Set<string>();
  const uniqueLinks = links.filter((l) => { const k = `${l.opportunity_id}|${l.evidence_id}|${l.role}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (uniqueLinks.length > 0) await db.query(`INSERT INTO plataforma.opportunity_evidence (tenant_id, opportunity_id, evidence_id, role, reason, topic, run_id) SELECT plataforma.current_tenant_id(), x.opportunity_id, x.evidence_id, x.role, x.reason, x.topic, $1 FROM jsonb_to_recordset($2::jsonb) AS x(opportunity_id uuid, evidence_id uuid, role text, reason text, topic text) ON CONFLICT DO NOTHING`, [runId, JSON.stringify(uniqueLinks)]);
  if (events.length > 0) await db.query(`INSERT INTO plataforma.opportunity_event (tenant_id, opportunity_id, event_type, from_status, to_status, actor, reason, data, run_id) SELECT plataforma.current_tenant_id(), x.opportunity_id, x.event_type, x.from_status, x.to_status, x.actor, x.reason, x.data, x.run_id FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS t(e, ord), jsonb_to_record(t.e) AS x(opportunity_id uuid, event_type text, from_status text, to_status text, actor text, reason text, data jsonb, run_id uuid) ORDER BY t.ord`, [JSON.stringify(events)]);
  return { opportunities: { created, existing: up.rows.length - created, rejected }, scores: { inserted: newScores.size }, transitions };
}

// ---- configuração versionada --------------------------------------------------------------------------------------------------------------------

export async function listScoreConfigs(db: TenantDb, verticalId: string): Promise<ActiveConfig[]> {
  const r = await db.query<ConfigRow>(`SELECT id, version, config, config_hash, note, created_at FROM plataforma.score_config WHERE vertical_id = $1 ORDER BY version DESC`, [verticalId]);
  return r.rows.map(toConfig);
}
/** Cria uma NOVA versão (imutável). Mesmo conteúdo que uma versão existente: devolve a existente, sem duplicar. */
export async function saveScoreConfig(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, input: { verticalId: string; config: ScoreConfig; note?: string }): Promise<{ config: ActiveConfig; created: boolean }> {
  const problems = validateScoreConfig(input.config);
  if (problems.length > 0) throw new ConfigError(problems);
  const hash = configHash(input.config);
  return withTenant(pool, identity, tenantId, async (db) => {
    const same = await db.query<ConfigRow>(`SELECT id, version, config, config_hash, note, created_at FROM plataforma.score_config WHERE vertical_id = $1 AND config_hash = $2`, [input.verticalId, hash]);
    if (same.rows[0]) return { config: toConfig(same.rows[0]), created: false };
    const r = await db.query<ConfigRow>(`INSERT INTO plataforma.score_config (tenant_id, vertical_id, version, config, config_hash, note, created_by) VALUES (plataforma.current_tenant_id(), $1, COALESCE((SELECT max(version) FROM plataforma.score_config WHERE vertical_id = $1), 0) + 1, $2::jsonb, $3, $4, $5) RETURNING id, version, config, config_hash, note, created_at`, [input.verticalId, JSON.stringify(input.config), hash, input.note ?? null, identity.userId]);
    return { config: toConfig(r.rows[0]!), created: true };
  });
}

// ---- reavaliação do score ------------------------------------------------------------------------------------------------------------------------

export interface RescoreResult { readonly opportunityId: string; readonly scoreId: string; readonly configVersion: number; readonly created: boolean; readonly result: ScoreResult; readonly comparison: ScoreComparison | null }
/** Reavalia UMA oportunidade com uma versão de configuração (a ativa, se não for indicada), reusando as entradas do último cálculo. */
export async function rescoreOpportunity(pool: PoolLike, identity: VerticalIdentityLike, tenantId: string, input: { opportunityId: string; configVersion?: number }): Promise<RescoreResult> {
  if (!UUID.test(input.opportunityId)) throw new OpportunityNotFoundError();
  return withTenant(pool, identity, tenantId, async (db) => {
    const o = await db.query<{ id: string; vertical_id: string; status: string; latest_score_id: string | null }>(`SELECT id, vertical_id, status, latest_score_id FROM plataforma.growth_opportunity WHERE id = $1`, [input.opportunityId]);
    const opp = o.rows[0];
    if (!opp) throw new OpportunityNotFoundError();
    if (!opp.latest_score_id) throw new StaleStateError("uma oportunidade com score", "sem score");
    const prev = await db.query<{ id: string; dimensions: DimensionMap; strategic: boolean; result: ScoreResult; config_id: string }>(`SELECT id, dimensions, strategic, result, config_id FROM plataforma.opportunity_score WHERE id = $1`, [opp.latest_score_id]);
    const p = prev.rows[0]!;
    const cr = input.configVersion === undefined
      ? await db.query<ConfigRow>(`SELECT id, version, config, config_hash, note, created_at FROM plataforma.score_config WHERE vertical_id = $1 ORDER BY version DESC LIMIT 1`, [opp.vertical_id])
      : await db.query<ConfigRow>(`SELECT id, version, config, config_hash, note, created_at FROM plataforma.score_config WHERE vertical_id = $1 AND version = $2`, [opp.vertical_id, input.configVersion]);
    const cfgRow = cr.rows[0];
    if (!cfgRow) throw new ConfigError(["versão de configuração inexistente"]);
    const cfg = toConfig(cfgRow);
    const bad = [...validateScoreConfig(cfg.config), ...validateInput({ dimensions: p.dimensions, strategic: p.strategic })];
    if (bad.length > 0) throw new ConfigError(bad);
    const result = computeScore({ dimensions: p.dimensions, strategic: p.strategic }, cfg.config);
    const inputsHash = hashInputs(p.dimensions, p.strategic, cfg.config, []);
    const ins = await db.query<{ id: string }>(`INSERT INTO plataforma.opportunity_score (tenant_id, opportunity_id, config_id, model_version, inputs_hash, strategic, dimensions, result, priority_value, priority_kind, eligible, confidence, created_by) VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12) ON CONFLICT (opportunity_id, config_id, inputs_hash) DO NOTHING RETURNING id`,
      [opp.id, cfg.id, result.model, inputsHash, p.strategic, JSON.stringify(p.dimensions), JSON.stringify(result), result.priority.value, result.priority.kind, result.eligibility.eligible, Math.round(result.confidence * 10000) / 10000, identity.userId]);
    const created = ins.rows.length > 0;
    const scoreId = ins.rows[0]?.id ?? (await db.query<{ id: string }>(`SELECT id FROM plataforma.opportunity_score WHERE opportunity_id = $1 AND config_id = $2 AND inputs_hash = $3`, [opp.id, cfg.id, inputsHash])).rows[0]!.id;
    if (created) {
      await db.query(`UPDATE plataforma.growth_opportunity SET latest_score_id = $2, priority_value = $3, priority_kind = $4, eligible = $5, commercial_value = $6, feasibility = $7, discovery = $8 WHERE id = $1`, [opp.id, scoreId, result.priority.value, result.priority.kind, result.eligibility.eligible, result.objectives.commercial_value.adjusted, result.objectives.execution_feasibility.adjusted, result.objectives.discovery_opportunity.adjusted]);
      await db.query(`INSERT INTO plataforma.opportunity_event (tenant_id, opportunity_id, event_type, actor, reason, data) VALUES (plataforma.current_tenant_id(), $1, 'score', $2, $3, $4::jsonb)`, [opp.id, identity.userId, `score recalculado com a configuração v${cfg.version}`, JSON.stringify({ configVersion: cfg.version, priority: result.priority.value, kind: result.priority.kind, eligible: result.eligibility.eligible })]);
      const st = opp.status as LifecycleState;
      const move = async (to: LifecycleState, reason: string) => { assertExecutable(st, to); await db.query(`UPDATE plataforma.growth_opportunity SET status = $2 WHERE id = $1 AND status = $3`, [opp.id, to, st]); await db.query(`INSERT INTO plataforma.opportunity_event (tenant_id, opportunity_id, event_type, from_status, to_status, actor, reason) VALUES (plataforma.current_tenant_id(), $1, 'transition', $2, $3, $4, $5)`, [opp.id, st, to, identity.userId, reason]); };
      if (st === "scored" && result.eligibility.eligible) await move("eligible", "passou a ser elegível com a nova configuração");
      else if (st === "eligible" && !result.eligibility.eligible) await move("scored", "deixou de ser elegível com a nova configuração");
    }
    let comparison: ScoreComparison | null = null;
    if (p.id !== scoreId) {
      const oldCfg = await db.query<{ config: ScoreConfig }>(`SELECT config FROM plataforma.score_config WHERE id = $1`, [p.config_id]);
      comparison = compareScores(p.result, result, oldCfg.rows[0]?.config, cfg.config);
    }
    return { opportunityId: opp.id, scoreId, configVersion: cfg.version, created, result, comparison };
  });
}
type VerticalIdentityLike = VerifiedIdentity;

// ---- transição de estado -------------------------------------------------------------------------------------------------------------------------

/** Move a oportunidade um passo no ciclo de vida. Valida no código e (de novo) no banco; `from` evita corrida com outra decisão. */
export async function transitionOpportunity(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, input: { opportunityId: string; from: LifecycleState; to: LifecycleState; reason: string }): Promise<void> {
  if (!UUID.test(input.opportunityId)) throw new OpportunityNotFoundError();
  if (!isState(input.from) || !isState(input.to)) throw new LifecycleError(input.from, input.to);
  assertExecutable(input.from, input.to);
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 1000) throw new TypeError("o motivo precisa ter de 3 a 1000 caracteres");
  await withTenant(pool, identity, tenantId, async (db) => {
    const r = await db.query<{ id: string }>(`UPDATE plataforma.growth_opportunity SET status = $2 WHERE id = $1 AND status = $3 RETURNING id`, [input.opportunityId, input.to, input.from]);
    if (r.rows.length === 0) {
      const cur = await db.query<{ status: string }>(`SELECT status FROM plataforma.growth_opportunity WHERE id = $1`, [input.opportunityId]);
      if (!cur.rows[0]) throw new OpportunityNotFoundError();
      throw new StaleStateError(input.from, cur.rows[0].status);
    }
    await db.query(`INSERT INTO plataforma.opportunity_event (tenant_id, opportunity_id, event_type, from_status, to_status, actor, reason) VALUES (plataforma.current_tenant_id(), $1, 'transition', $2, $3, $4, $5)`, [input.opportunityId, input.from, input.to, identity.userId, reason]);
  });
}
export { STATES };

/** A versão ativa da configuração (cria a versão 1 a partir do padrão da vertical se o tenant ainda não tem nenhuma). */
export function ensureActiveConfigFor(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, vertical: VerticalDefinition): Promise<ActiveConfig> {
  return withTenant(pool, identity, tenantId, (db) => ensureActiveConfig(db, vertical, identity.userId));
}
