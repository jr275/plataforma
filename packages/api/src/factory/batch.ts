import type { VerifiedIdentity } from "../identity";
import { recordDecision } from "../runtime/decision-audit";
import { runPagePipeline, type PipelineEnv } from "../runtime/pipeline";
import { withTenant, type PoolLike, type TenantDb } from "../tenant-context";

// Geração em lote: Select → Validate → Estimate → Confirm → Generate → QA → (Preview → Approve → Deploy → Verify, nas telas de página e deployment).
// O lote classifica ANTES de executar; só ELIGIBLE vira trabalho. A execução tem concorrência limitada, falha isolada por página, retentativa controlada, cancelamento cooperativo e retomada idempotente
// (a correlação do pipeline é determinística por lote+página, então passos concluídos são reaproveitados). Custos e tokens: o provedor não devolve custo por chamada ao pipeline, então o limite suportado é o de
// chamadas ao modelo por página; custo em dinheiro NÃO é estimado (sem metodologia).
export const MAX_CONCURRENCY = 8; export const MAX_ITEMS = 2000; export const MAX_ATTEMPTS = 2;
export interface BatchConfig {
  readonly limit: number; readonly families: readonly string[]; readonly templates: readonly string[]; readonly geo: { readonly uf?: string; readonly entityKeys?: readonly string[] } | null;
  readonly concurrency: number; readonly batchSize: number; readonly maxModelCallsPerPage: number; readonly qaPolicy: "default";
  readonly approvalPolicy: "manual"; readonly target: "none" | "preview" | "production"; readonly domainPack: string;
}
export const DEFAULT_CONFIG: BatchConfig = { limit: 50, families: [], templates: [], geo: null, concurrency: 2, batchSize: 10, maxModelCallsPerPage: 40, qaPolicy: "default", approvalPolicy: "manual", target: "preview", domainPack: "real-estate" };
export type Classification = "ELIGIBLE" | "BLOCKED" | "DATA_PENDING" | "ALREADY_DONE";
export interface BatchEstimate { readonly candidates: number; readonly eligible: number; readonly blocked: number; readonly dataPending: number; readonly alreadyDone: number; readonly estimatedBatches: number; readonly awaitingSerp: number; readonly externalDependencies: readonly string[]; readonly cost: { readonly available: false; readonly reason: string } }
export interface BatchRecord { readonly id: string; readonly name: string; readonly status: "PLANNED" | "CONFIRMED" | "RUNNING" | "COMPLETED" | "CANCELLED" | "FAILED"; readonly mode: "real" | "test_simulation"; readonly config: BatchConfig; readonly estimate: BatchEstimate; readonly cancelRequested: boolean; readonly createdBy: string; readonly createdAt: Date; readonly confirmedBy: string | null; readonly confirmedAt: Date | null; readonly startedAt: Date | null; readonly finishedAt: Date | null }
export class BatchError extends Error { constructor(message: string) { super(message); this.name = "BatchError"; } }

export function validateConfig(c: BatchConfig): string[] {
  const e: string[] = [];
  if (!Number.isInteger(c.limit) || c.limit < 1 || c.limit > MAX_ITEMS) e.push(`quantidade de candidatas deve ser de 1 a ${MAX_ITEMS}`);
  if (!Number.isInteger(c.concurrency) || c.concurrency < 1 || c.concurrency > MAX_CONCURRENCY) e.push(`concorrência deve ser de 1 a ${MAX_CONCURRENCY}`);
  if (!Number.isInteger(c.batchSize) || c.batchSize < 1 || c.batchSize > 100) e.push("tamanho do lote deve ser de 1 a 100");
  if (!Number.isInteger(c.maxModelCallsPerPage) || c.maxModelCallsPerPage < 1 || c.maxModelCallsPerPage > 200) e.push("limite de chamadas ao modelo por página deve ser de 1 a 200");
  if (!["none", "preview", "production"].includes(c.target)) e.push("destino inválido");
  if (c.geo?.uf !== undefined && !/^[A-Za-z]{2}$/.test(c.geo.uf)) e.push("UF inválida");
  return e;
}
interface Row { id: string; name: string; status: BatchRecord["status"]; mode: "real" | "test_simulation"; config: BatchConfig; estimate: BatchEstimate; cancel_requested: boolean; created_by: string; created_at: Date; confirmed_by: string | null; confirmed_at: Date | null; started_at: Date | null; finished_at: Date | null }
const COLS = "id, name, status, mode, config, estimate, cancel_requested, created_by, created_at, confirmed_by, confirmed_at, started_at, finished_at";
const toRec = (r: Row): BatchRecord => ({ id: r.id, name: r.name, status: r.status, mode: r.mode, config: r.config, estimate: r.estimate, cancelRequested: r.cancel_requested, createdBy: r.created_by, createdAt: r.created_at, confirmedBy: r.confirmed_by, confirmedAt: r.confirmed_at, startedAt: r.started_at, finishedAt: r.finished_at });

/** SELECT + VALIDATE + ESTIMATE: escolhe os candidatos pelo filtro (ordem determinística), classifica cada um pelo estado real e grava o lote PLANNED com a estimativa. Nada é executado. */
export async function planBatch(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, input: { name: string; config: BatchConfig; mode: "real" | "test_simulation"; llmConfigured: boolean }): Promise<{ batch: BatchRecord }> {
  const errors = validateConfig(input.config); if (errors.length > 0) throw new BatchError(errors.join("; "));
  const name = input.name.trim(); if (name.length < 1 || name.length > 120) throw new BatchError("dê um nome de 1 a 120 caracteres ao lote");
  const c = input.config;
  return withTenant(pool, identity, tenantId, async (db) => {
    const cands = (await db.query<{ id: string; decision: string | null; status: string; has_recipe: boolean; qa: string | null }>(`
      WITH d AS (SELECT DISTINCT ON (opportunity_id) opportunity_id, decision FROM plataforma.eligibility_decision ORDER BY opportunity_id, seq DESC),
           rc AS (SELECT DISTINCT ON (opportunity_id) opportunity_id, id FROM plataforma.page_recipe ORDER BY opportunity_id, version DESC),
           qa AS (SELECT DISTINCT ON (opportunity_id) opportunity_id, recipe_id, outcome FROM plataforma.qa_report ORDER BY opportunity_id, seq DESC)
      SELECT o.id, d.decision, o.status, rc.id IS NOT NULL AS has_recipe, CASE WHEN qa.recipe_id = rc.id THEN qa.outcome END AS qa
      FROM plataforma.growth_opportunity o LEFT JOIN d ON d.opportunity_id = o.id LEFT JOIN rc ON rc.opportunity_id = o.id LEFT JOIN qa ON qa.opportunity_id = o.id LEFT JOIN plataforma.entity e ON e.id = o.primary_entity_id
      WHERE o.topic_id IS NOT NULL AND ($1::text[] IS NULL OR o.candidate_page_family = ANY($1)) AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM plataforma.fact f WHERE f.entity_id = e.id AND f.attribute_id = e.entity_type || '.uf' AND f.superseded_at IS NULL AND upper(f.value #>> '{}') = upper($2))) AND ($3::text[] IS NULL OR e.source_key = ANY($3))
        AND ($4::text[] IS NULL OR EXISTS (SELECT 1 FROM plataforma.spec_blueprint b WHERE b.opportunity_id = o.id AND b.template_id = ANY($4)) OR NOT EXISTS (SELECT 1 FROM plataforma.spec_blueprint b WHERE b.opportunity_id = o.id))
      ORDER BY (d.decision = 'READY_FOR_BLUEPRINT') DESC NULLS LAST, o.priority_value DESC NULLS LAST, o.topic_id LIMIT $5`,
      [c.families.length ? [...c.families] : null, c.geo?.uf ?? null, c.geo?.entityKeys?.length ? [...c.geo.entityKeys] : null, c.templates.length ? [...c.templates] : null, c.limit])).rows;
    const cls = cands.map((x): { id: string; classification: Classification; reason: string | null; status: string } => {
      if (x.has_recipe && x.qa !== null) return { id: x.id, classification: "ALREADY_DONE", reason: `já tem recipe com QA (${x.qa})`, status: x.status };
      if (x.decision === "READY_FOR_BLUEPRINT") return { id: x.id, classification: "ELIGIBLE", reason: null, status: x.status };
      if (x.decision === "DATA_REQUIRED" || x.decision === "RESEARCH_REQUIRED") return { id: x.id, classification: "DATA_PENDING", reason: `decisão ${x.decision}: faltam dados ou demanda`, status: x.status };
      return { id: x.id, classification: "BLOCKED", reason: x.decision ? `decisão ${x.decision}` : "sem decisão de elegibilidade", status: x.status };
    });
    const n = (k: Classification) => cls.filter((x) => x.classification === k).length; const eligible = n("ELIGIBLE");
    const awaitingSerp = cls.filter((x) => x.classification === "ELIGIBLE" && ["eligible", "serp_analyzed"].includes(x.status)).length;
    const deps: string[] = [];
    if (!input.llmConfigured) deps.push("ANTHROPIC_API_KEY ausente: os agentes (explicação, narrativa e verificador) ficam bloqueados; o QA Q14 não roda e nenhuma página fica QA_PASSED");
    if (awaitingSerp > 0) deps.push(`${awaitingSerp} página(s) dependem de SERP analisada ou exceção humana registrada (ADR-025) antes do recipe`);
    if (c.target !== "none") deps.push("Deployment: projeto Vercel conectado e VERCEL_TOKEN (ver Deployment Center)");
    const estimate: BatchEstimate = { candidates: cls.length, eligible, blocked: n("BLOCKED"), dataPending: n("DATA_PENDING"), alreadyDone: n("ALREADY_DONE"), estimatedBatches: Math.ceil(eligible / c.batchSize), awaitingSerp, externalDependencies: deps, cost: { available: false, reason: "Sem metodologia de custo: o provedor de LLM não devolve custo por chamada a este pipeline. O limite suportado é o de chamadas ao modelo por página." } };
    const b = toRec((await db.query<Row>(`INSERT INTO plataforma.generation_batch (tenant_id, name, status, mode, config, estimate, created_by) VALUES (plataforma.current_tenant_id(), $1, 'PLANNED', $2, $3::jsonb, $4::jsonb, $5) RETURNING ${COLS}`, [name, input.mode, JSON.stringify(c), JSON.stringify(estimate), identity.userId])).rows[0]!);
    for (const x of cls) await db.query(`INSERT INTO plataforma.generation_batch_item (tenant_id, batch_id, opportunity_id, classification, reason, status) VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4, $5)`, [b.id, x.id, x.classification, x.reason, x.classification === "ELIGIBLE" ? "PENDING" : "SKIPPED"]);
    await recordDecision(db, { subjectKind: "batch", subjectRef: b.id, decision: "BATCH_PLANNED", decidedBy: "human", applied: true, reason: `lote “${name}” planejado: ${estimate.eligible} elegível(is) de ${estimate.candidates}`, actor: identity.userId });
    return { batch: b };
  });
}

/** CONFIRM: só um lote PLANNED. Produção como destino exige a frase de autorização explícita (o deployment ainda exigirá a sua própria autorização). */
export async function confirmBatch(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, input: { batchId: string; authorizeProduction?: string }): Promise<BatchRecord> {
  return withTenant(pool, identity, tenantId, async (db) => {
    const b = (await db.query<Row>(`SELECT ${COLS} FROM plataforma.generation_batch WHERE id = $1 FOR UPDATE`, [input.batchId])).rows[0]; if (!b) throw new BatchError("lote não encontrado");
    if (b.status !== "PLANNED") throw new BatchError(`o lote está ${b.status}; só um lote PLANNED pode ser confirmado`);
    if (b.config.target === "production" && input.authorizeProduction?.trim() !== "AUTORIZO PRODUÇÃO") throw new BatchError("destino de produção exige a autorização explícita (digite AUTORIZO PRODUÇÃO)");
    const up = toRec((await db.query<Row>(`UPDATE plataforma.generation_batch SET status = 'CONFIRMED', confirmed_by = $2, confirmed_at = now() WHERE id = $1 RETURNING ${COLS}`, [input.batchId, identity.userId])).rows[0]!);
    await recordDecision(db, { subjectKind: "batch", subjectRef: b.id, decision: "BATCH_CONFIRMED", decidedBy: "human", applied: true, reason: `lote confirmado: destino ${b.config.target}, concorrência ${b.config.concurrency}, ${b.estimate.eligible} elegível(is)`, actor: identity.userId });
    return up;
  });
}
export async function requestBatchCancel(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, batchId: string): Promise<boolean> {
  return withTenant(pool, identity, tenantId, async (db) => {
    const ok = (await db.query(`UPDATE plataforma.generation_batch SET cancel_requested = true WHERE id = $1 AND status IN ('CONFIRMED', 'RUNNING') RETURNING id`, [batchId])).rows.length > 0;
    if (ok) await recordDecision(db, { subjectKind: "batch", subjectRef: batchId, decision: "BATCH_CANCEL_REQUESTED", decidedBy: "human", applied: true, reason: "cancelamento pedido", actor: identity.userId });
    return ok;
  });
}

/** `cancel` é o cancelamento em processo (além do flag no banco); só impede NOVOS itens: o item em curso termina. */
export type BatchEnv = Omit<PipelineEnv, "cancel"> & { readonly cancel?: { cancelled: boolean } };
/** GENERATE + QA: executa (ou retoma; `reprocessAwaiting` reenvia as páginas que pararam em revisão humana, por exemplo depois de registrar a exceção de SERP) um lote CONFIRMED/RUNNING/CANCELLED/FAILED. Itens SUCCEEDED/BLOCKED/SKIPPED não são refeitos; FAILED volta até MAX_ATTEMPTS. */
export async function runBatch(env: BatchEnv, batchId: string, opts: { readonly reprocessAwaiting?: boolean } = {}): Promise<BatchRecord> {
  const { pool, identity, tenantId } = env;
  const b0 = await withTenant(pool, identity, tenantId, async (db) => {
    const b = (await db.query<Row>(`SELECT ${COLS} FROM plataforma.generation_batch WHERE id = $1 FOR UPDATE`, [batchId])).rows[0]; if (!b) throw new BatchError("lote não encontrado");
    if (b.status === "PLANNED") throw new BatchError("confirme o lote antes de executar");
    // um lote não mistura proveniências: planejado como simulação só roda/retoma com o ambiente de simulação, e o real só com o real
    if (b.mode !== env.mode) throw new BatchError(`o lote foi planejado em modo ${b.mode}; este ambiente é ${env.mode}. Retome com o mesmo modo (não se mistura simulação e execução real)`);
    if (b.status === "COMPLETED") {
      // concluído e sem nada a refazer: não faz nada (idempotente); com falha retentável ou revisão a reprocessar, o lote é retomado
      const redo = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.generation_batch_item WHERE batch_id = $1 AND ((status = 'FAILED' AND attempts < $2) OR ($3 AND status = 'SUCCEEDED' AND final_outcome = 'NEEDS_REVIEW'))`, [batchId, MAX_ATTEMPTS, opts.reprocessAwaiting === true])).rows[0]!.n);
      if (redo === 0) return toRec(b);
    }
    await db.query(`UPDATE plataforma.generation_batch SET status = 'RUNNING', cancel_requested = CASE WHEN $2 IN ('CANCELLED', 'FAILED') THEN false ELSE cancel_requested END, started_at = COALESCE(started_at, now()), finished_at = NULL WHERE id = $1`, [batchId, b.status]);
    await db.query(`UPDATE plataforma.generation_batch_item SET status = 'PENDING' WHERE batch_id = $1 AND (status IN ('CANCELLED', 'RUNNING') OR (status = 'FAILED' AND attempts < $2) OR ($3 AND status = 'SUCCEEDED' AND final_outcome = 'NEEDS_REVIEW'))`, [batchId, MAX_ATTEMPTS, opts.reprocessAwaiting === true]);
    return toRec({ ...b, status: "RUNNING" });
  });
  if (b0.status === "COMPLETED") return b0;
  const cfg = b0.config; const cancelled = { v: false };
  const next = async (): Promise<{ id: string; opportunity_id: string; attempts: number } | null> => withTenant(pool, identity, tenantId, async (db) => {
    const c = (await db.query<{ c: boolean }>(`SELECT cancel_requested AS c FROM plataforma.generation_batch WHERE id = $1`, [batchId])).rows[0]?.c; if (c || env.cancel?.cancelled) { cancelled.v = true; return null; }
    return (await db.query<{ id: string; opportunity_id: string; attempts: number }>(`UPDATE plataforma.generation_batch_item SET status = 'RUNNING', stage = 'pipeline', attempts = attempts + 1, started_at = now(), error = NULL WHERE id = (SELECT id FROM plataforma.generation_batch_item WHERE batch_id = $1 AND status = 'PENDING' ORDER BY seq LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id, opportunity_id, attempts`, [batchId])).rows[0] ?? null;
  });
  const work = async () => {
    for (;;) {
      const it = await next(); if (!it) return;
      try {
        const { cancel: _c, ...penv } = env; const r = await runPagePipeline({ ...penv, maxModelCalls: cfg.maxModelCallsPerPage }, { opportunityId: it.opportunity_id, correlationId: `batch-${batchId}-${it.opportunity_id}` });
        const failed = r.run.status === "FAILED";
        await withTenant(pool, identity, tenantId, (db) => db.query(`UPDATE plataforma.generation_batch_item SET status = $2, stage = $3, pipeline_run_id = $4, final_outcome = $5, error = $6, finished_at = now() WHERE id = $1`, [it.id, failed ? "FAILED" : r.outcome === "BLOCKED" ? "BLOCKED" : "SUCCEEDED", failed ? (r.steps.find((s) => s.status === "FAILED")?.stepKey ?? "pipeline") : "done", r.run.id, r.outcome, failed ? (r.run.summary ?? "falha").slice(0, 900) : r.outcome === "BLOCKED" ? (r.reasons[0] ?? "").slice(0, 900) : null]));
      } catch (e) {
        await withTenant(pool, identity, tenantId, (db) => db.query(`UPDATE plataforma.generation_batch_item SET status = 'FAILED', error = $2, finished_at = now() WHERE id = $1`, [it.id, `exceção: ${e instanceof Error ? e.message : String(e)}`.slice(0, 900)]));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(cfg.concurrency, 1), MAX_CONCURRENCY) }, work));
  return withTenant(pool, identity, tenantId, async (db) => {
    // falhas retentáveis: uma rodada extra controlada até MAX_ATTEMPTS acontece quando o operador retoma; aqui o lote só termina
    if (cancelled.v) await db.query(`UPDATE plataforma.generation_batch_item SET status = 'CANCELLED' WHERE batch_id = $1 AND status = 'PENDING'`, [batchId]);
    const left = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.generation_batch_item WHERE batch_id = $1 AND status IN ('PENDING', 'RUNNING')`, [batchId])).rows[0]!.n);
    const st = cancelled.v ? "CANCELLED" : left === 0 ? "COMPLETED" : "RUNNING";
    const up = toRec((await db.query<Row>(`UPDATE plataforma.generation_batch SET status = $2, finished_at = CASE WHEN $2 = 'RUNNING' THEN NULL ELSE now() END WHERE id = $1 RETURNING ${COLS}`, [batchId, st])).rows[0]!);
    await recordDecision(db, { subjectKind: "batch", subjectRef: batchId, decision: `BATCH_${st}`, decidedBy: "code", applied: true, reason: `execução do lote encerrou em ${st}`, actor: identity.userId });
    return up;
  });
}

export interface BatchCounters { readonly selected: number; readonly eligible: number; readonly notEligible: { readonly blocked: number; readonly dataPending: number; readonly alreadyDone: number }; readonly pending: number; readonly running: number; readonly approved: number; readonly awaitingHuman: number; readonly blocked: number; readonly failed: number; readonly cancelled: number }
export interface BatchView {
  readonly batch: BatchRecord; readonly counters: BatchCounters; readonly byStage: Readonly<Record<string, number>>; readonly elapsedMs: number | null; readonly ratePerMinute: number | null; readonly etaMs: number | null;
  readonly recent: readonly { readonly opportunityId: string; readonly status: string; readonly outcome: string | null; readonly stage: string | null; readonly attempts: number; readonly error: string | null; readonly at: Date | null }[];
  readonly errors: readonly { readonly opportunityId: string; readonly error: string; readonly attempts: number }[]; readonly blockReasons: readonly { readonly reason: string; readonly count: number }[]; readonly awaiting: readonly { readonly opportunityId: string; readonly reason: string }[];
}
/** Leitura de UM lote. Os contadores saem de UM agrupamento por (classificação, estado, desfecho): cada item cai em exatamente uma caixa, então os números são mutuamente consistentes. */
export async function getBatchView(db: TenantDb, batchId: string): Promise<BatchView | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId)) return null;
  const b = (await db.query<Row>(`SELECT ${COLS} FROM plataforma.generation_batch WHERE id = $1`, [batchId])).rows[0]; if (!b) return null;
  const g = (await db.query<{ classification: Classification; status: string; final_outcome: string | null; n: string }>(`SELECT classification, status, final_outcome, count(*) AS n FROM plataforma.generation_batch_item WHERE batch_id = $1 GROUP BY 1, 2, 3`, [batchId])).rows;
  const sum = (f: (r: (typeof g)[number]) => boolean) => g.filter(f).reduce((s, r) => s + Number(r.n), 0);
  const counters: BatchCounters = { selected: sum(() => true), eligible: sum((r) => r.classification === "ELIGIBLE"), notEligible: { blocked: sum((r) => r.classification === "BLOCKED"), dataPending: sum((r) => r.classification === "DATA_PENDING"), alreadyDone: sum((r) => r.classification === "ALREADY_DONE") },
    pending: sum((r) => r.classification === "ELIGIBLE" && r.status === "PENDING"), running: sum((r) => r.status === "RUNNING"), approved: sum((r) => r.classification === "ELIGIBLE" && r.status === "SUCCEEDED" && r.final_outcome === "APPROVED"), awaitingHuman: sum((r) => r.classification === "ELIGIBLE" && r.status === "SUCCEEDED" && r.final_outcome === "NEEDS_REVIEW"),
    blocked: sum((r) => r.classification === "ELIGIBLE" && r.status === "BLOCKED"), failed: sum((r) => r.status === "FAILED"), cancelled: sum((r) => r.status === "CANCELLED") };
  const byStage = Object.fromEntries((await db.query<{ stage: string | null; n: string }>(`SELECT stage, count(*) AS n FROM plataforma.generation_batch_item WHERE batch_id = $1 AND classification = 'ELIGIBLE' GROUP BY stage`, [batchId])).rows.map((r) => [r.stage ?? "aguardando", Number(r.n)]));
  const recent = (await db.query<{ opportunity_id: string; status: string; final_outcome: string | null; stage: string | null; attempts: number; error: string | null; at: Date | null }>(`SELECT opportunity_id, status, final_outcome, stage, attempts, error, coalesce(finished_at, started_at) AS at FROM plataforma.generation_batch_item WHERE batch_id = $1 AND started_at IS NOT NULL ORDER BY coalesce(finished_at, started_at) DESC LIMIT 15`, [batchId])).rows.map((r) => ({ opportunityId: r.opportunity_id, status: r.status, outcome: r.final_outcome, stage: r.stage, attempts: r.attempts, error: r.error, at: r.at }));
  const errors = (await db.query<{ opportunity_id: string; error: string; attempts: number }>(`SELECT opportunity_id, error, attempts FROM plataforma.generation_batch_item WHERE batch_id = $1 AND status = 'FAILED' AND error IS NOT NULL ORDER BY finished_at DESC NULLS LAST LIMIT 10`, [batchId])).rows.map((r) => ({ opportunityId: r.opportunity_id, error: r.error, attempts: r.attempts }));
  const blockReasons = (await db.query<{ reason: string; n: string }>(`SELECT left(coalesce(error, reason, status), 140) AS reason, count(*) AS n FROM plataforma.generation_batch_item WHERE batch_id = $1 AND (status = 'BLOCKED' OR classification IN ('BLOCKED', 'DATA_PENDING')) GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [batchId])).rows.map((r) => ({ reason: r.reason, count: Number(r.n) }));
  const awaiting = (await db.query<{ opportunity_id: string; reason: string | null }>(`SELECT i.opportunity_id, pr.summary AS reason FROM plataforma.generation_batch_item i LEFT JOIN plataforma.pipeline_run pr ON pr.id = i.pipeline_run_id AND pr.tenant_id = i.tenant_id WHERE i.batch_id = $1 AND i.final_outcome = 'NEEDS_REVIEW' ORDER BY i.finished_at DESC LIMIT 20`, [batchId])).rows.map((r) => ({ opportunityId: r.opportunity_id, reason: r.reason ?? "aguardando revisão" }));
  const rec = toRec(b); const now = Date.now();
  const elapsedMs = rec.startedAt ? (rec.finishedAt ? rec.finishedAt.getTime() : now) - rec.startedAt.getTime() : null;
  const finished = counters.approved + counters.awaitingHuman + counters.blocked + counters.failed;
  const rate = elapsedMs && elapsedMs >= 5_000 && finished >= 3 ? finished / (elapsedMs / 60_000) : null;
  const etaMs = rate && finished >= 5 && counters.pending + counters.running > 0 && rec.status === "RUNNING" ? ((counters.pending + counters.running) / rate) * 60_000 : null;
  return { batch: rec, counters, byStage, elapsedMs, ratePerMinute: rate, etaMs, recent, errors, blockReasons, awaiting };
}
export async function listBatches(db: TenantDb, limit = 30): Promise<(BatchRecord & { items: number })[]> {
  return (await db.query<Row & { items: string }>(`SELECT ${COLS}, (SELECT count(*) FROM plataforma.generation_batch_item i WHERE i.batch_id = b.id) AS items FROM plataforma.generation_batch b ORDER BY seq DESC LIMIT $1`, [Math.min(limit, 100)])).rows.map((r) => ({ ...toRec(r), items: Number(r.items) }));
}
