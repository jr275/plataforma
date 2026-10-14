import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fakeFetch } from "../engine/test-support/fake-fetch";
import { ProviderCallError } from "./store";
import { RateGate, PUBLIC_RATES } from "./rate";
import { PUBLIC_UA, publicJson } from "./public";
import { parseSidraCity, sidraEndpoint } from "./sidra";
import { gdeltEndpoint, parseGdelt } from "./gdelt";
import { overpassQuery, parseOverpassCount } from "./overpass";

const fx = (n: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/${n}`, import.meta.url)), "utf8");
const ctx = (routes: Parameters<typeof fakeFetch>[0], calls: { url: string; headers: Record<string, string> }[] = [], gate = new RateGate({})) => ({ fetch: fakeFetch(routes, calls), userAgent: PUBLIC_UA, gate });

describe("SIDRA (fixture REAL: São Paulo, Censo 2022)", () => {
  it("normaliza população e densidade com o ano", () => {
    expect(parseSidraCity(JSON.parse(fx("sidra-4714-3550308.json")), "3550308")).toEqual({ ibgeCode: "3550308", name: "São Paulo (SP)", year: 2022, population: 11451999, densityPerKm2: 7528.26 });
  });
  it("valor sigilado ou ausente vira null, nunca 0", () => {
    const raw = [{}, { D1C: "3550308", D1N: "X", D2C: "93", D3C: "2022", V: "..." }, { D1C: "3550308", D1N: "X", D2C: "614", D3C: "2022", V: "-" }];
    expect(parseSidraCity(raw, "3550308")).toMatchObject({ population: null, densityPerKm2: null });
  });
  it("município sem linhas devolve tudo desconhecido; formato inválido lança", () => {
    expect(parseSidraCity([{}], "3550308")).toEqual({ ibgeCode: "3550308", name: "", year: null, population: null, densityPerKm2: null });
    expect(() => parseSidraCity({ erro: 1 }, "3550308")).toThrow(/fora do formato/);
  });
  it("só aceita código IBGE de 7 dígitos (sem injeção no caminho)", () => {
    expect(sidraEndpoint("3550308")).toBe("values/t/4714/n6/3550308/v/93,614/p/last");
    for (const bad of ["355030", "3550308/x", "abc1234", ""]) expect(() => sidraEndpoint(bad)).toThrow(RangeError);
  });
});

describe("GDELT", () => {
  it("resposta {} (REAL) é lista vazia, não erro", () => { expect(parseGdelt(JSON.parse(fx("gdelt-empty.json")))).toEqual([]); });
  it("normaliza artigos (formato documentado) e descarta itens sem URL ou título", () => {
    const a = parseGdelt(JSON.parse(fx("gdelt-artlist.json")));
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ domain: "exemplo-noticias.com.br", sourceCountry: "Brazil", seenAt: new Date("2026-10-13T12:00:00Z") });
    expect(parseGdelt({ articles: [{ url: "javascript:x", title: "a" }, { url: "https://a.com/x", title: " " }, { url: "https://a.com/y", title: "ok" }] })).toHaveLength(1);
  });
  it("formato inesperado lança", () => { expect(() => parseGdelt([])).toThrow(); expect(() => parseGdelt({ articles: "x" })).toThrow(); });
  it("valida os parâmetros da consulta", () => {
    expect(gdeltEndpoint({ query: "(financiamento imobiliario)", timespan: "7d", maxRecords: 5 })).toContain("mode=artlist");
    expect(() => gdeltEndpoint({ query: "ab", timespan: "7d", maxRecords: 5 })).toThrow();
    expect(() => gdeltEndpoint({ query: "abcd", timespan: "forever", maxRecords: 5 })).toThrow();
    expect(() => gdeltEndpoint({ query: "abcd", timespan: "7d", maxRecords: 500 })).toThrow();
  });
});

describe("Overpass", () => {
  const c = { lat: -23.5505, lon: -46.6333 };
  it("monta a consulta só com categorias permitidas e entradas numéricas", () => {
    expect(overpassQuery("school", c, 2000)).toBe('[out:json][timeout:25];(node["amenity"="school"](around:2000,-23.55050,-46.63330););out count;');
    expect(() => overpassQuery("x" as never, c, 2000)).toThrow();
    expect(() => overpassQuery("park", { lat: 100, lon: 0 }, 2000)).toThrow();
    expect(() => overpassQuery("park", c, 50)).toThrow();
    expect(() => overpassQuery("park", { lat: Number.NaN, lon: 0 }, 2000)).toThrow();
  });
  it("lê a contagem (formato documentado) e declara a limitação de cobertura", () => {
    const p = parseOverpassCount(JSON.parse(fx("overpass-count.json")), "school", c, 2000);
    expect(p.count).toBe(42);
    expect(p.limitation).toMatch(/mapeado/);
  });
  it("resposta sem contagem lança (não assume zero)", () => { expect(() => parseOverpassCount({ elements: [] }, "school", c, 2000)).toThrow(/sem contagem/); });
});

describe("transporte público e limites", () => {
  it("devolve o JSON com custo 0 e envia User-Agent identificado", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const r = await publicJson(ctx({ "https://apisidra.ibge.gov.br/": { body: fx("sidra-4714-3550308.json") } }, calls), "https://apisidra.ibge.gov.br/values/t/4714");
    expect(r).toMatchObject({ costUsd: 0, httpStatus: 200 });
    expect(calls[0]!.headers["User-Agent"]).toBe(PUBLIC_UA);
  });
  it("429 real do GDELT vira rate_limited (retentável)", async () => {
    await expect(publicJson(ctx({ "https://api.gdeltproject.org/": { status: 429, body: fx("gdelt-429.txt") } }), "https://api.gdeltproject.org/api/v2/doc/doc")).rejects.toMatchObject({ code: "rate_limited", retryable: true, httpStatus: 429 });
  });
  it("504 real do Overpass vira erro de http retentável", async () => {
    const e = await publicJson(ctx({ "https://overpass-api.de/": { status: 504, body: fx("overpass-504.html") } }), "https://overpass-api.de/api/interpreter").catch((x) => x);
    expect(e).toBeInstanceOf(ProviderCallError);
    expect(e).toMatchObject({ code: "http", retryable: true, httpStatus: 504 });
  });
  it("corpo que não é JSON vira erro de parse", async () => {
    await expect(publicJson(ctx({ "https://overpass-api.de/": { body: "<html>erro</html>" } }), "https://overpass-api.de/x")).rejects.toMatchObject({ code: "parse" });
  });
  it("recusa HTTP simples e hosts locais (política das fontes públicas)", async () => {
    await expect(publicJson(ctx({}), "http://apisidra.ibge.gov.br/x")).rejects.toMatchObject({ code: "provider_rejected" });
    await expect(publicJson(ctx({}), "https://localhost/x")).rejects.toMatchObject({ code: "provider_rejected" });
  });
  it("o intervalo mínimo por host é respeitado (GDELT: ≥ 5 s) e hosts sem limite não esperam", async () => {
    let t = 0; const slept: number[] = [];
    const g = new RateGate(PUBLIC_RATES, () => t, async (ms) => { slept.push(ms); t += ms; });
    await g.wait("api.gdeltproject.org"); t += 1000;
    await g.wait("api.gdeltproject.org");
    await g.wait("outro.exemplo.com");
    expect(slept).toEqual([5000]);
    expect(PUBLIC_RATES["api.gdeltproject.org"]).toBeGreaterThanOrEqual(5000);
  });
});
