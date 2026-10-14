import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb, devIdentity, getCityDetail, runCityImport, runGeneration, searchCities, withTenant } from "../index";
import { productPoolConfig } from "../testing/pool-config";

// Busca e detalhe de cidades contra o esquema REAL (migrations 0001 a 0007) num PostgreSQL descartável. Dados: extrato real do IBGE (SP, 645 municípios).
// Tenants exclusivos K e L (ambos importam o mesmo arquivo: os ids de cidade são diferentes por tenant).
const K = "f7777777-7777-4777-8777-777777777777";
const L = "f8888888-8888-4888-8888-888888888888";
const M = "f9999999-9999-4999-8999-999999999999"; // amostra multi-UF, com linha duplicada e rejeitadas
const SAMPLE = readFileSync(new URL("../../../../db/test-fixtures/ingest/cidades-amostra.csv", import.meta.url));
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv", import.meta.url));
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };

let pool: pg.Pool;
beforeAll(async () => {
  pool = new pg.Pool(productPoolConfig(4));
  pool.on("error", () => undefined);
  for (const t of [K, L]) await runCityImport(pool, id(), t, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: MAPPING });
  await runCityImport(pool, id(), M, { content: SAMPLE, fileName: "cidades-amostra.csv", sourceName: "fixture", origin: "test", mapping: { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region" } });
  await runGeneration(pool, id(), K, { scope: { uf: "SP", limit: 20 } }); // só K tem páginas: as 20 maiores populações
});
afterAll(async () => { await pool.end(); });
const id = () => devIdentity([K, L, M]);
const as = <T>(t: string, fn: (db: TenantDb) => Promise<T>) => withTenant(pool, id(), t, fn);
const find = (t: string, ibge: string) => as(t, (db) => searchCities(db, { q: ibge })).then((r) => r.rows.find((x) => x.ibgeCode === ibge)!);

describe("busca, filtro, ordenação e paginação de cidades", () => {
  it("lista as 645 cidades do tenant, com a origem da importação, em ordem de nome", async () => {
    const r = await as(K, (db) => searchCities(db, { limit: 100 }));
    expect(r.total).toBe(645);
    expect(r.rows).toHaveLength(100);
    expect(r.rows[0]).toMatchObject({ uf: "SP", region: "Sudeste", sourceName: "IBGE", sourceOrigin: "real", populationYear: 2026 });
    expect(typeof r.rows[0]!.population).toBe("number");
  });
  it("pagina sem repetir nem pular, com ordem determinística", async () => {
    const all: string[] = [];
    for (let offset = 0; offset < 645; offset += 100) all.push(...(await as(K, (db) => searchCities(db, { limit: 100, offset }))).rows.map((x) => x.id));
    expect(all).toHaveLength(645);
    expect(new Set(all).size).toBe(645);
    const again = (await as(K, (db) => searchCities(db, { limit: 100 }))).rows.map((x) => x.id);
    expect(again).toEqual(all.slice(0, 100));
  });
  it("busca por nome SEM diferenciar acentos nem maiúsculas (inclusive apóstrofo)", async () => {
    const names = async (q: string) => (await as(K, (db) => searchCities(db, { q }))).rows.map((x) => x.name);
    expect(await names("sao paulo")).toContain("São Paulo");
    expect(await names("SÃO PAULO")).toContain("São Paulo");
    expect(await names("aguas de lindoia")).toEqual(["Águas de Lindóia"]);
    expect(await names("barbara d'oeste")).toEqual(["Santa Bárbara d'Oeste"]);
    expect(await names("  campinas  ")).toEqual(["Campinas"]);
  });
  it("busca por código IBGE (inteiro ou prefixo) quando o texto é só dígitos", async () => {
    expect((await as(K, (db) => searchCities(db, { q: "3509502" }))).rows.map((x) => x.name)).toEqual(["Campinas"]);
    const prefix = await as(K, (db) => searchCities(db, { q: "35095", limit: 100 }));
    expect(prefix.total).toBeGreaterThan(0);
    expect(prefix.rows.every((x) => x.ibgeCode.startsWith("35095"))).toBe(true);
  });
  it("filtra por UF (o tenant só tem SP) e por existência de página", async () => {
    expect((await as(K, (db) => searchCities(db, { uf: "SP" }))).total).toBe(645);
    expect((await as(K, (db) => searchCities(db, { uf: "RJ" }))).total).toBe(0);
    const withPage = await as(K, (db) => searchCities(db, { hasPage: true, limit: 100 }));
    expect(withPage.total).toBe(20);
    expect(withPage.rows.every((x) => x.pageId !== null && x.pagePath !== null && x.pageStatus === "draft")).toBe(true);
    expect((await as(K, (db) => searchCities(db, { hasPage: false }))).total).toBe(625);
    expect((await as(L, (db) => searchCities(db, { hasPage: true }))).total).toBe(0);
  });
  it("ordena por população (decrescente, com desempate pelo código) e por código", async () => {
    const top = await as(K, (db) => searchCities(db, { sort: "population", dir: "desc", limit: 3 }));
    expect(top.rows[0]!.name).toBe("São Paulo");
    expect(top.rows[0]!.population).toBeGreaterThan(11_000_000);
    const byCode = (await as(K, (db) => searchCities(db, { sort: "ibge", limit: 100 }))).rows.map((x) => x.ibgeCode);
    expect(byCode).toEqual([...byCode].sort());
  });
  it("curingas, aspas e injeção de SQL no texto são tratados como TEXTO", async () => {
    for (const q of ["%", "_", "\\", "'; DROP TABLE plataforma.city;--", "a%b"]) expect((await as(K, (db) => searchCities(db, { q }))).total, q).toBe(0);
    expect((await as(K, (db) => searchCities(db, {}))).total).toBe(645); // a tabela continua intacta
  });
  it("limites do paginador: limit entre 1 e 100 e offset não negativo", async () => {
    expect((await as(K, (db) => searchCities(db, { limit: 0 }))).rows).toHaveLength(1);
    expect((await as(K, (db) => searchCities(db, { limit: 5000 }))).rows).toHaveLength(100);
    expect((await as(K, (db) => searchCities(db, { limit: 2, offset: -9 }))).rows).toHaveLength(2);
    const beyond = await as(K, (db) => searchCities(db, { limit: 20, offset: 5000 }));
    expect(beyond.rows).toHaveLength(0);
    expect(beyond.total).toBe(645); // o total continua correto além do fim
  });
  it("isolamento: K e L têm as mesmas cidades, mas com ids distintos, e cada um só enxerga as próprias", async () => {
    const k = (await as(K, (db) => searchCities(db, { limit: 100 }))).rows.map((x) => x.id);
    const l = (await as(L, (db) => searchCities(db, { limit: 100 }))).rows.map((x) => x.id);
    expect(k.filter((x) => l.includes(x))).toEqual([]);
    expect((await as(L, (db) => searchCities(db, {}))).total).toBe(645);
  });
});

describe("detalhe da cidade e proveniência", () => {
  it("São Paulo: atributos, linha original, execução de origem, página gerada e relações derivadas da fonte", async () => {
    const sp = await find(K, "3550308");
    const d = (await as(K, (db) => getCityDetail(db, sp.id)))!;
    expect(d.city).toMatchObject({ id: sp.id, ibgeCode: "3550308", name: "São Paulo", uf: "SP", region: "Sudeste", populationYear: 2026 });
    expect(d.source).toMatchObject({ sourceName: "IBGE", origin: "real", fileName: "sp-ibge-2026-10-12.csv", status: "succeeded", totalRows: 645, acceptedRows: 645 });
    expect(d.source!.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(d.record).toMatchObject({ outcome: "accepted", entityId: sp.id, issues: [] });
    expect(d.record!.raw).toMatchObject({ ibge_code: "3550308", name: "São Paulo", uf: "SP" });
    expect(d.page).toMatchObject({ path: "/cidades/sp/sao-paulo", status: "draft", latestVersion: 1 });
    expect(d.relations).toEqual({ uf: { code: "SP", cityCount: 645 }, region: { name: "Sudeste", cityCount: 645 } });
  });
  it("cidade sem página gerada: `page` é indefinido (não há página inventada)", async () => {
    const small = await find(K, "3500501"); // Águas de Lindóia, fora das 20 maiores
    const d = (await as(K, (db) => getCityDetail(db, small.id)))!;
    expect(d.page).toBeUndefined();
    expect(d.record).toBeDefined();
  });
  it("id malformado ou inexistente: indefinido, sem erro", async () => {
    for (const bad of ["", "abc", "1", "../x", "00000000-0000-4000-8000-000000000000", "' OR 1=1 --"]) expect(await as(K, (db) => getCityDetail(db, bad)), bad).toBeUndefined();
  });
  it("isolamento: um id VÁLIDO de outro tenant não existe (nada vaza)", async () => {
    const ofL = await find(L, "3550308");
    expect(await as(K, (db) => getCityDetail(db, ofL.id))).toBeUndefined();
    expect(await as(L, (db) => getCityDetail(db, ofL.id))).toBeDefined();
    const ofK = await find(K, "3550308");
    expect(await as(L, (db) => getCityDetail(db, ofK.id))).toBeUndefined();
  });
  it("o detalhe de L não tem página (as páginas são de K), mesmo sendo a mesma cidade", async () => {
    const ofL = await find(L, "3550308");
    expect((await as(L, (db) => getCityDetail(db, ofL.id)))!.page).toBeUndefined();
  });
});

describe("várias UFs e regiões, linhas rejeitadas e população ausente (amostra multi-UF)", () => {
  it("só as linhas ACEITAS viram cidades; duplicada e rejeitadas não aparecem", async () => {
    const all = await as(M, (db) => searchCities(db, { limit: 100 }));
    expect(all.total).toBe(7);
    expect(all.rows.map((x) => x.name).sort()).toEqual(["Alta Floresta D'Oeste", "Ariquemes", "Boa Esperança do Norte", "Bom Princípio do Piauí", "Brasília", "Rio de Janeiro", "São Paulo"]);
    expect((await as(M, (db) => searchCities(db, { q: "curitiba" }))).total).toBe(0); // linha rejeitada (UF inválida)
    expect(all.rows.every((x) => x.sourceOrigin === "test" && x.sourceName === "fixture")).toBe(true); // origem de teste é dita como teste
  });
  it("filtro por UF e por região conta certo (UF e região não se confundem)", async () => {
    expect((await as(M, (db) => searchCities(db, { uf: "RO" }))).total).toBe(2);
    expect((await as(M, (db) => searchCities(db, { uf: "SP" }))).total).toBe(1);
    expect((await as(M, (db) => searchCities(db, { uf: "RJ" }))).rows.map((x) => x.name)).toEqual(["Rio de Janeiro"]);
  });
  it("relações derivadas da fonte: contagem de cidades por UF e por região, no workspace", async () => {
    const sp = await find(M, "3550308");
    expect((await as(M, (db) => getCityDetail(db, sp.id)))!.relations).toEqual({ uf: { code: "SP", cityCount: 1 }, region: { name: "Sudeste", cityCount: 2 } }); // SP + RJ
    const ro = await find(M, "1100023");
    expect((await as(M, (db) => getCityDetail(db, ro.id)))!.relations).toEqual({ uf: { code: "RO", cityCount: 2 }, region: { name: "Norte", cityCount: 2 } });
    const df = await find(M, "5300108");
    expect((await as(M, (db) => getCityDetail(db, df.id)))!.relations).toEqual({ uf: { code: "DF", cityCount: 1 }, region: { name: "Centro-Oeste", cityCount: 2 } }); // DF + MT
  });
  it("população ausente na fonte: nula na lista e no detalhe (nunca zero)", async () => {
    const x = await find(M, "1100023");
    expect(x.population).toBeNull();
    expect(x.populationYear).toBeNull();
    const d = (await as(M, (db) => getCityDetail(db, x.id)))!;
    expect(d.city.population).toBeNull();
  });
  it("a cidade repetida no arquivo tem como registro a linha ACEITA (a primeira), e a origem registra 3 linhas problemáticas", async () => {
    const x = await find(M, "1100015");
    const d = (await as(M, (db) => getCityDetail(db, x.id)))!;
    expect(d.record).toMatchObject({ rowNumber: 1, outcome: "accepted", entityId: x.id });
    expect(d.source).toMatchObject({ status: "partial", totalRows: 11, acceptedRows: 7 });
  });
  it("ordenação por população com valores ausentes: os ausentes vão para o fim", async () => {
    const r = await as(M, (db) => searchCities(db, { sort: "population", dir: "desc", limit: 100 }));
    expect(r.rows.every((x) => x.population === null)).toBe(true); // a amostra não tem população: ordem determinística pelo código
    expect(r.rows.map((x) => x.ibgeCode)).toEqual([...r.rows.map((x) => x.ibgeCode)].sort());
  });
});
