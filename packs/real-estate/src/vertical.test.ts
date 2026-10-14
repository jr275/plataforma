import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyCityRows, engine, parseCsv } from "@plataforma/api";
import { REAL_ESTATE_SCORE_CONFIG, VERTICAL_ID, realEstateVertical as V } from "./vertical";

const root = path.resolve(__dirname, "../../..");
const CSV = readFileSync(path.join(root, "db/test-fixtures/generation/sp-ibge-2026-10-12.csv"), "utf8");
const FIX = (n: string) => readFileSync(path.join(root, "packages/api/src/engine/adapters/__fixtures__", n), "utf8");
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" } as const;
// Cidades REAIS do IBGE (extrato de SP) como entidades do tenant.
const ENTITIES: engine.EntityRecord[] = classifyCityRows(parseCsv(CSV), MAPPING).rows.flatMap((r) => (r.city ? [{ kind: "city", id: `city-${r.city.ibgeCode}`, name: r.city.name, qualifier: r.city.uf, weight: r.city.population }] : []));
const NOW = new Date("2026-10-13T20:00:00Z");

describe("a vertical imobiliária é uma definição válida do contrato genérico", () => {
  it("passa na validação do núcleo, tem id próprio e configuração de score válida", () => {
    expect(engine.validateVertical(V)).toEqual([]);
    expect(V.id).toBe(VERTICAL_ID);
    expect(engine.validateScoreConfig(REAL_ESTATE_SCORE_CONFIG)).toEqual([]);
  });
  it("as séries do BCB apontam para temas existentes e o RSS é HTTPS", () => {
    expect(V.sources.bcbSeries.map((s) => s.id)).toEqual([432, 13522, 189]);
    expect(V.sources.rssFeeds.every((f) => f.url.startsWith("https://"))).toBe(true);
  });
  it("só a experiência 'visão geral da cidade' está suportada hoje (o resto é planejado: depende de dados que não existem)", () => {
    expect(V.experiences.filter((e) => e.status === "supported").map((e) => e.id)).toEqual(["location_overview"]);
  });
});

describe("queries imobiliárias reais: equivalentes agrupam, intenções diferentes não se misturam", () => {
  const index = engine.buildEntityIndex(ENTITIES);
  const cls = (q: string) => engine.classifyQuery(V, index, q);
  const pat = (q: string) => { const c = cls(q); return c.status === "matched" ? `${c.pattern.key}@${c.entity?.name ?? "-"}` : c.status; };
  it("variações de compra de apartamento em Campinas chegam ao mesmo padrão e à mesma cidade", () => {
    for (const q of ["apartamentos à venda em Campinas", "Comprar apartamento em campinas", "apartamento à venda Campinas", "apto à venda em campinas"]) expect(pat(q), q).toBe("buy-apartments@Campinas");
  });
  it("comprar e alugar NUNCA se misturam (intenções comerciais diferentes)", () => {
    expect(pat("alugar apartamento em Campinas")).toBe("rent-apartments@Campinas");
    expect(pat("apartamentos para alugar em Campinas")).toBe("rent-apartments@Campinas");
    expect(pat("casas à venda em Campinas")).toBe("buy-houses@Campinas");
    expect(pat("casa para alugar Campinas")).toBe("rent-houses@Campinas");
  });
  it("mercado, financiamento, visão geral e marca têm padrões próprios", () => {
    expect(pat("preço do metro quadrado em Santos")).toBe("price-per-sqm@Santos");
    expect(pat("como financiar imóvel em Santos")).toBe("mortgage-city@Santos");
    expect(pat("como é morar em Santos")).toBe("city-overview@Santos");
    expect(pat("remax em Santos")).toBe("brand-offices@Santos");
    expect(pat("melhores bairros para morar em Santos")).toBe("best-neighborhoods@Santos");
  });
  it("sem cidade: padrões de tema (juros, Selic, IGP-M); query de outro assunto fica sem cluster", () => {
    expect(pat("juros do financiamento imobiliário hoje")).toBe("mortgage-rates@-");
    expect(pat("como a selic afeta o financiamento imobiliário")).toBe("selic-mortgage@-");
    expect(pat("igp-m aluguel")).toBe("rent-adjustment@-");
    expect(pat("receita de bolo de cenoura")).toBe("unmatched");
    expect(pat("apartamentos à venda em Atlântida")).toBe("unmatched"); // cidade que o tenant não tem
  });
});

describe("pipeline com cidades reais do IBGE e evidências reais capturadas", () => {
  const run = async () => {
    const ev: engine.EvidenceInput[] = [];
    const f = (url: string, body: string) => ({ url, body });
    const bcb = await engine.bcbSgsAdapter.run({ fetch: async (url: string) => ({ ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => (url.includes("432") ? FIX("bcb-432.json") : url.includes("13522") ? FIX("bcb-13522.json") : FIX("bcb-189.json")) }), now: NOW, userAgent: "t", vertical: V, sleep: async () => {}, robots: new Map() });
    bcb.evidence.forEach((d, i) => ev.push({ key: `bcb-${i}`, draft: d }));
    void f;
    return engine.buildOpportunities({ def: V, entities: ENTITIES, evidence: ev, pages: [{ entityId: "city-3550308", templateKey: "city-overview" }], config: REAL_ESTATE_SCORE_CONFIG, now: NOW, entityLimit: 20 });
  };
  it("gera um cluster por padrão x cidade (10 padrões com cidade x 20 + 4 de tema) e NADA fica ambíguo", async () => {
    const { drafts, stats } = await run();
    expect(stats.unclassified).toEqual([]);
    expect(drafts).toHaveLength(10 * 20 + 4);
    expect(new Set(drafts.map((d) => d.clusterKey)).size).toBe(drafts.length);
  });
  it("os indicadores reais ligam-se aos temas certos (Selic: financiamento e compra; IGP-M e IPCA: aluguel e mercado)", async () => {
    const { drafts } = await run();
    const rates = drafts.find((d) => d.pattern.key === "mortgage-rates")!;
    expect(rates.links.some((l) => l.topic === "credit_rates" && l.role === "signal")).toBe(true);
    expect(rates.trend.some((t) => t.topic === "credit_rates")).toBe(true);
    const rent = drafts.find((d) => d.pattern.key === "rent-adjustment")!;
    expect(rent.links.some((l) => l.topic === "inflation_rent")).toBe(true);
    expect(drafts.find((d) => d.pattern.key === "city-overview")!.links.every((l) => l.topic !== "credit_rates")).toBe(true);
  });
  it("temas que só dependem de indicadores existentes têm evidência completa e risco residual; os que dependem de fontes inexistentes têm risco CRÍTICO", async () => {
    const { drafts } = await run();
    const rates = drafts.find((d) => d.pattern.key === "mortgage-rates")!;
    expect(rates.dimensions.evidence_availability.value).toBe(1);
    expect(rates.dimensions.evidence_risk.value).toBe(0.1);
    const buy = drafts.find((d) => d.pattern.key === "buy-apartments")!;
    expect(buy.dimensions.evidence_availability.value).toBe(0.5); // cidades existem; inventário não
    expect(buy.dimensions.evidence_risk.value).toBe(0.9);
    expect(buy.score.eligibility.eligible).toBe(false); // sem inventário real não se constrói diretório de imóveis
    expect(buy.score.recommendation.action).toContain("Ainda não elegível");
  });
  it("canibalização REAL: São Paulo já tem página de visão geral gerada, então esse tema aponta para ATUALIZAR; outra cidade não", async () => {
    const { drafts } = await run();
    const sp = drafts.find((d) => d.clusterKey === "city-overview:informational:city:city-3550308")!;
    expect(sp.dimensions.cannibalization_risk.value).toBe(0.85);
    expect(sp.score.eligibility.eligible).toBe(false);
    expect(sp.score.eligibility.checks.find((c) => c.code === "cannibalization_max")!.detail).toContain("atualize a página existente");
    const other = drafts.find((d) => d.pattern.key === "city-overview" && d.entity!.name !== "São Paulo")!;
    expect(other.dimensions.cannibalization_risk.value).toBe(0.1);
  });
  it("nenhuma oportunidade tem prioridade GERAL (faltam demanda e SERP): todas são parciais ou sem prioridade, e demanda é sempre desconhecida", async () => {
    const { drafts } = await run();
    for (const d of drafts) { expect(d.score.priority.kind).not.toBe("overall"); expect(d.dimensions.demand).toMatchObject({ value: null, basis: "unknown" }); }
    expect(drafts.some((d) => d.score.eligibility.eligible)).toBe(true); // há trabalho elegível para seguir (ex.: temas de juros com indicador real)
  });
  it("os pontos de partida elegíveis são os que podem ser fundamentados com dados que existem", async () => {
    const { drafts } = await run();
    const eligible = drafts.filter((d) => d.score.eligibility.eligible).map((d) => d.pattern.key);
    for (const k of eligible) expect(["mortgage-rates", "selic-mortgage", "rent-adjustment", "city-overview", "mortgage-city", "cost-of-living"]).toContain(k);
    expect(eligible).not.toContain("buy-apartments");
    expect(eligible).not.toContain("best-neighborhoods");
  });
});
