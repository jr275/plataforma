import { describe, expect, it } from "vitest";
import { COMPATIBILITY_RULES, DEFAULT_COMBINATION_POLICY, FAMILIES } from "./combination";

const bad = (d: Record<string, string>) => COMPATIBILITY_RULES.map((r) => ({ id: r.id, why: r.check(d) })).filter((x) => x.why !== null);
describe("matriz de compatibilidade (spec 15.6)", () => {
  it("quartos, suítes e vagas não combinam com terreno ou lote comercial", () => {
    for (const k of ["bedrooms", "suites", "parking"]) for (const t of ["land", "commercial_lot"]) expect(bad({ property_type: t, [k]: "2" }).map((x) => x.id), `${k}/${t}`).toEqual(["bedrooms-need-built"]);
    expect(bad({ property_type: "apartment", bedrooms: "2" })).toEqual([]);
    expect(bad({ property_type: "land" })).toEqual([]);
  });
  it("near=airport só para granularidade ≥ bairro", () => {
    expect(bad({ near: "airport", geo_granularity: "street" }).map((x) => x.id)).toEqual(["near-airport-granularity"]);
    expect(bad({ near: "airport", geo_granularity: "neighborhood" })).toEqual([]);
    expect(bad({ near: "park", geo_granularity: "street" })).toEqual([]);
  });
  it("perfil de estilo de vida não combina com imóvel", () => { expect(bad({ lifestyle_profile: "familia", property_id: "p1" }).map((x) => x.id)).toEqual(["lifestyle-not-property"]); expect(bad({ lifestyle_profile: "familia", neighborhood: "n" })).toEqual([]); });
  it("cauda longa: no máximo 3 dimensões de tipologia", () => {
    expect(bad({ property_type: "apartment", transaction: "sale", bedrooms: "2", price_band: "high" }).map((x) => x.id)).toEqual(["longtail-typology-limit"]);
    expect(bad({ property_type: "apartment", transaction: "sale", bedrooms: "2" })).toEqual([]);
  });
  it("comparar uma cidade com ela mesma é recusado", () => { expect(bad({ city: "ibge:1", compare_with: "ibge:1" }).map((x) => x.id)).toEqual(["comparison-distinct-entities"]); expect(bad({ city: "ibge:1", compare_with: "ibge:2" })).toEqual([]); });
});
describe("famílias e política do pack", () => {
  it("toda família tem a chave de mínimo na política; a comparação não é recorte do pai; tipologia usa raiz de bairro", () => {
    for (const f of FAMILIES) expect(DEFAULT_COMBINATION_POLICY.minItems[f.minItemsKey], f.id).toBeGreaterThan(0);
    expect(FAMILIES.find((f) => f.id === "city-comparison")!.parentRedundancy).toBe(false);
    expect(FAMILIES.find((f) => f.id === "neighborhood-typology")!.rootPatternKeys).toEqual(["topic-neighborhood"]);
  });
  it("valores iniciais da especificação: 4 dimensões (5 na cauda longa), razão 0,8 e ao menos 1 bloco exclusivo", () => { expect(DEFAULT_COMBINATION_POLICY).toMatchObject({ maxDimensions: 4, longTailMaxDimensions: 5, redundancyRatio: 0.8, minExclusiveBlocks: 1 }); });
});
