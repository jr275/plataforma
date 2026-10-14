import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverAttributes, gapReport, statsHash, valueMatches, type FactSample } from "./discovery";
import { validatePack, type AttributeDefinition, type CatalogPack, type DiscoveryPolicy } from "./types";
import { validateFact } from "./store";

// Pack FICTÍCIO mínimo ("restaurantes"): prova que o núcleo não depende do domínio imobiliário (spec, seção 20).
const def = (o: Partial<AttributeDefinition> & Pick<AttributeDefinition, "attributeId" | "entityType" | "dataType">): AttributeDefinition =>
  ({ name: o.attributeId, origin: "OBSERVED", semanticCategory: "x", source: "fonte de teste", sourceQuality: 0.9, maxAgeDays: null, derivationMethod: null, relatedEntities: [], supportedIntents: [], potentialPageFamilies: [], ...o });
const PACK: CatalogPack = {
  entityTypes: [{ entityType: "restaurant", label: "Restaurante" }, { entityType: "district", label: "Distrito" }],
  attributes: [
    def({ attributeId: "restaurant.rating", entityType: "restaurant", dataType: "numeric", maxAgeDays: 100, potentialPageFamilies: ["a", "b"] }),
    def({ attributeId: "restaurant.cuisine", entityType: "restaurant", dataType: "categorical", potentialPageFamilies: ["a"] }),
    def({ attributeId: "restaurant.vibe", entityType: "restaurant", dataType: "qualitative", origin: "INFERRED" }),
    def({ attributeId: "district.avg_price", entityType: "district", dataType: "derived", origin: "DERIVED", derivationMethod: "mean_price", potentialPageFamilies: ["a", "b", "c"] }),
  ],
  defaultPolicy: { minCoverageValid: 0.8, minCoveragePartial: 0.1, minConfidence: 0.7 },
};
const POLICY: DiscoveryPolicy = PACK.defaultPolicy;
const NOW = new Date("2026-10-14T12:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const f = (entityId: string, attributeId: string, value: unknown, days = 1, confidence = 0.9): FactSample => ({ entityId, attributeId, value, observedAt: ago(days), confidence });
const run = (facts: FactSample[], counts: Record<string, number> = { restaurant: 10, district: 0 }, policy = POLICY) => discoverAttributes({ definitions: PACK.attributes, entityCounts: counts, facts, policy, now: NOW });
const get = (stats: ReturnType<typeof run>, id: string) => stats.find((s) => s.definition.attributeId === id)!;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`);

describe("cobertura, status e a diferença entre 'sem entidades' e 'nenhuma tem o atributo'", () => {
  it("cobertura total e dados frescos: VALID, com distribuição numérica", () => {
    const s = get(run(ids(10).map((e, i) => f(e, "restaurant.rating", 3 + (i % 3) * 0.5))), "restaurant.rating");
    expect(s).toMatchObject({ entitiesTotal: 10, entitiesWithValue: 10, coverage: 1, status: "VALID", reasons: [] });
    expect(s.distribution).toMatchObject({ n: 10, min: 3, max: 4 });
  });
  it("não existem entidades do tipo: cobertura NULL e DATA_PENDING (nada foi medido, não é 0%)", () => {
    const s = get(run([]), "district.avg_price");
    expect(s).toMatchObject({ entitiesTotal: 0, coverage: null, status: "DATA_PENDING" });
    expect(s.reasons[0]).toMatch(/não existem entidades/);
  });
  it("existem entidades e NENHUMA tem o atributo: cobertura 0 (valor real) e DATA_PENDING com o motivo", () => {
    const s = get(run([]), "restaurant.rating");
    expect(s).toMatchObject({ coverage: 0, status: "DATA_PENDING", freshnessDays: null, confidence: null });
    expect(s.reasons[0]).toMatch(/nenhuma das 10/);
  });
  it("cobertura entre o mínimo parcial e o válido: PARTIAL; abaixo do parcial: DATA_PENDING", () => {
    expect(get(run(ids(5).map((e) => f(e, "restaurant.rating", 4))), "restaurant.rating")).toMatchObject({ coverage: 0.5, status: "PARTIAL" });
    expect(get(run(ids(5).map((e) => f(e, "restaurant.rating", 4))), "restaurant.rating").reasons.join()).toMatch(/abaixo do mínimo para VALID/);
    expect(get(run([f("r0", "restaurant.rating", 4)], { restaurant: 20, district: 0 }), "restaurant.rating")).toMatchObject({ coverage: 0.05, status: "DATA_PENDING" });
  });
  it("a política muda o resultado sem mudar o código", () => {
    const facts = ids(5).map((e) => f(e, "restaurant.rating", 4));
    expect(get(run(facts, undefined, { ...POLICY, minCoverageValid: 0.5 }), "restaurant.rating").status).toBe("VALID");
  });
});
describe("frescor, confiança e tipo do valor", () => {
  it("o fato MAIS ANTIGO define o frescor; fato acima da validade rebaixa para PARTIAL", () => {
    const facts = [...ids(9).map((e) => f(e, "restaurant.rating", 4, 5)), f("r9", "restaurant.rating", 4, 150)];
    const s = get(run(facts), "restaurant.rating");
    expect(s).toMatchObject({ freshnessDays: 150, staleValues: 1, status: "PARTIAL" });
    expect(s.reasons.join()).toMatch(/acima da validade de 100 dias/);
  });
  it("confiança média abaixo do mínimo rebaixa para PARTIAL", () => {
    const s = get(run(ids(10).map((e) => f(e, "restaurant.rating", 4, 1, 0.5))), "restaurant.rating");
    expect(s).toMatchObject({ confidence: 0.5, status: "PARTIAL" });
  });
  it("valor que não corresponde ao tipo declarado: INVALID (nunca contado como cobertura)", () => {
    const s = get(run([...ids(9).map((e) => f(e, "restaurant.rating", 4)), f("r9", "restaurant.rating", "ótimo")]), "restaurant.rating");
    expect(s).toMatchObject({ status: "INVALID", invalidValues: 1, entitiesWithValue: 9 });
    expect(get(run([f("r0", "restaurant.rating", Number.NaN)]), "restaurant.rating").status).toBe("INVALID");
  });
  it("tipos: numérico, categórico, temporal, geográfico", () => {
    const d = (dataType: AttributeDefinition["dataType"]) => def({ attributeId: "restaurant.x", entityType: "restaurant", dataType });
    expect([valueMatches(d("numeric"), 3), valueMatches(d("numeric"), "3"), valueMatches(d("numeric"), Infinity)]).toEqual([true, false, false]);
    expect([valueMatches(d("categorical"), "italiana"), valueMatches(d("categorical"), " "), valueMatches(d("categorical"), 4)]).toEqual([true, false, false]);
    expect([valueMatches(d("temporal"), "2026-01-01"), valueMatches(d("temporal"), "ontem")]).toEqual([true, false]);
    expect([valueMatches(d("geographic"), { type: "Point" }), valueMatches(d("geographic"), "x")]).toEqual([true, false]);
  });
});
describe("distribuição, origem e lacunas", () => {
  it("categórico: cardinalidade e os valores mais frequentes, ordem determinística", () => {
    const facts = ["italiana", "japonesa", "italiana", "mineira", "japonesa", "italiana"].map((v, i) => f(`r${i}`, "restaurant.cuisine", v));
    expect(get(run(facts, { restaurant: 6, district: 0 }), "restaurant.cuisine").distribution).toEqual({ n: 6, cardinality: 3, top: [{ value: "italiana", count: 3 }, { value: "japonesa", count: 2 }, { value: "mineira", count: 1 }] });
  });
  it("origem INFERRED nunca é usável como fato de página", () => {
    const s = get(run([]), "restaurant.vibe");
    expect(s.usableAsFact).toBe(false);
    expect(s.reasons.join()).toMatch(/INFERRED/);
    expect(get(run([]), "restaurant.rating").usableAsFact).toBe(true);
  });
  it("relatório de lacunas: só o que não é VALID, do que mais destrava ao que menos", () => {
    const stats = run(ids(10).map((e) => f(e, "restaurant.rating", 4)));
    const g = gapReport(stats).map((s) => s.definition.attributeId);
    expect(g).not.toContain("restaurant.rating");
    expect(g[0]).toBe("district.avg_price"); // 3 famílias
    expect(g.indexOf("restaurant.cuisine")).toBeGreaterThan(g.indexOf("district.avg_price"));
  });
});
describe("determinismo e contratos", () => {
  const facts = ids(10).map((e) => f(e, "restaurant.rating", 4));
  it("mesma entrada, mesmo resultado e mesmo hash; a política, os fatos ou o dia mudam o hash", () => {
    expect(JSON.stringify(run(facts))).toBe(JSON.stringify(run([...facts].reverse())));
    const h = statsHash(run(facts), "p1");
    expect(statsHash(run([...facts].reverse()), "p1")).toBe(h);
    expect(statsHash(run(facts), "p2")).not.toBe(h);
    expect(statsHash(run(facts.slice(1)), "p1")).not.toBe(h);
  });
  it("o pack fictício é válido e o núcleo do catálogo não menciona o domínio imobiliário (regra 10)", () => {
    expect(validatePack(PACK)).toEqual([]);
    const dir = fileURLToPath(new URL(".", import.meta.url));
    for (const file of readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) expect(readFileSync(`${dir}${file}`, "utf8"), file).not.toMatch(/imóvel|imóveis|imobili|corretor|remax|re\/max|bairro/i);
  });
  it("validatePack recusa: id fora do tipo, derivado sem método, método em não derivado, entidade desconhecida, política inválida", () => {
    const bad = (a: AttributeDefinition[], policy = POLICY) => validatePack({ ...PACK, attributes: a, defaultPolicy: policy }).join("|");
    expect(bad([def({ attributeId: "district.x", entityType: "restaurant", dataType: "numeric" })])).toMatch(/deve começar pelo tipo/);
    expect(bad([def({ attributeId: "restaurant.d", entityType: "restaurant", dataType: "derived", origin: "DERIVED" })])).toMatch(/exige o método/);
    expect(bad([def({ attributeId: "restaurant.o", entityType: "restaurant", dataType: "numeric", derivationMethod: "m" })])).toMatch(/só atributos derivados/);
    expect(bad([def({ attributeId: "ghost.x", entityType: "ghost", dataType: "numeric" })])).toMatch(/desconhecido/);
    expect(bad([], { ...POLICY, minCoveragePartial: 0.9 })).toMatch(/política de descoberta inválida/);
    expect(bad([PACK.attributes[0]!, PACK.attributes[0]!])).toMatch(/duplicado/);
  });
});
describe("R1: fato sem proveniência é recusado antes de gravar", () => {
  const ok = { entityId: "e", attributeId: "restaurant.rating", value: 4, sourceName: "fonte", observedAt: NOW, confidence: 0.9 };
  it("aceita o completo", () => expect(validateFact(ok)).toEqual([]));
  it("recusa sem fonte, sem data, confiança inválida, valor ausente e id de atributo inválido", () => {
    expect(validateFact({ ...ok, sourceName: " " }).join()).toMatch(/sem fonte/);
    expect(validateFact({ ...ok, observedAt: new Date("x") }).join()).toMatch(/sem data/);
    expect(validateFact({ ...ok, confidence: 1.2 }).join()).toMatch(/confiança/);
    expect(validateFact({ ...ok, value: null }).join()).toMatch(/ausência não é gravada/);
    expect(validateFact({ ...ok, value: undefined }).length).toBeGreaterThan(0);
    expect(validateFact({ ...ok, attributeId: "semponto" }).join()).toMatch(/atributo/);
  });
});
