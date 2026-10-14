import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb, devIdentity, graph, runCityImport, runGeneration, withTenant } from "../index";
import { productPoolConfig } from "../testing/pool-config";

// Grafo de conhecimento contra o esquema REAL (migrations 0001 a 0007) num PostgreSQL descartável. Dados: extrato real do IBGE (SP, 645 municípios)
// e a amostra multi-UF de teste. Tenants exclusivos N e O. Só leitura: o grafo não tem tabela própria (nenhuma migration).
const N = "fa111111-1111-4111-8111-111111111111";
const O = "fa222222-2222-4222-8222-222222222222";
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv", import.meta.url));
const SAMPLE = readFileSync(new URL("../../../../db/test-fixtures/ingest/cidades-amostra.csv", import.meta.url));
const FULL_MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };

let pool: pg.Pool;
beforeAll(async () => {
  pool = new pg.Pool(productPoolConfig(4));
  pool.on("error", () => undefined);
  await runCityImport(pool, id(), N, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: FULL_MAPPING });
  await runCityImport(pool, id(), O, { content: SAMPLE, fileName: "cidades-amostra.csv", sourceName: "fixture", origin: "test", mapping: { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region" } });
  await runGeneration(pool, id(), N, { scope: { uf: "SP", limit: 20 } });
});
afterAll(async () => { await pool.end(); });
const id = () => devIdentity([N, O]);
const as = <T>(t: string, fn: (db: TenantDb) => Promise<T>) => withTenant(pool, id(), t, fn);
const sql = <T>(t: string, fn: (r: graph.GraphReader) => Promise<T>) => as(t, (db) => fn(graph.createGraphReader(graph.createSqlGraphStore(db))));
const cityRef = async (t: string, ibge: string) => (await sql(t, (r) => r.search(ibge))).nodes.find((n) => n.kind === "city" && n.detail!.endsWith(ibge))!.ref;

describe("o leitor SQL e o de memória respondem IGUAL aos mesmos dados (a prévia de desenvolvimento é fiel)", () => {
  it("nós, expansões e buscas coincidem (inclusive datas, contagens e ordem)", async () => {
    // Monta o armazenamento de memória a partir das linhas do PRÓPRIO banco (mesmos ids), e compara as respostas dos dois leitores.
    const { cities, sources, pages, records } = await as(N, async (db) => {
      const c = await db.query<{ id: string; ibge_code: string; name: string; uf: string; region: string | null; population: string | null; population_year: number | null; source_run_id: string }>(`SELECT id, ibge_code, name, uf, region, population, population_year, source_run_id FROM plataforma.city`);
      const store = graph.createSqlGraphStore(db);
      const src = (await store.uf("SP"))!.sources;
      const p = await db.query<{ id: string; path: string; status: "draft" | "blocked"; latest_version: number; updated_at: Date; entity_id: string }>(`SELECT id, path, status, latest_version, updated_at, entity_id FROM plataforma.page`);
      const rec = new Map<string, { rowNumber: number; outcome: string; raw: Record<string, string> }>();
      for (const ibge of ["3550308", "3509502", "3500501"]) {
        const row = c.rows.find((x) => x.ibge_code === ibge)!;
        const d = await store.city(row.id);
        if (d?.record) rec.set(row.id, { rowNumber: d.record.rowNumber, outcome: d.record.outcome, raw: { ...d.record.raw } });
      }
      return {
        cities: c.rows.map((x) => ({ id: x.id, ibgeCode: x.ibge_code, name: x.name, uf: x.uf, region: x.region, population: x.population === null ? null : Number(x.population), populationYear: x.population_year, sourceRunId: x.source_run_id })),
        sources: src, records: rec, pages: p.rows.map((x) => ({ page: { id: x.id, path: x.path, status: x.status, latestVersion: x.latest_version, updatedAt: x.updated_at }, cityId: x.entity_id })),
      };
    });
    const mem = graph.createGraphReader(graph.createMemoryGraphStore({ cities, sources, pages, records }));
    const pageId = pages[0]!.page.id;
    const sp = cities.find((c) => c.ibgeCode === "3550308")!.id;
    const noPage = cities.find((c) => c.ibgeCode === "3500501")!.id;
    const refs = ["uf:SP", "region:Sudeste", `city:${sp}`, `city:${noPage}`, `page:${pageId}`, "uf:RJ", "region:Norte", "uf:XX"];
    for (const ref of refs) {
      expect(JSON.stringify(await mem.node(ref)), `node ${ref}`).toBe(JSON.stringify(await sql(N, (r) => r.node(ref))));
      for (const options of [undefined, { limit: 5 }, { limit: 96 }, { kinds: ["region" as const] }, { kinds: ["city" as const], limit: 3 }]) {
        expect(JSON.stringify(await mem.expand(ref, options)), `expand ${ref} ${JSON.stringify(options)}`).toBe(JSON.stringify(await sql(N, (r) => r.expand(ref, options))));
      }
    }
    for (const q of ["sao", "são paulo", "campinas", "3509", "3550308", "sp", "sud", "cidades/sp", "mogi", "zzz", "", "%", "d'oeste"]) {
      for (const options of [undefined, { perKind: 3 }, { kinds: ["city" as const] }]) {
        expect(JSON.stringify(await mem.search(q, options)), `search ${JSON.stringify(q)} ${JSON.stringify(options)}`).toBe(JSON.stringify(await sql(N, (r) => r.search(q, options))));
      }
    }
  });
});

describe("grafo sobre o extrato real (SP): relações vindas das colunas da fonte", () => {
  it("UF SP: 645 cidades, 20 com página, região Sudeste; a expansão é limitada e marca que há mais", async () => {
    const d = (await sql(N, (r) => r.node("uf:SP")))!;
    expect(d.attributes.find((a) => a.label === "Cidades neste workspace")!.value).toBe("645");
    expect(d.attributes.find((a) => a.label === "Com página gerada")!.value).toBe("20");
    expect(d.attributes.find((a) => a.label === "Regiões observadas nas cidades")!.value).toBe("Sudeste");
    expect(d.provenance.sources[0]).toMatchObject({ sourceName: "IBGE", origin: "real", fileName: "sp-ibge-2026-10-12.csv", status: "succeeded", totalRows: 645, acceptedRows: 645 });
    expect(d.suggestions[0]!.text).toContain("625");
    const x = (await sql(N, (r) => r.expand("uf:SP")))!;
    expect(x.shown.city).toBe(24);
    expect(x.totals.city).toBe(645);
    expect(x.truncated).toBe(true);
    expect(x.neighbors.find((n) => n.kind === "city")!.label).toBe("São Paulo"); // maior população
    const more = (await sql(N, (r) => r.expand("uf:SP", { limit: 96 })))!;
    expect(more.shown.city).toBe(96);
    expect(more.edges.filter((e) => e.kind === "belongs_to_uf")).toHaveLength(96);
  });
  it("cidade → UF e página; página → cidade; as arestas têm a base correta", async () => {
    const ref = await cityRef(N, "3550308");
    const x = (await sql(N, (r) => r.expand(ref)))!;
    expect(x.neighbors.map((n) => n.kind).sort()).toEqual(["page", "uf"]);
    expect(x.edges.find((e) => e.kind === "belongs_to_uf")).toMatchObject({ basis: "source_column", to: "uf:SP" });
    const page = x.neighbors.find((n) => n.kind === "page")!;
    expect(page.label).toBe("/cidades/sp/sao-paulo");
    expect(x.edges.find((e) => e.kind === "has_page")).toMatchObject({ basis: "recorded_link", from: ref, to: page.ref });
    const back = (await sql(N, (r) => r.expand(page.ref)))!;
    expect(back.neighbors[0]).toMatchObject({ kind: "city", ref });
    const noPageRef = await cityRef(N, "3500501");
    const noPage = (await sql(N, (r) => r.expand(noPageRef)))!;
    expect(noPage.neighbors.map((n) => n.kind)).toEqual(["uf"]);
  });
  it("nenhum vizinho é fantasma: tudo que uma expansão devolve resolve para um nó", async () => {
    for (const ref of ["uf:SP", "region:Sudeste", await cityRef(N, "3509502")]) {
      const x = (await sql(N, (r) => r.expand(ref, { limit: 30 })))!;
      for (const n of x.neighbors) expect(await sql(N, (r) => r.node(n.ref)), `${ref} -> ${n.ref}`).toBeDefined();
    }
  });
  it("ferramentas rodam sobre o SQL: origem real, idade em dias e sugestão (nunca fato) para cidade sem página", async () => {
    const now = new Date();
    const t = await sql(N, (r) => graph.runGraphTool(r, "trace_source", "uf:SP", now));
    expect(t.ok).toBe(true);
    expect(t.findings.find((f) => f.label === "Fonte")!.value).toContain("origem real");
    const noPageRef = await cityRef(N, "3500501");
    const c = await sql(N, (r) => graph.runGraphTool(r, "check_generation", noPageRef, now));
    expect(c.findings.find((f) => f.basis === "suggestion")).toBeDefined();
    const top = await sql(N, (r) => graph.runGraphTool(r, "top_cities", "uf:SP", now));
    expect(top.findings[0]!.label).toBe("São Paulo");
  });
});

describe("várias UFs e regiões (amostra multi-UF)", () => {
  it("relações e contagens vêm só do que existe: Sudeste = RJ e SP; Norte = RO; cidade repetida e rejeitadas não viram nós", async () => {
    const sudeste = (await sql(O, (r) => r.expand("region:Sudeste")))!;
    expect(sudeste.neighbors.map((n) => `${n.label}:${n.detail}`).sort()).toEqual(["RJ:1 cidade(s)", "SP:1 cidade(s)"]);
    const ro = (await sql(O, (r) => r.node("uf:RO")))!;
    expect(ro.attributes.find((a) => a.label === "Cidades neste workspace")!.value).toBe("2"); // a linha repetida não conta
    expect((await sql(O, (r) => r.node("uf:PR"))) /* a linha com UF inválida foi rejeitada */).toBeUndefined();
    expect((await sql(O, (r) => r.search("curitiba"))).nodes).toEqual([]);
    expect((await sql(O, (r) => r.node("region:Sul")))).toBeUndefined();
  });
  it("origem de teste é dita como teste na proveniência", async () => {
    const d = (await sql(O, (r) => r.node("uf:SP")))!;
    expect(d.provenance.sources[0]).toMatchObject({ origin: "test", sourceName: "fixture" });
  });
});

describe("isolamento entre tenants e somente leitura", () => {
  it("um nó VÁLIDO de outro tenant não existe (cidade, página e agregados); a busca não o encontra", async () => {
    const ofO = await cityRef(O, "1100023"); // Ariquemes (RO), só em O
    expect(await sql(N, (r) => r.node(ofO))).toBeUndefined();
    expect(await sql(N, (r) => r.expand(ofO))).toBeUndefined();
    expect(await sql(O, (r) => r.node(ofO))).toBeDefined();
    expect(await sql(N, (r) => r.node("uf:RO"))).toBeUndefined(); // N só tem SP
    const pageOfN = (await sql(N, (r) => r.search("cidades/sp"))).nodes.find((n) => n.kind === "page")!;
    expect(await sql(O, (r) => r.node(pageOfN.ref))).toBeUndefined();
    expect((await sql(O, (r) => r.search("cidades/sp"))).totals.page).toBe(0);
  });
  it("entradas hostis: referência malformada ou injeção é recusada sem erro de banco", async () => {
    for (const ref of ["", "city:' OR 1=1 --", "uf:SP'; DROP TABLE plataforma.city;--", "region:%", "page:00000000-0000-4000-8000-000000000000", "city:00000000-0000-4000-8000-000000000000"]) {
      expect(await sql(N, (r) => r.node(ref)), ref).toBeUndefined();
      expect(await sql(N, (r) => r.expand(ref)), ref).toBeUndefined();
    }
    for (const q of ["%", "_", "\\", "'; DROP TABLE plataforma.city;--"]) expect((await sql(N, (r) => r.search(q))).nodes, q).toEqual([]);
    expect((await sql(N, (r) => r.node("uf:SP")))).toBeDefined(); // as tabelas continuam intactas
  });
  it("só leitura: nenhuma tabela muda depois de uma bateria de consultas e ferramentas", async () => {
    const counts = () => as(N, async (db) => (await db.query<{ t: string }>(`SELECT (SELECT count(*) FROM plataforma.city) || '/' || (SELECT count(*) FROM plataforma.page) || '/' || (SELECT count(*) FROM plataforma.page_version) || '/' || (SELECT count(*) FROM plataforma.generation_run) || '/' || (SELECT count(*) FROM plataforma.import_run) || '/' || (SELECT count(*) FROM plataforma.import_record) AS t`)).rows[0]!.t);
    const before = await counts();
    const ref = await cityRef(N, "3550308");
    for (const tool of graph.GRAPH_TOOLS) await sql(N, (r) => graph.runGraphTool(r, tool, tool === "top_cities" ? "uf:SP" : ref, new Date()));
    await sql(N, (r) => r.expand("uf:SP", { limit: 96 }));
    expect(await counts()).toBe(before);
  });
});
