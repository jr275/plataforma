import { readFileSync } from "node:fs";
import pg from "pg";
import { productPoolConfig } from "../testing/pool-config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb, devIdentity, getGenerationRunDetail, getPageDetail, runCityImport, runGeneration, searchPages, withTenant } from "../index";

// Consultas da interface contra o esquema REAL (migrations 0001 a 0007) num PostgreSQL descartável. Dados: extrato real do IBGE (SP).
// Tenants exclusivos G e H.
const G = "f3333333-3333-4333-8333-333333333333";
const H = "f4444444-4444-4444-8444-444444444444";
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv", import.meta.url));
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };

let pool: pg.Pool;
let runG = "";
let runH = "";
beforeAll(async () => {
  pool = new pg.Pool(productPoolConfig(4));
  pool.on("error", () => undefined);
  for (const t of [G, H]) await runCityImport(pool, id(), t, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: MAPPING });
  runG = (await runGeneration(pool, id(), G, { scope: { uf: "SP", limit: 20 } })).runId;
  runH = (await runGeneration(pool, id(), H, { scope: { uf: "SP", limit: 5 } })).runId;
});
afterAll(async () => { await pool.end(); });
const id = () => devIdentity([G, H]);
const as = <T>(t: string, fn: (db: TenantDb) => Promise<T>) => withTenant(pool, id(), t, fn);

describe("busca, filtro, ordenação e paginação de páginas", () => {
  it("lista todas as 20 do tenant, com os dados da cidade de origem, em ordem de URL", async () => {
    const r = await as(G, (db) => searchPages(db, { limit: 100 }));
    expect(r.total).toBe(20);
    expect(r.rows).toHaveLength(20);
    expect(r.rows.map((x) => x.path)).toEqual([...r.rows.map((x) => x.path)].sort());
    const sp = r.rows.find((x) => x.path === "/cidades/sp/sao-paulo")!;
    expect(sp).toMatchObject({ cityName: "São Paulo", uf: "SP", region: "Sudeste", status: "draft", latestVersion: 1, populationYear: 2026 });
    expect(sp.population).toBeGreaterThan(11_000_000);
  });
  it("busca por nome da cidade ou pela URL, sem diferenciar maiúsculas", async () => {
    expect((await as(G, (db) => searchPages(db, { q: "CAMPINAS" }))).rows.map((x) => x.cityName)).toEqual(["Campinas"]);
    expect((await as(G, (db) => searchPages(db, { q: "sao-bernardo" }))).rows.map((x) => x.cityName)).toEqual(["São Bernardo do Campo"]);
  });
  it("ordena por população (decrescente) e pagina sem repetir nem pular", async () => {
    const all = await as(G, (db) => searchPages(db, { sort: "population", dir: "desc", limit: 100 }));
    expect(all.rows[0]!.cityName).toBe("São Paulo");
    const p1 = await as(G, (db) => searchPages(db, { sort: "population", dir: "desc", limit: 5, offset: 0 }));
    const p2 = await as(G, (db) => searchPages(db, { sort: "population", dir: "desc", limit: 5, offset: 5 }));
    expect(p1.total).toBe(20);
    expect([...p1.rows, ...p2.rows].map((x) => x.id)).toEqual(all.rows.slice(0, 10).map((x) => x.id));
  });
  it("ordenação por data de atualização (todas EMPATADAS, nascidas na mesma execução): a paginação é estável, sem repetir nem pular, nos dois sentidos", async () => {
    const ties = await as(G, (db) => db.query<{ n: string }>("SELECT count(DISTINCT updated_at)::text AS n FROM plataforma.page"));
    expect(Number(ties.rows[0]!.n)).toBeLessThan(20); // o empate existe de fato: sem desempate, a ordem seria indefinida
    for (const dir of ["asc", "desc"] as const) {
      const all = await as(G, (db) => searchPages(db, { sort: "updated", dir, limit: 100 }));
      const pages: string[] = [];
      for (let offset = 0; offset < 20; offset += 7) pages.push(...(await as(G, (db) => searchPages(db, { sort: "updated", dir, limit: 7, offset }))).rows.map((x) => x.id));
      expect(pages).toHaveLength(20);
      expect(new Set(pages).size).toBe(20);
      expect(pages).toEqual(all.rows.map((x) => x.id));
      expect((await as(G, (db) => searchPages(db, { sort: "updated", dir, limit: 100 }))).rows.map((x) => x.id)).toEqual(all.rows.map((x) => x.id)); // repetível
    }
  });
  it("página além do fim: nenhuma linha, mas o TOTAL continua correto (a interface distingue 'fora do intervalo' de 'sem dados')", async () => {
    const r = await as(G, (db) => searchPages(db, { limit: 20, offset: 400 }));
    expect(r.rows).toHaveLength(0);
    expect(r.total).toBe(20);
  });
  it("filtra por status e por UF", async () => {
    expect((await as(G, (db) => searchPages(db, { status: "blocked" }))).total).toBe(0);
    expect((await as(G, (db) => searchPages(db, { uf: "RJ" }))).total).toBe(0);
    expect((await as(G, (db) => searchPages(db, { uf: "sp" }))).total).toBe(20);
  });
  it("curingas e injeção de SQL no texto da busca são tratados como TEXTO", async () => {
    expect((await as(G, (db) => searchPages(db, { q: "%" }))).total).toBe(0); // '%' não é curinga
    expect((await as(G, (db) => searchPages(db, { q: "_" }))).total).toBe(0);
    expect((await as(G, (db) => searchPages(db, { q: "'; DROP TABLE plataforma.page; --" }))).total).toBe(0);
    expect((await as(G, (db) => searchPages(db, { limit: 100 }))).total).toBe(20); // a tabela continua intacta
    expect((await as(G, (db) => searchPages(db, { sort: "path; DROP" as never, dir: "x" as never }))).total).toBe(20); // ordenação fora da lista cai no padrão
  });
  it("limites do paginador: limit entre 1 e 100 e offset não negativo", async () => {
    expect((await as(G, (db) => searchPages(db, { limit: 0 }))).rows).toHaveLength(1);
    expect((await as(G, (db) => searchPages(db, { limit: 9999 }))).rows).toHaveLength(20);
    expect((await as(G, (db) => searchPages(db, { offset: -5, limit: 3 }))).rows).toHaveLength(3);
  });
  it("isolamento: H só vê as próprias páginas", async () => {
    const h = await as(H, (db) => searchPages(db, { limit: 100 }));
    expect(h.total).toBe(5);
    const g = await as(G, (db) => searchPages(db, { limit: 100 }));
    const gIds = new Set(g.rows.map((x) => x.id));
    expect(h.rows.every((x) => !gIds.has(x.id))).toBe(true);
  });
});

describe("detalhe de página e de execução", () => {
  it("devolve a página, as versões e os gates da tentativa mais recente", async () => {
    const sp = (await as(G, (db) => searchPages(db, { q: "sao-paulo" }))).rows[0]!;
    const d = (await as(G, (db) => getPageDetail(db, sp.id)))!;
    expect(d.page.cityName).toBe("São Paulo");
    expect(d.versions.map((v) => v.version)).toEqual([1]);
    expect(d.versions[0]!.content.title).toBe("São Paulo (SP): população e localização");
    expect(d.latestAttempt).toMatchObject({ runId: runG, outcome: "generated" });
    expect(d.latestAttempt!.gates).toHaveLength(6);
    expect(d.latestAttempt!.gates.every((g) => g.outcome === "pass")).toBe(true);
  });
  it("id inválido ou de outro tenant não existe (sem vazar)", async () => {
    const sp = (await as(G, (db) => searchPages(db, { q: "sao-paulo" }))).rows[0]!;
    expect(await as(H, (db) => getPageDetail(db, sp.id))).toBeUndefined();
    expect(await as(G, (db) => getPageDetail(db, "isto-nao-e-uuid"))).toBeUndefined();
    expect(await as(G, (db) => getPageDetail(db, "99999999-9999-4999-8999-999999999999"))).toBeUndefined();
  });
  it("detalhe da execução: itens com cidade, caminho e gates; outro tenant não enxerga", async () => {
    const d = (await as(G, (db) => getGenerationRunDetail(db, runG)))!;
    expect(d.run).toMatchObject({ id: runG, status: "succeeded", totalItems: 20, generatedItems: 20 });
    expect(d.scope).toMatchObject({ uf: "SP", limit: 20 });
    expect(d.items).toHaveLength(20);
    expect(d.items.every((i) => i.pagePath?.startsWith("/cidades/sp/") && i.gates.length === 6)).toBe(true);
    expect(d.items.map((i) => i.ibgeCode)).toEqual([...d.items.map((i) => i.ibgeCode)].sort());
    expect(await as(H, (db) => getGenerationRunDetail(db, runG))).toBeUndefined();
    expect((await as(H, (db) => getGenerationRunDetail(db, runH)))!.items).toHaveLength(5);
  });
});
