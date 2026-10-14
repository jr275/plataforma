import { createHash, randomUUID } from "node:crypto";
import { modelIntents, proposeTopics, reviewCombinations, summarizeInventory, type AgentBase, type AgentCtx, type CombinationGroupsInput, type DemandDatum, type InventoryInput, type IntentInput, type ProposerInput } from "../agents";
import { CallGuard, type RuntimeContext } from "../agents/runner";
import type { ProposalContext } from "../topics/generate";
import { withTenant, type TenantDb } from "../tenant-context";
import { agentDefinition } from "../agents/registry";
import { runBatched } from "./batching";
import { applyCombinationReviews } from "./decision-audit";
import { executeSteps, finishPipelineRun, getPipelineRun, startPipelineRun, type Mem, type PipelineEnv, type PipelineRunRecord, type PipelineStepRecord, type StepDef, type StepOutcome } from "./pipeline";
import { agentResolver, resolvePrompts } from "./prompts";

const h = (xs: readonly string[]) => (xs.length === 0 ? "all" : createHash("sha256").update(xs.join(",")).digest("hex").slice(0, 24));
// Pipeline de TÓPICOS (lote): Inventário (A01) → Propostas (A02, validadas pelo grafo) → Intenção (A03, em lotes de 20–50) → Revisão de combinações (A04, o código aplica e audita).
// Itens que quebram um lote são isolados por bisseção (os bons seguem). Cada passo é persistido e retomável; falta de dado de entrada vira passo SKIPPED explícito (nunca dado inventado).
export interface TopicStageEnv extends Pick<PipelineEnv, "pool" | "identity" | "tenantId" | "tenantName" | "mode" | "domainPack" | "now" | "sleep" | "maxModelCalls" | "cancel"> {
  readonly agents: { readonly ctx: AgentCtx; readonly budget: PipelineEnv["agents"] extends infer A ? (A extends { budget: infer B } ? B : never) : never };
  /** Entrada do Agente 1 (do catálogo de atributos); sem ela o passo é pulado. */ readonly inventory?: InventoryInput;
  /** Entradas do Agente 2 (uma por entidade) e o contexto de validação; sem elas o passo é pulado. */ readonly proposals?: { readonly inputs: readonly ProposerInput[]; readonly vctx: ProposalContext; readonly max?: number };
  /** Demanda OBSERVADA por tópico (de provedores reais); sem ela os tópicos ficam como HIPÓTESE. */ readonly demandData?: (db: TenantDb, topicIds: readonly string[]) => Promise<DemandDatum[]>;
  readonly topicIds?: readonly string[];
}
interface StageTopic { topic_id: string; dimensions: Record<string, string>; primary_query: string; user_need: string | null; parent_topic_id: string | null; required_attributes: string[]; status: string }
async function loadStageTopics(db: TenantDb, ids?: readonly string[]): Promise<StageTopic[]> {
  return (await db.query<StageTopic>(`SELECT topic_id, dimensions, primary_query, user_need, parent_topic_id, required_attributes, status FROM plataforma.growth_opportunity WHERE topic_id IS NOT NULL AND status NOT IN ('rejected', 'retired') AND ($1::text[] IS NULL OR topic_id = ANY($1::text[])) ORDER BY topic_id`, [ids ? [...ids] : null])).rows;
}
/** Grupos do Agente 4: pai com filhos; `exclusive_blocks` = atributos exigidos pelo filho que o pai não exige (calculado pelo código). */
export function combinationGroups(topics: readonly StageTopic[]): CombinationGroupsInput["groups"] {
  const by = new Map(topics.map((t) => [t.topic_id, t])); const groups = new Map<string, StageTopic[]>();
  for (const t of topics) if (t.parent_topic_id && by.has(t.parent_topic_id)) groups.set(t.parent_topic_id, [...(groups.get(t.parent_topic_id) ?? []), t]);
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([pid, kids]) => { const p = by.get(pid)!; return { parent: { topic_id: pid, dimensions: p.dimensions }, children: kids.map((k) => ({ topic_id: k.topic_id, dimensions: k.dimensions, count: k.required_attributes.length, exclusive_blocks: k.required_attributes.filter((a) => !p.required_attributes.includes(a)).length })) }; });
}

export interface TopicStageResult { readonly run: PipelineRunRecord; readonly steps: readonly PipelineStepRecord[]; readonly reused: readonly string[]; readonly modelCalls: number }
export async function runTopicStage(env: TopicStageEnv, input: { correlationId?: string } = {}): Promise<TopicStageResult> {
  const correlationId = input.correlationId ?? `topics-${randomUUID()}`;
  const { run } = await startPipelineRun(env, { pipeline: "topic", correlationId, opportunityId: null, params: { domainPack: env.domainPack } });
  const guard = new CallGuard(env.maxModelCalls ?? 200); const flags = { dbCancel: false };
  const isCancelled = () => env.cancel?.cancelled === true || flags.dbCancel;
  const resolved = await withTenant(env.pool, env.identity, env.tenantId, (db) => resolvePrompts(db, env.domainPack.id, env.agents.ctx.prompts));
  const rt: RuntimeContext = { tenantId: env.tenantId, tenantName: env.tenantName, domainPackId: env.domainPack.id, domainPackVersion: env.domainPack.version, resolve: agentResolver(resolved), ...(env.sleep ? { sleep: env.sleep } : {}), isCancelled, guard, trace: { pipelineRunId: run.id, correlationId } };
  const actx: AgentCtx = { ...env.agents.ctx, runtime: rt }; const now = env.now ?? (() => new Date());
  const baseOf = (db: TenantDb): AgentBase => ({ db, budget: env.agents.budget, runId: null, actor: env.identity.userId, now, trace: { pipelineRunId: run.id, correlationId } });
  const tdef = (n: number) => agentDefinition(n);
  const failKind = (r: { errors?: readonly string[]; failure?: { kind: string }; missing?: readonly string[]; state: string }) => (r.state === "provider_not_configured" ? `provider_not_configured: ${(r.missing ?? []).join(", ")}` : `${r.failure?.kind ?? "failed"}: ${(r.errors ?? []).join("; ")}`.slice(0, 400));
  const batchOutcome = (o: { calls: number; succeeded: readonly unknown[]; failed: readonly { item: unknown; error: string }[]; cancelled: readonly unknown[] }, extra: Record<string, unknown>): StepOutcome => ({
    status: o.cancelled.length > 0 ? "CANCELLED" : o.failed.length > 0 && o.succeeded.length === 0 ? "FAILED" : "SUCCEEDED",
    ...(o.failed.length > 0 && o.succeeded.length === 0 ? { error: `todos os itens falharam: ${o.failed[0]!.error}`.slice(0, 500) } : {}),
    result: { modelCalls: o.calls, succeededBatches: o.succeeded.length, failedItems: o.failed.length, failures: o.failed.slice(0, 20).map((f) => ({ item: f.item, error: f.error })), cancelledItems: o.cancelled.length, ...extra } });

  const steps: StepDef[] = [
    { key: "inventory", kind: "agent", agent: 1, dependsOn: [], idempotencyKey: () => `inventory:${env.inventory ? env.inventory.scope + ":" + env.inventory.attributes.length : "-"}`, run: async () => {
      if (!env.inventory) return { status: "SKIPPED", result: { reason: "sem catálogo de atributos de entrada" } };
      const r = await withTenant(env.pool, env.identity, env.tenantId, (db) => summarizeInventory(actx, baseOf(db), env.inventory!));
      if (r.state === "ok") return { status: "SUCCEEDED", agentRunId: r.agentRunId, result: { gaps: r.data.top_gaps.length, entities: r.data.entities.length } };
      return { status: r.state === "provider_not_configured" ? "BLOCKED" : r.failure.kind === "cancelled" ? "CANCELLED" : "FAILED", agentRunId: r.agentRunId, error: failKind(r), ...(r.state === "provider_not_configured" ? { result: { blockedExternally: true } } : {}) };
    } },
    { key: "proposals", kind: "agent", agent: 2, dependsOn: ["inventory"], idempotencyKey: () => `proposals:${env.proposals ? h(env.proposals.inputs.map((i) => i.entity.entity_id)) : "-"}`, run: async () => {
      if (!env.proposals) return { status: "SKIPPED", result: { reason: "sem entradas de entidade para propor tópicos" } };
      const accepted: { topicId: string }[] = []; const discarded: { reasons: string[] }[] = [];
      const o = await runBatched(env.proposals.inputs, { size: 1, isCancelled, call: async ([inp]) => {
        const r = await withTenant(env.pool, env.identity, env.tenantId, (db) => proposeTopics(actx, baseOf(db), inp!, env.proposals!.vctx, env.proposals!.max ?? 5));
        if (r.state !== "ok") return { ok: false, error: failKind(r) };
        accepted.push(...(r.accepted ?? []).map((a) => ({ topicId: a.topicId }))); discarded.push(...(r.discarded ?? []).map((d) => ({ reasons: d.reasons })));
        return { ok: true, value: (r.accepted ?? []).length };
      } });
      return batchOutcome(o, { acceptedProposals: accepted.length, discardedProposals: discarded.length, emptyIsLegitimate: accepted.length === 0 });
    } },
    { key: "intents", kind: "agent", agent: 3, dependsOn: ["proposals"], idempotencyKey: () => `intents:${h(env.topicIds ?? [])}`, run: async () => {
      const topics = await withTenant(env.pool, env.identity, env.tenantId, (db) => loadStageTopics(db, env.topicIds));
      if (topics.length === 0) return { status: "SKIPPED", result: { reason: "nenhum tópico para modelar" } };
      let hypothesis = 0; let observed = 0; let unmet = 0; let discrepancies = 0;
      const o = await runBatched(topics, { size: tdef(3).batch.max, isCancelled, call: async (batch) => {
        const r = await withTenant(env.pool, env.identity, env.tenantId, async (db) => {
          const demand = env.demandData ? await env.demandData(db, batch.map((t) => t.topic_id)) : [];
          const inp: IntentInput = { topics: batch.map((t) => ({ topic_id: t.topic_id, dimensions: t.dimensions, query_hypothesis: t.primary_query, user_need: t.user_need ?? "" })), demand_data: demand, existing_pages: [] };
          return modelIntents(actx, baseOf(db), inp);
        });
        if (r.state !== "ok") return { ok: false, error: failKind(r) };
        for (const i of r.intents ?? []) { if (i.demandStatus === "OBSERVED") observed += 1; else hypothesis += 1; if (i.unmetNeed) unmet += 1; discrepancies += i.discrepancies.length; }
        return { ok: true, value: (r.intents ?? []).length };
      } });
      return batchOutcome(o, { topics: topics.length, observed, hypothesis, unmetNeed: unmet, codeCorrectedDiscrepancies: discrepancies });
    } },
    { key: "combination_review", kind: "agent", agent: 4, dependsOn: ["intents"], idempotencyKey: () => `combination_review:${h(env.topicIds ?? [])}`, run: async () => {
      const topics = await withTenant(env.pool, env.identity, env.tenantId, (db) => loadStageTopics(db, env.topicIds));
      const groups = combinationGroups(topics);
      if (groups.length === 0) return { status: "SKIPPED", result: { reason: "nenhum grupo pai/filho para revisar" } };
      const verdicts = { kept: 0, absorbed: 0, recommendationsRefused: 0 };
      const o = await runBatched(groups, { size: Math.max(1, Math.floor(tdef(4).batch.max / 5)), isCancelled, call: async (batch) => {
        const inp: CombinationGroupsInput = { groups: batch };
        const r = await withTenant(env.pool, env.identity, env.tenantId, async (db) => {
          const res = await reviewCombinations(actx, baseOf(db), inp);
          if (res.state !== "ok") return res;
          const v = await applyCombinationReviews(db, res.data, inp, { pipelineRunId: run.id, agentRunId: res.agentRunId, actor: env.identity.userId });
          for (const x of v) { if (x.decision === "ABSORB") verdicts.absorbed += 1; else verdicts.kept += 1; if (!x.applied) verdicts.recommendationsRefused += 1; }
          return res;
        });
        return r.state === "ok" ? { ok: true, value: r.data.reviews.length } : { ok: false, error: failKind(r) };
      } });
      return batchOutcome(o, { groups: groups.length, ...verdicts });
    } },
  ];
  const mem: Mem = { decision: null, blueprintId: null, blueprintStatus: null, qa: null, serpPending: false, oppStatus: null }; const reused: string[] = [];
  const { done, cancelled } = await executeSteps(env, run.id, steps, isCancelled, flags, reused, mem, "");
  const failed = [...done.entries()].find(([, s]) => s.status === "FAILED");
  const blocked = [...done.entries()].find(([, s]) => s.status === "BLOCKED");
  const final = await finishPipelineRun(env, run.id, cancelled ? { status: "CANCELLED", finalOutcome: null, summary: "execução cancelada; passos concluídos preservados" } : failed ? { status: "FAILED", finalOutcome: null, summary: `falha no passo ${failed[0]}: ${failed[1].error ?? ""}` } : blocked ? { status: "BLOCKED", finalOutcome: "BLOCKED", summary: `bloqueado em ${blocked[0]}: ${blocked[1].error ?? ""}` } : { status: "SUCCEEDED", finalOutcome: null, summary: "tópicos processados (nada foi publicado)" });
  const detail = await withTenant(env.pool, env.identity, env.tenantId, (db) => getPipelineRun(db, run.id));
  return { run: final, steps: detail!.steps, reused, modelCalls: guard.calls };
}
