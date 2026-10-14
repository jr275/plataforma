import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb, devIdentity, runCityImport, withTenant } from "../index";
import { productPoolConfig } from "../testing/pool-config";
import { realEstateCatalog, realEstateFactConfidence } from "../../../../packs/real-estate/src/attributes";
import { realEstateTopicPatterns } from "../../../../packs/real-estate/src/topic-patterns";
import { realEstateVertical } from "../../../../packs/real-estate/src/vertical";
import { FAMILIES as COMBINATION_FAMILIES, COMPATIBILITY_RULES, DEFAULT_COMBINATION_POLICY, buildSpace as buildCombinationSpace } from "../../../../packs/real-estate/src/combination";
import { materializeCities, savePolicyVersion } from "../catalog";
import { runTopicGeneration } from "../topics";
import { listCombinationLog, runCombinations, validatePolicy, type CombinationDeps } from "./index";

// Combination Engine contra o esquema REAL (migrations 1 a 15) com os dados REAIS de SP. Tenants C (fd3, política padrão) e D (fd4, política de teste com mínimo 1).
const C = "fd333333-3333-4333-8333-333333333333";
const D = "fd444444-4444-4444-8444-444444444444";
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv", import.meta.url));
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };
const T0 = new Date("2026-10-14T12:00:00Z");
const topicDeps = { vertical: realEstateVertical, catalog: realEstateCatalog, patterns: realEstateTopicPatterns, now: () => T0 };
const comboDeps = (policy = DEFAULT_COMBINATION_POLICY): CombinationDeps => ({ vertical: realEstateVertical, families: COMBINATION_FAMILIES, rules: COMPATIBILITY_RULES, defaultPolicy: policy, buildSpace: buildCombinationSpace, now: () => T0 });
let pool: pg.Pool;
const id = () => devIdentity([C, D]);
const as = <X>(t: string, fn: (db: TenantDb) => Promise<X>) => withTenant(pool, id(), t, fn);
const count = (t: string, table: string, where = "true") => as(t, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.${table} WHERE ${where}`)).rows[0]!.n));

beforeAll(async () => {
  pool = new pg.Pool(productPoolConfig(4)); pool.on("error", () => undefined);
  for (const t of [C, D]) {
    await runCityImport(pool, id(), t, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: MAPPING });
    await as(t, (db) => materializeCities(db, realEstateFactConfidence, T0));
    expect((await runTopicGeneration(pool, id(), t, topicDeps)).result!.topics.created).toBe(645);
  }
});
afterAll(async () => { await pool.end(); });

describe("política e família", () => {
  it("a política padrão do pack é válida; valores inválidos são recusados", () => {
    expect(validatePolicy(DEFAULT_COMBINATION_POLICY)).toEqual([]);
    expect(validatePolicy({ ...DEFAULT_COMBINATION_POLICY, redundancyRatio: 1 }).join()).toMatch(/redundancyRatio/);
    expect(validatePolicy({ ...DEFAULT_COMBINATION_POLICY, longTailMaxDimensions: 2 }).join()).toMatch(/longTailMaxDimensions/);
    expect(validatePolicy({ ...DEFAULT_COMBINATION_POLICY, maxCandidatesPerRun: 0 }).join()).toMatch(/maxCandidatesPerRun/);
  });
  it("família desconhecida e política inválida lançam antes de abrir a execução", async () => {
    const before = await count(C, "research_run");
    await expect(runCombinations(pool, id(), C, comboDeps(), { familyId: "nao-existe" })).rejects.toThrow(/desconhecida/);
    await expect(runCombinations(pool, id(), C, comboDeps({ ...DEFAULT_COMBINATION_POLICY, maxDimensions: 0 }), { familyId: "city-comparison" })).rejects.toThrow(/política/);
    expect(await count(C, "research_run")).toBe(before);
  });
});

describe("dados reais de SP com a política padrão: a comparação NÃO tem dados suficientes (1 atributo comparável < 3)", () => {
  let res: Awaited<ReturnType<typeof runCombinations>>;
  it("avalia os pares das 10 cidades mais populosas, poda TODOS em F4 com o motivo e não mantém nenhum", async () => {
    res = await runCombinations(pool, id(), C, comboDeps(), { familyId: "city-comparison", rootLimit: 10 });
    expect(res.status).toBe("succeeded");
    const r = res.result!;
    expect(r).toMatchObject({ roots: 10, kept: 0, capped: false, topics: { created: 0, existing: 0 } });
    expect(r.evaluated).toBeGreaterThan(100);
    expect(r.pruned).toEqual({ F4_data_sufficiency: r.evaluated });
    const log = await as(C, (db) => listCombinationLog(db, { runId: res.runId, limit: 5 }));
    expect(log.total).toBe(r.evaluated);
    expect(log.rows[0]!.reason).toMatch(/1 item\(ns\) abaixo do mínimo de 3 da família/);
    expect(log.byFilter).toEqual({ F4_data_sufficiency: r.evaluated });
    expect(await count(C, "growth_opportunity", "topic_origin = 'COMBINATION'")).toBe(0);
  });
  it("a política padrão ficou gravada como versão 1 do tenant", async () => {
    expect(await count(C, "policy", "kind = 'combination' AND version = 1")).toBe(1);
  });
  it("tipologia × lugar: não há entidades de bairro, então não há raízes e nada é avaliado ou inventado", async () => {
    const r = await runCombinations(pool, id(), C, comboDeps(), { familyId: "neighborhood-typology" });
    expect(r.result).toMatchObject({ roots: 0, evaluated: 0, kept: 0 });
  });
});

describe("com política de teste (mínimo 1) os pares sobrevivem e viram tópicos filhos", () => {
  const policy = { ...DEFAULT_COMBINATION_POLICY, minItems: { ...DEFAULT_COMBINATION_POLICY.minItems, city_comparison: 1 } };
  let first: Awaited<ReturnType<typeof runCombinations>>;
  it("mantém os pares, persiste como tópicos COMBINATION com pai e log 'kept'", async () => {
    first = await runCombinations(pool, id(), D, comboDeps(policy), { familyId: "city-comparison", rootLimit: 10 });
    const r = first.result!;
    expect(r.kept).toBeGreaterThan(100);
    expect(r.pruned).toEqual({});
    expect(r.topics.created).toBe(r.kept);
    const t = await as(D, async (db) => (await db.query<{ topic_id: string; parent_topic_id: string; dimensions: Record<string, string>; topic_origin: string; candidate_page_family: string; intent_type: string; primary_query: string; status: string; demand_signal: { value: number | null }; pattern_key: string }>(`SELECT topic_id, parent_topic_id, dimensions, topic_origin, candidate_page_family, intent_type, primary_query, status, demand_signal, pattern_key FROM plataforma.growth_opportunity WHERE topic_origin = 'COMBINATION' ORDER BY topic_id LIMIT 3`)).rows);
    for (const x of t) {
      expect(x).toMatchObject({ topic_origin: "COMBINATION", candidate_page_family: "13-comparacao", intent_type: "comparative", status: "discovered", pattern_key: "topic-city-comparison" });
      expect(x.dimensions).toMatchObject({ topic: "visao_geral" });
      expect(Object.keys(x.dimensions).sort()).toEqual(["city", "compare_with", "topic"]);
      expect(x.primary_query).toMatch(/ vs .*: comparação/);
      expect(x.demand_signal.value).toBeNull();
    }
    // todo filho aponta para um tópico raiz existente
    const orphans = await as(D, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.growth_opportunity c WHERE c.topic_origin = 'COMBINATION' AND NOT EXISTS (SELECT 1 FROM plataforma.growth_opportunity p WHERE p.topic_id = c.parent_topic_id)`)).rows[0]!.n));
    expect(orphans).toBe(0);
  });
  it("não há pares espelhados (A×B e B×A) nem entre cidades de estados diferentes", async () => {
    const pairs = await as(D, async (db) => (await db.query<{ a: string; b: string }>(`SELECT dimensions->>'city' AS a, dimensions->>'compare_with' AS b FROM plataforma.growth_opportunity WHERE topic_origin = 'COMBINATION'`)).rows);
    const seen = new Set(pairs.map((p) => [p.a, p.b].sort().join("|")));
    expect(seen.size).toBe(pairs.length);
    for (const p of pairs) expect(p.a < p.b).toBe(true);
  });
  it("o log guarda a contagem e a marca de hipótese (sem demanda) de cada mantido", async () => {
    const l = await as(D, (db) => listCombinationLog(db, { runId: first.runId, outcome: "kept", limit: 3 }));
    for (const r of l.rows) expect(r.details).toMatchObject({ count: 1, demandStatus: "HYPOTHESIS" });
  });
  it("repetir é idempotente nos tópicos (nenhum novo) e acrescenta um novo log", async () => {
    const topics = await count(D, "growth_opportunity", "topic_origin = 'COMBINATION'");
    const again = await runCombinations(pool, id(), D, comboDeps(policy), { familyId: "city-comparison", rootLimit: 10 });
    expect(again.result).toMatchObject({ kept: first.result!.kept, topics: { created: 0, existing: first.result!.kept } });
    expect(await count(D, "growth_opportunity", "topic_origin = 'COMBINATION'")).toBe(topics);
    expect(await count(D, "combination_log", `run_id = '${again.runId}'`)).toBe(again.result!.evaluated);
  });
  it("o teto de candidatos (nova versão da política) corta COM registro: linha 'capped', resultado marcado e só os avaliados têm resultado", async () => {
    const v = await as(D, (db) => savePolicyVersion(db, "combination", { ...policy, maxCandidatesPerRun: 7 }, "teste: teto baixo", "teste"));
    expect(v.version).toBe(2);
    const r = await runCombinations(pool, id(), D, comboDeps(policy), { familyId: "city-comparison", rootLimit: 10 });
    expect(r.result).toMatchObject({ capped: true, evaluated: 7, policyVersion: 2 });
    const l = await as(D, (db) => listCombinationLog(db, { runId: r.runId, outcome: "capped" }));
    expect(l.rows).toHaveLength(1);
    expect(l.rows[0]!.reason).toMatch(/teto de 7 candidatos/);
    expect(await count(D, "combination_log", `run_id = '${r.runId}'`)).toBe(8);
  });
});

describe("isolamento", () => {
  it("o outro tenant não vê o log nem os filhos", async () => {
    expect(await count(C, "growth_opportunity", "topic_origin = 'COMBINATION'")).toBe(0);
    const logD = await as(D, (db) => listCombinationLog(db));
    expect(logD.total).toBeGreaterThan(0);
    const c = await as(C, (db) => listCombinationLog(db, {}));
    expect(c.rows.every((r) => r.outcome === "pruned")).toBe(true);
    await expect(as(C, (db) => db.query(`DELETE FROM plataforma.combination_log`))).rejects.toThrow(/permission denied/);
  });
});
