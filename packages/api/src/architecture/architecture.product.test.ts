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
import { realEstateArchitecture } from "../../../../packs/real-estate/src/architecture";
import { AGENT_HEADER, AGENT_PROMPTS, AGENT_PROMPTS_SOURCE, AGENT_PROMPT_VERSION } from "../../../../packs/real-estate/src/agent-prompts.generated";
import { materializeCities, recordSidraFacts } from "../catalog";
import { runTopicGeneration } from "../topics";
import { runEvaluation } from "../eligibility";
import { createSpecBlueprint } from "../blueprint-spec";
import { PUBLIC_UA, RateGate, RunBudget } from "../provider";
import type { AgentCtx } from "../agents";
import type { FetchLike } from "../engine/http";
import type { FamilyRenderer } from "../recipe";
import { routedLlm, A5, A7, A8 } from "../runtime/test-llm";
import { listDecisionAudit, runPagePipeline, type PipelineEnv } from "../runtime";
import { compileRecipeAndRunQa } from "../qa";
import { createDeployment, decidePages, factoryMetrics, listPages, pipelineStages, STAGE_IDS } from "../factory";
import { DEFAULT_LINK_POLICY, ArchitectureError, analyzeArchitecture, getLinkPolicy, getStoredArchitecture, latestIndexationObservation, listClusters, recordIndexationObservation, setArchetypeProfiles, setLinkPolicy, type ArchitecturePack, type ArchitectureDeps } from "./index";

// Arquitetura de conteúdo contra o esquema REAL (migrations 1–21), dados REAIS de SP (SIDRA gravado). LLM ROTEIRIZADO (test_simulation); Campinas, Santos e Guarulhos usam respostas CONSTRUÍDAS e demanda é SINAL DE TESTE.
// O renderer de teste acrescenta links ENTRE as 4 cidades (o do pack só aponta para hubs que ainda não existem), para exercitar o grafo. Tenants Q (fe9) e R (fea).
const Q = "fe999999-9999-4999-8999-999999999999";
const R = "fea11111-1111-4111-8111-111111111111";
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv", import.meta.url));
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };
const T0 = new Date("2026-10-14T12:00:00Z");
const PROMPTS = { version: AGENT_PROMPT_VERSION, sourceSha256: AGENT_PROMPTS_SOURCE.sha256, header: AGENT_HEADER, agents: Object.fromEntries(Object.entries(AGENT_PROMPTS).map(([k, v]) => [k, { name: v.name, body: v.body }])) };
const VARS = { TENANT_NAME: "Tenant Q", DOMAIN_PACK: "real-estate", SCORE_BRAND: "Índice", EDITORIAL_STYLE: "direto", RICH_MIN: "0.8", MAX_PROPOSALS: "5", SCOPE: "SP" };
const TEST_QA = { ...DEFAULT_QA_POLICY, maxSiblingSimilarity: 1, minVariableShare: 0, minSiblingsForComparison: 0 };
const CITIES = [["ibge:3550308", "3550308", "São Paulo", 11451999, 7528.26, "/cidades/sp/sao-paulo"], ["ibge:3509502", "3509502", "Campinas", 1139047, 1433.5, "/cidades/sp/campinas"], ["ibge:3548500", "3548500", "Santos", 418608, 1494.3, "/cidades/sp/santos"], ["ibge:3518800", "3518800", "Guarulhos", 1291771, 4053.57, "/cidades/sp/guarulhos"]] as const;
const URLS = CITIES.map((c) => c[5]);
const cityR = RENDERERS.find((r) => r.family === "04-cidade")!;
const augmented: FamilyRenderer = { ...cityR, render: (i) => { const o = cityR.render(i); if ("error" in o) return o; const own = i.blueprint.url; return { ...o, links: [...o.links, ...URLS.filter((u) => u !== own).map((u) => ({ path: u, text: `Veja ${u.split("/").pop()}` }))] }; } };
const RENDS = RENDERERS.map((r) => (r.family === "04-cidade" ? augmented : r));
const bpDeps = { vertical: realEstateVertical, recipes: RECIPES, templates: TEMPLATE_REGISTRY, attributes: realEstateCatalog.attributes, now: () => T0 };
const eligDeps = { verticalId: realEstateVertical.id, attributes: realEstateCatalog.attributes, defaultPolicy: DEFAULT_ELIGIBILITY_POLICY, now: () => T0 };
const arch: ArchitectureDeps = { pack: realEstateArchitecture, templates: TEMPLATE_REGISTRY, now: () => T0 };
const badPack: ArchitecturePack = { ...realEstateArchitecture, adapt: (i) => { const r = realEstateArchitecture.adapt(i); return "error" in r ? r : { ...r, data: { ...r.data, overviewSynthesis: "curto" } }; } };
const llm = routedLlm({ 5: A5, 7: A7, 8: A8() });
const baseCtx = (f: FetchLike): AgentCtx => ({ fetch: f, userAgent: PUBLIC_UA, gate: new RateGate({}), env: { ANTHROPIC_API_KEY: "sk-ant-ficticia" }, prompts: PROMPTS, vars: VARS });
let pool: pg.Pool;
const id = () => devIdentity([Q, R]);
const as = <X>(t: string, fn: (db: TenantDb) => Promise<X>) => withTenant(pool, id(), t, fn);
const oppOf = (key: string) => as(Q, async (db) => (await db.query<{ id: string }>(`SELECT o.id FROM plataforma.growth_opportunity o JOIN plataforma.entity e ON e.id = o.primary_entity_id WHERE e.source_key = $1 AND o.pattern_key = 'topic-city-overview'`, [key])).rows[0]!.id);
const penv = (over: Partial<PipelineEnv> = {}): PipelineEnv => ({ pool, identity: id(), tenantId: Q, tenantName: "Tenant Q", mode: "test_simulation", domainPack: { id: "real-estate", version: "0.1.0" }, agents: { ctx: baseCtx(llm), budget: RunBudget.create(), editorialStyle: "direto" }, eligibility: eligDeps, blueprint: bpDeps,
  recipeQa: { vertical: realEstateVertical, recipes: RECIPES, renderers: RENDS, qaPolicy: TEST_QA, attributes: realEstateCatalog.attributes, now: () => T0 }, now: () => T0, sleep: async () => undefined, ...over });
let ids: string[] = [];

beforeAll(async () => {
  pool = new pg.Pool(productPoolConfig(6)); pool.on("error", () => undefined);
  await runCityImport(pool, id(), Q, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: MAPPING });
  await as(Q, (db) => materializeCities(db, realEstateFactConfidence, T0));
  const prov = { provider: "ibge-sidra", endpoint: "values/t/4714/n6/x/v/93,614/p/last", params: {}, collectedAt: T0, costUsd: 0, cacheKey: "a".repeat(64), cached: false, callId: null };
  await as(Q, (db) => recordSidraFacts(db, CITIES.map((c) => ({ facts: { ibgeCode: c[1], name: `${c[2]} (SP)`, year: 2022, population: c[3], densityPerKm2: c[4] }, provenance: prov })), realEstateFactConfidence, T0));
  await runTopicGeneration(pool, id(), Q, { vertical: realEstateVertical, catalog: realEstateCatalog, patterns: realEstateTopicPatterns, now: () => T0 });
  for (const c of CITIES) await as(Q, (db) => db.query(`UPDATE plataforma.growth_opportunity o SET demand_signal = '{"value": 10000, "source": "sinal de teste"}'::jsonb FROM plataforma.entity e WHERE e.id = o.primary_entity_id AND e.source_key = $1 AND o.pattern_key = 'topic-city-overview'`, [c[0]]));
  await runEvaluation(pool, id(), Q, eligDeps);
  ids = await Promise.all(CITIES.map((c) => oppOf(c[0])));
  for (const o of ids) { await createSpecBlueprint(pool, id(), Q, bpDeps, { opportunityId: o }); await applySerpWaiver(pool, id(), Q, { opportunityId: o, reason: "Exceção de SERP de teste: não há provedor de SERP; nada é publicado." }); }
  for (const o of ids) { const r = await runPagePipeline(penv(), { opportunityId: o, correlationId: `arch-${o}` }); expect(r.steps.find((s) => s.stepKey === "recipe_qa")!.status).toBe("SUCCEEDED"); }
  // o compile só mantém links para páginas que JÁ existem: numa segunda passada (todas existem) cada recipe passa a linkar as outras três
  const second = { ...penv().recipeQa, agents: { ctx: { ...baseCtx(llm), runtime: { tenantId: Q, tenantName: "Tenant Q", domainPackId: "real-estate", domainPackVersion: "0.1.0" } }, budget: RunBudget.create(), editorialStyle: "direto" } };
  for (const o of ids) await compileRecipeAndRunQa(pool, id(), Q, second, { opportunityId: o });
});
afterAll(async () => { await pool.end(); });

describe("análise de arquitetura sobre páginas reais", () => {
  let first: Awaited<ReturnType<typeof analyzeArchitecture>>;
  it("os recipes reais mapeiam para T03; o cluster é por UF; o grafo tem as 12 arestas reais dos recipes (cada cidade linka as outras três); links para destinos inexistentes já são descartados na compilação do recipe", async () => {
    first = await analyzeArchitecture(pool, id(), Q, arch);
    expect(first.analyses).toHaveLength(4); expect(first.skipped).toEqual([]); expect(first.conflicts).toBe(0);
    expect(first.graph).toMatchObject({ nodes: 4, edges: 16, valid: 12, invalid: 4, byReason: { DESTINATION_MISSING: 4 } }); // 12 entre as cidades + 4 para /cidades (o compile trata /cidades como conhecido, mas não é uma página)
    for (const a of first.analyses) { expect(a).toMatchObject({ archetypeId: "T03", contractVersion: "1.0.0", clusterKey: "T03|real-estate|uf:SP" }); expect(a.inlinks).toMatchObject({ valid: 3, required: 3, passed: true }); expect(a.outlinks.valid).toHaveLength(3); expect(a.outlinks.invalid.map((e) => [e.toPath, e.invalidReason])).toEqual([["/cidades", "DESTINATION_MISSING"]]); }
  });
  it("T03 com dados REAIS: o que existe passa (fatos com fonte e data); amenidades, estações e FAQs NÃO são inventados, então a densidade é baixa e a INDEXAÇÃO fica retida; aprovação liberada", async () => {
    const a = first.analyses[0]!; const v = a.validation;
    expect(v).toMatchObject({ isValidForGeneration: true, isValidForIndexing: false, status: "DATA_PENDING" }); expect(v.score).toBe(0.3); expect(v.density!.signals.map((s) => [s.id, s.ok])).toEqual([["amenities_5", false], ["synthesis_100", true], ["station_1", false], ["faqs_2", false]]);
    expect(v.missingData).toEqual(expect.arrayContaining(["location.coordinates", "density:amenities_5", "density:station_1", "density:faqs_2"])); expect(v.evidence.length).toBeGreaterThan(0); expect(v.issues.find((i) => i.layer === "provenance")).toBeUndefined(); // métricas reais têm fonte e data
    expect(a.gate.eligibility).toEqual({ approval: true, publication: false, indexing: false });
    expect(a.gate.blockedBy.indexing).toEqual(expect.arrayContaining(["contract.indexing", "contract.density", "schema.hierarchy", "approval.human", "policy.index"])); expect(a.gate.blockedBy.indexing).not.toContain("INSUFFICIENT_CONTEXTUAL_INLINKS");
    expect(a.gate.nextActions.length).toBeGreaterThan(2);
  });
  it("o JSON-LD do recipe é validado contra o contrato (City aceito como AdministrativeArea) e o gerado a partir dos dados é determinístico", async () => {
    const a = first.analyses[0]!; expect(a.jsonLdValidation).toMatchObject({ valid: false }); expect(a.jsonLdValidation!.issues.map((i) => i.rule)).toEqual(["jsonld.breadcrumb_without_hierarchy"]); expect(a.generatedJsonLd.map((n) => n["@type"])).toEqual(["AdministrativeArea", "Place"]);
    const again = await analyzeArchitecture(pool, id(), Q, arch, { opportunityIds: [a.opportunityId] }); expect(again.analyses[0]!.generatedJsonLd).toEqual(a.generatedJsonLd);
  });
  it("é idempotente: reexecutar não cria grafo, arquitetura nem resultado; o estado persistido tem cluster, intenção e contexto dos links", async () => {
    const again = await analyzeArchitecture(pool, id(), Q, arch); expect(again).toMatchObject({ graphCreated: false, created: 0, unchanged: 4, graphId: first.graphId });
    const counts = await as(Q, async (db) => Object.fromEntries(await Promise.all(["link_graph", "page_architecture", "quality_gate_result", "topic_cluster"].map(async (t) => [t, Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.${t}`)).rows[0]!.n)])))); expect(counts).toEqual({ link_graph: 1, page_architecture: 4, quality_gate_result: 4, topic_cluster: 1 });
    const st = (await as(Q, (db) => getStoredArchitecture(db, ids[0]!)))!; expect(st.architecture).toMatchObject({ archetypeId: "T03", clusterName: "Cidades de SP", domain: "real-estate", locale: "pt-BR", market: "BR", canonicalRule: "self", primaryIntent: "informational visão geral do município" });
    expect(st.gate!.eligibility).toEqual({ approval: true, publication: false, indexing: false }); expect(st.inlinks.filter((e) => e.state === "VALID")).toHaveLength(3); expect(st.inlinks.every((e) => e.reason.startsWith("Veja"))).toBe(true); expect(st.outlinks.filter((e) => e.state === "VALID")).toHaveLength(3); expect(st.outlinks.filter((e) => e.state === "VALID").every((e) => e.relation === "sibling" && e.otherUrl !== null)).toBe(true); expect(st.outlinks.filter((e) => e.state === "INVALID").map((e) => [e.toPath, e.invalidReason])).toEqual([["/cidades", "DESTINATION_MISSING"]]);
  });
  it("os clusters mostram cobertura REAL: 4 páginas, 4 aprováveis, 0 indexáveis, sem inlinks insuficientes nem conflitos", async () => {
    expect(await as(Q, (db) => listClusters(db))).toEqual([expect.objectContaining({ name: "Cidades de SP", archetypeId: "T03", pages: 4, eligibleApproval: 4, eligibleIndexing: 0, insufficientInlinks: 0, withConflicts: 0, avgQuality: 0.3 })]);
  });
});

describe("política de inlinks: mínimo por tenant, exceção explícita e auditoria", () => {
  it("política inválida e alteração sem motivo são recusadas", async () => {
    await expect(setLinkPolicy(pool, id(), Q, { ...DEFAULT_LINK_POLICY, minInlinks: 0 }, "motivo válido")).rejects.toThrow(/minInlinks/); await expect(setLinkPolicy(pool, id(), Q, { ...DEFAULT_LINK_POLICY, minInlinks: 4 }, "x")).rejects.toThrow(/motivo/);
    await expect(setLinkPolicy(pool, id(), Q, { ...DEFAULT_LINK_POLICY, exceptions: [{ scope: {}, waivedMinInlinks: 0, reason: "curto", approvedBy: "", approvedAt: "2026-10-01" }] }, "motivo válido")).rejects.toBeInstanceOf(ArchitectureError);
  });
  it("mínimo 4 retém as 4 páginas por INSUFFICIENT_CONTEXTUAL_INLINKS com o que falta e sugestões; fica na auditoria e é por tenant", async () => {
    const v = await setLinkPolicy(pool, id(), Q, { ...DEFAULT_LINK_POLICY, minInlinks: 4 }, "exigir 4 inlinks neste teste"); expect(v).toMatchObject({ version: 2, created: true }); expect((await setLinkPolicy(pool, id(), Q, { ...DEFAULT_LINK_POLICY, minInlinks: 4 }, "mesmo conteúdo")).created).toBe(false);
    const r = await analyzeArchitecture(pool, id(), Q, arch); expect(r.graphCreated).toBe(true); expect(r.created).toBe(4);
    for (const a of r.analyses) { expect(a.inlinks).toMatchObject({ required: 4, valid: 3, missing: 1, passed: false, ruleId: "INSUFFICIENT_CONTEXTUAL_INLINKS" }); expect(a.gate.blockedBy.indexing).toContain("INSUFFICIENT_CONTEXTUAL_INLINKS"); expect(a.gate.linkProblems[0]).toMatchObject({ rule: "INSUFFICIENT_CONTEXTUAL_INLINKS", detail: { required: 4, valid: 3, missing: 1 } }); }
    expect((await as(Q, (db) => listPages(db, { linkFailure: true }))).total).toBe(4);
    expect((await as(Q, (db) => listDecisionAudit(db, { subjectKind: "link_policy" }))).map((a) => [a.decision, a.reason])).toEqual([["LINK_POLICY_CHANGED", "exigir 4 inlinks neste teste"]]);
    expect((await as(R, (db) => getLinkPolicy(db))).policy.minInlinks).toBe(3); // outro tenant segue o padrão
  });
  it("exceção EXPLÍCITA (escopo, justificativa, responsável) libera só a página do escopo e fica registrada no resultado; hub raiz não tem bypass implícito", async () => {
    const ex = { scope: { opportunityId: ids[0]! }, waivedMinInlinks: 3, reason: "Página piloto com 3 inlinks aceitos na revisão", approvedBy: "ana", approvedAt: "2026-10-14T00:00:00Z" };
    await setLinkPolicy(pool, id(), Q, { ...DEFAULT_LINK_POLICY, minInlinks: 4, exceptions: [ex] }, "exceção do piloto aprovada por Ana");
    const r = await analyzeArchitecture(pool, id(), Q, arch); const by = Object.fromEntries(r.analyses.map((a) => [a.opportunityId, a])); expect(by[ids[0]!]!.inlinks).toMatchObject({ passed: true, required: 3, exception: ex }); for (const o of ids.slice(1)) expect(by[o]!.inlinks.passed).toBe(false);
    await setLinkPolicy(pool, id(), Q, DEFAULT_LINK_POLICY, "voltar ao padrão de 3 inlinks"); expect((await as(Q, (db) => getLinkPolicy(db))).policy.minInlinks).toBe(3);
    expect((await analyzeArchitecture(pool, id(), Q, arch)).analyses.every((a) => a.inlinks.passed)).toBe(true);
  });
  it("perfis de densidade por archetype: versionados e validados (pesos somam 1); o perfil do tenant muda a pontuação e fica registrado", async () => {
    await expect(setArchetypeProfiles(pool, id(), Q, { T03: { version: "t1", weights: { amenities_5: 0.9 } } }, "perfil inválido")).rejects.toThrow(/somam/); await expect(setArchetypeProfiles(pool, id(), Q, { T03: { version: "t1", indexingThreshold: 0.2, weights: { nada: 0.1 } } }, "perfil inválido")).rejects.toThrow(/desconhecido/);
    await setArchetypeProfiles(pool, id(), Q, { T03: { version: "t1", indexingThreshold: 0.25 } }, "limiar menor só neste teste");
    const r = await analyzeArchitecture(pool, id(), Q, arch); expect(r.analyses[0]!.validation).toMatchObject({ score: 0.3, density: expect.objectContaining({ version: "t1", threshold: 0.25 }) }); expect(r.analyses[0]!.gate.blockedBy.indexing).not.toContain("contract.density");
    await setArchetypeProfiles(pool, id(), Q, {}, "remover o perfil do teste");
  });
});

describe("integração com aprovação, publicação, pipeline e listas", () => {
  it("aprovar com o gate de arquitetura: página elegível passa; dado fora do schema do archetype recusa com a regra; sem o gate o comportamento anterior continua", async () => {
    const badArch: ArchitectureDeps = { ...arch, pack: badPack };
    expect((await decidePages(pool, id(), Q, { opportunityIds: [ids[0]!], decision: "APPROVED", reason: "teste do gate" }, { architecture: badArch }))[0]).toMatchObject({ ok: false, message: expect.stringContaining("contract.schema") });
    expect((await decidePages(pool, id(), Q, { opportunityIds: ids.slice(0, 3), decision: "APPROVED", reason: "aprovação de teste" }, { architecture: arch })).map((x) => x.ok)).toEqual([true, true, true]);
    expect((await decidePages(pool, id(), Q, { opportunityIds: [ids[3]!], decision: "APPROVED", reason: "sem o gate (compatível)" }))[0].ok).toBe(true); // retrocompatível
  });
  it("depois da aprovação humana a PUBLICAÇÃO fica liberada, mas a INDEXAÇÃO não: elegibilidade e estado observado são coisas distintas", async () => {
    const r = await analyzeArchitecture(pool, id(), Q, arch); for (const a of r.analyses) { expect(a.gate.eligibility).toEqual({ approval: true, publication: true, indexing: false }); expect(a.gate.blockedBy.indexing).not.toContain("approval.human"); }
    expect((await as(Q, (db) => listPages(db, { eligibility: "publication" }))).total).toBe(4); expect((await as(Q, (db) => listPages(db, { eligibility: "indexing" }))).total).toBe(0); expect((await as(Q, (db) => listPages(db, { eligibility: "not_indexing" }))).total).toBe(4);
  });
  it("publicação em produção com o gate: bloqueada quando o gate não libera a publicação; liberada (preview/produção noindex) quando libera; sem credenciais nada é criado", async () => {
    const files: string[] = []; const f: FetchLike = async (url, init) => { const res = (s: number, b: string) => ({ ok: s < 300, status: s, headers: { get: () => null }, body: null, text: async () => b }); if (init?.method === "POST") { files.push(...(JSON.parse(init.body!) as { files: { file: string }[] }).files.map((x) => x.file)); return res(200, JSON.stringify({ id: "dpl_1", url: "x.vercel.app", readyState: "QUEUED" })); } return res(404, ""); };
    const env = { VERCEL_TOKEN: "t", VERCEL_PROJECT: "p" }; const A = { phrase: "AUTORIZO PRODUÇÃO", reason: "teste de publicação noindex" };
    expect(await createDeployment(pool, id(), Q, { env: {}, fetch: f, architecture: arch }, { opportunityIds: [ids[0]!], target: "preview" })).toMatchObject({ state: "provider_not_configured" });
    expect(await createDeployment(pool, id(), Q, { env, fetch: f, architecture: { ...arch, pack: badPack } }, { opportunityIds: [ids[0]!], target: "production", authorization: A })).toMatchObject({ state: "refused", reasons: [expect.stringContaining("não libera a publicação")] }); expect(files).toEqual([]);
    expect(await createDeployment(pool, id(), Q, { env, fetch: f, architecture: arch }, { opportunityIds: [ids[0]!], target: "production", authorization: A })).toMatchObject({ state: "ok" }); expect(files).toEqual(["cidades/sp/sao-paulo/index.html"]);
  });
  it("pipeline: o passo de arquitetura roda com o pack e, se o gate reprova a aprovação, a decisão final é BLOQUEADA com o motivo; sem o pack o passo é pulado", async () => {
    const ok = await runPagePipeline(penv({ architecture: arch }), { opportunityId: ids[0]!, correlationId: "arch-pipe-ok" }); const s = ok.steps.find((x) => x.stepKey === "architecture")!; expect(s.status).toBe("SUCCEEDED"); expect(s.result).toMatchObject({ archetype: "T03", eligibility: { approval: true } }); expect(ok.outcome).not.toBe("BLOCKED");
    const bad = await runPagePipeline(penv({ architecture: { ...arch, pack: badPack } }), { opportunityId: ids[1]!, correlationId: "arch-pipe-bad" }); expect(bad.run.finalOutcome).toBe("BLOCKED"); expect(bad.reasons[0]).toMatch(/Quality Gate de arquitetura.*contract\.schema/);
    const none = await runPagePipeline(penv(), { opportunityId: ids[2]!, correlationId: "arch-pipe-none" }); expect(none.steps.find((x) => x.stepKey === "architecture")).toMatchObject({ status: expect.stringMatching(/SKIPPED|SUCCEEDED/) });
  });
  it("filtros operacionais da lista: archetype, cluster, elegibilidade, falha de links e conflitos; colunas de arquitetura no registro", async () => {
    await analyzeArchitecture(pool, id(), Q, arch); // o resultado mais recente de cada página volta a ser o do pack real (os testes acima gravaram análises com o pack de teste reprovado)
    const t3 = await as(Q, (db) => listPages(db, { archetype: "T03" })); expect(t3.total).toBe(4); expect(t3.rows.every((r) => r.archetypeId === "T03" && r.clusterName === "Cidades de SP" && r.qualityScore === 0.3 && r.gate !== null)).toBe(true);
    expect((await as(Q, (db) => listPages(db, { archetype: "T09" }))).total).toBe(0); const cid = t3.rows[0]!.clusterId!; expect((await as(Q, (db) => listPages(db, { cluster: cid }))).total).toBe(4); expect((await as(Q, (db) => listPages(db, { cluster: "não-é-uuid" }))).total).toBeGreaterThan(600); // id inválido é ignorado, não vira filtro
    expect((await as(Q, (db) => listPages(db, { conflict: true }))).total).toBe(0); expect((await as(Q, (db) => listPages(db, { eligibility: "no_gate" }))).total).toBe(0);
  });
  it("as 7 novas etapas do pipeline vêm do gate persistido e mantêm a identidade total = soma dos estados", async () => {
    await analyzeArchitecture(pool, id(), Q, arch);
    const s = await as(Q, (db) => pipelineStages(db)); expect(s).toHaveLength(23); expect(s.map((x) => x.id)).toEqual([...STAGE_IDS]); for (const x of s) expect(x.total, x.id).toBe(x.completed + x.running + x.waiting + x.blocked + x.failed + x.skipped);
    const by = Object.fromEntries(s.map((x) => [x.id, x])); expect(by.data_validation).toMatchObject({ total: 4, completed: 0, blocked: 4 }); expect(by.data_validation!.reasons.map((r) => r.reason)).toEqual(expect.arrayContaining(["contract.indexing", "contract.density"])); expect(by.intent_resolution).toMatchObject({ completed: 4 }); expect(by.contract_validation).toMatchObject({ completed: 4 }); expect(by.link_graph).toMatchObject({ completed: 4 }); expect(by.links_gate).toMatchObject({ completed: 4, blocked: 0 }); expect(by.schema_validation).toMatchObject({ completed: 0, blocked: 4 }); expect(by.schema_validation!.reasons).toEqual([{ reason: "schema.hierarchy", count: 4 }]);
    expect(by.publication_eligibility).toMatchObject({ completed: 4, blocked: 0 });
  });
  it("estado de indexação é SÓ o observado: sem observação a métrica é 'não instrumentada'; com observação INDEXED conta, sem mudar a elegibilidade; estado inválido é recusado pelo banco", async () => {
    await analyzeArchitecture(pool, id(), Q, arch);
    let m = await as(Q, (db) => factoryMetrics(db)); expect(m.values.pages_indexed.state).toBe("not_instrumented"); expect(m.values.pages_gate_indexing).toMatchObject({ value: 0 }); expect(m.values.pages_gate_approval).toMatchObject({ value: 4 }); expect(m.values.pages_insufficient_inlinks).toMatchObject({ value: 0 });
    await recordIndexationObservation(pool, id(), Q, { opportunityId: ids[0]!, url: "https://exemplo.com.br/cidades/sp/sao-paulo", state: "INDEXED", source: "manual_inspection", observedAt: new Date("2026-10-13T00:00:00Z"), evidence: { nota: "inspeção manual de teste" } });
    m = await as(Q, (db) => factoryMetrics(db)); expect(m.values.pages_indexed).toMatchObject({ state: "available", value: 1 }); expect(m.values.pages_gate_indexing).toMatchObject({ value: 0 });
    expect(await as(Q, (db) => latestIndexationObservation(db, ids[0]!))).toMatchObject({ state: "INDEXED", source: "manual_inspection" });
    await expect(as(Q, (db) => db.query(`INSERT INTO plataforma.indexation_observation (tenant_id, opportunity_id, url, state, source, observed_at, created_by) VALUES (plataforma.current_tenant_id(), $1, 'https://x.com/a', 'PUBLICADA', 'manual_inspection', now(), 't')`, [ids[0]]))).rejects.toThrow(/check constraint/);
    await expect(recordIndexationObservation(pool, id(), Q, { opportunityId: ids[0]!, url: "ftp://x", state: "INDEXED", source: "search_console", observedAt: T0 })).rejects.toBeInstanceOf(ArchitectureError);
  });
  it("níveis encadeados no banco: não existe resultado que indexe sem publicar nem publique sem aprovar", async () => {
    const ins = (a: boolean, p: boolean, i: boolean) => as(Q, (db) => db.query(`INSERT INTO plataforma.quality_gate_result (tenant_id, opportunity_id, recipe_id, archetype_id, contract_version, input_hash, result, eligible_approval, eligible_publication, eligible_indexing, created_by) SELECT tenant_id, opportunity_id, recipe_id, archetype_id, contract_version, repeat(${i ? "'e'" : p ? "'d'" : "'f'"}, 64), result, $2, $3, $4, 't' FROM plataforma.quality_gate_result WHERE opportunity_id = $1 LIMIT 1`, [ids[0], a, p, i]));
    await expect(ins(false, true, false)).rejects.toThrow(/check constraint/); await expect(ins(true, false, true)).rejects.toThrow(/check constraint/);
  });
  it("isolamento: o outro tenant não vê clusters, grafos, arquitetura nem resultados; a análise dele é vazia", async () => {
    expect(await as(R, (db) => listClusters(db))).toEqual([]); expect(await as(R, (db) => getStoredArchitecture(db, ids[0]!))).toBeNull();
    for (const t of ["link_graph", "link_edge", "page_architecture", "quality_gate_result", "topic_cluster", "indexation_observation"]) expect(await as(R, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.${t}`)).rows[0]!.n)), t).toBe(0);
    expect(await analyzeArchitecture(pool, id(), R, arch)).toMatchObject({ analyses: [], skipped: [], graph: { nodes: 0, edges: 0 } });
    await expect(as(Q, (db) => db.query(`UPDATE plataforma.quality_gate_result SET eligible_indexing = true`))).rejects.toThrow(/permission denied/); await expect(as(Q, (db) => db.query(`DELETE FROM plataforma.link_edge`))).rejects.toThrow(/permission denied/);
  });
});
