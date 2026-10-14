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
import { runEvaluation } from "../eligibility";
import { createSpecBlueprint } from "../blueprint-spec";
import { PUBLIC_UA, RateGate, RunBudget } from "../provider";
import type { AgentCtx } from "../agents";
import type { FetchLike } from "../engine/http";
import { listRecipes } from "../qa";
import { routedLlm, A5, A7, A8 } from "../runtime/test-llm";
import { listDecisionAudit } from "../runtime";
import { DEFAULT_CONFIG, confirmBatch, createDeployment, decidePages, factoryMetrics, getBatchView, getDeployment, listBatches, listDeployments, listPages, pageFacets, pipelineStages, planBatch, refreshDeployment, renderRecipeDocument, requestBatchCancel, runBatch, verifyDeployment, BatchError, METRICS, STAGE_IDS, type BatchEnv, type BatchConfig } from "./index";

// Fábrica contra o esquema REAL (migrations 1 a 20), dados REAIS de SP (SIDRA gravado). LLM ROTEIRIZADO e a API da Vercel SIMULADA (servidor em memória que guarda os arquivos enviados e os serve na verificação): provam a
// lógica, NÃO uma execução real. Demanda é SINAL DE TESTE; Campinas e Santos usam respostas CONSTRUÍDAS. Política de QA de TESTE para exercitar o caminho aprovado. Tenants O (fe7) e P (fe8).
const O = "fe777777-7777-4777-8777-777777777777";
const P = "fe888888-8888-4888-8888-888888888888";
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv", import.meta.url));
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };
const T0 = new Date("2026-10-14T12:00:00Z");
const PROMPTS = { version: AGENT_PROMPT_VERSION, sourceSha256: AGENT_PROMPTS_SOURCE.sha256, header: AGENT_HEADER, agents: Object.fromEntries(Object.entries(AGENT_PROMPTS).map(([k, v]) => [k, { name: v.name, body: v.body }])) };
const VARS = { TENANT_NAME: "Tenant O", DOMAIN_PACK: "real-estate", SCORE_BRAND: "Índice", EDITORIAL_STYLE: "direto", RICH_MIN: "0.8", MAX_PROPOSALS: "5", SCOPE: "SP" };
const TEST_QA = { ...DEFAULT_QA_POLICY, maxSiblingSimilarity: 1, minVariableShare: 0, minSiblingsForComparison: 0 };
const bpDeps = { vertical: realEstateVertical, recipes: RECIPES, templates: TEMPLATE_REGISTRY, attributes: realEstateCatalog.attributes, now: () => T0 };
const eligDeps = { verticalId: realEstateVertical.id, attributes: realEstateCatalog.attributes, defaultPolicy: DEFAULT_ELIGIBILITY_POLICY, now: () => T0 };
const llmCalls: { agent: number; execution: string; correlation: string }[] = [];
const llm = routedLlm({ 5: A5, 7: A7, 8: A8() }, llmCalls);
const baseCtx = (fetch: FetchLike): AgentCtx => ({ fetch, userAgent: PUBLIC_UA, gate: new RateGate({}), env: { ANTHROPIC_API_KEY: "sk-ant-ficticia" }, prompts: PROMPTS, vars: VARS });

let pool: pg.Pool;
const id = () => devIdentity([O, P]);
const as = <X>(t: string, fn: (db: TenantDb) => Promise<X>) => withTenant(pool, id(), t, fn);
const oppOf = (key: string) => as(O, async (db) => (await db.query<{ id: string; status: string }>(`SELECT o.id, o.status FROM plataforma.growth_opportunity o JOIN plataforma.entity e ON e.id = o.primary_entity_id WHERE e.source_key = $1 AND o.pattern_key = 'topic-city-overview'`, [key])).rows[0]!);
const env = (over: Partial<BatchEnv> = {}): BatchEnv => ({ pool, identity: id(), tenantId: O, tenantName: "Tenant O", domainPack: { id: "real-estate", version: "0.1.0" }, agents: { ctx: baseCtx(llm), budget: RunBudget.create(), editorialStyle: "direto" }, eligibility: eligDeps, blueprint: bpDeps,
  recipeQa: { vertical: realEstateVertical, recipes: RECIPES, renderers: RENDERERS, qaPolicy: TEST_QA, attributes: realEstateCatalog.attributes, now: () => T0 }, now: () => T0, sleep: async () => undefined, ...over });
const cfg = (over: Partial<BatchConfig> = {}): BatchConfig => ({ ...DEFAULT_CONFIG, limit: 5, concurrency: 1, batchSize: 2, target: "preview", ...over });
let sp: { id: string }, cb: { id: string }, st: { id: string };

// "Vercel" em memória: guarda os arquivos enviados e os serve como o provedor faria (a verificação de verdade lê o que foi enviado)
function fakeVercel() {
  const files = new Map<string, string>(); const calls: { method: string; url: string; auth: string | null }[] = []; let state = "QUEUED"; let created = 0; let pageStatus = 200;
  const f: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? "GET", url, auth: init?.headers?.Authorization ?? null });
    const res = (status: number, body: string) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => "application/json" }, body: null, text: async () => body });
    if (url.startsWith("https://api.vercel.com/v13/deployments?") && init?.method === "POST") { created += 1; const b = JSON.parse(init.body!) as { files: { file: string; data: string }[] }; for (const x of b.files) files.set(`/${x.file.replace(/index\.html$/, "")}`, x.data); return res(200, JSON.stringify({ id: "dpl_1", url: "plataforma-abc.vercel.app", readyState: "QUEUED" })); }
    if (url.startsWith("https://api.vercel.com/v13/deployments/dpl_1")) return res(200, JSON.stringify({ id: "dpl_1", url: "plataforma-abc.vercel.app", readyState: state, errorMessage: state === "ERROR" ? "Build falhou" : undefined }));
    if (url.startsWith("https://plataforma-abc.vercel.app")) { const path = new URL(url).pathname; const html = files.get(path.endsWith("/") ? path : `${path}/`); return pageStatus !== 200 ? res(pageStatus, "") : html ? res(200, html) : res(404, ""); }
    return res(500, "{}");
  };
  return { fetch: f, calls, files, set: (s: string) => { state = s; }, setPageStatus: (s: number) => { pageStatus = s; }, get created() { return created; } };
}

beforeAll(async () => {
  pool = new pg.Pool(productPoolConfig(6)); pool.on("error", () => undefined);
  await runCityImport(pool, id(), O, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: MAPPING });
  await as(O, (db) => materializeCities(db, realEstateFactConfidence, T0));
  const prov = { provider: "ibge-sidra", endpoint: "values/t/4714/n6/x/v/93,614/p/last", params: {}, collectedAt: T0, costUsd: 0, cacheKey: "a".repeat(64), cached: false, callId: null };
  await as(O, (db) => recordSidraFacts(db, [{ facts: { ibgeCode: "3550308", name: "São Paulo (SP)", year: 2022, population: 11451999, densityPerKm2: 7528.26 }, provenance: prov }, { facts: { ibgeCode: "3509502", name: "Campinas (SP)", year: 2022, population: 1139047, densityPerKm2: 1433.5 }, provenance: prov }, { facts: { ibgeCode: "3548500", name: "Santos (SP)", year: 2022, population: 418608, densityPerKm2: 1494.3 }, provenance: prov }], realEstateFactConfidence, T0));
  await runTopicGeneration(pool, id(), O, { vertical: realEstateVertical, catalog: realEstateCatalog, patterns: realEstateTopicPatterns, now: () => T0 });
  for (const k of ["ibge:3550308", "ibge:3509502", "ibge:3548500"]) await as(O, (db) => db.query(`UPDATE plataforma.growth_opportunity o SET demand_signal = '{"value": 10000, "source": "sinal de teste"}'::jsonb FROM plataforma.entity e WHERE e.id = o.primary_entity_id AND e.source_key = $1 AND o.pattern_key = 'topic-city-overview'`, [k]));
  await runEvaluation(pool, id(), O, eligDeps);
  sp = await oppOf("ibge:3550308"); cb = await oppOf("ibge:3509502"); st = await oppOf("ibge:3548500");
  for (const o of [sp, cb]) { await createSpecBlueprint(pool, id(), O, bpDeps, { opportunityId: o.id }); await applySerpWaiver(pool, id(), O, { opportunityId: o.id, reason: "Exceção de SERP de teste: não há provedor de SERP; nada é publicado." }); }
});
afterAll(async () => { await pool.end(); });

describe("antes de qualquer geração: métricas e etapas refletem os registros, sem inventar", () => {
  it("as métricas vêm do banco: tópicos e elegíveis reais, nada gerado, indexação NÃO instrumentada (não é zero)", async () => {
    const m = await as(O, (db) => factoryMetrics(db, { periodDays: 7 }));
    expect(Object.keys(m.values).sort()).toEqual(METRICS.map((x) => x.id).sort());
    const v = (k: string) => { const x = m.values[k]!; if (x.state !== "available") throw new Error(`${k} indisponível`); return x.value; };
    expect(v("topics_discovered")).toBeGreaterThan(600); expect(v("entities_available")).toBeGreaterThan(600); expect(v("opportunities_eligible")).toBe(3); expect(v("pages_generated")).toBe(0); expect(v("pages_published")).toBe(0); expect(v("deployments_total")).toBe(0);
    expect(v("blueprints_created")).toBe(2); expect(v("combinations_evaluated")).toBeGreaterThanOrEqual(0);
    expect(m.values.pages_indexed).toEqual({ state: "not_instrumented", reason: expect.stringContaining("Search Console") });
  });
  it("as 16 etapas existem; em cada uma total = concluídos + em execução + aguardando + bloqueados + falhas + pulados", async () => {
    const s = await as(O, (db) => pipelineStages(db));
    expect(s.map((x) => x.id)).toEqual([...STAGE_IDS]);
    for (const x of s) { expect(x.total, x.id).toBe(x.completed + x.running + x.waiting + x.blocked + x.failed + x.skipped); expect(x.n).toBe(STAGE_IDS.indexOf(x.id) + 1); }
    const by = Object.fromEntries(s.map((x) => [x.id, x])); expect(by.data_ingestion!.completed).toBe(1); expect(by.eligibility!.completed).toBe(3); expect(by.eligibility!.blocked).toBeGreaterThan(500); expect(by.eligibility!.reasons.length).toBeGreaterThan(0);
    expect(by.blueprint_generation!).toMatchObject({ total: 3, completed: 2 }); expect(by.recipe_compilation!).toMatchObject({ total: 2, completed: 0 }); expect(by.recipe_compilation!.reasons).toEqual([{ reason: "aguardando compilação", count: 2 }]);
    expect(by.page_rendering!.instrumented).toBe(false); expect(by.vercel_deployment!.total).toBe(0); expect(by.vercel_deployment!.successRate).toBeNull();
  });
  it("outro tenant vê tudo zerado", async () => {
    const m = await as(P, (db) => factoryMetrics(db)); expect(m.values.topics_discovered).toMatchObject({ value: 0 });
    expect((await as(P, (db) => pipelineStages(db))).every((x) => x.total === 0)).toBe(true); expect(await as(P, (db) => listPages(db))).toEqual({ total: 0, byStage: {}, rows: [] }); expect(await as(P, (db) => listBatches(db))).toEqual([]);
  });
});

describe("lote: selecionar, validar, estimar, confirmar, gerar, cancelar, falhar e retomar", () => {
  let a: Awaited<ReturnType<typeof planBatch>>["batch"];
  it("planejar classifica por estado real e estima SEM executar nada; custo declarado como indisponível; dependências externas listadas", async () => {
    const before = llmCalls.length;
    a = (await planBatch(pool, id(), O, { name: "Lote A", config: cfg(), mode: "test_simulation", llmConfigured: false })).batch;
    expect(a).toMatchObject({ status: "PLANNED", mode: "test_simulation" });
    expect(a.estimate).toMatchObject({ candidates: 5, eligible: 3, dataPending: 2, blocked: 0, alreadyDone: 0, estimatedBatches: 2 });
    expect(a.estimate.cost).toMatchObject({ available: false }); expect(a.estimate.externalDependencies.join(" ")).toMatch(/ANTHROPIC_API_KEY/); expect(a.estimate.externalDependencies.join(" ")).toMatch(/SERP/); expect(a.estimate.externalDependencies.join(" ")).toMatch(/Vercel/);
    expect(llmCalls.length).toBe(before);
    const v = (await as(O, (db) => getBatchView(db, a.id)))!; expect(v.counters).toMatchObject({ selected: 5, eligible: 3, pending: 3, running: 0, approved: 0, notEligible: { blocked: 0, dataPending: 2, alreadyDone: 0 } });
  });
  it("configuração inválida e lote sem confirmação são recusados; produção exige a frase; só PLANNED confirma", async () => {
    await expect(planBatch(pool, id(), O, { name: "x", config: cfg({ concurrency: 99 }), mode: "real", llmConfigured: true })).rejects.toBeInstanceOf(BatchError);
    await expect(planBatch(pool, id(), O, { name: "", config: cfg(), mode: "real", llmConfigured: true })).rejects.toThrow(/nome/);
    await expect(runBatch(env(), a.id)).rejects.toThrow(/confirme o lote/);
    const prod = (await planBatch(pool, id(), O, { name: "Lote produção", config: cfg({ target: "production", limit: 2 }), mode: "test_simulation", llmConfigured: true })).batch;
    await expect(confirmBatch(pool, id(), O, { batchId: prod.id })).rejects.toThrow(/AUTORIZO PRODUÇÃO/);
    await expect(confirmBatch(pool, id(), O, { batchId: prod.id, authorizeProduction: "sim" })).rejects.toThrow(/AUTORIZO PRODUÇÃO/);
    expect((await confirmBatch(pool, id(), O, { batchId: prod.id, authorizeProduction: "AUTORIZO PRODUÇÃO" })).status).toBe("CONFIRMED");
    // cancelamento pedido ANTES de começar vale: nenhum item roda e nenhuma chamada é feita
    const before = llmCalls.length; expect(await requestBatchCancel(pool, id(), O, prod.id)).toBe(true);
    expect((await runBatch(env(), prod.id)).status).toBe("CANCELLED"); expect(llmCalls.length).toBe(before); expect((await as(O, (db) => getBatchView(db, prod.id)))!.counters).toMatchObject({ cancelled: 2, approved: 0, pending: 0 });
    await expect(confirmBatch(pool, id(), O, { batchId: prod.id, authorizeProduction: "AUTORIZO PRODUÇÃO" })).rejects.toThrow(/PLANNED/);
  });
  it("cancelar no meio: o item em curso termina, os demais ficam CANCELLED e o lote CANCELLED; nada novo é chamado", async () => {
    await confirmBatch(pool, id(), O, { batchId: a.id }); const flag = { cancelled: false };
    // o cancelamento chega enquanto o primeiro item está no pipeline (disparado pelo roteiro do Agente 5): o item em curso termina, nenhum novo começa
    const cancelling = routedLlm({ 5: (i, n) => { flag.cancelled = true; return A5(i, n); }, 7: A7, 8: A8() }, llmCalls);
    const e = env({ cancel: flag, agents: { ctx: baseCtx(cancelling), budget: RunBudget.create(), editorialStyle: "direto" } });
    const done = await runBatch(e, a.id);
    expect(done.status).toBe("CANCELLED"); const v = (await as(O, (db) => getBatchView(db, a.id)))!;
    expect(v.counters.cancelled).toBe(2); expect(v.counters.approved + v.counters.awaitingHuman + v.counters.blocked + v.counters.failed).toBe(1); expect(v.counters.pending).toBe(0);
    expect(v.counters.pending + v.counters.running + v.counters.approved + v.counters.awaitingHuman + v.counters.blocked + v.counters.failed + v.counters.cancelled).toBe(v.counters.eligible);
  });
  it("retomar: a falha de UMA página não derruba as outras (isolamento) e o item falho volta com retentativa controlada", async () => {
    let calls = 0; const flaky = { ...RENDERERS, find: (fn: (r: (typeof RENDERERS)[number]) => boolean) => { calls += 1; if (calls === 1) throw new Error("falha injetada no renderizador (teste)"); return RENDERERS.find(fn); } } as unknown as typeof RENDERERS;
    const r1 = await runBatch(env({ recipeQa: { ...env().recipeQa, renderers: flaky } }), a.id);
    let v = (await as(O, (db) => getBatchView(db, a.id)))!;
    expect(r1.status, JSON.stringify(v.counters) + JSON.stringify(v.recent)).toBe("COMPLETED"); expect(v.counters.failed).toBe(1); expect(v.counters.cancelled, JSON.stringify(v.counters) + JSON.stringify(v.recent)).toBe(0); expect(v.errors[0]!.error).toMatch(/falha injetada/); expect(v.errors[0]!.attempts).toBe(1);
    expect(v.counters.approved + v.counters.awaitingHuman + v.counters.blocked + v.counters.failed).toBe(3);
    await runBatch(env(), a.id); v = (await as(O, (db) => getBatchView(db, a.id)))!; expect(v.errors).toEqual([]);
    expect(v.counters.failed).toBe(0); expect(v.counters.approved).toBe(2); expect(v.counters.awaitingHuman).toBe(1);
  });
  it("os contadores são mutuamente consistentes e explicam o bloqueio humano: Santos espera SERP; nada é contado em dois estados", async () => {
    const v = (await as(O, (db) => getBatchView(db, a.id)))!;
    expect(v.counters).toMatchObject({ selected: 5, eligible: 3, approved: 2, awaitingHuman: 1, pending: 0, running: 0, blocked: 0, failed: 0, cancelled: 0 });
    expect(v.counters.eligible + v.counters.notEligible.blocked + v.counters.notEligible.dataPending + v.counters.notEligible.alreadyDone).toBe(v.counters.selected);
    expect(v.awaiting).toHaveLength(1); expect(v.awaiting[0]!.opportunityId).toBe(st.id); expect(v.awaiting[0]!.reason).toMatch(/SERP|ADR-025/);
    expect(v.batch.status).toBe("COMPLETED"); expect(v.elapsedMs).toBeGreaterThanOrEqual(0); expect(v.recent.length).toBeGreaterThan(0); expect(v.blockReasons.length).toBeGreaterThan(0);
    expect(v.etaMs).toBeNull(); // lote concluído: sem estimativa de conclusão
  });
  it("é idempotente: executar de novo o lote concluído não chama o modelo nem refaz páginas", async () => {
    const before = llmCalls.length; const again = await runBatch(env(), a.id); expect(again.status).toBe("COMPLETED"); expect(llmCalls.length).toBe(before);
    expect(await as(O, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.page_recipe WHERE narrative_source = 'agent7'`)).rows[0]!.n))).toBe(2);
  });
  it("registrar a exceção de SERP e reprocessar só as que esperavam revisão humana aprova a terceira, sem refazer as outras", async () => {
    await applySerpWaiver(pool, id(), O, { opportunityId: st.id, reason: "Exceção de SERP de teste: não há provedor de SERP; nada é publicado." });
    const before = llmCalls.filter((c) => c.agent === 7).length;
    await runBatch(env(), a.id, { reprocessAwaiting: true });
    const v = (await as(O, (db) => getBatchView(db, a.id)))!; expect(v.counters).toMatchObject({ approved: 3, awaitingHuman: 0 });
    expect(llmCalls.filter((c) => c.agent === 7).length - before).toBe(1); // só a Santos chamou o Agente 7 de novo
  });
  it("histórico: lotes listados com a quantidade de itens; ações ficam na auditoria; outro tenant não vê", async () => {
    const l = await as(O, (db) => listBatches(db)); expect(l.length).toBeGreaterThanOrEqual(2); expect(l.find((x) => x.id === a.id)!.items).toBe(5);
    const au = await as(O, (db) => listDecisionAudit(db, { subjectKind: "batch", subjectRef: a.id })); expect(au.map((x) => x.decision)).toEqual(expect.arrayContaining(["BATCH_PLANNED", "BATCH_CONFIRMED", "BATCH_CANCELLED", "BATCH_COMPLETED"]));
    expect(await as(P, (db) => getBatchView(db, a.id))).toBeNull();
  });
  it("uma segunda estimativa vê o que já foi feito (ALREADY_DONE) e não promete trabalho repetido", async () => {
    const b = (await planBatch(pool, id(), O, { name: "Lote B", config: cfg(), mode: "test_simulation", llmConfigured: true })).batch;
    expect(b.estimate).toMatchObject({ eligible: 0, alreadyDone: 3 }); expect(b.estimate.estimatedBatches).toBe(0);
  });
});

describe("Page Factory: lista no servidor, filtros, estados distintos, preview e aprovação", () => {
  it("o estágio é derivado dos registros: três páginas aguardam aprovação (QA aprovado), nenhuma é aprovada nem publicada", async () => {
    const l = await as(O, (db) => listPages(db, { stage: "awaiting_approval" })); expect(l.total).toBe(3); expect(l.rows.every((r) => r.qaOutcome === "QA_PASSED" && r.approval === null && r.stage === "awaiting_approval")).toBe(true);
    const all = await as(O, (db) => listPages(db, { limit: 5 })); expect(all.byStage.awaiting_approval).toBe(3); expect(all.byStage.candidate).toBeGreaterThan(600); expect(all.byStage.approved ?? 0).toBe(0); expect(all.byStage.published ?? 0).toBe(0);
    const r = l.rows.find((x) => x.opportunityId === sp.id)!; expect(r).toMatchObject({ url: "/cidades/sp/sao-paulo", templateId: "city-overview", editorial: "agent7", recipeVersion: 2 }); expect(r.blocksFilled).toBeGreaterThan(0); expect(r.title).toMatch(/São Paulo/);
  });
  it("paginação e filtros rodam no banco: tamanho de página, total do filtro, busca por entidade/URL/título, família e template", async () => {
    const p1 = await as(O, (db) => listPages(db, { limit: 10, offset: 0 })); const p2 = await as(O, (db) => listPages(db, { limit: 10, offset: 10 }));
    expect(p1.rows).toHaveLength(10); expect(p2.rows).toHaveLength(10); expect(p1.total).toBe(p2.total); expect(new Set([...p1.rows, ...p2.rows].map((r) => r.opportunityId)).size).toBe(20); expect(p1.total).toBeGreaterThan(600);
    expect((await as(O, (db) => listPages(db, { q: "sao-paulo" }))).rows.map((r) => r.opportunityId)).toContain(sp.id); expect((await as(O, (db) => listPages(db, { q: "Campinas", stage: "awaiting_approval" }))).total).toBe(1);
    expect((await as(O, (db) => listPages(db, { q: "%" }))).total).toBe(0); // curinga literal: não vira "tudo"
    const f = await as(O, (db) => pageFacets(db)); expect(f.families).toContain("04-cidade"); expect(f.templates).toContain("city-overview");
    expect((await as(O, (db) => listPages(db, { template: "city-overview", stage: "awaiting_approval" }))).total).toBe(3); expect((await as(O, (db) => listPages(db, { family: "nao-existe" }))).total).toBe(0); expect((await as(O, (db) => listPages(db, { editorial: "template" }))).total).toBe(0);
    expect((await as(O, (db) => listPages(db, { limit: 1000 }))).rows.length).toBeLessThanOrEqual(100); // teto de página
  });
  it("preview: o documento vem do recipe compilado (mesmo renderer), com SEO, módulos e o que faltou; e é idêntico ao que o deployment enviará", async () => {
    const rc = (await as(O, (db) => listRecipes(db, sp.id)))[0]!; const d = renderRecipeDocument(rc.recipe);
    expect(d.seo).toMatchObject({ url: "/cidades/sp/sao-paulo", robots: "noindex" }); expect(d.html).toContain(`<h1>${rc.recipe.h1}</h1>`); expect(d.modules.length).toBeGreaterThan(0); expect(d.jsonLd.map((j) => j["@type"])).toEqual(["City", "BreadcrumbList"]);
    expect(d.stats.textFromAgent7).toBe(1); expect(d.html).not.toContain("data-block=");
  });
  it("aprovar exige QA_PASSED da versão mais recente; cada página é validada à parte; aprovar é idempotente e revogar volta o estágio", async () => {
    const none = await as(O, async (db) => (await db.query<{ id: string }>(`SELECT id FROM plataforma.growth_opportunity WHERE topic_id IS NOT NULL AND status = 'scored' LIMIT 1`)).rows[0]!.id);
    const r = await decidePages(pool, id(), O, { opportunityIds: [sp.id, none, cb.id], decision: "APPROVED", reason: "revisão de teste" });
    expect(r.map((x) => [x.opportunityId === none ? "none" : "ok", x.ok])).toEqual([["ok", true], ["none", false], ["ok", true]]); expect(r[1]!.message).toMatch(/não tem recipe/);
    expect((await decidePages(pool, id(), O, { opportunityIds: [sp.id], decision: "APPROVED", reason: "de novo" }))[0]).toMatchObject({ ok: true, message: expect.stringContaining("nada a fazer") });
    expect((await as(O, (db) => listPages(db, { stage: "approved" }))).total).toBe(2); expect((await as(O, (db) => listPages(db, { stage: "awaiting_approval" }))).total).toBe(1);
    expect((await decidePages(pool, id(), O, { opportunityIds: [st.id], decision: "REVOKED", reason: "teste" }))[0]).toMatchObject({ ok: false, message: expect.stringContaining("não há aprovação") });
    await decidePages(pool, id(), O, { opportunityIds: [cb.id], decision: "REVOKED", reason: "revogada em teste" }); expect((await as(O, (db) => listPages(db, { stage: "awaiting_approval" }))).total).toBe(2);
    await expect(decidePages(pool, id(), O, { opportunityIds: [], decision: "APPROVED", reason: "motivo válido" })).rejects.toThrow(/1 a 200/); await expect(decidePages(pool, id(), O, { opportunityIds: [sp.id], decision: "APPROVED", reason: "ab" })).rejects.toThrow(/motivo/);
    expect((await as(O, (db) => listDecisionAudit(db, { subjectKind: "page", subjectRef: sp.id }))).some((a) => a.decision === "APPROVAL_APPROVED" && a.decidedBy === "human")).toBe(true);
    await decidePages(pool, id(), O, { opportunityIds: [st.id, cb.id], decision: "APPROVED", reason: "revisão de teste" }); // as três ficam aprovadas para o deployment
  });
});

describe("Deployment Center: o estado vem do provedor, nunca do pedido", () => {
  const vc = fakeVercel(); const E = { VERCEL_TOKEN: "tok_teste", VERCEL_PROJECT: "plataforma-teste" };
  it("sem credenciais: nada é criado e o que falta é dito; nenhuma chamada sai", async () => {
    const r = await createDeployment(pool, id(), O, { env: {}, fetch: vc.fetch }, { opportunityIds: [sp.id], target: "preview" });
    expect(r).toEqual({ state: "provider_not_configured", missing: ["VERCEL_TOKEN", "VERCEL_PROJECT"] }); expect(vc.calls).toHaveLength(0); expect((await as(O, (db) => listDeployments(db))).total).toBe(0);
  });
  it("só entra página aprovada com QA_PASSED da versão atual; produção exige autorização explícita; revogada não passa", async () => {
    await decidePages(pool, id(), O, { opportunityIds: [cb.id], decision: "REVOKED", reason: "revogada em teste" });
    const r = await createDeployment(pool, id(), O, { env: E, fetch: vc.fetch }, { opportunityIds: [sp.id, cb.id], target: "preview" }); expect(r).toMatchObject({ state: "refused" }); expect((r as unknown as { reasons: string[] }).reasons.join(" ")).toMatch(/sem aprovação humana vigente/);
    const p = await createDeployment(pool, id(), O, { env: E, fetch: vc.fetch }, { opportunityIds: [sp.id], target: "production" }); expect(p).toMatchObject({ state: "refused", reasons: [expect.stringContaining("AUTORIZO PRODUÇÃO")] });
    expect(await createDeployment(pool, id(), O, { env: E, fetch: vc.fetch }, { opportunityIds: [sp.id], target: "production", authorization: { phrase: "AUTORIZO PRODUÇÃO", reason: "curto" } })).toMatchObject({ state: "refused" });
    expect(vc.calls).toHaveLength(0);
    await decidePages(pool, id(), O, { opportunityIds: [cb.id], decision: "APPROVED", reason: "aprovada de novo" });
  });
  let dep: string;
  it("preview: criado QUEUED (aceite ≠ sucesso), vira BUILDING e READY só pelo que o provedor relata, e a verificação lê as páginas enviadas", async () => {
    const r = await createDeployment(pool, id(), O, { env: E, fetch: vc.fetch }, { opportunityIds: [sp.id, cb.id], target: "preview", git: { branch: "main", commit: "abc1234" } });
    expect(r).toMatchObject({ state: "ok", reused: false }); const d = (r as { deployment: { id: string; status: string; url: string; pages: number; target: string } }).deployment; dep = d.id;
    expect(d).toMatchObject({ status: "QUEUED", pages: 2, target: "preview", url: "https://plataforma-abc.vercel.app" }); expect(vc.calls[0]).toMatchObject({ method: "POST", auth: "Bearer tok_teste" });
    expect([...vc.files.keys()].sort()).toEqual(["/cidades/sp/campinas/", "/cidades/sp/sao-paulo/"]);
    expect((await as(O, (db) => listPages(db, { stage: "preview" }))).total).toBe(0); // QUEUED não é preview pronto
    vc.set("BUILDING"); expect(await refreshDeployment(pool, id(), O, { env: E, fetch: vc.fetch }, dep)).toMatchObject({ changed: true, deployment: { status: "BUILDING" } });
    expect(await refreshDeployment(pool, id(), O, { env: E, fetch: vc.fetch }, dep)).toMatchObject({ changed: false });
    vc.set("READY"); expect(await refreshDeployment(pool, id(), O, { env: E, fetch: vc.fetch }, dep)).toMatchObject({ changed: true, deployment: { status: "READY" } });
    expect((await as(O, (db) => listPages(db, { stage: "preview" }))).total).toBe(2); expect((await as(O, (db) => listPages(db, { stage: "published" }))).total).toBe(0);
  });
  it("verificação que falha NÃO vira VERIFIED (fica VERIFICATION_PENDING com o motivo); quando as páginas respondem 200 com o h1, vira VERIFIED", async () => {
    vc.setPageStatus(401); const bad = await verifyDeployment(pool, id(), O, { fetch: vc.fetch }, dep);
    expect(bad.verified).toBe(false); expect(bad.deployment.status).toBe("VERIFICATION_PENDING"); expect(bad.results.every((x) => x.httpStatus === 401 && x.reason === "HTTP 401")).toBe(true); expect(bad.deployment.error).toMatch(/2 URL/);
    vc.setPageStatus(200); const ok = await verifyDeployment(pool, id(), O, { fetch: vc.fetch }, dep);
    expect(ok.verified).toBe(true); expect(ok.deployment).toMatchObject({ status: "VERIFIED", error: null }); expect(ok.results.every((x) => x.ok)).toBe(true);
    const g = (await as(O, (db) => getDeployment(db, dep)))!; expect(g.events.map((e) => e.status)).toEqual(["VERIFIED", "VERIFICATION_PENDING", "VERIFICATION_PENDING", "READY", "BUILDING", "QUEUED", "QUEUED"]); // QUEUED duas vezes: registrado aqui e depois aceito pela Vercel
    expect(g.events[5]!.detail).toMatchObject({ accepted: true }); expect(g.events[6]!.detail).toMatchObject({ pages: 2 }); expect(g.pages.every((p) => p.httpStatus === 200 && p.verifiedAt !== null)).toBe(true);
    expect(g.events.find((e) => e.status === "QUEUED")!.source).toBe("request"); expect(g.events.find((e) => e.status === "READY")!.source).toBe("poll");
  });
  it("é idempotente: o mesmo conjunto de versões e destino reutiliza o deployment e não chama a Vercel de novo", async () => {
    const n = vc.created; const r = await createDeployment(pool, id(), O, { env: E, fetch: vc.fetch }, { opportunityIds: [cb.id, sp.id], target: "preview" });
    expect(r).toMatchObject({ state: "ok", reused: true }); expect((r as { deployment: { id: string } }).deployment.id).toBe(dep); expect(vc.created).toBe(n);
  });
  it("falha de build no provedor vira FAILED com o motivo; deployment final não é reaberto pela consulta", async () => {
    const vc2 = fakeVercel(); await decidePages(pool, id(), O, { opportunityIds: [st.id], decision: "APPROVED", reason: "aprovada" });
    const r = await createDeployment(pool, id(), O, { env: E, fetch: vc2.fetch }, { opportunityIds: [st.id], target: "preview" }); const d = (r as { deployment: { id: string } }).deployment.id;
    vc2.set("ERROR"); const f = await refreshDeployment(pool, id(), O, { env: E, fetch: vc2.fetch }, d); expect(f).toMatchObject({ changed: true, deployment: { status: "FAILED", error: "Build falhou" } });
    vc2.set("READY"); expect(await refreshDeployment(pool, id(), O, { env: E, fetch: vc2.fetch }, d)).toMatchObject({ changed: false, deployment: { status: "FAILED" } });
    await expect(verifyDeployment(pool, id(), O, { fetch: vc2.fetch }, d)).rejects.toThrow(/FAILED/);
  });
  it("recusa da API (HTTP 403) fica registrada como FAILED, não como sucesso", async () => {
    const deny: FetchLike = async () => ({ ok: false, status: 403, headers: { get: () => null }, body: null, text: async () => JSON.stringify({ error: { code: "forbidden", message: "Not authorized" } }) });
    await decidePages(pool, id(), O, { opportunityIds: [sp.id], decision: "REVOKED", reason: "ciclo de teste" }); await decidePages(pool, id(), O, { opportunityIds: [sp.id], decision: "APPROVED", reason: "ciclo de teste" });
    const r = await createDeployment(pool, id(), O, { env: E, fetch: deny }, { opportunityIds: [sp.id], target: "preview" }); expect(r).toMatchObject({ state: "provider_error", deployment: { status: "FAILED" } }); expect((r as { message: string }).message).toMatch(/HTTP 403.*forbidden/);
  });
  it("produção autorizada: registra quem autorizou e o motivo; a página só vira PUBLICADA com o deployment de produção pronto (e ainda não está indexada)", async () => {
    const vc3 = fakeVercel(); const A = { phrase: "AUTORIZO PRODUÇÃO", reason: "publicação de teste em projeto de teste" };
    const r = await createDeployment(pool, id(), O, { env: E, fetch: vc3.fetch }, { opportunityIds: [cb.id], target: "production", authorization: A });
    const d = (r as { deployment: { id: string; authorizedBy: string; status: string } }).deployment; expect(d).toMatchObject({ status: "QUEUED", authorizedBy: id().userId });
    expect((await as(O, (db) => listPages(db, { stage: "published" }))).total).toBe(0); vc3.set("READY"); await refreshDeployment(pool, id(), O, { env: E, fetch: vc3.fetch }, d.id);
    const pub = await as(O, (db) => listPages(db, { stage: "published" })); expect(pub.total).toBe(1); expect(pub.rows[0]).toMatchObject({ opportunityId: cb.id, deploymentTarget: "production", publishedVersion: 2 });
    const m = await as(O, (db) => factoryMetrics(db)); expect(m.values.pages_published).toMatchObject({ value: 1 }); expect(m.values.pages_indexed.state).toBe("not_instrumented");
  });
});

describe("indicadores finais batem entre si e com as listas", () => {
  it("métricas, etapas e lista de páginas contam as mesmas páginas", async () => {
    const m = await as(O, (db) => factoryMetrics(db)); const val = (k: string) => (m.values[k] as { value: number }).value; const s = Object.fromEntries((await as(O, (db) => pipelineStages(db))).map((x) => [x.id, x]));
    for (const x of Object.values(s)) expect(x.total, x.id).toBe(x.completed + x.running + x.waiting + x.blocked + x.failed + x.skipped);
    expect(val("pages_generated")).toBe(3); expect(val("pages_qa_passed")).toBe(3); expect(val("recipe_versions")).toBeGreaterThanOrEqual(3); expect(val("deployments_total")).toBe(4); expect(val("deployments_verified")).toBe(1);
    expect(s.quality_assurance!.completed).toBe(val("pages_qa_passed")); expect(s.eligibility!.completed).toBe(val("opportunities_eligible")); expect(s.vercel_deployment!.failed).toBe(2); expect(s.vercel_deployment!.completed).toBe(2); expect(s.deployment_verification!.completed).toBe(1);
    expect(s.editorial_generation!.completed).toBe(3); expect(s.approval!.completed).toBe(val("pages_approved"));
    const total = (await as(O, (db) => listPages(db, { limit: 1 }))).total; expect(val("topics_discovered")).toBe(total);
    expect(val("pages_blocked")).toBeGreaterThanOrEqual(0); expect(m.values.generation_failures).toMatchObject({ state: "available", previous: expect.any(Number) });
  });
  it("histórico e isolamento: deployments e eventos são do tenant; o outro tenant não vê nada", async () => {
    expect((await as(O, (db) => listDeployments(db))).total).toBe(4); expect((await as(O, (db) => listDeployments(db, { status: "VERIFIED" }))).rows).toHaveLength(1);
    expect((await as(P, (db) => listDeployments(db))).total).toBe(0); expect(await as(P, (db) => getDeployment(db, "00000000-0000-4000-8000-000000000000"))).toBeNull();
    await expect(as(O, (db) => db.query(`UPDATE plataforma.deployment SET target = 'production'`))).rejects.toThrow(/permission denied/); await expect(as(O, (db) => db.query(`DELETE FROM plataforma.deployment_event`))).rejects.toThrow(/permission denied/);
    await expect(as(O, (db) => db.query(`UPDATE plataforma.page_approval SET decision = 'APPROVED'`))).rejects.toThrow(/permission denied/);
  });
});
