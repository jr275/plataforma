import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fakeFetch } from "../engine/test-support/fake-fetch";
import { RunBudget } from "./budget";
import { RateGate } from "./rate";
import { PUBLIC_UA } from "./public";
import type { TenantDb } from "../tenant-context";
import { AI_OPTIMIZATION_STATE, ENDPOINTS, backlinksSummarySpec, checkEnvelope, dfsSearchVolume, keywordDifficultySpec, parseBacklinksSummary, parseKeywordDifficulty, parseKeywordList, parseSearchVolume, parseSerp, parseSerpNews, parseTrends, relatedKeywordsSpec, searchVolumeSpec, serpOrganicSpec, trendsSpec } from "./dataforseo";

const fx = (n: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`./__fixtures__/${n}`, import.meta.url)), "utf8")) as { tasks: { result: unknown }[] };
const result = (n: string) => fx(n).tasks[0]!.result;
// um banco que falha se for tocado: `provider_not_configured` não pode gravar nem consultar nada
const noDb = { query: async () => { throw new Error("o banco não podia ser usado"); } } as unknown as TenantDb;
const base = { db: noDb, budget: RunBudget.create(), runId: null, actor: "t", now: () => new Date("2026-10-14T12:00:00Z") };

describe("sem credencial: provider_not_configured, sem requisição e sem gravação", () => {
  it("lista só os NOMES das variáveis ausentes", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const ctx = { fetch: fakeFetch({}, calls), userAgent: PUBLIC_UA, gate: new RateGate({}), env: { DATAFORSEO_LOGIN: "alguem@exemplo.com" } };
    const r = await dfsSearchVolume(ctx, base, ["apartamento"]);
    expect(r).toEqual({ state: "provider_not_configured", provider: "dataforseo", missing: ["DATAFORSEO_PASSWORD"], detail: "variáveis ausentes: DATAFORSEO_PASSWORD" });
    expect(calls).toHaveLength(0);
  });
  it("ambas ausentes ou vazias", async () => {
    const ctx = { fetch: fakeFetch({}), userAgent: PUBLIC_UA, gate: new RateGate({}), env: { DATAFORSEO_LOGIN: " ", DATAFORSEO_PASSWORD: "" } };
    expect(await dfsSearchVolume(ctx, base, ["apartamento"])).toMatchObject({ state: "provider_not_configured", missing: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"] });
  });
});

describe("envelope e erros da API", () => {
  it("20000 devolve o custo e o resultado", () => { expect(checkEnvelope(fx("dataforseo-search-volume.json"))).toMatchObject({ cost: 0.075 }); });
  it("40100 no topo é unauthorized (credencial rejeitada), sem nova tentativa", () => {
    expect(() => checkEnvelope(JSON.parse(readFileSync(fileURLToPath(new URL("./__fixtures__/dataforseo-401.json", import.meta.url)), "utf8")))).toThrowError(expect.objectContaining({ code: "unauthorized", retryable: false }));
  });
  it("erro na tarefa é provider_rejected e o custo cobrado continua registrado", () => {
    expect(() => checkEnvelope(JSON.parse(readFileSync(fileURLToPath(new URL("./__fixtures__/dataforseo-task-error.json", import.meta.url)), "utf8")))).toThrowError(expect.objectContaining({ code: "provider_rejected", costUsd: 0.01 }));
  });
  it("formato inesperado é erro de parse", () => { for (const bad of [null, {}, { tasks: "x" }, "texto", { status_code: 20000, tasks: [] }]) expect(() => checkEnvelope(bad)).toThrow(); });
});

describe("parsers (fixtures construídas da documentação): ausência é null, nunca 0", () => {
  it("volume de busca: valor ausente fica null e o índice de concorrência vira 0..1", () => {
    const m = parseSearchVolume(result("dataforseo-search-volume.json"));
    expect(m[0]).toMatchObject({ keyword: "apartamento à venda em campinas", searchVolume: 1300, cpc: 1.35, competition: 0.54 });
    expect(m[0]!.monthly).toEqual([{ year: 2026, month: 9, volume: 1400 }, { year: 2026, month: 8, volume: 1200 }, { year: 2026, month: 7, volume: null }]);
    expect(m[1]).toMatchObject({ keyword: "custo de vida em campinas", searchVolume: null, cpc: null, competition: null, monthly: [] });
  });
  it("dificuldade: sem dado é null", () => { expect(parseKeywordDifficulty(result("dataforseo-keyword-difficulty.json"))).toEqual([{ keyword: "apartamento à venda em campinas", difficulty: 38 }, { keyword: "custo de vida em campinas", difficulty: null }]); });
  it("relacionadas: volume, CPC, dificuldade e intenção; faltantes são null", () => {
    const k = parseKeywordList(result("dataforseo-related-keywords.json"));
    expect(k[0]).toEqual({ keyword: "apartamento barato campinas", searchVolume: 320, cpc: 0.9, difficulty: 25, intent: "commercial" });
    expect(k[1]).toEqual({ keyword: "bairros bons para morar em campinas", searchVolume: null, cpc: null, difficulty: null, intent: null });
  });
  it("SERP: posições, domínios sem www, PAA e recursos; descarta item sem URL válida ou domínio", () => {
    const s = parseSerp(result("dataforseo-serp-organic.json"));
    expect(s.query).toBe("apartamento à venda em campinas");
    expect(s.capturedAt).toEqual(new Date("2026-10-14T12:00:00Z"));
    expect(s.items.map((i) => [i.rank, i.resultType, i.domain])).toEqual([[1, "featured_snippet", "portal-exemplo.com.br"], [1, "organic", "portal-exemplo.com.br"], [2, "organic", "forum-exemplo.com.br"]]);
    expect(s.peopleAlsoAsk).toEqual(["Quanto custa um apartamento em Campinas?", "Qual o melhor bairro de Campinas?"]);
    expect(s.features).toEqual(["people_also_ask", "featured_snippet"]);
    expect(s.totalResults).toBe(1230000);
  });
  it("notícias: exige título e URL e lê a data", () => {
    const n = parseSerpNews(result("dataforseo-serp-news.json"));
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ title: "Juros do financiamento imobiliário", source: "Veículo Exemplo", publishedAt: new Date("2026-10-13T09:30:00Z") });
  });
  it("Trends: semana sem dado fica null (não 0)", () => {
    const t = parseTrends(result("dataforseo-trends.json"));
    expect(t.keywords).toEqual(["apartamento"]);
    expect(t.points.map((p) => p.values)).toEqual([[62], [null]]);
    expect(t.averages).toEqual([58]);
    expect(() => parseTrends([{ items: [] }])).toThrow(/sem série/);
  });
  it("backlinks: campos ausentes ficam null", () => {
    expect(parseBacklinksSummary(result("dataforseo-backlinks-summary.json"))).toEqual({ target: "portal-exemplo.com.br", rank: 512, backlinks: 98200, referringDomains: 3400, referringMainDomains: 3100 });
    expect(parseBacklinksSummary([{ target: "a.com.br" }])).toMatchObject({ rank: null, backlinks: null });
  });
  it("resultado vazio ou fora do formato lança", () => { for (const f of [parseSerp, parseKeywordDifficulty, parseBacklinksSummary, parseTrends]) expect(() => f([])).toThrow(); expect(() => parseSearchVolume({})).toThrow(); });
});

describe("construção das requisições", () => {
  it("padrão Brasil/pt (2076) e corpo previsível", () => {
    expect(searchVolumeSpec(["a b"]).body).toEqual({ keywords: ["a b"], location_code: 2076, language_code: "pt" });
    expect(serpOrganicSpec("a b").body).toMatchObject({ keyword: "a b", device: "desktop", depth: 10, location_code: 2076, language_code: "pt" });
    expect(serpOrganicSpec("a b", { place: { locationName: "Campinas,State of Sao Paulo,Brazil" } }).body).toMatchObject({ location_name: "Campinas,State of Sao Paulo,Brazil" });
    expect(serpOrganicSpec("a b", { place: { locationName: "x" } }).body).not.toHaveProperty("location_code");
  });
  it("a reserva do teto cresce com a profundidade da SERP", () => { expect(serpOrganicSpec("a", { depth: 30 }).estimateUsd).toBeCloseTo(ENDPOINTS.serpOrganic.estimateUsd * 3); });
  it("recusa entradas inválidas (termos, limites, profundidade, domínio)", () => {
    expect(() => searchVolumeSpec([])).toThrow(RangeError);
    expect(() => searchVolumeSpec(["x".repeat(81)])).toThrow(RangeError);
    expect(() => keywordDifficultySpec(Array.from({ length: 1001 }, (_, i) => `k${i}`))).toThrow(RangeError);
    expect(() => relatedKeywordsSpec("a", 0)).toThrow(RangeError);
    expect(() => serpOrganicSpec("a", { depth: 15 })).toThrow(RangeError);
    expect(() => trendsSpec(["a", "b", "c", "d", "e", "f"])).toThrow(RangeError);
    for (const d of ["http://x.com", "x.com/a", "x", "X.com"]) expect(() => backlinksSummarySpec(d)).toThrow(RangeError);
  });
  it("AI Optimization existe só como contrato", () => { expect(AI_OPTIMIZATION_STATE).toBe("contract_only"); });
});
