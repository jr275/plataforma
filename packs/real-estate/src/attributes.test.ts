import { catalog } from "@plataforma/api";
import { describe, expect, it } from "vitest";
import { realEstateCatalog, realEstateFactConfidence } from "./attributes";

describe("catálogo do pack imobiliário", () => {
  it("é válido para o núcleo", () => expect(catalog.validatePack(realEstateCatalog)).toEqual([]));
  it("nenhum atributo INFERRED é declarado como fato; derivados têm método", () => {
    for (const a of realEstateCatalog.attributes) { if (a.origin === "DERIVED") expect(a.derivationMethod, a.attributeId).toBeTruthy(); expect(a.origin, a.attributeId).not.toBe("INFERRED"); }
  });
  it("R3: tempo de deslocamento só existe por roteamento (método e fonte explícitos); sem fatos fica DATA_PENDING", () => {
    const t = realEstateCatalog.attributes.find((a) => a.attributeId === "neighborhood.travel_time_to_center")!;
    expect(t.derivationMethod).toBe("routing_travel_time");
    const stats = catalog.discoverAttributes({ definitions: [t], entityCounts: { neighborhood: 12 }, facts: [], policy: realEstateCatalog.defaultPolicy, now: new Date() });
    expect(stats[0]).toMatchObject({ status: "DATA_PENDING", coverage: 0 });
  });
  it("a confiança dos fatos é a qualidade da fonte declarada (nenhum atributo sem qualidade tem confiança)", () => {
    for (const a of realEstateCatalog.attributes) expect(realEstateFactConfidence[a.attributeId] ?? null, a.attributeId).toBe(a.sourceQuality);
  });
  it("atributos de entidades que ainda não existem (bairro, anúncio) declaram a família de página que destravariam", () => {
    for (const a of realEstateCatalog.attributes.filter((x) => x.entityType !== "city")) expect(a.potentialPageFamilies.length, a.attributeId).toBeGreaterThan(0);
  });
});
