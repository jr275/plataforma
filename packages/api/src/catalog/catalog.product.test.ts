import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb, devIdentity, runCityImport, withTenant } from "../index";
import { productPoolConfig } from "../testing/pool-config";
import { realEstateCatalog, realEstateFactConfidence } from "../../../../packs/real-estate/src/attributes";
import { fakeFetch } from "../engine/test-support/fake-fetch";
import { PUBLIC_UA, RateGate, RunBudget, fetchSidraCity } from "../provider";
import { CITY_ATTRS, FactError, currentFacts, latestCatalog, materializeCities, recordFacts, recordSidraFacts, runCatalog, savePolicyVersion, upsertEntities } from "./index";

// Camada de dados contra o esquema REAL (migration 0013): entidade, fato bi-temporal com proveniência obrigatória, política versionada e catálogo de atributos. Tenants Y e Z.
const Y = "fc111111-1111-4111-8111-111111111111";
const Z = "fc222222-2222-4222-8222-222222222222";
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv", import.meta.url));
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };
const SIDRA = readFileSync(new URL("../provider/__fixtures__/sidra-4714-3550308.json", import.meta.url), "utf8");
const T0 = new Date("2026-10-14T12:00:00Z");
let pool: pg.Pool;
const id = () => devIdentity([Y, Z]);
const as = <X>(t: string, fn: (db: TenantDb) => Promise<X>) => withTenant(pool, id(), t, fn);
const count = (t: string, table: string, where = "true") => as(t, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.${table} WHERE ${where}`)).rows[0]!.n));

beforeAll(async () => {
  pool = new pg.Pool(productPoolConfig(4)); pool.on("error", () => undefined);
  await runCityImport(pool, id(), Y, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: MAPPING });
  // Z: importação que NÃO é real (teste): nunca pode virar fato
  await runCityImport(pool, id(), Z, { content: FIXTURE, fileName: "teste.csv", sourceName: "Teste", origin: "test", mapping: MAPPING });
});
afterAll(async () => { await pool.end(); });

describe("entidades e fatos de município a partir da importação REAL", () => {
  it("cria uma entidade por município e fatos com fonte, data observada (precisão de ano) e confiança declarada pelo pack", async () => {
    const r = await as(Y, (db) => materializeCities(db, realEstateFactConfidence, T0));
    expect(r.entities).toBe(645);
    expect(r.facts.inserted).toBeGreaterThan(645 * 2);
    const f = await as(Y, async (db) => (await db.query<{ value: number; source_name: string; observed_at: Date; observed_precision: string; confidence: string; unit: string; import_run_id: string; geospatial_precision: string }>(
      `SELECT f.value, f.source_name, f.observed_at, f.observed_precision, f.confidence, f.unit, f.import_run_id, f.geospatial_precision FROM plataforma.fact f JOIN plataforma.entity e ON e.id = f.entity_id WHERE e.source_key = 'ibge:3550308' AND f.attribute_id = 'city.population'`)).rows[0]!);
    expect(f).toMatchObject({ value: 11911337, observed_precision: "year", unit: "pessoas", geospatial_precision: "city" });
    expect(f.source_name).toContain("IBGE (arquivo sp-ibge-2026-10-12.csv)");
    expect(f.observed_at).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(Number(f.confidence)).toBe(0.95);
    expect(f.import_run_id).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("repetir é idempotente: nenhuma entidade nem fato novo", async () => {
    const before = [await count(Y, "entity"), await count(Y, "fact")];
    const r = await as(Y, (db) => materializeCities(db, realEstateFactConfidence, T0));
    expect(r.facts).toMatchObject({ inserted: 0, superseded: 0 });
    expect(r.facts.unchanged).toBe(before[1]);
    expect([await count(Y, "entity"), await count(Y, "fact")]).toEqual(before);
  });
  it("importação que não é real (teste) nunca vira entidade nem fato", async () => {
    const r = await as(Z, (db) => materializeCities(db, realEstateFactConfidence, T0));
    expect(r).toMatchObject({ entities: 0, facts: { inserted: 0 } });
    expect(await count(Z, "entity")).toBe(0);
    expect(await count(Z, "fact")).toBe(0);
  });
  it("atributo sem qualidade declarada ganha confiança 0, não um valor otimista", async () => {
    const r = await as(Y, (db) => materializeCities(db, {}, new Date(T0.getTime() + 86_400_000)));
    expect(r.facts.superseded).toBeGreaterThan(0); // a confiança mudou: nova versão, a antiga encerrada
    const cur = await as(Y, async (db) => (await db.query<{ c: string }>(`SELECT DISTINCT confidence AS c FROM plataforma.fact WHERE superseded_at IS NULL AND attribute_id = 'city.uf'`)).rows);
    expect(cur.map((x) => Number(x.c))).toEqual([0]);
    await as(Y, (db) => materializeCities(db, realEstateFactConfidence, new Date(T0.getTime() + 2 * 86_400_000))); // restaura
  });
});

describe("fato bi-temporal e append-only (R1)", () => {
  it("corrigir um fato encerra a versão antiga (superseded_at) e insere a nova; o histórico permanece", async () => {
    const e = (await as(Y, (db) => upsertEntities(db, [{ entityType: "city", sourceKey: "ibge:3550308", name: "São Paulo" }]))).get("city|ibge:3550308")!;
    const base = { entityId: e, attributeId: "city.population", sourceName: "IBGE (correção de teste)", observedAt: new Date("2026-01-01T00:00:00Z"), observedPrecision: "year" as const, confidence: 0.95 };
    const r = await as(Y, (db) => recordFacts(db, [{ ...base, value: 12000000 }], new Date(T0.getTime() + 3 * 86_400_000)));
    expect(r).toMatchObject({ inserted: 1, superseded: 1, unchanged: 0 });
    const rows = await as(Y, async (db) => (await db.query<{ value: number; superseded_at: Date | null }>(`SELECT value, superseded_at FROM plataforma.fact WHERE entity_id = $1 AND attribute_id = 'city.population' ORDER BY ingested_at, superseded_at NULLS LAST`, [e])).rows);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.filter((x) => x.superseded_at === null)).toHaveLength(1);
    expect(rows.find((x) => x.superseded_at === null)!.value).toBe(12000000);
    expect(rows.some((x) => x.value === 11911337)).toBe(true); // a versão antiga continua consultável
    const again = await as(Y, (db) => recordFacts(db, [{ ...base, value: 12000000 }], new Date(T0.getTime() + 4 * 86_400_000)));
    expect(again).toMatchObject({ inserted: 0, unchanged: 1 });
  });
  it("fato sem fonte, sem data ou com valor ausente lança ANTES de gravar qualquer coisa do lote", async () => {
    const e = (await as(Y, (db) => upsertEntities(db, [{ entityType: "city", sourceKey: "ibge:3509502", name: "Campinas" }]))).get("city|ibge:3509502")!;
    const before = await count(Y, "fact");
    await expect(as(Y, (db) => recordFacts(db, [{ entityId: e, attributeId: "city.uf", value: "SP", sourceName: "x", observedAt: T0, confidence: 0.9 }, { entityId: e, attributeId: "city.region", value: "Sudeste", sourceName: " ", observedAt: T0, confidence: 0.9 }], T0))).rejects.toBeInstanceOf(FactError);
    await expect(as(Y, (db) => recordFacts(db, [{ entityId: e, attributeId: "city.region", value: null, sourceName: "x", observedAt: T0, confidence: 0.9 }], T0))).rejects.toThrow(/ausência não é gravada/);
    expect(await count(Y, "fact")).toBe(before);
  });
  it("o banco também recusa (defesa em profundidade): INSERT direto sem fonte, com confiança fora de 0..1 ou duplicado corrente", async () => {
    const e = (await as(Y, (db) => upsertEntities(db, [{ entityType: "city", sourceKey: "ibge:3509502", name: "Campinas" }]))).get("city|ibge:3509502")!;
    const ins = (src: string, conf: number, attr = "city.teste_a") => as(Y, (db) => db.query(`INSERT INTO plataforma.fact (tenant_id, entity_id, attribute_id, value, source_name, observed_at, ingested_at, confidence, content_hash) VALUES (plataforma.current_tenant_id(), $1, $2, '1', $3, now(), now(), $4, $5)`, [e, attr, src, conf, "a".repeat(64)]));
    await expect(ins("  ", 0.9)).rejects.toThrow(/check constraint/);
    await expect(ins("fonte", 1.5)).rejects.toThrow(/check constraint/);
    await ins("fonte", 0.9);
    await expect(as(Y, (db) => db.query(`INSERT INTO plataforma.fact (tenant_id, entity_id, attribute_id, value, source_name, observed_at, ingested_at, confidence, content_hash) VALUES (plataforma.current_tenant_id(), $1, 'city.teste_a', '2', 'fonte', now(), now(), 0.9, $2)`, [e, "b".repeat(64)]))).rejects.toThrow(/fact_current_idx/);
  });
  it("um fato é imutável: só superseded_at muda, uma vez; DELETE é negado", async () => {
    await expect(as(Y, (db) => db.query(`UPDATE plataforma.fact SET value = '0' WHERE attribute_id = 'city.teste_a'`))).rejects.toThrow(/permission denied/);
    await as(Y, (db) => db.query(`UPDATE plataforma.fact SET superseded_at = now() WHERE attribute_id = 'city.teste_a'`));
    await expect(as(Y, (db) => db.query(`UPDATE plataforma.fact SET superseded_at = now() WHERE attribute_id = 'city.teste_a'`))).rejects.toThrow(/encerrado uma vez/);
    await expect(as(Y, (db) => db.query(`DELETE FROM plataforma.fact`))).rejects.toThrow(/permission denied/);
  });
  it("entidade: tipo + chave da fonte são únicos; registrar de novo devolve a mesma", async () => {
    const a = await as(Y, (db) => upsertEntities(db, [{ entityType: "city", sourceKey: "ibge:9999999", name: "Cidade de teste" }]));
    const b = await as(Y, (db) => upsertEntities(db, [{ entityType: "city", sourceKey: "ibge:9999999", name: "Outro nome" }]));
    expect(b.get("city|ibge:9999999")).toBe(a.get("city|ibge:9999999"));
    expect(await count(Y, "entity", "source_key = 'ibge:9999999'")).toBe(1);
    await as(Y, (db) => db.query(`UPDATE plataforma.entity SET status = 'DEPRECATED' WHERE source_key = 'ibge:9999999'`));
    await expect(as(Y, (db) => db.query(`UPDATE plataforma.entity SET name = 'x' WHERE source_key = 'ibge:9999999'`))).rejects.toThrow(/permission denied/);
  });
});

describe("SIDRA como fato, ligado à resposta bruta", () => {
  it("grava os fatos do Censo 2022 com URL, licença e provider_call; município fora das entidades é ignorado", async () => {
    const ctx = { fetch: fakeFetch({ "https://apisidra.ibge.gov.br/": { body: SIDRA } }), userAgent: PUBLIC_UA, gate: new RateGate({}) };
    const got = await as(Y, async (db) => { const r = await fetchSidraCity({ db, ctx, ibgeCode: "3550308", budget: RunBudget.create(), runId: null, actor: "t", now: () => T0 }); if (r.state !== "ok") throw new Error(r.state); return r; });
    const r = await as(Y, (db) => recordSidraFacts(db, [{ facts: got.data, provenance: got.provenance }, { facts: { ...got.data, ibgeCode: "0000000" }, provenance: got.provenance }], realEstateFactConfidence, T0));
    expect(r.inserted).toBe(2);
    const f = await as(Y, async (db) => (await db.query<{ attribute_id: string; value: number; source_url: string; source_license: string; provider_call_id: string; observed_precision: string }>(`SELECT attribute_id, value, source_url, source_license, provider_call_id, observed_precision FROM plataforma.fact WHERE provider_call_id IS NOT NULL ORDER BY attribute_id`)).rows);
    expect(f.map((x) => [x.attribute_id, Number(x.value)])).toEqual([[CITY_ATTRS.censusDensity, 7528.26], [CITY_ATTRS.censusPopulation, 11451999]]);
    expect(f[0]).toMatchObject({ source_license: "dados abertos do IBGE", observed_precision: "year" });
    expect(f[0]!.source_url).toContain("apisidra.ibge.gov.br/values/t/4714/n6/3550308");
    expect(f[0]!.provider_call_id).toBe(got.provenance.callId);
  });
});

describe("catálogo de atributos (Attribute Discovery) sobre dados reais", () => {
  let first: Awaited<ReturnType<typeof runCatalog>>;
  const stat = (id: string) => first.stats.find((s) => s.definition.attributeId === id)!;
  it("mede cobertura real: UF e região VALID; população do Censo com 1 de 645 vira DATA_PENDING; bairro e anúncio sem entidades ficam DATA_PENDING (R12)", async () => {
    first = await as(Y, (db) => runCatalog(db, realEstateCatalog, T0, "teste"));
    expect(first.created).toBe(true);
    expect(stat("city.uf")).toMatchObject({ entitiesTotal: 645, entitiesWithValue: 645, coverage: 1, status: "VALID" }); // a entidade DEPRECATED de um teste anterior não conta
    expect(stat("city.region")).toMatchObject({ coverage: 1, status: "VALID" });
    expect(stat("city.population_census_2022")).toMatchObject({ entitiesWithValue: 1, status: "DATA_PENDING" });
    for (const a of ["neighborhood.price_per_m2", "neighborhood.poi_count_school", "neighborhood.travel_time_to_center", "listing.bedrooms"]) expect(stat(a), a).toMatchObject({ coverage: null, entitiesWithValue: 0, status: "DATA_PENDING" });
    expect(await count(Y, "fact", "attribute_id LIKE 'neighborhood.%' OR attribute_id LIKE 'listing.%'")).toBe(0);
  });
  it("a distribuição e o frescor vêm dos fatos (população de SP no máximo; observação mais antiga manda)", () => {
    expect(stat("city.population").distribution).toMatchObject({ n: expect.any(Number), max: 12000000 });
    expect(stat("city.population").freshnessDays).toBe(286); // 2026-01-01 → 2026-10-14
    expect(stat("city.uf").distribution).toMatchObject({ cardinality: 1, top: [{ value: "SP", count: 645 }] });
  });
  it("persiste a execução e as linhas; a leitura devolve o catálogo mais recente com a versão da política", async () => {
    const c = (await as(Y, (db) => latestCatalog(db)))!;
    expect(c.runId).toBe(first.runId);
    expect(c.policyVersion).toBe(1);
    expect(c.rows).toHaveLength(realEstateCatalog.attributes.length);
    expect(c.rows.find((r) => r.attributeId === "city.uf")).toMatchObject({ status: "VALID", origin: "OBSERVED", usableAsFact: true });
    expect(await count(Y, "attribute_catalog")).toBe(realEstateCatalog.attributes.length);
  });
  it("é idempotente: mesmos fatos, política e dia = a mesma execução, sem linhas novas", async () => {
    const again = await as(Y, (db) => runCatalog(db, realEstateCatalog, T0, "teste"));
    expect(again).toMatchObject({ created: false, runId: first.runId });
    expect(await count(Y, "catalog_run")).toBe(1);
    expect(await count(Y, "attribute_catalog")).toBe(realEstateCatalog.attributes.length);
  });
  it("política nova (versão 2) muda o resultado sem mudar o código e fica registrada; a versão 1 permanece", async () => {
    const v = await as(Y, (db) => savePolicyVersion(db, "attribute_discovery", { ...realEstateCatalog.defaultPolicy, minCoveragePartial: 0.001 }, "teste: aceita cobertura baixa como parcial", "teste"));
    expect(v).toEqual({ version: 2, created: true });
    expect(await as(Y, (db) => savePolicyVersion(db, "attribute_discovery", { ...realEstateCatalog.defaultPolicy, minCoveragePartial: 0.001 }, "igual", "teste"))).toEqual({ version: 2, created: false });
    const second = await as(Y, (db) => runCatalog(db, realEstateCatalog, T0, "teste"));
    expect(second.created).toBe(true);
    expect(second.policyVersion).toBe(2);
    expect(second.stats.find((s) => s.definition.attributeId === "city.population_census_2022")!.status).toBe("PARTIAL");
    expect(await count(Y, "policy")).toBe(2);
  });
  it("um valor de tipo errado numa entrada vira INVALID e não conta como cobertura", async () => {
    const e = (await as(Y, (db) => upsertEntities(db, [{ entityType: "city", sourceKey: "ibge:8888888", name: "Cidade inválida" }]))).get("city|ibge:8888888")!;
    await as(Y, (db) => recordFacts(db, [{ entityId: e, attributeId: "city.population", value: "muitos", sourceName: "teste", observedAt: T0, confidence: 0.9 }], T0));
    const c = await as(Y, (db) => runCatalog(db, realEstateCatalog, new Date(T0.getTime() + 86_400_000), "teste"));
    expect(c.stats.find((s) => s.definition.attributeId === "city.population")).toMatchObject({ status: "INVALID", invalidValues: 1 });
  });
});

describe("isolamento entre tenants", () => {
  it("o outro tenant não vê entidades, fatos, políticas nem catálogos, e não usa os do primeiro", async () => {
    for (const t of ["entity", "fact", "policy", "catalog_run", "attribute_catalog"]) expect(await count(Z, t), t).toBe(0);
    expect(await as(Z, (db) => currentFacts(db))).toEqual([]);
    expect(await as(Z, (db) => latestCatalog(db))).toBeNull();
    const zc = await as(Z, (db) => runCatalog(db, realEstateCatalog, T0, "teste"));
    expect(zc.stats.find((s) => s.definition.attributeId === "city.uf")).toMatchObject({ entitiesTotal: 0, coverage: null, status: "DATA_PENDING" });
  });
  it("um fato de Z não aponta para entidade de Y", async () => {
    const eY = await as(Y, async (db) => (await db.query<{ id: string }>(`SELECT id FROM plataforma.entity LIMIT 1`)).rows[0]!.id);
    await expect(as(Z, (db) => recordFacts(db, [{ entityId: eY, attributeId: "city.uf", value: "SP", sourceName: "x", observedAt: T0, confidence: 0.9 }], T0))).rejects.toThrow(/foreign key/);
  });
});
