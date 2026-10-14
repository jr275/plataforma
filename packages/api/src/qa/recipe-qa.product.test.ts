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
import { scriptedLlm, type ScriptedCall } from "../agents/test-support";
import type { AgentCtx } from "../agents";
import { RecipeQaError, compileRecipeAndRunQa, listQaReports, listRecipes, type RecipeQaDeps } from "./index";

// Recipe e QA contra o esquema REAL (migrations 1 a 18), dados REAIS de SP. Demanda e respostas dos Agentes 7 e 8 são SINAIS/ROTEIROS DE TESTE (identificados). Tenants K (fe3) e L (fe4).
const K = "fe333333-3333-4333-8333-333333333333";
const L = "fe444444-4444-4444-8444-444444444444";
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv", import.meta.url));
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };
const T0 = new Date("2026-10-14T12:00:00Z");
const PROMPTS = { version: AGENT_PROMPT_VERSION, sourceSha256: AGENT_PROMPTS_SOURCE.sha256, header: AGENT_HEADER, agents: Object.fromEntries(Object.entries(AGENT_PROMPTS).map(([k, v]) => [k, { name: v.name, body: v.body }])) };
const actx = (script: Parameters<typeof scriptedLlm>[0], calls: ScriptedCall[] = []): AgentCtx => ({ fetch: scriptedLlm(script, calls), userAgent: PUBLIC_UA, gate: new RateGate({}), env: { ANTHROPIC_API_KEY: "sk-ant-ficticia" }, prompts: PROMPTS, vars: { TENANT_NAME: "T", DOMAIN_PACK: "real-estate", SCORE_BRAND: "Índice", EDITORIAL_STYLE: "direto", RICH_MIN: "0.8", MAX_PROPOSALS: "5", SCOPE: "SP" } });
const base: RecipeQaDeps = { vertical: realEstateVertical, recipes: RECIPES, renderers: RENDERERS, qaPolicy: DEFAULT_QA_POLICY, attributes: realEstateCatalog.attributes, now: () => T0 };
const bpDeps = { vertical: realEstateVertical, recipes: RECIPES, templates: TEMPLATE_REGISTRY, attributes: realEstateCatalog.attributes, now: () => T0 };
let pool: pg.Pool;
const id = () => devIdentity([K, L]);
const as = <X>(t: string, fn: (db: TenantDb) => Promise<X>) => withTenant(pool, id(), t, fn);
const count = (t: string, table: string, where = "true") => as(t, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.${table} WHERE ${where}`)).rows[0]!.n));
const opp = (key: string) => as(K, async (db) => (await db.query<{ id: string; status: string }>(`SELECT o.id, o.status FROM plataforma.growth_opportunity o JOIN plataforma.entity e ON e.id = o.primary_entity_id WHERE e.source_key = $1 AND o.pattern_key = 'topic-city-overview'`, [key])).rows[0]!);
const evalAll = () => runEvaluation(pool, id(), K, { verticalId: realEstateVertical.id, attributes: realEstateCatalog.attributes, defaultPolicy: DEFAULT_ELIGIBILITY_POLICY, now: () => T0 });
let sp: { id: string; status: string };

beforeAll(async () => {
  pool = new pg.Pool(productPoolConfig(4)); pool.on("error", () => undefined);
  await runCityImport(pool, id(), K, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: MAPPING });
  await as(K, (db) => materializeCities(db, realEstateFactConfidence, T0));
  const prov = { provider: "ibge-sidra", endpoint: "values/t/4714/n6/x/v/93,614/p/last", params: {}, collectedAt: T0, costUsd: 0, cacheKey: "a".repeat(64), cached: false, callId: null };
  // SP: SIDRA REAL (fixture). Campinas e Santos: respostas CONSTRUÍDAS, só para este teste (dão variação e irmãs).
  await as(K, (db) => recordSidraFacts(db, [{ facts: { ibgeCode: "3550308", name: "São Paulo (SP)", year: 2022, population: 11451999, densityPerKm2: 7528.26 }, provenance: prov }, { facts: { ibgeCode: "3509502", name: "Campinas (SP)", year: 2022, population: 1139047, densityPerKm2: 1433.5 }, provenance: prov }, { facts: { ibgeCode: "3548500", name: "Santos (SP)", year: 2022, population: 418608, densityPerKm2: 1494.3 }, provenance: prov }], realEstateFactConfidence, T0));
  await runTopicGeneration(pool, id(), K, { vertical: realEstateVertical, catalog: realEstateCatalog, patterns: realEstateTopicPatterns, now: () => T0 });
  for (const k of ["ibge:3550308", "ibge:3509502", "ibge:3548500"]) await as(K, (db) => db.query(`UPDATE plataforma.growth_opportunity o SET demand_signal = '{"value": 10000, "source": "sinal de teste"}'::jsonb FROM plataforma.entity e WHERE e.id = o.primary_entity_id AND e.source_key = $1 AND o.pattern_key = 'topic-city-overview'`, [k]));
  expect((await evalAll()).result!.byDecision.READY_FOR_BLUEPRINT).toBe(3);
  sp = await opp("ibge:3550308");
  for (const k of ["ibge:3550308", "ibge:3509502", "ibge:3548500"]) { const o = await opp(k); await createSpecBlueprint(pool, id(), K, bpDeps, { opportunityId: o.id }); await applySerpWaiver(pool, id(), K, { opportunityId: o.id, reason: "Exceção de SERP de teste: não há provedor de SERP; nada é publicado." }); }
});
afterAll(async () => { await pool.end(); });

describe("precondições", () => {
  it("tópico fora de 'blueprinted' (ou sem blueprint) não compila recipe", async () => {
    const other = await as(K, async (db) => (await db.query<{ id: string }>(`SELECT id FROM plataforma.growth_opportunity WHERE topic_id IS NOT NULL AND status = 'scored' LIMIT 1`)).rows[0]!.id);
    const e = await compileRecipeAndRunQa(pool, id(), K, base, { opportunityId: other }).catch((x) => x);
    expect(e).toBeInstanceOf(RecipeQaError);
    expect(e.reasons.join(" ")).toMatch(/“scored”/);
    await expect(compileRecipeAndRunQa(pool, id(), K, base, { opportunityId: "x" })).rejects.toBeInstanceOf(RecipeQaError);
    await expect(compileRecipeAndRunQa(pool, id(), L, base, { opportunityId: sp.id })).rejects.toBeInstanceOf(RecipeQaError);
  });
});

describe("recipe determinístico + QA do código, sem agentes (verificador ausente)", () => {
  let r1: Awaited<ReturnType<typeof compileRecipeAndRunQa>>;
  it("compila o recipe com fatos REAIS referenciados (fact_id), módulos RICH, noindex e JSON-LD; avança até 'qa' com um evento por passo", async () => {
    expect((await opp("ibge:3550308")).status).toBe("blueprinted");
    r1 = await compileRecipeAndRunQa(pool, id(), K, base, { opportunityId: sp.id });
    const rc = r1.recipe.recipe;
    expect(r1.recipe).toMatchObject({ version: 1, narrativeSource: "template" });
    expect(rc).toMatchObject({ url: "/cidades/sp/sao-paulo", canonical: "/cidades/sp/sao-paulo", robots: "noindex", templateId: "city-overview", travelTime: null });
    expect(rc.modules.map((m) => [m.moduleId, m.render])).toEqual([["identificacao", "RENDERED"], ["demografia", "RENDERED"]]);
    expect(rc.blocks.filter((b) => b.kind === "paragraph").every((b) => b.refs.length > 0 && b.source === "template")).toBe(true);
    expect(rc.blocks.find((b) => b.blockId === "demografia:pop")!.text).toBe("A população estimada é de 11.911.337 habitantes, com referência em 2026, segundo IBGE.");
    expect(rc.blocks.find((b) => b.blockId === "demografia:dens")!.text).toContain("7.528,26 habitantes por km²");
    expect(rc.jsonLd.map((j) => j["@type"])).toEqual(["City", "BreadcrumbList"]);
    expect(r1.steps.map((s) => `${s.from}>${s.to}`)).toEqual(["blueprinted>data_assembled", "data_assembled>evidence_validated", "evidence_validated>experience_built", "experience_built>qa"]);
    expect((await opp("ibge:3550308")).status).toBe("qa");
  });
  it("os fatos do recipe são os fatos reais gravados (ids existem na tabela fact, com fonte)", async () => {
    const ids = r1.recipe.recipe.facts.map((f) => f.factId);
    const n = await count(K, "fact", `id = ANY(ARRAY['${ids.join("','")}']::uuid[]) AND source_name <> '' AND superseded_at IS NULL`);
    expect(n).toBe(ids.length);
  });
  it("Q1, Q2, Q3, Q7, Q8, Q9, Q10, Q11, Q12, Q13 passam; Q14 NÃO roda sem o verificador; o desfecho nunca é QA_PASSED", () => {
    const res = r1.report.results;
    for (const q of ["Q1", "Q2", "Q3", "Q7", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13"] as const) expect(res[q].status, `${q}: ${res[q].issues.join("; ")}`).toBe("PASS");
    expect(res.Q14).toMatchObject({ status: "NOT_RUN", by: "none" });
    expect(res.Q4.status).toBe("NOT_RUN"); // ainda não há 2 irmãs compiladas
    expect(r1.report.outcome).not.toBe("QA_PASSED");
    expect(r1.verifier).toEqual({ attempted: false }); expect(r1.narrative).toEqual({ attempted: false });
  });
  it("Q5 é avaliado de verdade: a página de município com poucos blocos varia pouco e o resultado fica registrado com o número", () => {
    expect(["PASS", "FAIL"]).toContain(r1.report.results.Q5.status);
    expect([r1.report.results.Q5.detail, ...r1.report.results.Q5.issues].join(" ")).toMatch(/parcela variável \d+(\.\d+)?%/);
  });
  it("é idempotente no recipe (mesmo conteúdo = mesma versão) e cada execução de QA é registrada; o estado não muda de novo", async () => {
    const again = await compileRecipeAndRunQa(pool, id(), K, base, { opportunityId: sp.id });
    expect(again.recipe.id).toBe(r1.recipe.id);
    expect(again.steps).toEqual([]);
    expect(await count(K, "page_recipe", `opportunity_id = '${sp.id}'`)).toBe(1);
    expect(await count(K, "qa_report", `opportunity_id = '${sp.id}'`)).toBe(2);
  });
  it("o QA não publica nem indexa: nenhum evento autoriza publicação e nenhum estado pós-QA existe", async () => {
    expect(await count(K, "growth_opportunity", "status IN ('published','indexed','monitored','converted','measured','learned','refreshed')")).toBe(0);
    expect(await count(K, "opportunity_event", `opportunity_id = '${sp.id}' AND data ->> 'authorizesPublication' = 'true'`)).toBe(0);
  });
});

describe("com duas irmãs compiladas, Q4 e Q5 passam a ser avaliados", () => {
  it("Campinas e Santos compilam e a comparação de forma entre as três é feita (Q4 sem o nome do lugar)", async () => {
    const c = await compileRecipeAndRunQa(pool, id(), K, base, { opportunityId: (await opp("ibge:3509502")).id });
    const s = await compileRecipeAndRunQa(pool, id(), K, base, { opportunityId: (await opp("ibge:3548500")).id });
    expect(c.report.results.Q4.status).toBe("NOT_RUN"); // só 1 irmã (SP) antes dela
    expect(["PASS", "FAIL"]).toContain(s.report.results.Q4.status); // 2 irmãs: agora avalia
    const again = await compileRecipeAndRunQa(pool, id(), K, base, { opportunityId: sp.id });
    expect(["PASS", "FAIL"]).toContain(again.report.results.Q4.status);
    // as páginas são o MESMO modelo com outro lugar e outros valores: a forma do texto é praticamente idêntica
    expect(again.report.results.Q4.status).toBe("FAIL");
    expect(again.report.results.Q4.issues.join()).toMatch(/similaridade 1\.00 > 0\.8/);
    expect(again.report.outcome).toBe("QA_FAILED");
  });
});

describe("Agentes 7 e 8 (roteirizados): o código valida; o verificador só reprova mais, nunca aprova o que o código reprovou", () => {
  it("narrativa do Agente 7 com 'a pé' é rejeitada pelo código (R3) e a página mantém o texto determinístico; o verificador ausente deixa Q14 NOT_RUN", async () => {
    const o = await opp("ibge:3550308");
    const bad = JSON.stringify({ page_id: "x", slots: [] });
    const calls: ScriptedCall[] = [];
    const r = await compileRecipeAndRunQa(pool, id(), K, { ...base, agents: { ctx: actx([bad, bad, bad, JSON.stringify({ page_id: "x", checks: { Q1: { result: "PASS", issues: [] }, Q2: { result: "PASS", issues: [] }, Q8: { result: "PASS", issues: [] }, Q13: { result: "PASS", issues: [] }, Q14: { result: "PASS", issues: [], exclusive_value: ["x"] } }, summary: "" })], calls), budget: RunBudget.create(), editorialStyle: "direto" } }, { opportunityId: o.id });
    expect(r.narrative.state).toBe("failed");
    expect(r.recipe.narrativeSource).toBe("template");
    expect(r.verifier).toMatchObject({ attempted: true, state: "failed" }); // page_id do script difere: o código recusa a saída do verificador
    expect(r.report.results.Q14.status).toBe("NOT_RUN");
  });
  it("com narrativa e verificador válidos: nova versão do recipe (agent7), Q14 PASS por llm; um FAIL do verificador em Q2 reprova e é bloqueante", async () => {
    const o = await opp("ibge:3550308");
    // o recipe determinístico (versão 1, template) dá o page_id e os slots que o Agente 7 recebe (um por parágrafo)
    const tpl = (await as(K, (db) => listRecipes(db, o.id))).find((r) => r.narrativeSource === "template")!.recipe;
    const input = { page_id: tpl.pageId, narrative_slots: tpl.blocks.filter((b) => b.kind === "paragraph").map((b) => ({ slot_id: b.blockId, facts: b.refs.map((r) => ({ fact_id: r })) })) };
    const popRef = tpl.blocks.find((b) => b.blockId === "demografia:pop")!.refs[0]!;
    const narrative = JSON.stringify({ page_id: input.page_id, slots: input.narrative_slots.map((s) => (s.slot_id === "demografia:pop" ? { slot_id: s.slot_id, status: "OK", text: `São Paulo tem 11.911.337 habitantes [${popRef}].`, evidence_refs: [popRef] } : { slot_id: s.slot_id, status: "INSUFFICIENT", text: "", evidence_refs: [] })) });
    const verdict = (q2: "PASS" | "FAIL") => JSON.stringify({ page_id: input.page_id, checks: { Q1: { result: "PASS", issues: [] }, Q2: { result: q2, issues: q2 === "FAIL" ? [{ excerpt: "São Paulo tem 11.911.337", expected: "referência", found: "ausente" }] : [] }, Q8: { result: "PASS", issues: [] }, Q13: { result: "PASS", issues: [] }, Q14: { result: "PASS", issues: [], exclusive_value: ["população estimada e do Censo lado a lado"] } }, summary: "ok" });
    const ok = await compileRecipeAndRunQa(pool, id(), K, { ...base, agents: { ctx: actx([narrative, verdict("PASS")]), budget: RunBudget.create(), editorialStyle: "direto" } }, { opportunityId: o.id });
    expect(ok.narrative.state).toBe("ok");
    expect(ok.recipe).toMatchObject({ narrativeSource: "agent7" });
    expect(ok.recipe.recipe.blocks.find((b) => b.blockId === "demografia:pop")).toMatchObject({ source: "agent7", text: "São Paulo tem 11.911.337 habitantes." });
    expect(ok.report.results.Q14).toMatchObject({ status: "PASS", by: "llm" });
    expect(ok.report.results.Q2).toMatchObject({ status: "PASS", by: "both" });
    expect(ok.report.agentRunId).toMatch(/^[0-9a-f-]{36}$/);
    // o verificador reprova Q2 (conservador): vale, é bloqueante, e o QA falha
    const failed = await compileRecipeAndRunQa(pool, id(), K, { ...base, agents: { ctx: { ...actx([narrative, verdict("FAIL")]), env: { ANTHROPIC_API_KEY: "sk-ant-ficticia", PLATAFORMA_AGENT_MODEL: "claude-teste-b" } }, budget: RunBudget.create(), editorialStyle: "direto" } }, { opportunityId: o.id });
    expect(failed.report.results.Q2).toMatchObject({ status: "FAIL", by: "both" });
    expect(failed.report.blockingFailures).toContain("Q2");
    expect(failed.report.outcome).toBe("QA_FAILED");
  });
});

describe("auditoria, falhas e isolamento", () => {
  it("falhas e verificações incompletas viram evento 'blocker' com os Q reprovados e os não executados", async () => {
    const ev = await as(K, async (db) => (await db.query<{ reason: string; data: { failed: string[]; notRun: string[] } }>(`SELECT reason, data FROM plataforma.opportunity_event WHERE opportunity_id = $1 AND event_type = 'blocker' ORDER BY seq DESC LIMIT 1`, [sp.id])).rows[0]!);
    expect(ev.reason).toMatch(/^QA QA_(FAILED|INCOMPLETE)/);
    expect(Array.isArray(ev.data.failed)).toBe(true);
  });
  it("leitura: versões do recipe e relatórios em ordem, imutáveis e isolados por tenant", async () => {
    const recipes = await as(K, (db) => listRecipes(db, sp.id)); const reports = await as(K, (db) => listQaReports(db, sp.id));
    expect(recipes.length).toBeGreaterThanOrEqual(2); expect(recipes[0]!.version).toBeGreaterThan(recipes[1]!.version);
    expect(reports.length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(reports[0]!.results)).toEqual(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13", "Q14"]);
    await expect(as(K, (db) => db.query(`UPDATE plataforma.qa_report SET outcome = 'QA_PASSED'`))).rejects.toThrow(/permission denied/);
    await expect(as(K, (db) => db.query(`DELETE FROM plataforma.page_recipe`))).rejects.toThrow(/permission denied/);
    expect(await count(L, "page_recipe")).toBe(0);
    expect(await count(L, "qa_report")).toBe(0);
  });
  it("o banco recusa desfecho fora da lista e recipe agent7 sem execução de agente", async () => {
    await expect(as(K, (db) => db.query(`INSERT INTO plataforma.qa_report (tenant_id, opportunity_id, recipe_id, reference_time, results, outcome, created_by) SELECT tenant_id, opportunity_id, recipe_id, reference_time, results, 'APROVADO', 't' FROM plataforma.qa_report LIMIT 1`))).rejects.toThrow(/check constraint/);
    await expect(as(K, (db) => db.query(`INSERT INTO plataforma.page_recipe (tenant_id, opportunity_id, spec_blueprint_id, version, narrative_source, content, content_hash, created_by) SELECT tenant_id, opportunity_id, spec_blueprint_id, 99, 'agent7', content, repeat('c', 64), 't' FROM plataforma.page_recipe LIMIT 1`))).rejects.toThrow(/check constraint/);
  });
});
