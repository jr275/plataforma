import { createHash, randomUUID } from "node:crypto";
import { explainDecision, type AgentBase, type AgentCtx, type DecisionInput } from "../agents";
import { CallGuard, type RuntimeContext } from "../agents/runner";
import type { VerifiedIdentity } from "../identity";
import type { EligibilityDeps, DecisionRow } from "../eligibility/store";
import { listDecisionHistory, runEvaluation } from "../eligibility/store";
import { createSpecBlueprint, listSpecBlueprints, refineWithAgent6, SpecBlueprintPreconditionError, type SpecBlueprintDeps } from "../blueprint-spec/store";
import { RecipeQaError, compileRecipeAndRunQa, type RecipeQaDeps } from "../qa/store";
import type { QaOutcome } from "../qa/types";
import type { RunBudget } from "../provider/budget";
import { withTenant, type PoolLike, type TenantDb } from "../tenant-context";
import { agentResolver, resolvePrompts } from "./prompts";
import { recordDecision } from "./decision-audit";

// Pipeline de página (explícito, retomável e idempotente). O LLM propõe; a aplicação valida; o motor determinístico decide; o Control Plane explica; a auditoria prova.
//   eligibility → explain (A05) → blueprint (+A06 se o código não fechou os campos semânticos) → serp_gate (SERP ou exceção humana, ADR-025) → recipe_qa (A07 + QA de código + A08) → quality_gate
// Cada passo tem dependências, chave de idempotência (derivada do artefato anterior) e estado persistido em `pipeline_step`; reexecutar a mesma correlação reaproveita o que já foi concluído com a mesma chave.
// O pipeline NUNCA publica: o desfecho máximo é APPROVED = “apto à revisão humana de publicação”; publicar é uma ação humana fora deste código.
export type StepStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED" | "BLOCKED" | "CANCELLED";
export type RunStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "BLOCKED" | "NEEDS_REVIEW";
export type FinalOutcome = "APPROVED" | "BLOCKED" | "NEEDS_REVIEW";
export type ExecMode = "real" | "test_simulation";

export interface PipelineRunRecord { readonly id: string; readonly pipeline: "page" | "topic"; readonly correlationId: string; readonly opportunityId: string | null; readonly mode: ExecMode; readonly status: RunStatus; readonly finalOutcome: FinalOutcome | null; readonly summary: string | null; readonly params: Record<string, unknown>; readonly cancelRequested: boolean; readonly createdBy: string; readonly createdAt: Date; readonly finishedAt: Date | null }
export interface PipelineStepRecord { readonly id: string; readonly stepKey: string; readonly kind: "agent" | "engine"; readonly agent: number | null; readonly status: StepStatus; readonly attempts: number; readonly idempotencyKey: string; readonly agentRunId: string | null; readonly result: Record<string, unknown> | null; readonly error: string | null; readonly startedAt: Date | null; readonly finishedAt: Date | null }

/** O mínimo que o motor de passos precisa (compartilhado pelo pipeline de página e o de tópicos). */
export type RunEnv = Pick<PipelineEnv, "pool" | "identity" | "tenantId" | "mode">;
export interface PipelineEnv {
  readonly pool: PoolLike; readonly identity: VerifiedIdentity; readonly tenantId: string; readonly tenantName: string;
  /** real = LLM real; test_simulation = LLM roteirizado/fixtures: gravado no run e exibido assim no Control Plane. */ readonly mode: ExecMode;
  readonly domainPack: { readonly id: string; readonly version: string };
  readonly agents: { readonly ctx: AgentCtx; readonly budget: RunBudget; readonly editorialStyle: string } | null;
  readonly eligibility: EligibilityDeps; readonly blueprint: SpecBlueprintDeps; readonly recipeQa: Omit<RecipeQaDeps, "agents">;
  readonly now?: () => Date; readonly sleep?: (ms: number) => Promise<void>;
  /** Teto de chamadas ao modelo por execução (proteção contra laço). */ readonly maxModelCalls?: number;
  /** Cancelamento em processo (além do flag no banco). */ readonly cancel?: { cancelled: boolean };
  /** Valores de exemplo para o Agente 6 (derivados dos fatos); sem eles vai vazio. */ readonly sampleValues?: (db: TenantDb, opportunityId: string) => Promise<Record<string, string>>;
}

interface RunRow { id: string; pipeline: "page" | "topic"; correlation_id: string; opportunity_id: string | null; mode: ExecMode; status: RunStatus; final_outcome: FinalOutcome | null; summary: string | null; params: Record<string, unknown>; cancel_requested: boolean; created_by: string; created_at: Date; finished_at: Date | null }
const RUN_COLS = "id, pipeline, correlation_id, opportunity_id, mode, status, final_outcome, summary, params, cancel_requested, created_by, created_at, finished_at";
const toRun = (r: RunRow): PipelineRunRecord => ({ id: r.id, pipeline: r.pipeline, correlationId: r.correlation_id, opportunityId: r.opportunity_id, mode: r.mode, status: r.status, finalOutcome: r.final_outcome, summary: r.summary, params: r.params, cancelRequested: r.cancel_requested, createdBy: r.created_by, createdAt: r.created_at, finishedAt: r.finished_at });
interface StepRow { id: string; step_key: string; kind: "agent" | "engine"; agent: number | null; status: StepStatus; attempts: number; idempotency_key: string; agent_run_id: string | null; result: Record<string, unknown> | null; error: string | null; started_at: Date | null; finished_at: Date | null }
const STEP_COLS = "id, step_key, kind, agent, status, attempts, idempotency_key, agent_run_id, result, error, started_at, finished_at";
const toStep = (r: StepRow): PipelineStepRecord => ({ id: r.id, stepKey: r.step_key, kind: r.kind, agent: r.agent, status: r.status, attempts: r.attempts, idempotencyKey: r.idempotency_key, agentRunId: r.agent_run_id, result: r.result, error: r.error, startedAt: r.started_at, finishedAt: r.finished_at });

export async function startPipelineRun(env: RunEnv, a: { pipeline: "page" | "topic"; correlationId: string; opportunityId: string | null; params?: Record<string, unknown> }): Promise<{ run: PipelineRunRecord; resumed: boolean }> {
  return withTenant(env.pool, env.identity, env.tenantId, async (db) => {
    const ex = (await db.query<RunRow>(`SELECT ${RUN_COLS} FROM plataforma.pipeline_run WHERE correlation_id = $1 FOR UPDATE`, [a.correlationId])).rows[0];
    if (ex) {
      if (ex.pipeline !== a.pipeline || ex.opportunity_id !== a.opportunityId) throw new Error("a correlação já pertence a outra execução");
      const re = (await db.query<RunRow>(`UPDATE plataforma.pipeline_run SET status = 'RUNNING', final_outcome = NULL, finished_at = NULL, cancel_requested = false WHERE id = $1 RETURNING ${RUN_COLS}`, [ex.id])).rows[0]!;
      return { run: toRun(re), resumed: true };
    }
    const ins = (await db.query<RunRow>(`INSERT INTO plataforma.pipeline_run (tenant_id, pipeline, correlation_id, opportunity_id, mode, status, params, created_by) VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4, 'RUNNING', $5::jsonb, $6) RETURNING ${RUN_COLS}`, [a.pipeline, a.correlationId, a.opportunityId, env.mode, JSON.stringify(a.params ?? {}), env.identity.userId])).rows[0]!;
    return { run: toRun(ins), resumed: false };
  });
}
export async function finishPipelineRun(env: RunEnv, runId: string, f: { status: RunStatus; finalOutcome: FinalOutcome | null; summary: string }): Promise<PipelineRunRecord> {
  return withTenant(env.pool, env.identity, env.tenantId, async (db) => toRun((await db.query<RunRow>(`UPDATE plataforma.pipeline_run SET status = $2, final_outcome = $3, summary = $4, finished_at = now() WHERE id = $1 RETURNING ${RUN_COLS}`, [runId, f.status, f.finalOutcome, f.summary.slice(0, 2000)])).rows[0]!));
}
/** Pede o cancelamento: o pipeline para antes do próximo passo e nenhuma chamada nova ao modelo é feita. */
export async function requestPipelineCancel(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, runId: string): Promise<boolean> {
  return withTenant(pool, identity, tenantId, async (db) => (await db.query(`UPDATE plataforma.pipeline_run SET cancel_requested = true WHERE id = $1 AND status IN ('PENDING', 'RUNNING') RETURNING id`, [runId])).rows.length > 0);
}
export async function getPipelineRun(db: TenantDb, runId: string): Promise<{ run: PipelineRunRecord; steps: PipelineStepRecord[] } | null> {
  const r = (await db.query<RunRow>(`SELECT ${RUN_COLS} FROM plataforma.pipeline_run WHERE id = $1`, [runId])).rows[0]; if (!r) return null;
  return { run: toRun(r), steps: (await db.query<StepRow>(`SELECT ${STEP_COLS} FROM plataforma.pipeline_step WHERE pipeline_run_id = $1 ORDER BY seq`, [runId])).rows.map(toStep) };
}
export async function listPipelineRuns(db: TenantDb, f: { opportunityId?: string; limit?: number } = {}): Promise<PipelineRunRecord[]> {
  return (await db.query<RunRow>(`SELECT ${RUN_COLS} FROM plataforma.pipeline_run WHERE ($1::uuid IS NULL OR opportunity_id = $1) ORDER BY seq DESC LIMIT $2`, [f.opportunityId ?? null, Math.min(f.limit ?? 50, 200)])).rows.map(toRun);
}

// --- Quality Gate Engine: decisão FINAL, por regra do código. Nenhum agente aprova a própria saída. -------------------------------------------------------------------------------
export interface QualityGateInput { readonly decision: string | null; readonly blueprintStatus: string | null; readonly serpPending: boolean; readonly qaOutcome: QaOutcome | null; readonly qaBlocking: readonly string[]; readonly qaNotRun: readonly string[] }
export function qualityGate(i: QualityGateInput): { outcome: FinalOutcome; reasons: string[] } {
  if (i.decision !== "READY_FOR_BLUEPRINT") return { outcome: "BLOCKED", reasons: [`a decisão de elegibilidade é ${i.decision ?? "inexistente"}, não READY_FOR_BLUEPRINT`] };
  if (i.blueprintStatus !== "COMPLETE") return { outcome: "BLOCKED", reasons: [`blueprint ${i.blueprintStatus ?? "inexistente"}: a diferenciação não está descrita (enriquecimento de dados necessário)`] };
  if (i.serpPending) return { outcome: "NEEDS_REVIEW", reasons: ["aguardando análise de SERP ou exceção humana registrada (ADR-025)"] };
  if (i.qaOutcome === null) return { outcome: "BLOCKED", reasons: ["o QA não rodou"] };
  if (i.qaOutcome === "QA_FAILED") return { outcome: "BLOCKED", reasons: [`QA reprovado em ${i.qaBlocking.join(", ") || "gates bloqueantes"}`] };
  if (i.qaOutcome === "QA_INCOMPLETE") return { outcome: "NEEDS_REVIEW", reasons: [`QA incompleto: ${i.qaNotRun.join(", ") || "verificações não executadas"} não rodaram (nada é aprovado por padrão)`] };
  return { outcome: "APPROVED", reasons: ["todos os gates de QA passaram; apto à revisão humana (nada foi publicado)"] };
}

// --- Passos ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export interface StepOutcome { readonly status: "SUCCEEDED" | "FAILED" | "SKIPPED" | "BLOCKED" | "CANCELLED"; readonly result?: Record<string, unknown>; readonly error?: string; readonly agentRunId?: string | null }
export interface StepDef { readonly key: string; readonly kind: "agent" | "engine"; readonly agent?: number; readonly dependsOn: readonly string[]; readonly idempotencyKey: () => string; readonly run: () => Promise<StepOutcome> }
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

export interface PagePipelineResult { readonly run: PipelineRunRecord; readonly steps: readonly PipelineStepRecord[]; readonly outcome: FinalOutcome | null; readonly reasons: readonly string[]; readonly resumed: boolean; readonly reused: readonly string[]; readonly modelCalls: number }

export async function runPagePipeline(env: PipelineEnv, input: { opportunityId: string; correlationId?: string }): Promise<PagePipelineResult> {
  const correlationId = input.correlationId ?? `page-${randomUUID()}`;
  const { run: started, resumed } = await startPipelineRun(env, { pipeline: "page", correlationId, opportunityId: input.opportunityId, params: { domainPack: env.domainPack } });
  const runId = started.id; const guard = new CallGuard(env.maxModelCalls ?? 40);
  const flags = { dbCancel: false };
  const isCancelled = () => env.cancel?.cancelled === true || flags.dbCancel;
  const resolved = await withTenant(env.pool, env.identity, env.tenantId, (db) => (env.agents ? resolvePrompts(db, env.domainPack.id, env.agents.ctx.prompts) : Promise.resolve(null)));
  const rt: RuntimeContext = { tenantId: env.tenantId, tenantName: env.tenantName, domainPackId: env.domainPack.id, domainPackVersion: env.domainPack.version, ...(resolved ? { resolve: agentResolver(resolved) } : {}), ...(env.sleep ? { sleep: env.sleep } : {}), isCancelled, guard, trace: { pipelineRunId: runId, correlationId } };
  const actx: AgentCtx | null = env.agents ? { ...env.agents.ctx, runtime: rt } : null;
  const now = env.now ?? (() => new Date());
  const reused: string[] = [];
  const mem: { decision: DecisionRow | null; blueprintId: string | null; blueprintStatus: string | null; qa: { outcome: QaOutcome; blocking: string[]; notRun: string[] } | null; serpPending: boolean; oppStatus: string | null } = { decision: null, blueprintId: null, blueprintStatus: null, qa: null, serpPending: false, oppStatus: null };

  const oppRow = await withTenant(env.pool, env.identity, env.tenantId, async (db) => (await db.query<{ id: string; topic_id: string | null; status: string }>(`SELECT id, topic_id, status FROM plataforma.growth_opportunity WHERE id = $1`, [input.opportunityId])).rows[0] ?? null);

  const steps: StepDef[] = [
    { key: "eligibility", kind: "engine", dependsOn: [], idempotencyKey: () => `eligibility:${input.opportunityId}`, run: async () => {
      if (!oppRow || !oppRow.topic_id) return { status: "FAILED", error: "oportunidade não encontrada ou não é um tópico do motor" };
      // a avaliação é exclusiva por tenant (uma execução do motor por vez): com páginas em paralelo (lote) espera a vez, com limite, em vez de falhar
      let ev: Awaited<ReturnType<typeof runEvaluation>> | undefined;
      for (let attempt = 0; ; attempt++) {
        try { ev = await runEvaluation(env.pool, env.identity, env.tenantId, env.eligibility, { topicIds: [oppRow.topic_id] }); break; }
        catch (e) { if (!(e instanceof Error && e.name === "ResearchBusyError") || attempt >= 60) throw e; await (env.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(150 + Math.floor(Math.random() * 150)); }
      }
      if (ev.status !== "succeeded") return { status: "FAILED", error: ev.error ?? "a avaliação de elegibilidade falhou" };
      const d = (await withTenant(env.pool, env.identity, env.tenantId, (db) => listDecisionHistory(db, input.opportunityId)))[0] ?? null;
      if (!d) return { status: "FAILED", error: "a avaliação não gerou decisão" };
      mem.decision = d;
      return { status: "SUCCEEDED", result: { decisionId: d.id, decision: d.decision, eligible: d.eligible, totalScore: d.totalScore, policyVersion: d.policyVersion, blockingReasons: d.blockingReasons, missingRequirements: d.missingRequirements } };
    } },
    { key: "explain", kind: "agent", agent: 5, dependsOn: ["eligibility"], idempotencyKey: () => `explain:${mem.decision?.id ?? "-"}`, run: async () => {
      if (!actx || !env.agents) return { status: "SKIPPED", result: { reason: "agentes não configurados para esta execução" } };
      const d = mem.decision!;
      const r = await withTenant(env.pool, env.identity, env.tenantId, (db) => explainDecision(actx, base(db, env, runId, correlationId, now), d.id, decisionInput(d)));
      return agentOutcome(r, (data) => ({ explanation: data.explanation, nextBestAction: data.next_best_action }));
    } },
    { key: "blueprint", kind: "engine", dependsOn: ["eligibility"], idempotencyKey: () => `blueprint:${mem.decision?.id ?? "-"}`, run: async () => {
      if (mem.decision?.decision !== "READY_FOR_BLUEPRINT") return { status: "BLOCKED", error: `decisão ${mem.decision?.decision}: o blueprint só nasce de READY_FOR_BLUEPRINT`, result: { decision: mem.decision?.decision ?? null } };
      try {
        // tópico que já avançou (blueprinted em diante) reaproveita o blueprint vigente; senão a criação é idempotente por conteúdo
        const cur = (await withTenant(env.pool, env.identity, env.tenantId, (db) => listSpecBlueprints(db, input.opportunityId)))[0];
        const advanced = ["blueprinted", "data_assembled", "evidence_validated", "experience_built", "qa"].includes((await statusOf(env, input.opportunityId)) ?? "");
        const rec = cur && advanced ? cur : (await createSpecBlueprint(env.pool, env.identity, env.tenantId, env.blueprint, { opportunityId: input.opportunityId })).record;
        mem.blueprintId = rec.id; mem.blueprintStatus = rec.status;
        return { status: "SUCCEEDED", result: { blueprintId: rec.id, version: rec.version, status: rec.status, templateId: rec.templateId, templateGap: rec.templateGap, semanticSource: rec.semanticSource } };
      } catch (e) { if (e instanceof SpecBlueprintPreconditionError) return { status: "BLOCKED", error: e.reasons.join("; ") }; throw e; }
    } },
    { key: "blueprint_semantics", kind: "agent", agent: 6, dependsOn: ["blueprint"], idempotencyKey: () => `blueprint_semantics:${mem.blueprintId ?? "-"}`, run: async () => {
      if (mem.blueprintStatus === "COMPLETE") return { status: "SKIPPED", result: { reason: "os campos semânticos foram fechados por código; o Agente 6 não é necessário" } };
      if (!actx || !env.agents) return { status: "BLOCKED", error: "provider_not_configured: o Agente 6 é necessário para os campos semânticos e não está configurado", result: { blockedExternally: true } };
      const sample = env.sampleValues ? await withTenant(env.pool, env.identity, env.tenantId, (db) => env.sampleValues!(db, input.opportunityId)) : {};
      const r = await refineWithAgent6(actx, env.pool, env.identity, env.tenantId, { opportunityId: input.opportunityId, sampleValues: sample, budget: env.agents.budget, now });
      if (r.state === "ok") { mem.blueprintId = r.record!.id; mem.blueprintStatus = r.record!.status; return { status: "SUCCEEDED", agentRunId: r.agentRunId ?? null, result: { blueprintId: r.record!.id, status: r.record!.status } }; }
      if (r.state === "insufficient") { mem.blueprintStatus = "SEMANTIC_INSUFFICIENT"; return { status: "BLOCKED", agentRunId: r.agentRunId ?? null, error: "o Agente 6 devolveu INSUFFICIENT: o tópico volta ao enriquecimento de dados", result: { insufficient: true } }; }
      if (r.state === "provider_not_configured") return { status: "BLOCKED", agentRunId: r.agentRunId ?? null, error: `provider_not_configured: ${(r.missing ?? []).join(", ")}`, result: { blockedExternally: true } };
      return { status: "FAILED", agentRunId: r.agentRunId ?? null, error: (r.errors ?? []).join("; ").slice(0, 500) };
    } },
    { key: "serp_gate", kind: "engine", dependsOn: ["blueprint_semantics"], idempotencyKey: () => `serp_gate:${mem.blueprintId ?? "-"}`, run: async () => {
      const st = await statusOf(env, input.opportunityId); mem.oppStatus = st;
      if (mem.blueprintStatus !== "COMPLETE") return { status: "BLOCKED", error: `blueprint ${mem.blueprintStatus}: sem diferenciação descrita`, result: { oppStatus: st } };
      if (st === "eligible" || st === "serp_analyzed") { mem.serpPending = true; return { status: "BLOCKED", error: "aguardando SERP analisada ou exceção humana registrada (ADR-025)", result: { oppStatus: st, awaiting: "serp_or_waiver" } }; }
      mem.serpPending = false; return { status: "SUCCEEDED", result: { oppStatus: st } };
    } },
    { key: "recipe_qa", kind: "engine", dependsOn: ["serp_gate"], idempotencyKey: () => `recipe_qa:${mem.blueprintId ?? "-"}`, run: async () => {
      try {
        const r = await compileRecipeAndRunQa(env.pool, env.identity, env.tenantId, { ...env.recipeQa, ...(actx && env.agents ? { agents: { ctx: actx, budget: env.agents.budget, editorialStyle: env.agents.editorialStyle } } : {}) }, { opportunityId: input.opportunityId });
        const res = r.report.results; const notRun = Object.entries(res).filter(([, c]) => c.status === "NOT_RUN").map(([k]) => k); const failed = Object.entries(res).filter(([, c]) => c.status === "FAIL").map(([k]) => k);
        mem.qa = { outcome: r.report.outcome, blocking: [...r.report.blockingFailures], notRun };
        const ag = await agentRunsOf(env, runId);
        return { status: "SUCCEEDED", result: { recipeId: r.recipe.id, recipeVersion: r.recipe.version, narrativeSource: r.recipe.narrativeSource, qaReportId: r.report.id, qaOutcome: r.report.outcome, failed, notRun, blocking: r.report.blockingFailures, narrative: r.narrative, verifier: r.verifier, agentRuns: ag } };
      } catch (e) { if (e instanceof RecipeQaError) return { status: "BLOCKED", error: e.reasons.join("; ") }; throw e; }
    } },
    { key: "quality_gate", kind: "engine", dependsOn: ["eligibility"], idempotencyKey: () => `quality_gate:${sha(JSON.stringify([mem.decision?.id, mem.blueprintStatus, mem.serpPending, mem.qa]))}`, run: async () => {
      const g = qualityGate({ decision: mem.decision?.decision ?? null, blueprintStatus: mem.blueprintStatus, serpPending: mem.serpPending, qaOutcome: mem.qa?.outcome ?? null, qaBlocking: mem.qa?.blocking ?? [], qaNotRun: mem.qa?.notRun ?? [] });
      await withTenant(env.pool, env.identity, env.tenantId, (db) => recordDecision(db, { pipelineRunId: runId, subjectKind: "page", subjectRef: input.opportunityId, decision: g.outcome, decidedBy: "code", applied: true, reason: g.reasons.join("; "), evidenceRefs: mem.decision?.evidenceRefs ?? [], actor: env.identity.userId }));
      return { status: "SUCCEEDED", result: { outcome: g.outcome, reasons: g.reasons } };
    } },
  ];

  const { done, cancelled } = await executeSteps(env, runId, steps, isCancelled, flags, reused, mem, input.opportunityId);
  const final = await finishRun(env, runId, cancelled, done, mem);
  const detail = await withTenant(env.pool, env.identity, env.tenantId, (db) => getPipelineRun(db, runId));
  return { run: final.run, steps: detail!.steps, outcome: final.outcome, reasons: final.reasons, resumed, reused, modelCalls: guard.calls };
}

export interface StepPersist { readonly status: StepStatus; readonly result?: Record<string, unknown>; readonly error?: string }
/** Executa os passos em ordem declarada, respeitando dependências, retomada por chave de idempotência e cancelamento. */
export async function executeSteps(env: RunEnv, runId: string, steps: readonly StepDef[], isCancelled: () => boolean, flags: { dbCancel: boolean }, reused: string[], mem: Mem, opportunityId: string): Promise<{ done: Map<string, StepPersist>; cancelled: boolean }> {
  const done = new Map<string, StepPersist>(); let cancelled = false;
  for (const def of steps) {
    flags.dbCancel = await withTenant(env.pool, env.identity, env.tenantId, async (db) => (await db.query<{ c: boolean }>(`SELECT cancel_requested AS c FROM plataforma.pipeline_run WHERE id = $1`, [runId])).rows[0]?.c ?? false);
    if (isCancelled() || cancelled) { cancelled = true; await persistStep(env, runId, def, { status: "CANCELLED", error: "execução cancelada" }, 0, true); done.set(def.key, { status: "CANCELLED" }); continue; }
    done.set(def.key, await executeStep(env, runId, def, done, reused, mem, opportunityId));
  }
  return { done, cancelled };
}
async function statusOf(env: RunEnv, opportunityId: string): Promise<string | null> {
  return withTenant(env.pool, env.identity, env.tenantId, async (db) => (await db.query<{ status: string }>(`SELECT status FROM plataforma.growth_opportunity WHERE id = $1`, [opportunityId])).rows[0]?.status ?? null);
}
async function agentRunsOf(env: RunEnv, runId: string): Promise<Record<string, { agentRunId: string; status: string }>> {
  return withTenant(env.pool, env.identity, env.tenantId, async (db) => {
    const rows = (await db.query<{ id: string; agent: number; status: string }>(`SELECT DISTINCT ON (agent) id, agent, status FROM plataforma.agent_run WHERE pipeline_run_id = $1 AND agent IN (7, 8) ORDER BY agent, seq DESC`, [runId])).rows;
    return Object.fromEntries(rows.map((r) => [`agent${r.agent}`, { agentRunId: r.id, status: r.status }]));
  });
}
const base = (db: TenantDb, env: PipelineEnv, runId: string, correlationId: string, now: () => Date): AgentBase => ({ db, budget: env.agents!.budget, runId: null, actor: env.identity.userId, now, trace: { pipelineRunId: runId, correlationId } });

/** Mapeia o resultado do runner para o passo: ok / não configurado (bloqueio EXTERNO) / cancelado / falha classificada. */
function agentOutcome<T>(r: { state: string; data?: T; agentRunId: string; errors?: readonly string[]; missing?: readonly string[]; failure?: { kind: string; retryable: boolean } }, pick: (d: T) => Record<string, unknown>): StepOutcome {
  if (r.state === "ok") return { status: "SUCCEEDED", agentRunId: r.agentRunId, result: pick(r.data as T) };
  if (r.state === "provider_not_configured") return { status: "BLOCKED", agentRunId: r.agentRunId, error: `provider_not_configured: ${(r.missing ?? []).join(", ")}`, result: { blockedExternally: true } };
  if (r.failure?.kind === "cancelled") return { status: "CANCELLED", agentRunId: r.agentRunId, error: (r.errors ?? []).join("; ").slice(0, 500) };
  return { status: "FAILED", agentRunId: r.agentRunId, error: `${r.failure?.kind ?? "failed"}: ${(r.errors ?? []).join("; ")}`.slice(0, 1000), result: { failure: r.failure ?? null } };
}

export type Mem = { decision: DecisionRow | null; blueprintId: string | null; blueprintStatus: string | null; qa: { outcome: QaOutcome; blocking: string[]; notRun: string[] } | null; serpPending: boolean; oppStatus: string | null };
async function executeStep(env: RunEnv, runId: string, def: StepDef, done: Map<string, StepPersist>, reused: string[], mem: Mem, opportunityId: string): Promise<StepPersist> {
  const key = def.idempotencyKey();
  const prior = await withTenant(env.pool, env.identity, env.tenantId, async (db) => (await db.query<StepRow>(`SELECT ${STEP_COLS} FROM plataforma.pipeline_step WHERE pipeline_run_id = $1 AND step_key = $2`, [runId, def.key])).rows[0] ?? null);
  const blocked = def.dependsOn.filter((d) => { const s = done.get(d)?.status; return s !== "SUCCEEDED" && s !== "SKIPPED"; });
  if (blocked.length > 0) { const out: StepPersist = { status: "BLOCKED", error: `dependência não concluída: ${blocked.join(", ")}` }; await persistStep(env, runId, def, out, 0, true, key); return out; }
  if (prior && (prior.status === "SUCCEEDED" || prior.status === "SKIPPED") && prior.idempotency_key === key && prior.kind === def.kind) {
    reused.push(def.key); const out: StepPersist = { status: prior.status, ...(prior.result ? { result: prior.result } : {}) };
    // o estado em memória que os passos seguintes usam é refeito a partir do que foi gravado (retomada)
    await rehydrate(env, def.key, prior.result, mem, opportunityId);
    return out;
  }
  await persistStep(env, runId, def, { status: "RUNNING" }, (prior?.attempts ?? 0) + 1, false, key);
  let out: StepOutcome;
  try { out = await def.run(); } catch (e) { out = { status: "FAILED", error: `exceção: ${e instanceof Error ? e.message : String(e)}`.slice(0, 1000) }; }
  const persisted: StepPersist = { status: out.status, ...(out.result ? { result: out.result } : {}), ...(out.error ? { error: out.error } : {}) };
  await persistStep(env, runId, def, persisted, (prior?.attempts ?? 0) + 1, true, key, out.agentRunId ?? null);
  return persisted;
}
async function rehydrate(env: RunEnv, key: string, result: Record<string, unknown> | null, mem: Mem, opportunityId: string): Promise<void> {
  if (!result) return;
  if (key === "eligibility" && result.decisionId) mem.decision = (await withTenant(env.pool, env.identity, env.tenantId, (db) => listDecisionHistory(db, opportunityId))).find((d) => d.id === result.decisionId) ?? null;
  if ((key === "blueprint" || key === "blueprint_semantics") && result.blueprintId) { mem.blueprintId = String(result.blueprintId); if (result.status) mem.blueprintStatus = String(result.status); }
  if (key === "serp_gate") mem.serpPending = false;
  if (key === "recipe_qa" && result.qaOutcome) mem.qa = { outcome: result.qaOutcome as QaOutcome, blocking: (result.blocking as string[]) ?? [], notRun: (result.notRun as string[]) ?? [] };
}
async function persistStep(env: RunEnv, runId: string, def: StepDef, o: StepPersist, attempts: number, finished: boolean, key?: string, agentRunId: string | null = null): Promise<void> {
  const idem = key ?? def.idempotencyKey();
  await withTenant(env.pool, env.identity, env.tenantId, async (db) => {
    await db.query(`INSERT INTO plataforma.pipeline_step (tenant_id, pipeline_run_id, step_key, kind, agent, status, attempts, idempotency_key, agent_run_id, result, error, started_at, finished_at)
      VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, now(), $11)
      ON CONFLICT (tenant_id, pipeline_run_id, step_key) DO UPDATE SET status = EXCLUDED.status, attempts = EXCLUDED.attempts, idempotency_key = EXCLUDED.idempotency_key, agent_run_id = EXCLUDED.agent_run_id, result = EXCLUDED.result, error = EXCLUDED.error, started_at = COALESCE(plataforma.pipeline_step.started_at, EXCLUDED.started_at), finished_at = EXCLUDED.finished_at`,
      [runId, def.key, def.kind, def.agent ?? null, o.status, attempts, idem, agentRunId, o.result ? JSON.stringify(o.result) : null, o.error ?? null, finished ? new Date() : null]);
  });
}

async function finishRun(env: RunEnv, runId: string, cancelled: boolean, done: Map<string, StepPersist>, _mem: Mem): Promise<{ run: PipelineRunRecord; outcome: FinalOutcome | null; reasons: string[] }> {
  if (cancelled) return { run: await finishPipelineRun(env, runId, { status: "CANCELLED", finalOutcome: null, summary: "execução cancelada; os passos concluídos foram preservados e podem ser retomados" }), outcome: null, reasons: ["cancelada"] };
  const critical = ["eligibility", "blueprint", "recipe_qa"] as const;
  const failedStep = [...done.entries()].find(([k, s]) => s.status === "FAILED" && (critical as readonly string[]).includes(k));
  if (failedStep) return { run: await finishPipelineRun(env, runId, { status: "FAILED", finalOutcome: null, summary: `falha no passo ${failedStep[0]}: ${failedStep[1].error ?? ""}` }), outcome: null, reasons: [`falha em ${failedStep[0]}`] };
  const q = done.get("quality_gate")?.result as { outcome: FinalOutcome; reasons: string[] } | undefined;
  if (!q) return { run: await finishPipelineRun(env, runId, { status: "FAILED", finalOutcome: null, summary: "o Quality Gate Engine não rodou" }), outcome: null, reasons: ["sem decisão final"] };
  const status: RunStatus = q.outcome === "APPROVED" ? "SUCCEEDED" : q.outcome === "BLOCKED" ? "BLOCKED" : "NEEDS_REVIEW";
  return { run: await finishPipelineRun(env, runId, { status, finalOutcome: q.outcome, summary: q.reasons.join("; ") }), outcome: q.outcome, reasons: q.reasons };
}

/** Entrada do Agente 5 a partir da decisão gravada (o agente só recebe o que o motor decidiu). */
export function decisionInput(d: DecisionRow): DecisionInput {
  const floors = Object.entries(d.scores ?? {}).filter(([, v]) => { const x = v as { score?: number | null; floor?: number | null }; return typeof x?.score === "number" && typeof x?.floor === "number" && x.score < x.floor; }).map(([k]) => k);
  return { topic_id: d.topicId, decision: d.decision, eligible: d.eligible, gate_results: d.gateResults, gate_details: Object.fromEntries(Object.entries(d.gateDetails).map(([k, v]) => [k, { result: v.result, detail: v.detail, missing: v.missing }])), blocking_reasons: d.blockingReasons, missing_requirements: d.missingRequirements, floor_failures: floors, total_score: d.totalScore, weight_coverage: d.weightCoverage, recommended_action: d.recommendedAction, policy_version: d.policyVersion };
}

