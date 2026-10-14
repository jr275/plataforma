import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEMPLATE_REGISTRY, TenantDb, devIdentity, runCityImport, withTenant } from "../index";
import { applySerpWaiver } from "../engine";
import { productPoolConfig } from "../testing/pool-config";
import { realEstateCatalog, realEstateFactConfidence } from "../../../../packs/real-estate/src/attributes";
import { realEstateTopicPatterns } from "../../../../packs/real-estate/src/topic-patterns";
import { realEstateVertical } from "../../../../packs/real-estate/src/vertical";
import { DEFAULT_ELIGIBILITY_POLICY } from "../../../../packs/real-estate/src/eligibility";
import { RECIPES } from "../../../../packs/real-estate/src/blueprint-recipes";
import { DEFAULT_QA_POLICY, RENDERERS } from "../../../../packs/real-estate/src/recipe-renderers";
import { AGENT_HEADER, AGENT_PROMPTS, AGENT_PROMPTS_SOURCE, AGENT_PROMPT_VERSION } from "../../../../packs/real-estate/src/agent-prompts.generated";
import { materializeCities, recordSidraFacts } from "../catalog";
import { runTopicGeneration } from "../topics";
import { listDecisionHistory, runEvaluation } from "../eligibility";
import { PUBLIC_UA, RateGate, RunBudget } from "../provider";
import { explainerSpec, runAgent, type AgentBase, type AgentCtx, type RuntimeContext } from "../agents";
import { CallGuard } from "../agents/runner";
import type { FetchLike, FetchResponse } from "../engine/http";
import type { RecipeQaDeps } from "../qa";
import { getAgentRun, getEngineView, listAgentRuns, topicDiscoverySummary, listAgentRegistry, syncAgentDefinitions, activatePrompt, deprecatePrompt, listPromptVersions, recordRegression, registerPrompt, rollbackPrompt, seedFilePrompts, resolvePrompts, PromptRegistryError, agentResolver, listDecisionAudit, runPagePipeline, runTopicStage, requestPipelineCancel, getPipelineRun, listPipelineRuns, decisionInput, type PipelineEnv, type TopicStageEnv } from "./index";

// Runtime dos agentes contra o esquema REAL (migrations 1 a 19), dados REAIS de SP (SIDRA gravado). TODO LLM aqui é ROTEIRIZADO e identificado como `test_simulation`: prova o runtime
// (execução, retentativa, cancelamento, retomada, lote, auditoria, isolamento), NÃO a qualidade de um modelo real. Demanda é SINAL DE TESTE. Tenants M (fe5) e N (fe6).
const M = "fe555555-5555-4555-8555-555555555555";
const N = "fe666666-6666-4666-8666-666666666666";
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv", import.meta.url));
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };
const T0 = new Date("2026-10-14T12:00:00Z");
const PROMPTS = { version: AGENT_PROMPT_VERSION, sourceSha256: AGENT_PROMPTS_SOURCE.sha256, header: AGENT_HEADER, agents: Object.fromEntries(Object.entries(AGENT_PROMPTS).map(([k, v]) => [k, { name: v.name, body: v.body }])) };
const VARS = { TENANT_NAME: "Tenant M", DOMAIN_PACK: "real-estate", SCORE_BRAND: "Índice", EDITORIAL_STYLE: "direto", RICH_MIN: "0.8", MAX_PROPOSALS: "5", SCOPE: "SP" };
const TEST_QA = { ...DEFAULT_QA_POLICY, maxSiblingSimilarity: 1, minVariableShare: 0, minSiblingsForComparison: 0 }; // política de QA de TESTE: só para exercitar o caminho aprovado
const recipeBase: Omit<RecipeQaDeps, "agents"> = { vertical: realEstateVertical, recipes: RECIPES, renderers: RENDERERS, qaPolicy: DEFAULT_QA_POLICY, attributes: realEstateCatalog.attributes, now: () => T0 };
const bpDeps = { vertical: realEstateVertical, recipes: RECIPES, templates: TEMPLATE_REGISTRY, attributes: realEstateCatalog.attributes, now: () => T0 };
const eligDeps = { verticalId: realEstateVertical.id, attributes: realEstateCatalog.attributes, defaultPolicy: DEFAULT_ELIGIBILITY_POLICY, now: () => T0 };

type Reply = string | { status: number; body: string } | "hang";
type Handler = (input: any, n: number) => Reply;
const inputOf = (content: string): any => { const s = content.indexOf("{"); let depth = 0; let inStr = false; for (let i = s; i < content.length; i++) { const c = content[i]!; if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; } if (c === '"') inStr = true; else if (c === "{") depth++; else if (c === "}" && --depth === 0) return JSON.parse(content.slice(s, i + 1)); } throw new Error("INPUT não encontrado"); };
/** LLM roteirizado POR AGENTE (lê o slug do bloco de contexto): só testes. Cada chamada fica em `calls`. */
function routedLlm(handlers: Partial<Record<number, Handler>>, calls: { agent: number; execution: string; correlation: string }[] = []): FetchLike {
  const n: Record<number, number> = {};
  return async (_url, init) => {
    const b = JSON.parse(init?.body ?? "{}") as { system: string; messages: { content: string }[] };
    const agent = Number(/agent: agent-0(\d)-/.exec(b.system)![1]); n[agent] = (n[agent] ?? 0) + 1;
    calls.push({ agent, execution: /execution_id: (\S+)/.exec(b.system)![1]!, correlation: /correlation_id: (\S+)/.exec(b.system)![1]! });
    const h = handlers[agent]; if (!h) throw new Error(`sem roteiro para o agente ${agent}`);
    const r = h(inputOf(b.messages[0]!.content), n[agent]!);
    if (r === "hang") return new Promise<FetchResponse>((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
    const status = typeof r === "string" ? 200 : r.status;
    const body = typeof r === "string" ? JSON.stringify({ id: `m${n[agent]}`, type: "message", role: "assistant", model: "claude-teste", content: [{ type: "text", text: r }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 20 } }) : r.body;
    const h2 = new Map([["content-type", "application/json"]]);
    return { ok: status >= 200 && status < 300, status, headers: { get: (k: string) => h2.get(k.toLowerCase()) ?? null }, body: null, text: async () => body };
  };
}
const A5: Handler = (i) => JSON.stringify({ topic_id: i.topic_id, explanation: `A decisão do motor foi ${i.decision}, conforme os gates e a pontuação gravados.`, next_best_action: "Revisar os requisitos listados pelo motor." });
const A7: Handler = (i) => JSON.stringify({ page_id: i.page_id, slots: i.narrative_slots.map((s: any) => (s.slot_id === "demografia:pop" ? { slot_id: s.slot_id, status: "OK", text: `São Paulo tem ${Number(s.facts[0].value).toLocaleString("pt-BR")} habitantes [${s.facts[0].fact_id}].`, evidence_refs: [s.facts[0].fact_id] } : { slot_id: s.slot_id, status: "INSUFFICIENT", text: "", evidence_refs: [] })) });
const A8 = (q2: "PASS" | "FAIL" = "PASS"): Handler => (i) => JSON.stringify({ page_id: i.page_id, checks: { Q1: { result: "PASS", issues: [] }, Q2: { result: q2, issues: q2 === "FAIL" ? [{ excerpt: "x", expected: "y", found: "z" }] : [] }, Q8: { result: "PASS", issues: [] }, Q13: { result: "PASS", issues: [] }, Q14: { result: "PASS", issues: [], exclusive_value: ["população estimada e do Censo lado a lado"] } }, summary: "ok" });

let pool: pg.Pool;
const id = () => devIdentity([M, N]);
const as = <X>(t: string, fn: (db: TenantDb) => Promise<X>) => withTenant(pool, id(), t, fn);
const count = (t: string, table: string, where = "true") => as(t, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.${table} WHERE ${where}`)).rows[0]!.n));
const oppOf = (key: string, tenant = M) => as(tenant, async (db) => (await db.query<{ id: string; status: string; topic_id: string }>(`SELECT o.id, o.status, o.topic_id FROM plataforma.growth_opportunity o JOIN plataforma.entity e ON e.id = o.primary_entity_id WHERE e.source_key = $1 AND o.pattern_key = 'topic-city-overview'`, [key])).rows[0]!);
const baseCtx = (fetch: FetchLike): AgentCtx => ({ fetch, userAgent: PUBLIC_UA, gate: new RateGate({}), env: { ANTHROPIC_API_KEY: "sk-ant-ficticia" }, prompts: PROMPTS, vars: VARS });
const penv = (llm: FetchLike | null, over: Partial<PipelineEnv> = {}): PipelineEnv => ({ pool, identity: id(), tenantId: M, tenantName: "Tenant M", mode: "test_simulation", domainPack: { id: "real-estate", version: "0.1.0" }, agents: llm ? { ctx: baseCtx(llm), budget: RunBudget.create(), editorialStyle: "direto" } : null, eligibility: eligDeps, blueprint: bpDeps, recipeQa: recipeBase, now: () => T0, sleep: async () => undefined, ...over });
type StepView = { stepKey: string; status: string; error?: string | null; result?: Record<string, unknown> | null; agentRunId?: string | null; agent?: number | null };
const stepOf = (r: { steps: readonly StepView[] }, k: string): StepView => r.steps.find((s) => s.stepKey === k)!;
let sp: { id: string; status: string; topic_id: string };
let cb: { id: string; status: string; topic_id: string };

beforeAll(async () => {
  pool = new pg.Pool(productPoolConfig(4)); pool.on("error", () => undefined);
  await runCityImport(pool, id(), M, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: MAPPING });
  await as(M, (db) => materializeCities(db, realEstateFactConfidence, T0));
  const prov = { provider: "ibge-sidra", endpoint: "values/t/4714/n6/x/v/93,614/p/last", params: {}, collectedAt: T0, costUsd: 0, cacheKey: "a".repeat(64), cached: false, callId: null };
  await as(M, (db) => recordSidraFacts(db, [{ facts: { ibgeCode: "3550308", name: "São Paulo (SP)", year: 2022, population: 11451999, densityPerKm2: 7528.26 }, provenance: prov }, { facts: { ibgeCode: "3509502", name: "Campinas (SP)", year: 2022, population: 1139047, densityPerKm2: 1433.5 }, provenance: prov }], realEstateFactConfidence, T0));
  await runTopicGeneration(pool, id(), M, { vertical: realEstateVertical, catalog: realEstateCatalog, patterns: realEstateTopicPatterns, now: () => T0 });
  for (const k of ["ibge:3550308", "ibge:3509502"]) await as(M, (db) => db.query(`UPDATE plataforma.growth_opportunity o SET demand_signal = '{"value": 10000, "source": "sinal de teste"}'::jsonb FROM plataforma.entity e WHERE e.id = o.primary_entity_id AND e.source_key = $1 AND o.pattern_key = 'topic-city-overview'`, [k]));
  sp = await oppOf("ibge:3550308"); cb = await oppOf("ibge:3509502");
});
afterAll(async () => { await pool.end(); });

describe("registro de agentes e definições versionadas", () => {
  it("espelha as 8 definições (idempotente) e a visão do registro mostra execuções REAIS (zero antes de qualquer uma)", async () => {
    expect(await as(M, (db) => syncAgentDefinitions(db, "t"))).toEqual({ inserted: 8, unchanged: 0 });
    expect(await as(M, (db) => syncAgentDefinitions(db, "t"))).toEqual({ inserted: 0, unchanged: 8 });
    expect(await count(M, "agent_definition")).toBe(8);
    const reg = await as(M, (db) => listAgentRegistry(db, "real-estate"));
    expect(reg.map((r) => r.definition.agent)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(reg.every((r) => r.runs === 0 && r.version === 1 && r.activePrompt === null)).toBe(true);
    expect(await count(N, "agent_definition")).toBe(0); // isolamento por tenant
  });
  it("mudar um parâmetro operacional cria nova versão da definição (nada é sobrescrito)", async () => {
    expect(await as(M, (db) => syncAgentDefinitions(db, "t", "claude-outro-modelo"))).toEqual({ inserted: 8, unchanged: 0 });
    expect(await as(M, async (db) => Number((await db.query<{ v: number }>(`SELECT max(version) AS v FROM plataforma.agent_definition WHERE agent = 1`)).rows[0]!.v))).toBe(2);
    await as(M, (db) => syncAgentDefinitions(db, "t")); // volta ao modelo padrão: hash já existe (v1), nada novo
    expect(await count(M, "agent_definition")).toBe(16);
  });
});

describe("registro de prompts: versões, ativação, rollback, regressão", () => {
  it("semeia do arquivo do pack (8 ativas, idempotente) e resolve por agente com a versão do registro", async () => {
    expect(await as(M, (db) => seedFilePrompts(db, "real-estate", PROMPTS, "t"))).toEqual({ seeded: 8, kept: 0 });
    expect(await as(M, (db) => seedFilePrompts(db, "real-estate", PROMPTS, "t"))).toEqual({ seeded: 0, kept: 8 });
    const r = await as(M, (db) => resolvePrompts(db, "real-estate", PROMPTS));
    expect([...r.byAgent.values()].every((p) => p.source === "registry" && p.promptVersionId !== null && p.promptVersion.startsWith("file-"))).toBe(true);
    expect(await as(N, async (db) => [...(await resolvePrompts(db, "real-estate", PROMPTS)).byAgent.values()].map((p) => p.source))).toEqual(Array(8).fill("file")); // outro tenant cai no arquivo
  });
  it("versão com placeholder desconhecido é recusada; o mesmo corpo não duplica (sem sobrescrita silenciosa)", async () => {
    await expect(as(M, (db) => registerPrompt(db, { agent: 5, domainPackId: "real-estate", body: "x {{ELIGIBILITY_DECISION_JSON}} {{SEGREDO}}", header: "h", source: "control_plane", changeLog: "c", actor: "t" }))).rejects.toThrow(/placeholder desconhecido: \{\{SEGREDO\}\}/);
    const body = `${AGENT_PROMPTS[5]!.body}\n(ajuste de teste)`;
    const a = await as(M, (db) => registerPrompt(db, { agent: 5, domainPackId: "real-estate", body, header: "h", source: "control_plane", changeLog: "ajuste de tom", actor: "t" }));
    const b = await as(M, (db) => registerPrompt(db, { agent: 5, domainPackId: "real-estate", body, header: "h", source: "control_plane", changeLog: "outra tentativa", actor: "t" }));
    expect(a.created).toBe(true); expect(b.created).toBe(false); expect(b.record.id).toBe(a.record.id); expect(a.record.status).toBe("DRAFT");
    expect(await count(M, "prompt_version", "agent = 5")).toBe(2);
  });
  it("versão do Control Plane só ativa com regressão aprovada; ativar deprecia a anterior; rollback volta; a ATIVA não é deprecada direto", async () => {
    const draft = (await as(M, (db) => listPromptVersions(db, { agent: 5 }))).find((v) => v.status === "DRAFT")!;
    await expect(as(M, (db) => activatePrompt(db, draft.id, "t"))).rejects.toThrow(/regressão aprovada/);
    await as(M, (db) => recordRegression(db, draft.id, { passed: false, cases: 3, failures: ["caso 2"], mode: "test_simulation", ranAt: T0.toISOString() }));
    await expect(as(M, (db) => activatePrompt(db, draft.id, "t"))).rejects.toThrow(/regressão aprovada/);
    await as(M, (db) => recordRegression(db, draft.id, { passed: true, cases: 3, failures: [], mode: "test_simulation", ranAt: T0.toISOString() }));
    const act = await as(M, (db) => activatePrompt(db, draft.id, "t"));
    expect(act.status).toBe("ACTIVE");
    const all = await as(M, (db) => listPromptVersions(db, { agent: 5 }));
    expect(all.filter((v) => v.status === "ACTIVE").map((v) => v.id)).toEqual([draft.id]); expect(all.filter((v) => v.status === "DEPRECATED")).toHaveLength(1);
    await expect(as(M, (db) => deprecatePrompt(db, draft.id, "t"))).rejects.toBeInstanceOf(PromptRegistryError);
    const back = await as(M, (db) => rollbackPrompt(db, 5, "real-estate", "t"));
    expect(back.source).toBe("file"); expect(back.status).toBe("ACTIVE");
    expect((await as(M, (db) => listPromptVersions(db, { agent: 5 }))).find((v) => v.id === draft.id)!.status).toBe("DEPRECATED");
    await expect(as(M, (db) => rollbackPrompt(db, 3, "real-estate", "t"))).rejects.toThrow(/não há versão anterior/);
    expect(await as(M, (db) => listDecisionAudit(db, { subjectKind: "prompt" }))).not.toHaveLength(0); // ativação/rollback ficam auditados
  });
  it("outro tenant não vê nem altera os prompts", async () => {
    expect(await count(N, "prompt_version")).toBe(0);
    await expect(as(N, (db) => activatePrompt(db, "00000000-0000-4000-8000-000000000000", "t"))).rejects.toThrow(PromptRegistryError);
  });
});

describe("execução dos agentes: tempo, retentativa, falha permanente, saída inválida, cancelamento, laço", () => {
  let dec: ReturnType<typeof decisionInput>;
  beforeAll(async () => { await as(M, async () => undefined); await runEvaluation(pool, id(), M, eligDeps); dec = decisionInput((await as(M, (db) => listDecisionHistory(db, sp.id)))[0]!); });
  const run = async (llm: FetchLike, rt: Partial<RuntimeContext> = {}, resolve: { timeoutMs: number; maxRetries: number } = { timeoutMs: 2000, maxRetries: 2 }) => {
    const sleeps: number[] = [];
    const full: RuntimeContext = { tenantId: M, tenantName: "Tenant M", domainPackId: "real-estate", domainPackVersion: "0.1.0", resolve: () => ({ name: "Eligibility Explainer", body: AGENT_PROMPTS[5]!.body, promptVersion: "teste-v1", promptVersionId: null, ...resolve }), sleep: async (ms) => { sleeps.push(ms); }, trace: { pipelineRunId: null, correlationId: "corr-x" }, ...rt };
    const ctx: AgentCtx = { ...baseCtx(llm), runtime: full };
    const r = await as(M, (db) => runAgent(ctx, { db, budget: RunBudget.create(), runId: null, actor: "t", now: () => T0 } satisfies AgentBase, explainerSpec({ ...dec, topic_id: dec.topic_id }), { ...dec, _case: Math.random() }, { kind: "test", ref: "exec" }));
    const row = await as(M, async (db) => (await db.query<{ status: string; attempts: number; usage: Record<string, unknown>; correlation_id: string | null; duration_ms: number }>(`SELECT status, attempts, usage, correlation_id, duration_ms FROM plataforma.agent_run WHERE id = $1`, [r.agentRunId])).rows[0]!);
    return { r, row, sleeps };
  };
  it("sucesso: grava correlação, versão de prompt do registro e duração; o contexto de execução vai no cabeçalho com o execution_id = agent_run.id", async () => {
    const calls: { agent: number; execution: string; correlation: string }[] = [];
    const { r, row } = await run(routedLlm({ 5: A5 }, calls));
    expect(r.state).toBe("ok"); expect(row).toMatchObject({ status: "succeeded", correlation_id: "corr-x" }); expect(row.duration_ms).toBeGreaterThanOrEqual(0);
    expect(calls[0]).toMatchObject({ agent: 5, correlation: "corr-x" }); expect(calls[0]!.execution).toBe(r.agentRunId);
  });
  it("limite de taxa (429): espera com recuo e repete; a execução termina com sucesso e registra as retentativas", async () => {
    const { r, row, sleeps } = await run(routedLlm({ 5: (i, n) => (n === 1 ? { status: 429, body: "{}" } : A5(i, n)) }));
    expect(r.state).toBe("ok"); expect(sleeps).toEqual([1000]); expect(row.usage.transientRetries).toBe(1);
  });
  it("falha transitória (503) esgota as retentativas limitadas e falha como 'transient', sem laço infinito", async () => {
    let calls = 0; const { r, row, sleeps } = await run(routedLlm({ 5: () => { calls += 1; return { status: 503, body: "{}" }; } }));
    expect(r).toMatchObject({ state: "failed", failure: { kind: "transient", retryable: true } }); expect(calls).toBe(3); expect(sleeps).toEqual([1000, 2000]); expect(row).toMatchObject({ status: "failed" }); expect(row.usage.transientRetries).toBe(2);
  });
  it("falha permanente (401) NÃO repete", async () => {
    let calls = 0; const { r, row, sleeps } = await run(routedLlm({ 5: () => { calls += 1; return { status: 401, body: "{}" }; } }));
    expect(r).toMatchObject({ state: "failed", failure: { kind: "permanent", retryable: false } }); expect(calls).toBe(1); expect(sleeps).toEqual([]); expect(row.status).toBe("failed");
  });
  it("tempo esgotado: TIMED_OUT, repete só o limitado e o estado auditado é timed_out", async () => {
    let calls = 0; const { r, row } = await run(routedLlm({ 5: () => { calls += 1; return "hang"; } }), {}, { timeoutMs: 30, maxRetries: 1 });
    expect(r).toMatchObject({ state: "failed", failure: { kind: "timeout" } }); expect(calls).toBe(2); expect(row.status).toBe("timed_out");
  });
  it("saída inválida (JSON quebrado) após as correções → INVALID_OUTPUT, sem retentativa de infraestrutura", async () => {
    let calls = 0; const { r, row } = await run(routedLlm({ 5: () => { calls += 1; return "isto não é JSON"; } }));
    expect(r).toMatchObject({ state: "failed", failure: { kind: "invalid_output", retryable: false } }); expect(calls).toBe(3); expect(row).toMatchObject({ status: "invalid_output", attempts: 3 });
  });
  it("cancelamento: nenhuma chamada ao modelo é feita e o estado é cancelled", async () => {
    let calls = 0; const { r, row } = await run(routedLlm({ 5: () => { calls += 1; return A5(dec as never, 1); } }), { isCancelled: () => true });
    expect(r).toMatchObject({ state: "failed", failure: { kind: "cancelled" } }); expect(calls).toBe(0); expect(row.status).toBe("cancelled");
  });
  it("proteção contra laço: a chamada acima do teto da execução é recusada (loop_guard)", async () => {
    const guard = new CallGuard(1); const llm = routedLlm({ 5: A5 });
    const a = await run(llm, { guard }); const b = await run(llm, { guard });
    expect(a.r.state).toBe("ok"); expect(b.r).toMatchObject({ state: "failed", failure: { kind: "loop_guard" } }); expect(b.row.usage.failureKind).toBe("loop_guard");
  });
  it("o agente não pode alterar a decisão: explicação que cita outra decisão é inválida e a decisão gravada fica intacta", async () => {
    const before = (await as(M, (db) => listDecisionHistory(db, sp.id)))[0]!;
    const { r: r2 } = await run(routedLlm({ 5: (i) => JSON.stringify({ topic_id: i.topic_id, explanation: dec.decision === "DATA_REQUIRED" ? "A decisão é REJECTED." : "A decisão é DATA_REQUIRED.", next_best_action: "x" }) }));
    expect(r2).toMatchObject({ state: "failed", failure: { kind: "invalid_output" } });
    expect((await as(M, (db) => listDecisionHistory(db, sp.id)))[0]).toEqual(before);
  });
});

describe("pipeline de página: caminho com bloqueio, retomada idempotente e aprovação", () => {
  const calls: { agent: number; execution: string; correlation: string }[] = [];
  const llm = routedLlm({ 5: A5, 7: A7, 8: A8() }, calls);
  let first: Awaited<ReturnType<typeof runPagePipeline>>;
  it("sem SERP nem exceção: eligibility, explain (A05) e blueprint rodam; serp_gate bloqueia; o Quality Gate pede REVISÃO (NEEDS_REVIEW), nada é aprovado", async () => {
    expect((await oppOf("ibge:3550308")).status).toBe("eligible");
    first = await runPagePipeline(penv(llm), { opportunityId: sp.id, correlationId: "pg-1" });
    expect(first.run).toMatchObject({ status: "NEEDS_REVIEW", finalOutcome: "NEEDS_REVIEW", mode: "test_simulation", correlationId: "pg-1" });
    expect(first.steps.map((s) => `${s.stepKey}:${s.status}`)).toEqual(["eligibility:SUCCEEDED", "explain:SUCCEEDED", "blueprint:SUCCEEDED", "blueprint_semantics:SKIPPED", "serp_gate:BLOCKED", "recipe_qa:BLOCKED", "quality_gate:SUCCEEDED"]);
    expect(stepOf(first, "recipe_qa")).toMatchObject({ error: expect.stringContaining("dependência não concluída: serp_gate") });
    expect(stepOf(first, "serp_gate").error).toMatch(/SERP analisada ou exceção humana/);
    expect(first.reasons[0]).toMatch(/ADR-025/);
    expect(calls.filter((c) => c.agent === 7 || c.agent === 8)).toHaveLength(0); // sem SERP, nem o editorial nem o verificador rodam
  });
  it("a execução do Agente 5 fica ligada ao passo, ao pipeline e à correlação; a explicação é gravada ligada à decisão", async () => {
    const ex = { ...stepOf(first, "explain"), agent: 5 as number | null };
    expect(ex.agent).toBe(5); expect(ex.agentRunId).toMatch(/^[0-9a-f-]{36}$/);
    const row = await as(M, async (db) => (await db.query<{ pipeline_run_id: string; correlation_id: string; prompt_version_id: string | null }>(`SELECT pipeline_run_id, correlation_id, prompt_version_id FROM plataforma.agent_run WHERE id = $1`, [ex.agentRunId])).rows[0]!);
    expect(row).toMatchObject({ pipeline_run_id: first.run.id, correlation_id: "pg-1" }); expect(row.prompt_version_id).not.toBeNull(); // versão do registro (semeada acima)
    expect(await count(M, "decision_explanation")).toBeGreaterThanOrEqual(1);
  });
  it("o Quality Gate é decisão do CÓDIGO e fica na auditoria (decided_by = code)", async () => {
    const a = await as(M, (db) => listDecisionAudit(db, { pipelineRunId: first.run.id }));
    expect(a).toHaveLength(1); expect(a[0]).toMatchObject({ subjectKind: "page", decision: "NEEDS_REVIEW", decidedBy: "code", recommendationApplied: true });
  });
  it("retomada com a mesma correlação: passos concluídos são REAPROVEITADOS (nenhuma chamada nova ao modelo para eles) e, com a exceção humana registrada, o pipeline segue", async () => {
    await applySerpWaiver(pool, id(), M, { opportunityId: sp.id, reason: "Exceção de SERP de teste: não há provedor de SERP; nada é publicado." });
    const before = calls.length;
    const second = await runPagePipeline(penv(llm, { recipeQa: { ...recipeBase, qaPolicy: TEST_QA } }), { opportunityId: sp.id, correlationId: "pg-1" });
    expect(second.resumed).toBe(true); expect(second.run.id).toBe(first.run.id);
    expect(second.reused).toEqual(["eligibility", "explain", "blueprint", "blueprint_semantics"]);
    const newCalls = calls.slice(before); expect(newCalls.map((c) => c.agent).sort()).toEqual([7, 8]); // só o editorial e o verificador
    expect(second.steps.map((s) => `${s.stepKey}:${s.status}`)).toEqual(["eligibility:SUCCEEDED", "explain:SUCCEEDED", "blueprint:SUCCEEDED", "blueprint_semantics:SKIPPED", "serp_gate:SUCCEEDED", "recipe_qa:SUCCEEDED", "quality_gate:SUCCEEDED"]);
    expect(await count(M, "pipeline_step", `pipeline_run_id = '${first.run.id}'`)).toBe(7); // uma linha por passo (upsert), sem duplicar
    expect(second.run).toMatchObject({ status: "SUCCEEDED", finalOutcome: "APPROVED" });
    expect(second.run.summary).toMatch(/nada foi publicado/);
  });
  it("o recipe e o QA têm a narrativa do Agente 7 e o veredito do Agente 8 ligados ao pipeline; o estado vai a 'qa' e NUNCA a publicado", async () => {
    const r = await as(M, (db) => getPipelineRun(db, first.run.id));
    const qa = r!.steps.find((s) => s.stepKey === "recipe_qa")!.result as { narrativeSource: string; qaOutcome: string; agentRuns: Record<string, { status: string }>; failed: string[] };
    expect(qa).toMatchObject({ narrativeSource: "agent7", qaOutcome: "QA_PASSED" }); expect(qa.agentRuns.agent7!.status).toBe("succeeded"); expect(qa.agentRuns.agent8!.status).toBe("succeeded");
    expect((await oppOf("ibge:3550308")).status).toBe("qa");
    expect(await count(M, "growth_opportunity", "status IN ('published','indexed','monitored','converted','measured','learned','refreshed')")).toBe(0);
  });
  it("rodar de novo a mesma correlação não repete nada (idempotente): zero chamadas novas e mesma decisão final", async () => {
    const before = calls.length; const third = await runPagePipeline(penv(llm, { recipeQa: { ...recipeBase, qaPolicy: TEST_QA } }), { opportunityId: sp.id, correlationId: "pg-1" });
    expect(calls.length).toBe(before); expect(third.reused).toHaveLength(7); expect(third.run.finalOutcome).toBe("APPROVED");
    expect(await count(M, "page_recipe", `opportunity_id = '${sp.id}' AND narrative_source = 'agent7'`)).toBe(1);
  });
  it("o verificador (A08) reprovando Q2 BLOQUEIA a página: nenhum agente aprova a própria saída", async () => {
    const llm2 = routedLlm({ 5: A5, 7: A7, 8: A8("FAIL") }); const e2 = penv(llm2, { recipeQa: { ...recipeBase, qaPolicy: TEST_QA } });
    const r1 = await runPagePipeline(e2, { opportunityId: cb.id, correlationId: "pg-cb" });
    expect(r1.run.finalOutcome).toBe("NEEDS_REVIEW"); // aguardando SERP/exceção
    await applySerpWaiver(pool, id(), M, { opportunityId: cb.id, reason: "Exceção de SERP de teste: não há provedor de SERP; nada é publicado." });
    const r2 = await runPagePipeline(e2, { opportunityId: cb.id, correlationId: "pg-cb" });
    expect(r2.run).toMatchObject({ status: "BLOCKED", finalOutcome: "BLOCKED" }); expect(r2.reasons[0]).toContain("Q2");
  });
});

describe("pipeline de página: caminhos bloqueados", () => {
  it("decisão que não é READY bloqueia o blueprint e todo o resto, mesmo com agentes disponíveis (gate manda)", async () => {
    const other = await as(M, async (db) => (await db.query<{ id: string }>(`SELECT o.id FROM plataforma.growth_opportunity o WHERE o.topic_id IS NOT NULL AND o.status IN ('scored', 'validated') ORDER BY o.topic_id LIMIT 1`)).rows[0]);
    if (!other) return;
    const r = await runPagePipeline(penv(routedLlm({ 5: A5 })), { opportunityId: other.id, correlationId: "pg-block" });
    expect(["BLOCKED"]).toContain(r.run.status); expect(r.run.finalOutcome).toBe("BLOCKED");
    expect(stepOf(r, "blueprint").status).toBe("BLOCKED"); expect(stepOf(r, "recipe_qa").status).toBe("BLOCKED");
  });
  it("sem agentes configurados (sem chave) o pipeline não inventa: A05 é pulado e a diferença fica visível no passo", async () => {
    const r = await runPagePipeline(penv(null), { opportunityId: sp.id, correlationId: "pg-noagents" });
    expect(stepOf(r, "explain").status).toBe("SKIPPED");
    expect(r.run.status).not.toBe("FAILED");
  });
  it("sem ANTHROPIC_API_KEY o agente fica 'not_configured' e o passo é BLOQUEIO EXTERNO (BLOCKED), não falha de código", async () => {
    const cfg = { ...penv(routedLlm({})).agents!, ctx: { ...baseCtx(routedLlm({})), env: {} } };
    const o2 = await as(M, async (db) => (await db.query<{ id: string }>(`SELECT id FROM plataforma.growth_opportunity WHERE id = $1`, [cb.id])).rows[0]!);
    const r = await runPagePipeline(penv(null, { agents: cfg }), { opportunityId: o2.id, correlationId: "pg-nokey" });
    expect(stepOf(r, "explain")).toMatchObject({ status: "BLOCKED", error: expect.stringContaining("provider_not_configured") });
    expect(stepOf(r, "explain").result).toMatchObject({ blockedExternally: true });
  });
  it("cancelamento: pedido antes de rodar para o pipeline, marca os passos CANCELLED e não faz chamada ao modelo; depois pode ser retomado", async () => {
    const calls: { agent: number; execution: string; correlation: string }[] = [];
    const llm = routedLlm({ 5: A5, 7: A7, 8: A8() }, calls); const env = penv(llm);
    const started = await runPagePipeline(penv(null), { opportunityId: cb.id, correlationId: "pg-cancel" }); // cria a execução
    expect(await requestPipelineCancel(pool, id(), M, started.run.id)).toBe(false); // já terminou: nada a cancelar
    const flag = { cancelled: true };
    const r = await runPagePipeline({ ...env, cancel: flag }, { opportunityId: cb.id, correlationId: "pg-cancel-2" });
    expect(r.run.status).toBe("CANCELLED"); expect(r.steps.every((s) => s.status === "CANCELLED")).toBe(true); expect(calls).toHaveLength(0);
    flag.cancelled = false;
    const again = await runPagePipeline({ ...env, cancel: flag }, { opportunityId: cb.id, correlationId: "pg-cancel-2" });
    expect(again.resumed).toBe(true); expect(again.run.status).not.toBe("CANCELLED"); expect(again.steps.some((s) => s.status === "SUCCEEDED")).toBe(true);
  });
  it("o teto de chamadas por execução (loop guard) para o pipeline com falha explícita", async () => {
    const e = penv(routedLlm({ 5: A5 }), { maxModelCalls: 0 });
    const r = await runPagePipeline(e, { opportunityId: sp.id, correlationId: "pg-guard" });
    expect(stepOf(r, "explain")).toMatchObject({ status: "FAILED", error: expect.stringContaining("loop_guard") });
  });
});

describe("pipeline de tópicos: lotes, intenção, revisão de combinações e isolamento", () => {
  const topics = () => as(M, async (db) => (await db.query<{ topic_id: string }>(`SELECT topic_id FROM plataforma.growth_opportunity WHERE topic_id IS NOT NULL ORDER BY topic_id LIMIT 6`)).rows.map((r) => r.topic_id));
  const intentsReply: Handler = (i) => JSON.stringify({ intents: i.topics.map((t: any) => ({ topic_id: t.topic_id, what: "visão geral", where: "município", why: "conhecer", when: "pesquisa", for_whom: "interessados", intent_type: "informational", primary_keyword: null, variants: [], query_hypothesis: t.query_hypothesis, demand_status: "HYPOTHESIS", demand_signal: { value: null, source: "sem fonte", period: "n/d", uncertainty: "sem demanda observada" }, unmet_need: false })) });
  const tenv = (llm: FetchLike, over: Partial<TopicStageEnv> = {}): TopicStageEnv => ({ pool, identity: id(), tenantId: M, tenantName: "Tenant M", mode: "test_simulation", domainPack: { id: "real-estate", version: "0.1.0" }, agents: { ctx: baseCtx(llm), budget: RunBudget.create() }, now: () => T0, sleep: async () => undefined, ...over });
  it("A03 modela a intenção em lote: sem demanda OBSERVADA tudo é HIPÓTESE (nunca inventada) e o resultado é gravado no tópico", async () => {
    const ids = await topics(); const calls: { agent: number; execution: string; correlation: string }[] = [];
    const r = await runTopicStage(tenv(routedLlm({ 3: intentsReply, 4: () => JSON.stringify({ reviews: [] }) }, calls), { topicIds: ids }), { correlationId: "tp-1" });
    expect(stepOf(r, "inventory").status).toBe("SKIPPED"); expect(stepOf(r, "proposals").status).toBe("SKIPPED");
    expect(stepOf(r, "intents"), JSON.stringify(stepOf(r, "intents").error ?? "") + JSON.stringify(stepOf(r, "intents").result).slice(0, 600)).toMatchObject({ status: "SUCCEEDED", result: expect.objectContaining({ topics: ids.length, observed: 0, hypothesis: ids.length, failedItems: 0 }) });
    expect(calls.filter((c) => c.agent === 3)).toHaveLength(1); // um lote (≤ 50)
    expect(await count(M, "growth_opportunity", `topic_id = ANY(ARRAY['${ids.join("','")}']) AND intent_model ->> 'demandStatus' = 'HYPOTHESIS'`)).toBe(ids.length);
  });
  it("um item que quebra o lote é ISOLADO por bisseção: os outros seguem e a falha fica registrada só para ele", async () => {
    const ids = (await topics()).slice(0, 5); const bad = ids[2]!; // conjunto diferente do teste anterior (o cache de chamadas devolveria a resposta antiga)
    const flaky: Handler = (i) => (i.topics.some((t: any) => t.topic_id === bad) ? "isto não é JSON" : intentsReply(i, 1));
    const r = await runTopicStage(tenv(routedLlm({ 3: flaky, 4: () => JSON.stringify({ reviews: [] }) }), { topicIds: ids }), { correlationId: "tp-2" });
    const st = stepOf(r, "intents") as unknown as { status: string; result: { failedItems: number; failures: { item: { topic_id: string }; error: string }[] } };
    expect(st.status).toBe("SUCCEEDED"); expect(st.result.failedItems).toBe(1); expect(st.result.failures[0]!.item.topic_id).toBe(bad); expect(st.result.failures[0]!.error).toMatch(/invalid_output/);
    expect(await count(M, "growth_opportunity", `topic_id = '${ids[0]}' AND intent_model IS NOT NULL`)).toBe(1);
  });
  it("A03 com chave ausente: bloqueio externo registrado, nada inventado", async () => {
    const ids = await topics(); const noKey = tenv(routedLlm({}), { topicIds: ids, agents: { ctx: { ...baseCtx(routedLlm({})), env: {} }, budget: RunBudget.create() } });
    const r = await runTopicStage(noKey, { correlationId: "tp-3" });
    expect(stepOf(r, "intents").status).toBe("FAILED"); expect(stepOf(r, "intents").error).toMatch(/provider_not_configured/);
    expect(r.run.status).toBe("FAILED");
  });
  it("A04 recomenda; o CÓDIGO aplica e audita: absorve só o que não tem bloco exclusivo; filho com dado próprio permanece, e tudo vai para decision_audit", async () => {
    // montagem de TESTE: o gerador atual não cria pai/filho entre cidades; dois tópicos reais passam a ser filhos de SP (um igual ao pai em atributos exigidos, outro com um atributo próprio a mais)
    const pick = (pattern: string, not: string[]) => as(M, async (db) => (await db.query<{ topic_id: string }>(`SELECT topic_id FROM plataforma.growth_opportunity WHERE pattern_key = $1 AND status IN ('discovered', 'validated', 'scored') AND topic_id <> ALL($2::text[]) ORDER BY topic_id LIMIT 1`, [pattern, not])).rows[0]?.topic_id ?? (() => { throw new Error(`sem tópico ${pattern} disponível`); })());
    const same = await pick("topic-city-overview", [sp.topic_id, cb.topic_id]); const own = await pick("topic-city-overview", [sp.topic_id, cb.topic_id, same]);
    await as(M, (db) => db.query(`UPDATE plataforma.growth_opportunity SET required_attributes = required_attributes || ARRAY['city.density_per_km2'] WHERE topic_id = $1`, [own]));
    await as(M, (db) => db.query(`UPDATE plataforma.growth_opportunity SET parent_topic_id = $1 WHERE topic_id = ANY($2::text[])`, [sp.topic_id, [same, own]]));
    const all = [sp.topic_id, same, own];
    let seen: { groups: { parent: { topic_id: string }; children: { topic_id: string; exclusive_blocks: number }[] }[] } | null = null;
    const a4: Handler = (i) => { seen = i; return JSON.stringify({ reviews: i.groups.flatMap((g: any) => g.children.map((c: any) => ({ topic_id: c.topic_id, differs_from_parent: c.exclusive_blocks > 0, parent_reason: "teste", redundant_with_siblings: [], recommendation: "FILTER_ONLY", rationale: "roteiro de teste" }))) }); };
    const r = await runTopicStage(tenv(routedLlm({ 3: intentsReply, 4: a4 }), { topicIds: all }), { correlationId: "tp-a4" });
    const st = stepOf(r, "combination_review") as unknown as { status: string; result: { groups: number; kept: number; absorbed: number; recommendationsRefused: number } };
    expect(seen, "o Agente 4 não foi chamado: não há grupos pai/filho").not.toBeNull();
    const kids = seen!.groups.flatMap((g) => g.children); expect(kids.some((c) => c.exclusive_blocks === 0) && kids.some((c) => c.exclusive_blocks > 0), JSON.stringify(kids)).toBe(true); const expectAbsorb = kids.filter((c) => c.exclusive_blocks === 0).map((c) => c.topic_id);
    expect(st.status).toBe("SUCCEEDED"); expect(st.result.absorbed).toBe(expectAbsorb.length); expect(st.result.kept + st.result.absorbed).toBe(kids.length);
    const audit = await as(M, (db) => listDecisionAudit(db, { pipelineRunId: r.run.id, subjectKind: "topic" }));
    expect(audit).toHaveLength(kids.length); expect(audit.every((a) => a.decidedBy === "code" && a.recommendation !== null && a.agentRunId !== null)).toBe(true);
    for (const t of expectAbsorb) expect((await as(M, async (db) => (await db.query<{ status: string }>(`SELECT status FROM plataforma.growth_opportunity WHERE topic_id = $1`, [t])).rows[0]!.status))).toBe("rejected");
    for (const c of kids.filter((x) => x.exclusive_blocks > 0)) expect((await as(M, async (db) => (await db.query<{ status: string }>(`SELECT status FROM plataforma.growth_opportunity WHERE topic_id = $1`, [c.topic_id])).rows[0]!.status))).not.toBe("rejected");
  });
  it("auditoria e isolamento: execuções e passos visíveis só para o tenant dono", async () => {
    expect((await as(M, (db) => listPipelineRuns(db))).length).toBeGreaterThan(3);
    expect(await as(N, (db) => listPipelineRuns(db))).toEqual([]);
    expect(await count(N, "agent_run")).toBe(0); expect(await count(N, "pipeline_step")).toBe(0); expect(await count(N, "decision_audit")).toBe(0);
    expect(await as(N, (db) => getPipelineRun(db, "00000000-0000-4000-8000-000000000000"))).toBeNull();
  });
  it("histórico imutável: a aplicação não altera nem apaga a auditoria, os prompts (corpo) ou as execuções", async () => {
    await expect(as(M, (db) => db.query(`UPDATE plataforma.decision_audit SET decision = 'X'`))).rejects.toThrow(/permission denied/);
    await expect(as(M, (db) => db.query(`UPDATE plataforma.prompt_version SET body = 'x'`))).rejects.toThrow(/permission denied/);
    await expect(as(M, (db) => db.query(`DELETE FROM plataforma.pipeline_step`))).rejects.toThrow(/permission denied/);
    await expect(as(M, (db) => db.query(`UPDATE plataforma.agent_run SET status = 'succeeded'`))).rejects.toThrow(/permission denied/);
  });
});

describe("leituras do Control Plane (monitor, inspetor, visão do motor, descoberta)", () => {
  it("o monitor lista as execuções por agente, estado e pipeline, com totais por estado vindos do banco", async () => {
    const all = await as(M, (db) => listAgentRuns(db));
    expect(all.total).toBeGreaterThan(5); expect(all.rows.length).toBeGreaterThan(0); expect(Object.keys(all.byStatus)).toEqual(expect.arrayContaining(["succeeded", "invalid_output"]));
    const a5 = await as(M, (db) => listAgentRuns(db, { agent: 5 })); expect(a5.rows.every((r) => r.agent === 5)).toBe(true);
    const bad = await as(M, (db) => listAgentRuns(db, { status: "invalid_output" })); expect(bad.total).toBe(all.byStatus.invalid_output); expect(bad.rows.every((r) => r.status === "invalid_output" && r.failureKind === "invalid_output")).toBe(true);
    const pr = await as(M, (db) => listPipelineRuns(db, { limit: 1 })); const inRun = await as(M, (db) => listAgentRuns(db, { pipelineRunId: pr[0]!.id }));
    expect(inRun.rows.every((r) => r.pipelineRunId === pr[0]!.id)).toBe(true);
    const page = await as(M, (db) => listAgentRuns(db, { limit: 2, offset: 2 })); expect(page.rows).toHaveLength(2); expect(page.rows[0]!.seq).toBeLessThan(all.rows[1]!.seq);
    expect(await as(N, (db) => listAgentRuns(db))).toEqual({ total: 0, byStatus: {}, rows: [] });
  });
  it("o inspetor devolve entrada, saída e erros; id inexistente, malformado ou de outro tenant dá null", async () => {
    const ok = (await as(M, (db) => listAgentRuns(db, { status: "succeeded", limit: 1 }))).rows[0]!;
    const d = await as(M, (db) => getAgentRun(db, ok.id));
    expect(d).toMatchObject({ id: ok.id, status: "succeeded", promptSha256: expect.stringMatching(/^[0-9a-f]{64}$/) }); expect(d!.output).not.toBeNull(); expect(d!.input).not.toBeNull();
    const inv = (await as(M, (db) => listAgentRuns(db, { status: "invalid_output", limit: 1 }))).rows[0]!;
    const di = await as(M, (db) => getAgentRun(db, inv.id)); expect(di!.output).toBeNull(); expect(di!.errors.length).toBeGreaterThan(0);
    expect(await as(M, (db) => getAgentRun(db, "00000000-0000-4000-8000-000000000000"))).toBeNull(); expect(await as(M, (db) => getAgentRun(db, "não-é-uuid"))).toBeNull(); expect(await as(N, (db) => getAgentRun(db, ok.id))).toBeNull();
  });
  it("a visão do motor por oportunidade junta decisão (com a explicação do A05), blueprint, recipe, QA, pipelines e auditoria; outro tenant não vê", async () => {
    const v = (await as(M, (db) => getEngineView(db, sp.id)))!;
    expect(v.decisions.length).toBeGreaterThan(0); expect(v.decisions.some((d) => d.explanation !== null)).toBe(true);
    expect(v.blueprints.length).toBeGreaterThan(0); expect(v.recipes.length).toBeGreaterThan(0); expect(v.qaReports.length).toBeGreaterThan(0); expect(v.pipelines.length).toBeGreaterThan(0); expect(v.audit.length).toBeGreaterThan(0);
    expect(await as(N, (db) => getEngineView(db, sp.id))).toBeNull(); expect(await as(M, (db) => getEngineView(db, "x"))).toBeNull();
  });
  it("a descoberta de tópicos conta o que existe (por estado, padrão e demanda) e zera para o outro tenant", async () => {
    const t = await as(M, (db) => topicDiscoverySummary(db));
    expect(t.total).toBeGreaterThan(10); expect(Object.values(t.byStatus).reduce((s, n) => s + n, 0)).toBe(t.total); expect(t.byPattern["topic-city-overview"]).toBeGreaterThan(0);
    expect(t.intentModeled).toBeGreaterThan(0); expect(t.byDemand.OBSERVED ?? 0).toBe(0); expect(t.withParent).toBeGreaterThanOrEqual(2); // o teste do A04 liga dois filhos
    expect(await as(N, (db) => topicDiscoverySummary(db))).toEqual({ total: 0, byStatus: {}, byPattern: {}, intentModeled: 0, byDemand: {}, withParent: 0 });
  });
});
