import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEMPLATE_REGISTRY, TenantDb, devIdentity, runCityImport, withTenant } from "../index";
import { productPoolConfig } from "../testing/pool-config";
import { realEstateCatalog, realEstateFactConfidence } from "../../../../packs/real-estate/src/attributes";
import { realEstateTopicPatterns } from "../../../../packs/real-estate/src/topic-patterns";
import { realEstateVertical } from "../../../../packs/real-estate/src/vertical";
import { DEFAULT_ELIGIBILITY_POLICY } from "../../../../packs/real-estate/src/eligibility";
import { RECIPES } from "../../../../packs/real-estate/src/blueprint-recipes";
import { AGENT_HEADER, AGENT_PROMPTS, AGENT_PROMPTS_SOURCE, AGENT_PROMPT_VERSION } from "../../../../packs/real-estate/src/agent-prompts.generated";
import { materializeCities, recordSidraFacts } from "../catalog";
import { runTopicGeneration } from "../topics";
import { runEvaluation } from "../eligibility";
import { PUBLIC_UA, RateGate, RunBudget } from "../provider";
import { scriptedLlm, type ScriptedCall } from "../agents/test-support";
import type { AgentCtx } from "../agents";
import { SpecBlueprintPreconditionError, createSpecBlueprint, listSpecBlueprints, refineWithAgent6, structuralHash, type SpecBlueprintDeps } from "./index";

// Blueprint da especificação contra o esquema REAL (migrations 1 a 17), com dados REAIS de SP. A demanda e a resposta do Agente 6 são SINAIS/ROTEIROS DE TESTE (identificados); nenhum é dado real.
const I = "fe111111-1111-4111-8111-111111111111";
const J = "fe222222-2222-4222-8222-222222222222";
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv", import.meta.url));
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };
const T0 = new Date("2026-10-14T12:00:00Z");
const deps: SpecBlueprintDeps = { vertical: realEstateVertical, recipes: RECIPES, templates: TEMPLATE_REGISTRY, attributes: realEstateCatalog.attributes, now: () => T0 };
const PROMPTS = { version: AGENT_PROMPT_VERSION, sourceSha256: AGENT_PROMPTS_SOURCE.sha256, header: AGENT_HEADER, agents: Object.fromEntries(Object.entries(AGENT_PROMPTS).map(([k, v]) => [k, { name: v.name, body: v.body }])) };
const actx = (script: Parameters<typeof scriptedLlm>[0], env: Record<string, string | undefined> = { ANTHROPIC_API_KEY: "sk-ant-ficticia" }, calls: ScriptedCall[] = []): AgentCtx => ({ fetch: scriptedLlm(script, calls), userAgent: PUBLIC_UA, gate: new RateGate({}), env, prompts: PROMPTS, vars: { TENANT_NAME: "T", DOMAIN_PACK: "real-estate", SCORE_BRAND: "Índice", EDITORIAL_STYLE: "direto", RICH_MIN: "0.8", MAX_PROPOSALS: "5", SCOPE: "SP" } });
let pool: pg.Pool;
const id = () => devIdentity([I, J]);
const as = <X>(t: string, fn: (db: TenantDb) => Promise<X>) => withTenant(pool, id(), t, fn);
const count = (t: string, table: string, where = "true") => as(t, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.${table} WHERE ${where}`)).rows[0]!.n));
const opp = (key: string) => as(I, async (db) => (await db.query<{ id: string; status: string }>(`SELECT o.id, o.status FROM plataforma.growth_opportunity o JOIN plataforma.entity e ON e.id = o.primary_entity_id WHERE e.source_key = $1 AND o.pattern_key = 'topic-city-overview'`, [key])).rows[0]!);
const evalAll = () => runEvaluation(pool, id(), I, { verticalId: realEstateVertical.id, attributes: realEstateCatalog.attributes, defaultPolicy: DEFAULT_ELIGIBILITY_POLICY, now: () => T0 });

beforeAll(async () => {
  pool = new pg.Pool(productPoolConfig(4)); pool.on("error", () => undefined);
  await runCityImport(pool, id(), I, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: MAPPING });
  await as(I, (db) => materializeCities(db, realEstateFactConfidence, T0));
  const prov = { provider: "ibge-sidra", endpoint: "values/t/4714/n6/x/v/93,614/p/last", params: {}, collectedAt: T0, costUsd: 0, cacheKey: "a".repeat(64), cached: false, callId: null };
  // SP: resposta REAL do SIDRA (fixture); Campinas: CONSTRUÍDA, só para este teste (dá a variação que o gate de unicidade exige)
  await as(I, (db) => recordSidraFacts(db, [{ facts: { ibgeCode: "3550308", name: "São Paulo (SP)", year: 2022, population: 11451999, densityPerKm2: 7528.26 }, provenance: prov }, { facts: { ibgeCode: "3509502", name: "Campinas (SP)", year: 2022, population: 1139047, densityPerKm2: 1433.5 }, provenance: prov }], realEstateFactConfidence, T0));
  await runTopicGeneration(pool, id(), I, { vertical: realEstateVertical, catalog: realEstateCatalog, patterns: realEstateTopicPatterns, now: () => T0 });
  await evalAll();
});
afterAll(async () => { await pool.end(); });

describe("precondições: só READY_FOR_BLUEPRINT", () => {
  it("sem demanda o tópico é RESEARCH_REQUIRED e o blueprint é recusado com os motivos", async () => {
    const sp = await opp("ibge:3550308");
    expect(sp.status).toBe("scored");
    const e = await createSpecBlueprint(pool, id(), I, deps, { opportunityId: sp.id }).catch((x) => x);
    expect(e).toBeInstanceOf(SpecBlueprintPreconditionError);
    expect(e.reasons.join(" ")).toMatch(/READY_FOR_BLUEPRINT/);
    expect(await count(I, "spec_blueprint")).toBe(0);
  });
  it("identificador inválido e oportunidade de outro tenant são recusados", async () => {
    await expect(createSpecBlueprint(pool, id(), I, deps, { opportunityId: "x" })).rejects.toBeInstanceOf(SpecBlueprintPreconditionError);
    const sp = await opp("ibge:3550308");
    await expect(createSpecBlueprint(pool, id(), J, deps, { opportunityId: sp.id })).rejects.toBeInstanceOf(SpecBlueprintPreconditionError);
  });
});

describe("com demanda de TESTE o tópico vira READY e o blueprint nasce válido", () => {
  let sp: { id: string; status: string }; let first: Awaited<ReturnType<typeof createSpecBlueprint>>;
  it("READY → blueprint COMPLETE (campos semânticos por código), módulos RICH, URL do template, noindex, 14 gates; também cria o blueprint do motor existente", async () => {
    await as(I, (db) => db.query(`UPDATE plataforma.growth_opportunity o SET demand_signal = '{"value": 10000, "source": "sinal de teste", "period": "12m", "method": "estimativa", "uncertainty": "±30%"}'::jsonb FROM plataforma.entity e WHERE e.id = o.primary_entity_id AND e.source_key = 'ibge:3550308' AND o.pattern_key = 'topic-city-overview'`));
    expect((await evalAll()).result!.byDecision.READY_FOR_BLUEPRINT).toBe(1);
    sp = await opp("ibge:3550308"); expect(sp.status).toBe("eligible");
    first = await createSpecBlueprint(pool, id(), I, deps, { opportunityId: sp.id });
    expect(first.created).toBe(true);
    const b = first.record.blueprint;
    expect(first.record).toMatchObject({ version: 1, status: "COMPLETE", semanticSource: "code", templateId: "city-overview", templateGap: false, agentRunId: null });
    expect(b).toMatchObject({ page_family: "04-cidade", page_archetype: "hub", url: "/cidades/sp/sao-paulo", indexability_policy: "noindex", canonical_policy: "self", primary_entity: "ibge:3550308" });
    expect(b.data_contract.map((m) => [m.module_id, m.status])).toEqual([["identificacao", "RICH"], ["demografia", "RICH"]]);
    expect(b.unique_fields_per_instance).toEqual(["population", "census_population", "census_density"]);
    expect(b.search_intent.demand_signal).toEqual({ value: 10000, source: "sinal de teste" });
    expect(b.quality_gates).toHaveLength(14);
    expect(b.internal_link_plan.siblings.length).toBeGreaterThan(0);
    expect(b.evidence_requirements).toEqual([{ claim_type: "população", source_class: "IBGE", max_age_days: 800 }, { claim_type: "população do Censo", source_class: "IBGE SIDRA", max_age_days: null }]);
    expect(first.legacy).toMatchObject({ attempted: true, template: "city-overview" });
    expect(await count(I, "page_blueprint", `opportunity_id = '${sp.id}'`)).toBe(1);
    expect((await opp("ibge:3550308")).status).toBe("eligible"); // não avança sem SERP/exceção (ADR-025)
  });
  it("é idempotente e imutável: a mesma entrada não cria versão; o evento 'blueprint' fica registrado", async () => {
    const again = await createSpecBlueprint(pool, id(), I, deps, { opportunityId: sp.id });
    expect(again.created).toBe(false);
    expect(again.record.id).toBe(first.record.id);
    expect(await count(I, "spec_blueprint")).toBe(1);
    expect(await count(I, "opportunity_event", `opportunity_id = '${sp.id}' AND event_type = 'blueprint'`)).toBeGreaterThanOrEqual(1);
    await expect(as(I, (db) => db.query(`UPDATE plataforma.spec_blueprint SET status = 'COMPLETE'`))).rejects.toThrow(/permission denied/);
    await expect(as(I, (db) => db.query(`DELETE FROM plataforma.spec_blueprint`))).rejects.toThrow(/permission denied/);
  });
  it("trocar o template (receita) NÃO altera o blueprint estrutural", async () => {
    const other = await createSpecBlueprint(pool, id(), I, { ...deps, recipes: RECIPES.map((r) => (r.family === "04-cidade" ? { ...r, templateId: "outro-template", moduleRequirements: ["x"] } : r)) }, { opportunityId: sp.id });
    expect(other.created).toBe(true);
    expect(other.record.templateGap).toBe(true); // o template novo não existe no registro: template_gap, sem improvisar
    const strip = (x: typeof first.record.blueprint) => { const { template_id: _t, module_requirements: _m, ...r } = x; void _t; void _m; return r; };
    expect(strip(other.record.blueprint)).toEqual(strip(first.record.blueprint));
    expect(other.record.structuralHash).toBe(first.record.structuralHash);
    expect(structuralHash(other.record.blueprint)).toBe(structuralHash(first.record.blueprint));
    expect(other.record.contentHash).not.toBe(first.record.contentHash);
  });
});

describe("Agente 6 (roteirizado): refina os campos semânticos; o código valida", () => {
  let sp: { id: string };
  const sample = { city_name: "São Paulo", population: "11.451.999", uf: "SP", region: "Sudeste", census_population: "11.451.999", census_density: "7.528" };
  const fields = (o: Record<string, unknown>) => JSON.stringify({ page_id: "", fields: o, notes: "" });
  beforeAll(async () => { sp = await opp("ibge:3550308"); });
  it("sem ANTHROPIC_API_KEY: provider_not_configured e nenhuma versão nova", async () => {
    const before = await count(I, "spec_blueprint");
    const r = await refineWithAgent6(actx([], {}), pool, id(), I, { opportunityId: sp.id, sampleValues: sample, budget: RunBudget.create() });
    expect(r).toMatchObject({ state: "provider_not_configured", missing: ["ANTHROPIC_API_KEY"] });
    expect(await count(I, "spec_blueprint")).toBe(before);
  });
  it("saída válida gera uma versão nova com origem agent6 ligada à execução auditada", async () => {
    const pid = (await as(I, (db) => listSpecBlueprints(db, sp.id)))[0]!.blueprint.page_id;
    const calls: ScriptedCall[] = [];
    const out = JSON.stringify({ page_id: pid, fields: { topic_definition: "Qual o tamanho de São Paulo e como se compara no estado, para quem avalia onde morar.", title_pattern: "{city_name}: população e dados", meta_description_pattern: "Dados verificáveis de {city_name}: população do Censo 2022 e densidade.", "internal_link_plan.anchor_texts": ["dados de São Paulo", "ver município"] }, notes: "" });
    const r = await refineWithAgent6(actx([out], undefined, calls), pool, id(), I, { opportunityId: sp.id, sampleValues: sample, budget: RunBudget.create() });
    expect(r.state).toBe("ok");
    expect(r.record).toMatchObject({ semanticSource: "agent6", status: "COMPLETE" });
    expect(r.record!.agentRunId).toBe(r.agentRunId);
    expect(r.record!.blueprint.internal_link_plan.anchor_texts).toEqual(["dados de São Paulo", "ver município"]);
    expect(r.record!.blueprint.url).toBe("/cidades/sp/sao-paulo"); // campos estruturais intactos
    expect(calls[0]!.body.messages[0]!.content).toContain("Complete os campos marcados"); // o prompt do Agente 6 com o rascunho do blueprint como entrada
    expect(calls[0]!.body.messages[0]!.content).toContain(pid);
    const run = await as(I, async (db) => (await db.query<{ agent: number; status: string }>(`SELECT agent, status FROM plataforma.agent_run WHERE id = $1`, [r.agentRunId])).rows[0]!);
    expect(run).toMatchObject({ agent: 6, status: "succeeded" });
  });
  it("INSUFFICIENT: o tópico volta a DATA_REQUIRED (eligible → scored), com o motivo auditado e nenhum blueprint 'completo'", async () => {
    const pid = (await as(I, (db) => listSpecBlueprints(db, sp.id)))[0]!.blueprint.page_id;
    const r = await refineWithAgent6(actx([JSON.stringify({ page_id: pid, fields: { differentiation_strategy: "INSUFFICIENT" }, notes: "sem blocos concretos" })]), pool, id(), I, { opportunityId: sp.id, sampleValues: sample, budget: RunBudget.create() });
    expect(r.state).toBe("insufficient");
    expect(r.record).toMatchObject({ status: "SEMANTIC_INSUFFICIENT", semanticSource: "agent6" });
    const o = await opp("ibge:3550308");
    expect(o.status).toBe("scored");
    const ev = await as(I, async (db) => (await db.query<{ from_status: string; to_status: string; data: { mapped?: string } }>(`SELECT from_status, to_status, data FROM plataforma.opportunity_event WHERE opportunity_id = $1 AND event_type = 'transition' ORDER BY seq DESC LIMIT 1`, [sp.id])).rows[0]!);
    expect(ev).toMatchObject({ from_status: "eligible", to_status: "scored", data: { mapped: "DATA_REQUIRED" } });
  });
  it("saída com campo não pedido é rejeitada pelo código e, esgotadas as tentativas, a falha é explícita (nenhuma versão nova)", async () => {
    const before = await count(I, "spec_blueprint");
    const pid = (await as(I, (db) => listSpecBlueprints(db, sp.id)))[0]!.blueprint.page_id;
    const bad = JSON.stringify({ page_id: pid, fields: { url: "/hack" }, notes: "" });
    const r = await refineWithAgent6(actx([bad, bad, bad]), pool, id(), I, { opportunityId: sp.id, sampleValues: sample, budget: RunBudget.create() });
    expect(r.state).toBe("failed");
    expect(r.errors).toHaveLength(3);
    expect(await count(I, "spec_blueprint")).toBe(before);
  });
});

describe("o blueprint só nasce enquanto o tópico está em 'eligible'", () => {
  it("READY na decisão mas estado já avançado ('blueprinted'): recusado, citando o estado", async () => {
    await as(I, (db) => db.query(`UPDATE plataforma.growth_opportunity o SET demand_signal = '{"value": 8000, "source": "sinal de teste"}'::jsonb FROM plataforma.entity e WHERE e.id = o.primary_entity_id AND e.source_key = 'ibge:3509502' AND o.pattern_key = 'topic-city-overview'`));
    expect((await evalAll()).result!.byDecision.READY_FOR_BLUEPRINT).toBeGreaterThanOrEqual(1);
    const c = await opp("ibge:3509502"); expect(c.status).toBe("eligible");
    await as(I, (db) => db.query(`UPDATE plataforma.growth_opportunity SET status = 'blueprinted' WHERE id = $1`, [c.id]));
    const e = await createSpecBlueprint(pool, id(), I, deps, { opportunityId: c.id }).catch((x) => x);
    expect(e).toBeInstanceOf(SpecBlueprintPreconditionError);
    expect(e.reasons.join(" ")).toMatch(/“blueprinted”/);
  });
});

describe("isolamento", () => {
  it("o outro tenant não vê blueprints", async () => { expect(await count(J, "spec_blueprint")).toBe(0); });
});
