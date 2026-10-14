import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb, devIdentity, runCityImport, withTenant } from "../index";
import { productPoolConfig } from "../testing/pool-config";
import { realEstateCatalog, realEstateFactConfidence } from "../../../../packs/real-estate/src/attributes";
import { realEstateTopicPatterns } from "../../../../packs/real-estate/src/topic-patterns";
import { realEstateVertical } from "../../../../packs/real-estate/src/vertical";
import { materializeCities } from "../catalog";
import { runTopicGeneration, validateTopicPatterns } from "./index";

// Tópicos contra o esquema REAL (migrations 1 a 14). Dados: importação real do IBGE (SP, 645 municípios). Tenants A (fd1) e B (fd2).
const A = "fd111111-1111-4111-8111-111111111111";
const B = "fd222222-2222-4222-8222-222222222222";
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv", import.meta.url));
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };
const T0 = new Date("2026-10-14T12:00:00Z");
const deps = { vertical: realEstateVertical, catalog: realEstateCatalog, patterns: realEstateTopicPatterns, now: () => T0 };
let pool: pg.Pool;
const id = () => devIdentity([A, B]);
const as = <X>(t: string, fn: (db: TenantDb) => Promise<X>) => withTenant(pool, id(), t, fn);
const count = (t: string, table: string, where = "true") => as(t, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.${table} WHERE ${where}`)).rows[0]!.n));

beforeAll(async () => {
  pool = new pg.Pool(productPoolConfig(4)); pool.on("error", () => undefined);
  await runCityImport(pool, id(), A, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: MAPPING });
  await as(A, (db) => materializeCities(db, realEstateFactConfidence, T0));
});
afterAll(async () => { await pool.end(); });

describe("padrões do pack", () => {
  it("são válidos contra a vertical e o catálogo", () => expect(validateTopicPatterns(deps)).toEqual([]));
  it("um padrão cujo padrão de consulta não é topicOnly, ou cujo atributo não existe, é recusado", () => {
    const bad = { ...deps, patterns: [{ ...realEstateTopicPatterns[0]!, queryPatternKey: "buy-apartments", requiredAttributes: ["city.ghost"] }] };
    expect(validateTopicPatterns(bad).join("|")).toMatch(/topicOnly[\s\S]*não declarado/);
  });
});

describe("geração e persistência (dados reais de SP)", () => {
  let first: Awaited<ReturnType<typeof runTopicGeneration>>;
  it("gera 1 tópico por município (645), ignora os padrões de bairro com o motivo, e grava tudo com identidade determinística", async () => {
    first = await runTopicGeneration(pool, id(), A, deps);
    expect(first.status).toBe("succeeded");
    expect(first.result!.topics).toEqual({ created: 645, existing: 0, duplicates: 0 });
    expect(first.result!.skipped.map((s) => s.patternId).sort()).toEqual(["neighborhood-price-m2", "neighborhood-schools", "neighborhood-transit"]);
    for (const s of first.result!.skipped) expect(s.reason).toMatch(/não existem entidades|sem cobertura suficiente/);
    expect(await count(A, "growth_opportunity", "topic_id IS NOT NULL")).toBe(645);
    const sp = await as(A, async (db) => (await db.query<{ topic_id: string; primary_query: string; status: string; hypothesis: boolean; entity_kind: string; entity_id: string; dimensions: Record<string, string>; data_available: string[]; data_missing: string[]; candidate_page_family: string; topic_origin: string; intent_type: string; demand_signal: { value: number | null }; demand: { basis: string }; pattern_key: string; experience: string }>(`SELECT o.* FROM plataforma.growth_opportunity o JOIN plataforma.entity e ON e.id = o.primary_entity_id WHERE e.source_key = 'ibge:3550308'`)).rows[0]!);
    expect(sp).toMatchObject({ primary_query: "São Paulo (SP): população e dados do município", status: "discovered", hypothesis: true, entity_kind: "city", candidate_page_family: "04-cidade", topic_origin: "ATTRIBUTE", intent_type: "informational", pattern_key: "topic-city-overview", experience: "location_overview" });
    expect(sp.topic_id).toMatch(/^[0-9a-f]{64}$/);
    expect(sp.dimensions).toEqual({ city: "ibge:3550308", topic: "visao_geral" });
    expect(sp.data_missing).toEqual([]);
    expect(sp.data_available).toEqual(expect.arrayContaining(["city.population", "city.uf", "city.region"]));
    expect(sp.data_available).not.toContain("city.population_census_2022"); // sem fato do Censo neste tenant: não se afirma
    expect(sp.demand_signal.value).toBeNull();
    expect(sp.demand.basis).toBe("unknown");
  });
  it("registra o evento de descoberta de cada tópico e a execução fecha com as estatísticas", async () => {
    expect(await count(A, "opportunity_event", "event_type = 'discovered' AND opportunity_id IN (SELECT id FROM plataforma.growth_opportunity WHERE topic_id IS NOT NULL)")).toBe(645);
    const run = await as(A, async (db) => (await db.query<{ status: string; params: { kind: string }; stats: { topics: { created: number } } }>(`SELECT status, params, stats FROM plataforma.research_run WHERE id = $1`, [first.runId])).rows[0]!);
    expect(run).toMatchObject({ status: "succeeded", params: { kind: "topics" }, stats: { topics: { created: 645 } } });
  });
  it("é idempotente: repetir não cria tópicos nem eventos", async () => {
    const again = await runTopicGeneration(pool, id(), A, deps);
    expect(again.result!.topics).toEqual({ created: 0, existing: 645, duplicates: 0 });
    expect(await count(A, "growth_opportunity", "topic_id IS NOT NULL")).toBe(645);
    expect(await count(A, "opportunity_event", "event_type = 'discovered' AND opportunity_id IN (SELECT id FROM plataforma.growth_opportunity WHERE topic_id IS NOT NULL)")).toBe(645);
  });
  it("o mesmo dado em OUTRO tenant gera outros ids (o tenant entra no hash) e o isolamento vale", async () => {
    expect(await count(B, "growth_opportunity")).toBe(0);
    await runCityImport(pool, id(), B, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: MAPPING });
    await as(B, (db) => materializeCities(db, realEstateFactConfidence, T0));
    const r = await runTopicGeneration(pool, id(), B, deps);
    expect(r.result!.topics.created).toBe(645);
    const idsA = await as(A, async (db) => (await db.query<{ t: string }>(`SELECT topic_id AS t FROM plataforma.growth_opportunity WHERE topic_id IS NOT NULL LIMIT 20`)).rows.map((x) => x.t));
    const shared = await as(B, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.growth_opportunity WHERE topic_id = ANY($1::text[])`, [idsA])).rows[0]!.n));
    expect(shared).toBe(0);
  });
  it("padrões inválidos lançam ANTES de abrir a execução (nada gravado)", async () => {
    const runs = await count(A, "research_run");
    await expect(runTopicGeneration(pool, id(), A, { ...deps, patterns: [{ ...realEstateTopicPatterns[0]!, queryPatternKey: "nao-existe" }] })).rejects.toThrow(/padrões de tópico inválidos/);
    expect(await count(A, "research_run")).toBe(runs);
  });
  it("o motor anterior (descoberta por padrão × entidade) ignora padrões topicOnly", async () => {
    // a vertical tem 3 padrões topicOnly e nenhum tópico aparece com pattern_key de padrão do motor anterior
    expect(realEstateVertical.patterns.filter((p) => p.topicOnly).map((p) => p.key).sort()).toEqual(["topic-city-comparison", "topic-city-overview", "topic-neighborhood"]);
    expect(await count(A, "growth_opportunity", "topic_id IS NOT NULL AND pattern_key <> 'topic-city-overview'")).toBe(0);
  });
});
