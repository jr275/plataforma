import { describe, expect, it } from "vitest";
import { graph } from "@plataforma/api";
import { DEFAULT_LIMIT, graphHref, loadGraphWorkspace, parseGraphParams } from "./graph";

// DADOS SINTÉTICOS DE TESTE: servem só para exercitar o carregador. O leitor é o REAL (packages/api), sobre armazenamento em memória.
const SRC: graph.StoreSource = { runId: "c0000000-0000-4000-8000-000000000001", sourceName: "fonte-de-teste", origin: "test", fileName: "t.csv", fileSha256: "ab".repeat(32), status: "succeeded", importedAt: new Date("2026-10-12T20:00:00Z"), totalRows: 3, acceptedRows: 3 };
const c = (n: number, name: string, uf: string, region: string | null, pop: number | null): graph.StoreCity => ({ id: `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`, ibgeCode: String(3500000 + n), name, uf, region, population: pop, populationYear: pop === null ? null : 2026, sourceRunId: SRC.runId });
const reader = (cities: graph.StoreCity[]) => graph.createGraphReader(graph.createMemoryGraphStore({ cities, sources: [SRC] }));
const CITIES = [c(1, "Alfa", "SP", "Sudeste", 500), c(2, "Beta", "SP", "Sudeste", 900), c(3, "Gama", "RJ", "Sudeste", 700)];

describe("parseGraphParams (defensivo)", () => {
  it("padrões, referência válida, limite e tipos", () => {
    expect(parseGraphParams({})).toEqual({ node: "", q: "", kinds: [], limit: DEFAULT_LIMIT });
    expect(parseGraphParams({ node: "uf:SP", q: "  são  ", kinds: "city,uf,city", limit: "48" })).toEqual({ node: "uf:SP", q: "são", kinds: ["city", "uf"], limit: 48 });
  });
  it("referência inválida some; tipo fora da lista some; limite é preso a 1..96; texto a 80", () => {
    for (const node of ["uf:XX", "city:abc", "lixo", "region:Leste", "page:1", "' OR 1=1"]) expect(parseGraphParams({ node }).node, node).toBe("");
    expect(parseGraphParams({ kinds: "city,admin,'; DROP" }).kinds).toEqual(["city"]);
    expect(parseGraphParams({ limit: "0" }).limit).toBe(1);
    expect(parseGraphParams({ limit: "9999" }).limit).toBe(96);
    expect(parseGraphParams({ limit: "abc" }).limit).toBe(DEFAULT_LIMIT);
    expect(parseGraphParams({ q: "x".repeat(200) }).q).toHaveLength(80);
    expect(parseGraphParams({ node: ["uf:SP"], q: ["a"], kinds: ["city"] })).toEqual({ node: "", q: "", kinds: [], limit: DEFAULT_LIMIT }); // arrays não são aceitos
  });
});

describe("graphHref: a URL é o estado", () => {
  it("omite os padrões e preserva busca, filtro e limite ao navegar", () => {
    const p = parseGraphParams({});
    expect(graphHref(p)).toBe("/graph");
    expect(graphHref(p, { node: "uf:SP" })).toBe("/graph?node=uf%3ASP");
    expect(graphHref({ ...p, q: "sao", kinds: ["city", "uf"], limit: 48 }, { node: "uf:SP" })).toBe("/graph?node=uf%3ASP&q=sao&kinds=city%2Cuf&limit=48");
    expect(graphHref({ ...p, kinds: [...graph.NODE_KINDS] }, {})).toBe("/graph"); // todos os tipos = sem filtro
  });
});

describe("loadGraphWorkspace", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  it("sem nó: só pontos de partida REAIS (regiões que existem), sem inspetor nem expansão", async () => {
    const d = await loadGraphWorkspace(reader(CITIES), parseGraphParams({}), now);
    expect(d.starters.map((n) => n.label)).toEqual(["Sudeste"]); // as outras regiões não existem nos dados: não são oferecidas
    expect(d.detail).toBeUndefined();
    expect(d.expansion).toBeUndefined();
    expect(d.nodeMissing).toBe(false);
  });
  it("sem nenhuma cidade: sem pontos de partida (estado vazio verdadeiro)", async () => {
    expect((await loadGraphWorkspace(reader([]), parseGraphParams({}), now)).starters).toEqual([]);
  });
  it("com nó: detalhe e expansão do MESMO nó, respeitando o filtro de tipos e o limite", async () => {
    const d = await loadGraphWorkspace(reader(CITIES), parseGraphParams({ node: "uf:SP", kinds: "city", limit: "1" }), now);
    expect(d.detail!.node.ref).toBe("uf:SP");
    expect(d.expansion!.center.ref).toBe("uf:SP");
    expect(d.expansion!.neighbors.map((n) => n.label)).toEqual(["Beta"]);
    expect(d.expansion!.truncated).toBe(true);
    expect(d.starters).toEqual([]);
  });
  it("nó pedido que não existe: `nodeMissing` (não é erro de infraestrutura)", async () => {
    const d = await loadGraphWorkspace(reader(CITIES), parseGraphParams({ node: "uf:AC" }), now);
    expect(d.nodeMissing).toBe(true);
    expect(d.detail).toBeUndefined();
  });
  it("busca: resultados e totais; vazio quando nada casa", async () => {
    expect((await loadGraphWorkspace(reader(CITIES), parseGraphParams({ q: "alf" }), now)).search!.nodes.map((n) => n.label)).toEqual(["Alfa"]);
    expect((await loadGraphWorkspace(reader(CITIES), parseGraphParams({ q: "zzz" }), now)).search!.nodes).toEqual([]);
  });
});
