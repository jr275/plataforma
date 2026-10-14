import { describe, expect, it } from "vitest";
import { GRAPH_TOOLS, createGraphReader, createMemoryGraphStore, formatRef, isGraphTool, parseRef, runGraphTool, toolsFor, type GraphNodeKind, type GraphReader, type StoreCity, type StoreSource } from "./index";

// DADOS SINTÉTICOS DE TESTE (nunca apresentados como reais): servem só para exercitar a lógica do leitor. A prova contra dados reais e contra o SQL
// está em graph.product.test.ts.
const NOW = new Date("2026-11-01T12:00:00Z");
const SRC: StoreSource = { runId: "c0000000-0000-4000-8000-000000000001", sourceName: "fonte-de-teste", origin: "test", fileName: "teste.csv", fileSha256: "ab".repeat(32), status: "succeeded", importedAt: new Date("2026-10-12T20:00:00Z"), totalRows: 6, acceptedRows: 6 };
const SRC2: StoreSource = { ...SRC, runId: "c0000000-0000-4000-8000-000000000002", importedAt: new Date("2026-10-20T20:00:00Z") };
const id = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const city = (n: number, name: string, uf: string, region: string | null, population: number | null, run = SRC.runId): StoreCity => ({ id: id(n), ibgeCode: String(3500000 + n), name, uf, region, population, populationYear: population === null ? null : 2026, sourceRunId: run });
const CITIES = [city(1, "Alfa", "SP", "Sudeste", 500), city(2, "Águas Beta", "SP", "Sudeste", 900), city(3, "Gama", "SP", "Sudeste", null), city(4, "Delta", "RJ", "Sudeste", 700, SRC2.runId), city(5, "Épsilon", "RO", "Norte", 100), city(6, "Zeta", "RO", null, 50)];
const PAGE_ID = "e0000000-0000-4000-8000-000000000001";
const reader = (): GraphReader => createGraphReader(createMemoryGraphStore({
  cities: CITIES, sources: [SRC, SRC2],
  pages: [{ page: { id: PAGE_ID, path: "/cidades/sp/agua-beta", status: "draft", latestVersion: 2, updatedAt: new Date("2026-10-13T03:10:00Z") }, cityId: id(2) }, { page: { id: "e0000000-0000-4000-8000-000000000002", path: "/cidades/ro/zeta", status: "blocked", latestVersion: 1, updatedAt: new Date("2026-10-13T03:10:00Z") }, cityId: id(6) }],
  records: new Map([[id(1), { rowNumber: 2, outcome: "accepted", raw: { ibge_code: "3500001", name: "Alfa" } }]]),
}));

describe("referências de nós", () => {
  it("formato e validação: só city/page com uuid, uf da lista e região da lista", () => {
    expect(parseRef(formatRef("city", id(1)))).toEqual({ kind: "city", key: id(1) });
    expect(parseRef("uf:SP")).toEqual({ kind: "uf", key: "SP" });
    expect(parseRef("region:Centro-Oeste")).toEqual({ kind: "region", key: "Centro-Oeste" });
    for (const bad of ["", "city", "city:", "city:abc", "uf:XX", "uf:sp", "region:Leste", "page:1", "x:SP", ":SP", "city:' OR 1=1", `city:${id(1)}:x`]) expect(parseRef(bad), bad).toBeUndefined();
  });
});

describe("nós: atributos com natureza, proveniência e sugestões", () => {
  it("cidade: valores literais da fonte são `fact`; vínculo com a página é derivado; sem página gera SUGESTÃO (nunca fato)", async () => {
    const d = (await reader().node(`city:${id(1)}`))!;
    expect(d.node).toMatchObject({ kind: "city", label: "Alfa", detail: "SP · 3500001" });
    expect(d.attributes.every((a) => a.basis === "fact")).toBe(true);
    expect(d.attributes.find((a) => a.label === "População")!.value).toBe("500");
    expect(d.provenance.sources[0]).toMatchObject({ sourceName: "fonte-de-teste", origin: "test" });
    expect(d.provenance.record).toMatchObject({ rowNumber: 2, outcome: "accepted" });
    expect(d.counts).toEqual({ uf: 1, page: 0 });
    expect(d.suggestions).toEqual([{ text: expect.stringContaining("Nenhuma página gerada"), href: "/generation" }]);
    expect(d.links.map((l) => l.href)).toEqual([`/cities/${id(1)}`, `/data-flow?run=${SRC.runId}`]);
  });
  it("cidade com campos ausentes: 'não informado', nunca zero", async () => {
    const d = (await reader().node(`city:${id(3)}`))!;
    expect(d.attributes.find((a) => a.label === "População")!.value).toBe("não informado");
    const z = (await reader().node(`city:${id(6)}`))!;
    expect(z.attributes.find((a) => a.label === "Região")!.value).toBe("não informado");
  });
  it("UF: contagens são `derived`; regiões observadas vêm das colunas das cidades; sugestão aponta as cidades sem página", async () => {
    const d = (await reader().node("uf:SP"))!;
    expect(d.attributes.find((a) => a.label === "Sigla")!.basis).toBe("fact");
    expect(d.attributes.filter((a) => a.label !== "Sigla").every((a) => a.basis === "derived")).toBe(true);
    expect(d.attributes.find((a) => a.label === "Cidades neste workspace")!.value).toBe("3");
    expect(d.attributes.find((a) => a.label === "Com população informada")!.value).toBe("2");
    expect(d.attributes.find((a) => a.label === "Com página gerada")!.value).toBe("1");
    expect(d.attributes.find((a) => a.label === "Regiões observadas nas cidades")!.value).toBe("Sudeste");
    expect(d.suggestions[0]).toMatchObject({ text: expect.stringContaining("2 cidade(s)"), href: "/cities?uf=SP&pages=without" });
  });
  it("RO tem uma cidade sem região: a região observada é só a que existe; nada é completado", async () => {
    const d = (await reader().node("uf:RO"))!;
    expect(d.attributes.find((a) => a.label === "Regiões observadas nas cidades")!.value).toBe("Norte");
    expect(d.counts).toEqual({ city: 2, region: 1 });
  });
  it("UF com cidades de duas execuções: a proveniência lista as duas, a mais recente primeiro, com o intervalo de atualidade", async () => {
    const r = reader();
    const sudeste = (await r.node("region:Sudeste"))!;
    expect(sudeste.provenance.sources.map((s) => s.runId)).toEqual([SRC2.runId, SRC.runId]);
    expect(sudeste.provenance.newestImportAt).toEqual(SRC2.importedAt);
    expect(sudeste.provenance.oldestImportAt).toEqual(SRC.importedAt);
    expect(sudeste.attributes.find((a) => a.label === "UFs observadas nas cidades")!.value).toBe("RJ, SP");
  });
  it("página: status e URL são derivados; a cidade de origem é fato; bloqueada sugere ver os gates", async () => {
    const d = (await reader().node(`page:${PAGE_ID}`))!;
    expect(d.node).toMatchObject({ kind: "page", label: "/cidades/sp/agua-beta", detail: "rascunho" });
    expect(d.attributes.find((a) => a.label === "Status")!.value).toContain("não publicada");
    expect(d.attributes.find((a) => a.label === "Cidade de origem")!.basis).toBe("fact");
    const b = (await reader().node("page:e0000000-0000-4000-8000-000000000002"))!;
    expect(b.suggestions[0]!.text).toContain("bloqueada");
  });
  it("inexistente, inválido ou de outro tipo: undefined, sem erro", async () => {
    const r = reader();
    for (const ref of ["uf:AC", "region:Sul", `city:${id(99)}`, `page:${id(1)}`, "uf:XX", "lixo"]) expect(await r.node(ref), ref).toBeUndefined();
  });
});

describe("expansão: só relações que existem nos dados", () => {
  it("cidade: UF (coluna da fonte) e página (vínculo gravado), com direção e base de cada aresta", async () => {
    const x = (await reader().expand(`city:${id(2)}`))!;
    expect(x.neighbors.map((n) => n.ref).sort()).toEqual([`page:${PAGE_ID}`, "uf:SP"].sort());
    const toUf = x.edges.find((e) => e.kind === "belongs_to_uf")!;
    expect(toUf).toMatchObject({ from: `city:${id(2)}`, to: "uf:SP", basis: "source_column", label: "pertence à UF" });
    expect(x.edges.find((e) => e.kind === "has_page")).toMatchObject({ from: `city:${id(2)}`, to: `page:${PAGE_ID}`, basis: "recorded_link" });
    expect(x.totals).toEqual({ uf: 1, page: 1 });
  });
  it("cidade sem página: não há vizinho de página inventado", async () => {
    const x = (await reader().expand(`city:${id(1)}`))!;
    expect(x.neighbors.map((n) => n.kind)).toEqual(["uf"]);
    expect(x.totals.page).toBe(0);
  });
  it("UF: regiões observadas e as cidades de maior população primeiro (empate pelo código); `truncated` quando há mais", async () => {
    const full = (await reader().expand("uf:SP"))!;
    expect(full.neighbors.filter((n) => n.kind === "city").map((n) => n.label)).toEqual(["Águas Beta", "Alfa", "Gama"]); // 900, 500, sem população por último
    expect(full.neighbors.find((n) => n.kind === "region")).toMatchObject({ ref: "region:Sudeste" });
    expect(full.truncated).toBe(false);
    const cut = (await reader().expand("uf:SP", { limit: 2 }))!;
    expect(cut.shown.city).toBe(2);
    expect(cut.totals.city).toBe(3);
    expect(cut.truncated).toBe(true);
    expect(cut.edges.filter((e) => e.kind === "belongs_to_uf").every((e) => e.to === "uf:SP")).toBe(true);
  });
  it("filtro por tipo: só os tipos pedidos aparecem, e os totais continuam contando todos", async () => {
    const x = (await reader().expand("uf:SP", { kinds: ["region"] }))!;
    expect(x.neighbors.every((n) => n.kind === "region")).toBe(true);
    expect(x.totals.city).toBe(3);
    expect(x.shown.city).toBeUndefined();
    expect(x.truncated).toBe(false); // cidades filtradas não contam como truncadas
  });
  it("região: as UFs observadas, com a contagem de cidades; sem cidades diretas", async () => {
    const x = (await reader().expand("region:Sudeste"))!;
    expect(x.neighbors.map((n) => n.label).sort()).toEqual(["RJ", "SP"]);
    expect(x.neighbors.find((n) => n.label === "SP")!.detail).toBe("3 cidade(s)");
    expect(x.edges.every((e) => e.kind === "in_region" && e.to === "region:Sudeste" && e.basis === "source_column")).toBe(true);
  });
  it("página: a cidade de origem", async () => {
    const x = (await reader().expand(`page:${PAGE_ID}`))!;
    expect(x.neighbors).toHaveLength(1);
    expect(x.edges[0]).toMatchObject({ from: `city:${id(2)}`, to: `page:${PAGE_ID}`, kind: "has_page" });
  });
  it("limite: entre 1 e 96", async () => {
    expect((await reader().expand("uf:SP", { limit: 0 }))!.shown.city).toBe(1);
    expect((await reader().expand("uf:SP", { limit: 9999 }))!.shown.city).toBe(3);
  });
  it("NENHUM vizinho é fantasma: todo nó e toda aresta de toda expansão resolve para um nó real", async () => {
    const r = reader();
    const refs = ["uf:SP", "uf:RJ", "uf:RO", "region:Sudeste", "region:Norte", `city:${id(2)}`, `city:${id(6)}`, `page:${PAGE_ID}`];
    for (const ref of refs) {
      const x = (await r.expand(ref))!;
      for (const n of x.neighbors) expect(await r.node(n.ref), `${ref} -> ${n.ref}`).toBeDefined();
      for (const e of x.edges) expect([x.center.ref, ...x.neighbors.map((n) => n.ref)]).toEqual(expect.arrayContaining([e.from, e.to]));
    }
  });
});

describe("busca", () => {
  it("sem acento nem maiúsculas; por tipo; com totais", async () => {
    const r = reader();
    expect((await r.search("aguas")).nodes.map((n) => n.label)).toEqual(["Águas Beta"]);
    expect((await r.search("EPSILON")).nodes.map((n) => n.label)).toEqual(["Épsilon"]);
    const sp = await r.search("sp");
    expect(sp.nodes.some((n) => n.ref === "uf:SP")).toBe(true);
    const sud = await r.search("sudeste");
    expect(sud.nodes[0]).toMatchObject({ ref: "region:Sudeste", detail: "4 cidade(s)" });
    expect((await r.search("3500002")).nodes.map((n) => n.label)).toEqual(["Águas Beta"]); // código IBGE
    expect((await r.search("agua", { kinds: ["uf"] })).nodes).toEqual([]);
    expect((await r.search("cidades/sp")).nodes.map((n) => n.kind)).toEqual(["page"]);
    expect((await r.search("zzzz")).nodes).toEqual([]);
    expect((await r.search("")).nodes.filter((n) => n.kind === "uf" || n.kind === "region")).toEqual([]); // vazio não lista UFs nem regiões
  });
});

describe("ferramentas reais e somente leitura", () => {
  const run = (tool: Parameters<typeof runGraphTool>[1], ref: string) => runGraphTool(reader(), tool, ref, NOW);
  it("todas as ferramentas aplicáveis a cada tipo executam e devolvem passos, achados e citações (nunca inferência)", async () => {
    const refs: [GraphNodeKind, string][] = [["city", `city:${id(2)}`], ["uf", "uf:SP"], ["region", "region:Sudeste"], ["page", `page:${PAGE_ID}`]];
    for (const [kind, ref] of refs) for (const tool of toolsFor(kind)) {
      const r = await run(tool, ref);
      expect(r.ok, `${tool} ${ref}`).toBe(true);
      expect(r.steps.every((s) => s.status === "done")).toBe(true);
      expect(r.findings.length).toBeGreaterThan(0);
      expect(r.findings.every((f) => ["fact", "derived", "suggestion"].includes(f.basis))).toBe(true);
    }
  });
  it("tool inexistente, referência inválida, tipo não aplicável e entidade ausente falham com mensagem clara (sem lançar)", async () => {
    expect(isGraphTool("rm -rf")).toBe(false);
    expect(GRAPH_TOOLS).toHaveLength(5);
    expect((await run("describe_entity", "lixo")).error).toContain("inválida");
    expect((await run("top_cities", `city:${id(1)}`)).error).toContain("não se aplica");
    expect((await run("describe_entity", "uf:AC")).error).toContain("não existe");
  });
  it("trace_source: a origem de TESTE é dita como teste, com o arquivo, o sha256 e a idade em dias", async () => {
    const r = await run("trace_source", `city:${id(1)}`);
    const f = (label: string) => r.findings.find((x) => x.label === label)!;
    expect(f("Fonte").value).toContain("origem de TESTE");
    expect(f("Arquivo").value).toBe("teste.csv");
    expect(f("SHA-256").value).toBe("ab".repeat(32));
    expect(f("Importado em").value).toContain("há 19 dia(s)"); // 12/10 20:00Z a 01/11 12:00Z = 19 dias e 16 horas
    expect(f("Importado em").basis).toBe("derived");
    expect(f("Linha original").value).toContain("ibge_code=3500001");
  });
  it("check_generation: cidade sem página recebe uma SUGESTÃO, nunca um fato", async () => {
    const r = await run("check_generation", `city:${id(1)}`);
    expect(r.findings.find((f) => f.label === "Página gerada")!.value).toBe("nenhuma");
    expect(r.findings.find((f) => f.basis === "suggestion")!.href).toBe("/generation");
  });
  it("top_cities (só UF): por população decrescente, ausentes por último, com link para a cidade; região não se aplica", async () => {
    const r = await run("top_cities", "uf:SP");
    expect(r.findings.map((f) => f.label)).toEqual(["Águas Beta", "Alfa", "Gama"]);
    expect(r.findings[0]!.href).toBe(`/cities/${id(2)}`);
    expect((await run("top_cities", "region:Sudeste")).error).toContain("não se aplica");
  });
  it("list_relationships: totais e arestas com direção", async () => {
    const r = await run("list_relationships", "uf:SP");
    expect(r.findings.some((f) => f.label === "Vizinhos do tipo city" && f.value.startsWith("3"))).toBe(true);
    expect(r.findings.some((f) => f.label === "está na região")).toBe(true);
  });
});
