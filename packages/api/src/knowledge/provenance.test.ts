import { describe, expect, it } from "vitest";
import * as provenance from "./provenance";
import { validateEvidence, validateObservation, type Evidence, type Observation } from "./provenance";

const OBS: Observation = { id: "obs-1", sourceId: "src-1", sourceRef: "https://example.org/pagina", observedAt: new Date("2026-10-01T10:00:00Z"), ingestedAt: new Date("2026-10-01T10:05:00Z"), contentHash: "a".repeat(64), parserVersion: "p1" };
const EV: Evidence = { id: "ev-1", observationId: "obs-1", supports: "supports", method: "direct_extraction", transformations: [{ name: "normalize-price", version: "1" }], derivedFrom: [], confidence: { sourceQuality: "medium", directEvidence: "high", consistency: "unknown", recency: "high", resolutionUncertainty: "low" } };

describe("observação", () => {
  it("aceita uma observação completa", () => expect(validateObservation(OBS)).toEqual([]));
  it("exige hash sha256, versão do parser e ingestão não anterior à observação", () => {
    expect(validateObservation({ ...OBS, contentHash: "xyz" }).join()).toMatch(/sha256/);
    expect(validateObservation({ ...OBS, parserVersion: " " }).join()).toMatch(/parserVersion/);
    expect(validateObservation({ ...OBS, ingestedAt: new Date("2026-10-01T09:00:00Z") }).join()).toMatch(/anterior/);
  });
  it("a data da fonte, se existir, não pode ser posterior à ingestão", () => {
    expect(validateObservation({ ...OBS, sourceUpdatedAt: new Date("2026-09-30T00:00:00Z") })).toEqual([]);
    expect(validateObservation({ ...OBS, sourceUpdatedAt: new Date("2027-01-01T00:00:00Z") }).join()).toMatch(/sourceUpdatedAt/);
  });
  it("só aceita URL http(s) ou referência interna sem esquema (nada de file:, javascript:, ftp:)", () => {
    for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "ftp://x/y", "http://"]) expect(validateObservation({ ...OBS, sourceRef: bad }).join()).toMatch(/sourceRef/);
    expect(validateObservation({ ...OBS, sourceRef: "feed/2026-10-01/linha-7" })).toEqual([]);
  });
});

describe("evidência e confiança", () => {
  it("aceita evidência completa", () => expect(validateEvidence(EV)).toEqual([]));
  it("derivação e inferência por regra exigem fatos de origem", () => {
    expect(validateEvidence({ ...EV, method: "derivation" }).join()).toMatch(/derivedFrom/);
    expect(validateEvidence({ ...EV, method: "rule_inference", derivedFrom: ["fv-1"] })).toEqual([]);
  });
  it("transformação precisa de nome e versão", () => {
    expect(validateEvidence({ ...EV, transformations: [{ name: "x", version: "" }] }).join()).toMatch(/versão/);
  });
  it("a confiança são cinco dimensões separadas e NÃO existe agregação em nota única", () => {
    expect(Object.keys(EV.confidence).sort()).toEqual(["consistency", "directEvidence", "recency", "resolutionUncertainty", "sourceQuality"]);
    expect(Object.keys(provenance).filter((k) => /score|nota|aggregate|overall|combine/i.test(k))).toEqual([]);
    expect(validateEvidence({ ...EV, confidence: { ...EV.confidence, recency: "ótimo" as never } }).join()).toMatch(/recency/);
  });
});
