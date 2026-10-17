import { describe, expect, it } from "vitest";
import type { City } from "../ingest/read";
import { BLOCK_LABELS, BLOCK_TYPES, blockParagraphs, toBlocks, validateBlocks, type PageBlock } from "./blocks";
import { CITY_OVERVIEW, buildCityFacts, renderCityPage, type RenderedPage } from "./city-overview";

// Entradas montadas à mão (NÃO são dados reais de produção): a cadeia sob teste é a real (fatos → template → blocos).
const RUN = { id: "c0000000-0000-4000-8000-000000000001", sourceName: "IBGE", origin: "real" as const, status: "succeeded" as const, fileSha256: "a".repeat(64), finishedAt: new Date("2026-10-12T10:00:00Z") };
const city = (over: Partial<City> = {}): City => ({ id: "d0000000-0000-4000-8000-000000000001", ibgeCode: "3550308", name: "São Paulo", uf: "SP", region: "Sudeste", population: 11451999, populationYear: 2024, sourceRunId: RUN.id, ...over });
function page(over: Partial<City> = {}, known: string[] = ["/cidades/sp", "/cidades"]): RenderedPage {
  const f = buildCityFacts(city(over), RUN);
  if (!f.ok) throw new Error(f.reason);
  const r = renderCityPage(CITY_OVERVIEW, f, { knownPaths: new Set(known) });
  if (!r.ok) throw new Error(r.detail);
  return r.page;
}

describe("toBlocks", () => {
  it("monta breadcrumb, hero, texto, dados, links e fontes, nessa ordem, e o resultado é válido", () => {
    const b = toBlocks(page());
    expect(b.map((x) => x.type)).toEqual(["breadcrumb", "hero", "prose", "prose", "prose", "facts", "links", "sources"]);
    expect(validateBlocks(b)).toEqual([]);
  });
  it("INVARIANTE: todo parágrafo da página aparece exatamente uma vez, na mesma ordem, sem nenhum texto acrescentado", () => {
    const p = page();
    expect(blockParagraphs(toBlocks(p))).toEqual(p.sections.flatMap((s) => [...s.paragraphs]));
  });
  it("o primeiro parágrafo sobe para o hero e sai da seção", () => {
    const p = page();
    const [, hero, overview] = toBlocks(p) as [PageBlock, Extract<PageBlock, { type: "hero" }>, Extract<PageBlock, { type: "prose" }>];
    expect(hero.lead).toBe(p.sections[0]!.paragraphs[0]);
    expect(overview.paragraphs).not.toContain(hero.lead);
  });
  it("a tabela de dados só traz fatos COM fonte, com o valor formatado e o ano de referência da população", () => {
    const facts = toBlocks(page()).find((x) => x.type === "facts") as Extract<PageBlock, { type: "facts" }>;
    expect(facts.rows.map((r) => r.label)).toEqual(["UF", "Região", "População estimada", "Código IBGE"]);
    const pop = facts.rows.find((r) => r.label === "População estimada")!;
    expect(pop).toMatchObject({ value: "11.451.999", asOf: 2024, source: "IBGE", factId: "city:3550308:population" });
    for (const r of facts.rows) { expect(r.source).toBeTruthy(); expect(r.factId).toMatch(/^city:3550308:/); expect(r.collectedAt).toBe("2026-10-12"); }
  });
  it("sem região nem população essas linhas não existem (nada é inventado)", () => {
    const facts = toBlocks(page({ region: null, population: null, populationYear: null })).find((x) => x.type === "facts") as Extract<PageBlock, { type: "facts" }>;
    expect(facts.rows.map((r) => r.label)).toEqual(["UF", "Código IBGE"]);
  });
  it("o breadcrumb só tem link para caminhos que existem; os demais viram texto", () => {
    const bc = (known: string[]) => (toBlocks(page({}, known))[0] as Extract<PageBlock, { type: "breadcrumb" }>).items.map((i) => i.path);
    expect(bc(["/cidades/sp", "/cidades"])).toEqual([null, "/cidades", "/cidades/sp", null]);
    expect(bc([])).toEqual([null, null, null, null]);
  });
  it("os rótulos fixos não contêm algarismos (número só entra por fato)", () => {
    for (const v of Object.values(BLOCK_LABELS)) expect(v).not.toMatch(/\d/);
  });
  it("é determinístico: a mesma página gera os mesmos blocos", () => {
    expect(JSON.stringify(toBlocks(page()))).toBe(JSON.stringify(toBlocks(page())));
  });
});

describe("validateBlocks (falha fechada)", () => {
  const ok = (): PageBlock[] => toBlocks(page());
  const mut = (f: (b: any[]) => void): string[] => { const b = JSON.parse(JSON.stringify(ok())); f(b); return validateBlocks(b); };
  it("recusa entrada que não é uma lista de blocos", () => {
    for (const v of [null, undefined, "x", {}, []]) expect(validateBlocks(v).length, String(v)).toBeGreaterThan(0);
  });
  it("recusa bloco fora do catálogo (não existe bloco de HTML livre)", () => {
    expect(mut((b) => b.push({ type: "html", html: "<b>x</b>" })).join(" ")).toContain("tipo desconhecido");
    expect(BLOCK_TYPES).not.toContain("html");
  });
  it("recusa marcação em qualquer texto", () => {
    expect(mut((b) => { b[2].paragraphs[0] = "<script>alert(1)</script>"; }).join(" ")).toContain("marcação");
    expect(mut((b) => { b[1].h1 = "Título <img src=x>"; }).join(" ")).toContain("marcação");
  });
  it("exige um único hero e que ele venha primeiro (no máximo depois do breadcrumb)", () => {
    expect(mut((b) => b.splice(1, 1)).join(" ")).toContain("exatamente um hero");
    expect(mut((b) => b.push({ ...b[1] })).join(" ")).toContain("exatamente um hero");
    expect(mut((b) => { const h = b.splice(1, 1)[0]; b.splice(3, 0, h); }).join(" ")).toContain("hero deve vir primeiro");
  });
  it("recusa linha de dados sem fonte ou sem id do fato", () => {
    expect(mut((b) => { delete b.find((x) => x.type === "facts").rows[0].source; }).join(" ")).toContain("source");
    expect(mut((b) => { b.find((x) => x.type === "facts").rows[0].factId = ""; }).join(" ")).toContain("factId");
  });
  it("recusa link externo, de protocolo ou protocolo-relativo", () => {
    for (const path of ["https://exemplo.com/x", "//evil.com", "javascript:alert(1)", "cidades"]) {
      expect(mut((b) => { b.find((x) => x.type === "links").items[0].path = path; }).join(" "), path).toContain("caminho");
    }
  });
  it("exige as fontes por último e no máximo um de cada bloco único", () => {
    expect(mut((b) => { const s = b.pop(); b.splice(2, 0, s); }).join(" ")).toContain("fontes deve ser o último");
    expect(mut((b) => b.splice(5, 0, JSON.parse(JSON.stringify(b.find((x) => x.type === "facts"))))).join(" ")).toContain("um bloco facts");
  });
  it("recusa blocos vazios", () => {
    expect(mut((b) => { b.find((x) => x.type === "prose").paragraphs = []; }).join(" ")).toContain("sem parágrafos");
    expect(mut((b) => { b.find((x) => x.type === "sources").items = []; }).join(" ")).toContain("sem fontes");
  });
});
