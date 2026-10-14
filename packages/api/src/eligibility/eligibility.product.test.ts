import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb, devIdentity, runCityImport, withTenant } from "../index";
import { productPoolConfig } from "../testing/pool-config";
import { realEstateCatalog, realEstateFactConfidence } from "../../../../packs/real-estate/src/attributes";
import { realEstateTopicPatterns } from "../../../../packs/real-estate/src/topic-patterns";
import { realEstateVertical } from "../../../../packs/real-estate/src/vertical";
import { DEFAULT_ELIGIBILITY_POLICY } from "../../../../packs/real-estate/src/eligibility";
import { materializeCities, recordSidraFacts, savePolicyVersion } from "../catalog";
import { runTopicGeneration } from "../topics";
import { listDecisionHistory, listLatestDecisions, runEvaluation, type EligibilityDeps } from "./index";

// Elegibilidade contra o esquema REAL (migrations 1 a 16), com os dados REAIS de SP. Tenants E (fd5) e F (fd6). O tempo é CONTROLADO (deps.now).
const E = "fd555555-5555-4555-8555-555555555555";
const F = "fd666666-6666-4666-8666-666666666666";
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv", import.meta.url));
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };
const T0 = new Date("2026-10-14T12:00:00Z");
const topicDeps = { vertical: realEstateVertical, catalog: realEstateCatalog, patterns: realEstateTopicPatterns, now: () => T0 };
const deps = (now = T0, policy = DEFAULT_ELIGIBILITY_POLICY): EligibilityDeps => ({ verticalId: realEstateVertical.id, attributes: realEstateCatalog.attributes, defaultPolicy: policy, now: () => now });
let pool: pg.Pool;
const id = () => devIdentity([E, F]);
const as = <X>(t: string, fn: (db: TenantDb) => Promise<X>) => withTenant(pool, id(), t, fn);
const count = (t: string, table: string, where = "true") => as(t, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.${table} WHERE ${where}`)).rows[0]!.n));
const topicOf = (key: string) => as(E, async (db) => (await db.query<{ id: string; topic_id: string; status: string; eligible: boolean | null; priority_kind: string | null; priority_value: string | null }>(`SELECT o.id, o.topic_id, o.status, o.eligible, o.priority_kind, o.priority_value FROM plataforma.growth_opportunity o JOIN plataforma.entity e ON e.id = o.primary_entity_id WHERE e.source_key = $1 AND o.pattern_key = 'topic-city-overview'`, [key])).rows[0]!);
const latest = async (key: string) => { const t = await topicOf(key); return (await as(E, (db) => listDecisionHistory(db, t.id)))[0]!; };

beforeAll(async () => {
  pool = new pg.Pool(productPoolConfig(4)); pool.on("error", () => undefined);
  await runCityImport(pool, id(), E, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: MAPPING });
  await as(E, (db) => materializeCities(db, realEstateFactConfidence, T0));
  expect((await runTopicGeneration(pool, id(), E, topicDeps)).result!.topics.created).toBe(645);
});
afterAll(async () => { await pool.end(); });

describe("dados reais de SP: o município com só população/UF/região NÃO é único o bastante (G5)", () => {
  let first: Awaited<ReturnType<typeof runEvaluation>>;
  it("avalia os 645 tópicos: todos DATA_REQUIRED por G5 (1 bloco varia < 3), sem nota, e leva cada um a 'scored' com 2 transições", async () => {
    first = await runEvaluation(pool, id(), E, deps());
    expect(first.status).toBe("succeeded");
    expect(first.result).toMatchObject({ evaluated: 645, created: 645, unchanged: 0, byDecision: { DATA_REQUIRED: 645 }, gateFailures: { G5_uniqueness: 645 }, transitions: 1290, skippedTransition: 0, policyVersion: 1 });
    expect(await count(E, "growth_opportunity", "topic_id IS NOT NULL AND status = 'scored'")).toBe(645);
    expect(await count(E, "eligibility_decision")).toBe(645);
  });
  it("a decisão guarda snapshot, política, gates, motivo faltante e NENHUMA nota (a nota só existe depois dos gates)", async () => {
    const d = await latest("ibge:3550308");
    expect(d).toMatchObject({ decision: "DATA_REQUIRED", eligible: false, policyVersion: 1, totalScore: null, weightCoverage: null, scores: {} });
    expect(d.gateResults).toMatchObject({ G1_entity: "PASS", G2_intent: "PASS", G3_data_sufficiency: "PASS", G4_evidence: "PASS", G5_uniqueness: "FAIL", G6_geo_semantic: "PASS", G7_freshness: "PASS", G8_policy: "PASS", G9_cannibalization: "PASS" });
    expect(d.missingRequirements.join()).toMatch(/G5_uniqueness: mais 2 bloco\(s\) que variem por instância/);
    expect(d.gateDetails.G5_uniqueness.detail).toMatch(/apenas 1 bloco/);
    expect(d.gateDetails.G2_intent.hypothesis).toBe(true);
    expect(d.evidenceRefs).toHaveLength(3);
    expect(d.recommendedAction).toMatch(/Obter o que falta/);
    const snap = await as(E, async (db) => (await db.query<{ snapshot: { referenceTime: string; varyingBlocks: number; topic: { demand: { value: null } } } }>(`SELECT snapshot FROM plataforma.eligibility_decision WHERE id = $1`, [d.id])).rows[0]!.snapshot);
    expect(snap.referenceTime).toBe(T0.toISOString());
    expect(snap.varyingBlocks).toBe(1);
    expect(snap.topic.demand.value).toBeNull();
  });
  it("cada transição fica auditada com a decisão que a originou (autor, motivo, snapshot e política)", async () => {
    const t = await topicOf("ibge:3550308");
    const ev = await as(E, async (db) => (await db.query<{ event_type: string; from_status: string | null; to_status: string | null; actor: string; reason: string; data: { decision?: string; snapshotHash?: string; policyVersion?: number } }>(`SELECT event_type, from_status, to_status, actor, reason, data FROM plataforma.opportunity_event WHERE opportunity_id = $1 ORDER BY seq`, [t.id])).rows);
    expect(ev.map((x) => `${x.event_type}:${x.from_status ?? ""}>${x.to_status ?? ""}`)).toEqual(["discovered:>discovered", "transition:discovered>validated", "transition:validated>scored", "score:>"]);
    expect(ev[1]).toMatchObject({ reason: "avaliação de elegibilidade: DATA_REQUIRED", data: { decision: "DATA_REQUIRED", policyVersion: 1 } });
    expect(ev[1]!.data.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(t).toMatchObject({ status: "scored", eligible: false, priority_kind: "none", priority_value: null });
  });
  it("idempotente: a mesma entrada (snapshot, política e tempo) não cria decisão nem transição", async () => {
    const again = await runEvaluation(pool, id(), E, deps());
    expect(again.result).toMatchObject({ evaluated: 645, created: 0, unchanged: 645, transitions: 0 });
    expect(await count(E, "eligibility_decision")).toBe(645);
  });
  it("o instante de referência é parte do snapshot: outro dia = nova decisão auditável, mas o estado não muda", async () => {
    const r = await runEvaluation(pool, id(), E, deps(new Date("2026-10-15T12:00:00Z")));
    expect(r.result).toMatchObject({ created: 645, transitions: 0, byDecision: { DATA_REQUIRED: 645 } });
    expect(await count(E, "eligibility_decision")).toBe(1290);
  });
});

describe("com blocos que variam (Censo 2022 em duas cidades) a hipótese vira RESEARCH_REQUIRED, com nota parcial", () => {
  it("passa em todos os gates, mas sem demanda: RESEARCH_REQUIRED, dimensão de demanda desconhecida (não zero), cobertura < 1, estado permanece 'scored'", async () => {
    // fixture REAL do SIDRA (SP) + uma resposta CONSTRUÍDA para Campinas (somente teste, tenant isolado)
    const sp = { ibgeCode: "3550308", name: "São Paulo (SP)", year: 2022, population: 11451999, densityPerKm2: 7528.26 };
    const campinas = { ibgeCode: "3509502", name: "Campinas (SP)", year: 2022, population: 1139047, densityPerKm2: 1433.5 };
    const prov = { provider: "ibge-sidra", endpoint: "values/t/4714/n6/x/v/93,614/p/last", params: {}, collectedAt: T0, costUsd: 0, cacheKey: "a".repeat(64), cached: false, callId: null };
    await as(E, (db) => recordSidraFacts(db, [{ facts: sp, provenance: prov }, { facts: campinas, provenance: prov }], realEstateFactConfidence, T0));
    const r = await runEvaluation(pool, id(), E, deps());
    expect(r.result).toMatchObject({ evaluated: 645, created: 2, unchanged: 643, byDecision: { DATA_REQUIRED: 643, RESEARCH_REQUIRED: 2 }, transitions: 0 });
    const d = await latest("ibge:3550308");
    expect(d).toMatchObject({ decision: "RESEARCH_REQUIRED", eligible: false });
    expect(d.gateResults.G5_uniqueness).toBe("PASS");
    expect((d.scores as Record<string, { score: number | null }>).search_demand.score).toBeNull();
    expect(d.weightCoverage).toBeLessThan(1);
    expect(d.totalScore).toBeGreaterThan(0);
    expect(d.recommendedAction).toMatch(/sinal de demanda/);
    expect((await topicOf("ibge:3550308"))).toMatchObject({ status: "scored", eligible: false, priority_kind: "partial" });
  });
  it("com demanda OBSERVADA (sinal de teste) e todos os gates, o tópico vira READY_FOR_BLUEPRINT: scored → eligible, priority_kind parcial (SERP desconhecida)", async () => {
    await as(E, (db) => db.query(`UPDATE plataforma.growth_opportunity o SET demand_signal = '{"value": 10000, "source": "sinal de teste", "period": "12m", "method": "estimativa", "uncertainty": "±30%"}'::jsonb FROM plataforma.entity e WHERE e.id = o.primary_entity_id AND e.source_key = 'ibge:3550308' AND o.pattern_key = 'topic-city-overview'`));
    const r = await runEvaluation(pool, id(), E, deps());
    expect(r.result).toMatchObject({ created: 1, unchanged: 644, transitions: 1 });
    const d = await latest("ibge:3550308");
    expect(d).toMatchObject({ decision: "READY_FOR_BLUEPRINT", eligible: true });
    expect(d.totalScore).toBeGreaterThanOrEqual(75);
    expect((await topicOf("ibge:3550308"))).toMatchObject({ status: "eligible", eligible: true, priority_kind: "partial" });
    const tt = await topicOf("ibge:3550308");
    const history = await as(E, (db) => listDecisionHistory(db, tt.id));
    expect(history.map((h) => h.decision)).toEqual(["READY_FOR_BLUEPRINT", "RESEARCH_REQUIRED", "DATA_REQUIRED", "DATA_REQUIRED"]);
  });
  it("NÃO COMPENSATÓRIO no banco: demanda altíssima numa cidade SEM blocos variáveis continua DATA_REQUIRED, sem nota e sem avançar", async () => {
    await as(E, (db) => db.query(`UPDATE plataforma.growth_opportunity o SET demand_signal = '{"value": 100000, "source": "sinal de teste"}'::jsonb FROM plataforma.entity e WHERE e.id = o.primary_entity_id AND e.source_key = 'ibge:3548500' AND o.pattern_key = 'topic-city-overview'`));
    await runEvaluation(pool, id(), E, deps());
    const d = await latest("ibge:3548500");
    expect(d).toMatchObject({ decision: "DATA_REQUIRED", eligible: false, totalScore: null });
    expect(d.gateResults.G5_uniqueness).toBe("FAIL");
    expect((await topicOf("ibge:3548500")).status).toBe("scored");
  });
});

describe("reavaliação: política nova, entidade deprecada e volta", () => {
  it("nova versão da política (limiar de READY mais alto) reavalia com a versão 2 e leva eligible → scored", async () => {
    await as(E, (db) => savePolicyVersion(db, "eligibility", { ...DEFAULT_ELIGIBILITY_POLICY, readyMin: 95 }, "teste: limiar alto", "teste"));
    const r = await runEvaluation(pool, id(), E, deps());
    expect(r.result).toMatchObject({ policyVersion: 2 });
    const d = await latest("ibge:3550308");
    expect(d).toMatchObject({ decision: "DATA_REQUIRED", policyVersion: 2 });
    expect(d.totalScore).toBeLessThan(95);
    expect((await topicOf("ibge:3550308")).status).toBe("scored");
  });
  it("entidade deprecada → G1 reprova → REJECTED (scored → rejected, aresta nova); ao voltar ACTIVE, rejected → discovered → validated → scored", async () => {
    await as(E, (db) => db.query(`UPDATE plataforma.entity SET status = 'DEPRECATED' WHERE source_key = 'ibge:3509502'`));
    await runEvaluation(pool, id(), E, deps());
    expect(await latest("ibge:3509502")).toMatchObject({ decision: "REJECTED", eligible: false });
    expect((await topicOf("ibge:3509502")).status).toBe("rejected");
    await as(E, (db) => db.query(`UPDATE plataforma.entity SET status = 'ACTIVE' WHERE source_key = 'ibge:3509502'`));
    await runEvaluation(pool, id(), E, deps());
    expect((await topicOf("ibge:3509502")).status).toBe("scored");
    const t = await topicOf("ibge:3509502");
    const tr = await as(E, async (db) => (await db.query<{ from_status: string; to_status: string }>(`SELECT from_status, to_status FROM plataforma.opportunity_event WHERE opportunity_id = $1 AND event_type = 'transition' ORDER BY seq`, [t.id])).rows.map((x) => `${x.from_status}>${x.to_status}`));
    expect(tr).toEqual(["discovered>validated", "validated>scored", "scored>rejected", "rejected>discovered", "discovered>validated", "validated>scored"]);
  });
  it("nunca chega à publicação, e um estado avançado não regride (decisão registrada, estado preservado)", async () => {
    expect(await count(E, "growth_opportunity", "status IN ('published', 'indexed', 'monitored', 'converted', 'measured', 'learned', 'refreshed')")).toBe(0);
    await as(E, (db) => db.query(`UPDATE plataforma.growth_opportunity o SET status = 'eligible' FROM plataforma.entity e WHERE e.id = o.primary_entity_id AND e.source_key = 'ibge:3550308' AND o.pattern_key = 'topic-city-overview'`));
    await as(E, (db) => db.query(`UPDATE plataforma.growth_opportunity o SET status = 'blueprinted' FROM plataforma.entity e WHERE e.id = o.primary_entity_id AND e.source_key = 'ibge:3550308' AND o.pattern_key = 'topic-city-overview'`));
    await as(E, (db) => db.query(`UPDATE plataforma.growth_opportunity o SET demand_signal = '{"value": null}'::jsonb FROM plataforma.entity e WHERE e.id = o.primary_entity_id AND e.source_key = 'ibge:3550308' AND o.pattern_key = 'topic-city-overview'`));
    const r = await runEvaluation(pool, id(), E, deps());
    expect(r.result!.skippedTransition).toBeGreaterThanOrEqual(1);
    expect((await topicOf("ibge:3550308")).status).toBe("blueprinted");
    expect((await latest("ibge:3550308")).decision).toBe("RESEARCH_REQUIRED");
  });
});

describe("listagem, imutabilidade e isolamento", () => {
  it("lista a decisão mais recente por tópico com contagem por decisão e filtro por gate", async () => {
    const l = await as(E, (db) => listLatestDecisions(db, { limit: 5 }));
    expect(l.total).toBe(645);
    expect(Object.values(l.byDecision).reduce((a, b) => a + b, 0)).toBe(645);
    const g5 = await as(E, (db) => listLatestDecisions(db, { gate: "G5_uniqueness", limit: 3 }));
    expect(g5.total).toBeGreaterThan(600);
    expect(g5.rows.every((r) => r.gateResults.G5_uniqueness === "FAIL")).toBe(true);
    const research = await as(E, (db) => listLatestDecisions(db, { decision: "RESEARCH_REQUIRED" }));
    expect(research.rows.every((r) => r.decision === "RESEARCH_REQUIRED" && r.totalScore !== null)).toBe(true);
  });
  it("a decisão é imutável (sem UPDATE/DELETE) e READY exige o booleano eligible (CHECK)", async () => {
    await expect(as(E, (db) => db.query(`UPDATE plataforma.eligibility_decision SET decision = 'READY_FOR_BLUEPRINT'`))).rejects.toThrow(/permission denied/);
    await expect(as(E, (db) => db.query(`DELETE FROM plataforma.eligibility_decision`))).rejects.toThrow(/permission denied/);
    await expect(as(E, (db) => db.query(`INSERT INTO plataforma.eligibility_decision (tenant_id, opportunity_id, topic_id, policy_id, policy_version, snapshot_hash, snapshot, reference_time, decision, eligible, gate_results, gate_details, scores, recommended_action, evaluated_at, created_by) SELECT tenant_id, opportunity_id, topic_id, policy_id, policy_version, repeat('b', 64), snapshot, reference_time, 'READY_FOR_BLUEPRINT', false, gate_results, gate_details, scores, recommended_action, evaluated_at, created_by FROM plataforma.eligibility_decision LIMIT 1`))).rejects.toThrow(/check constraint/);
  });
  it("o outro tenant não vê decisões e uma política inválida lança antes de abrir a execução", async () => {
    expect(await count(F, "eligibility_decision")).toBe(0);
    const runs = await count(E, "research_run");
    await expect(runEvaluation(pool, id(), E, deps(T0, { ...DEFAULT_ELIGIBILITY_POLICY, readyMin: 10 }))).rejects.toThrow(/política de elegibilidade inválida/);
    expect(await count(E, "research_run")).toBe(runs);
  });
});
