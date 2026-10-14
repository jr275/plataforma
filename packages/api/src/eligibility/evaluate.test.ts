import { describe, expect, it } from "vitest";
import { evaluate, evaluateGates, scoreDimensions, snapshotHash } from "./evaluate";
import { DIMENSIONS, GATES, validatePolicy, type EligibilityPolicy, type EligibilitySnapshot } from "./types";

// Política e snapshot FICTÍCIOS (domínio "restaurantes"): a função é pura e genérica. O tempo é CONTROLADO (referenceTime no snapshot).
const POLICY: EligibilityPolicy = {
  minResolutionConfidence: 0.8, minEvidenceConfidence: 0.7, minUniqueBlocks: 3, uniquenessTarget: 5, demandSaturation: 10_000, similarityThreshold: 0.6,
  weights: { search_demand: 20, user_utility: 15, data_availability: 10, evidence_quality: 10, uniqueness: 10, business_relevance: 10, conversion_potential: 5, serp_opportunity: 5, graph_connectivity: 5, production_cost: 5, freshness: 3, geo_ai_discoverability: 2 },
  floors: { user_utility: 50, evidence_quality: 60, uniqueness: 50 }, readyMin: 75, dataRequiredMin: 60, minWeightCoverage: 0.8,
  businessRelevance: { high: 100, medium: 65, low: 35, none: 0 }, conversion: { transactional: 100, commercial: 80, comparative: 60, local: 50, informational: 30, question: 25, seasonal: 40 },
  families: { F1: { minBlocks: 3, idealBlocks: 4, maintenanceCost: 20, geoScore: 80 } }, connectivity: { parent: 30, siblings: 50, children: 20, siblingCap: 5, childCap: 3 }, forbiddenCategories: ["social"],
};
const REF = "2026-10-14T12:00:00.000Z";
const fact = (id: string, attr: string, over: Partial<EligibilitySnapshot["facts"][number]> = {}) => ({ factId: id, attributeId: attr, confidence: 0.95, observedAt: "2026-10-01T00:00:00.000Z", sourceName: "fonte", maxAgeDays: 90, ...over });
const ATTRS = ["r.a", "r.b", "r.c", "r.d"];
const SNAP: EligibilitySnapshot = {
  referenceTime: REF, tenantId: "t1",
  topic: { topicId: "a".repeat(64), origin: "ATTRIBUTE", family: "F1", intentType: "commercial", geoGranularity: "neighborhood", commercialPotential: "high", queryHypothesis: "restaurantes no bairro X", parentTopicId: "p".repeat(64), demand: { value: 10_000, source: "fonte de teste" }, attributesUsed: ATTRS, dataAvailable: ATTRS, dataMissing: [] },
  entity: { id: "e1", status: "ACTIVE", resolutionConfidence: 0.95 },
  attributes: ATTRS.map((a) => ({ attributeId: a, status: "VALID", usableAsFact: true, semanticCategory: "culinária", derivationMethod: null })),
  facts: ATTRS.map((a, i) => fact(`f${i}`, a)), varyingBlocks: 5, coherenceConflicts: [], conflicts: [], graph: { siblings: 5, children: 3 }, serp: { opportunity: 80 },
};
const snap = (o: Partial<EligibilitySnapshot> = {}, topic: Partial<EligibilitySnapshot["topic"]> = {}): EligibilitySnapshot => ({ ...SNAP, ...o, topic: { ...SNAP.topic, ...topic } });
const ev = (s: EligibilitySnapshot = SNAP, p: EligibilityPolicy = POLICY) => evaluate(s, p, 1);
const one = (dim: (typeof DIMENSIONS)[number], score: Record<string, number>): EligibilityPolicy => ({ ...POLICY, weights: Object.fromEntries(DIMENSIONS.map((d) => [d, d === dim ? 100 : 0])) as EligibilityPolicy["weights"], businessRelevance: score as EligibilityPolicy["businessRelevance"], floors: {} });

describe("tudo em ordem: READY com a nota calculada só depois dos gates", () => {
  const d = ev();
  it("todos os gates passam e a decisão é READY_FOR_BLUEPRINT com nota ≥ 75", () => {
    for (const g of GATES) expect(d.gateResults[g], g).toBe("PASS");
    expect(d).toMatchObject({ decision: "READY_FOR_BLUEPRINT", eligible: true, blockingReasons: [], missingRequirements: [], policyVersion: 1, evaluatedAt: REF });
    expect(d.totalScore).toBeGreaterThanOrEqual(75);
    expect(d.weightCoverage).toBe(1);
    expect(d.evidenceRefs).toEqual(["f0", "f1", "f2", "f3"]);
  });
  it("cada dimensão persiste score, peso, piso, entradas, justificativa e incerteza", () => {
    for (const k of DIMENSIONS) expect(d.scores![k], k).toMatchObject({ weight: POLICY.weights[k], justification: expect.any(String), uncertainty: expect.any(String), inputs: expect.any(Object) });
    expect(d.scores!.user_utility.floor).toBe(50);
  });
  it("a decisão não carrega explicação: o LLM só explica DEPOIS, sem poder alterar (R7)", () => { expect(Object.keys(d)).not.toContain("explanation"); });
});

describe("gates são NÃO compensatórios: nota alta jamais supera um gate reprovado", () => {
  const cases: [string, Partial<EligibilitySnapshot>, Partial<EligibilitySnapshot["topic"]>, string, "REJECTED" | "DATA_REQUIRED"][] = [
    ["G1 entidade inexistente", { entity: null }, {}, "G1_entity", "REJECTED"],
    ["G1 entidade fundida", { entity: { id: "e", status: "MERGED", resolutionConfidence: 0.95 } }, {}, "G1_entity", "REJECTED"],
    ["G1 resolução baixa", { entity: { id: "e", status: "ACTIVE", resolutionConfidence: 0.5 } }, {}, "G1_entity", "REJECTED"],
    ["G3 bloco faltando", {}, { dataMissing: ["r.d"], dataAvailable: ["r.a", "r.b", "r.c"] }, "G3_data_sufficiency", "DATA_REQUIRED"],
    ["G3 poucos blocos", {}, { dataAvailable: ["r.a", "r.b"], attributesUsed: ["r.a", "r.b"] }, "G3_data_sufficiency", "DATA_REQUIRED"],
    ["G4 confiança baixa", { facts: ATTRS.map((a, i) => fact(`f${i}`, a, { confidence: 0.5 })) }, {}, "G4_evidence", "DATA_REQUIRED"],
    ["G4 fato sem fonte", { facts: ATTRS.map((a, i) => fact(`f${i}`, a, { sourceName: i === 0 ? " " : "fonte" })) }, {}, "G4_evidence", "DATA_REQUIRED"],
    ["G4 atributo INFERRED usado como fato", { attributes: ATTRS.map((a, i) => ({ attributeId: a, status: "VALID", usableAsFact: i !== 0, semanticCategory: "x", derivationMethod: null })) }, {}, "G4_evidence", "REJECTED"],
    ["G5 pouca variação entre instâncias", { varyingBlocks: 2 }, {}, "G5_uniqueness", "DATA_REQUIRED"],
    ["G6 conflito geográfico", { coherenceConflicts: ["bairro na cidade errada"] }, {}, "G6_geo_semantic", "REJECTED"],
    ["G7 dado vencido", { facts: ATTRS.map((a, i) => fact(`f${i}`, a, { observedAt: "2026-01-01T00:00:00.000Z" })) }, {}, "G7_freshness", "DATA_REQUIRED"],
    ["G8 categoria proibida (R5)", { attributes: ATTRS.map((a, i) => ({ attributeId: a, status: "VALID", usableAsFact: true, semanticCategory: i === 0 ? "social" : "x", derivationMethod: null })) }, {}, "G8_policy", "REJECTED"],
    ["G9 canibalização não resolvida", { conflicts: [{ topicId: "c".repeat(64), similarity: 0.9, resolved: false }] }, {}, "G9_cannibalization", "REJECTED"],
  ];
  for (const [name, over, topic, gate, expected] of cases) it(`${name} → ${gate} FAIL → ${expected}, sem nota`, () => {
    const d = ev(snap(over, topic));
    expect(d.gateResults[gate as (typeof GATES)[number]]).toBe("FAIL");
    expect(d.decision).toBe(expected);
    expect(d.eligible).toBe(false);
    expect(d.scores).toBeNull();
    expect(d.totalScore).toBeNull();
    expect(expected === "REJECTED" ? d.blockingReasons.join() : d.missingRequirements.join()).toContain(gate);
  });
  it("impedimento (blocking) vence a falta de dado quando os dois ocorrem", () => {
    const d = ev(snap({ entity: null, varyingBlocks: 0 }));
    expect(d.decision).toBe("REJECTED");
    expect(d.blockingReasons.length).toBeGreaterThan(0);
    expect(d.missingRequirements.length).toBeGreaterThan(0);
  });
  it("conflito de canibalização abaixo do limiar ou já resolvido não reprova", () => {
    expect(ev(snap({ conflicts: [{ topicId: "c", similarity: 0.3, resolved: false }, { topicId: "d", similarity: 0.95, resolved: true }] })).gateResults.G9_cannibalization).toBe("PASS");
  });
  it("R3: tempo de deslocamento sem fato com fonte de roteamento reprova G8", () => {
    const d = ev(snap({ attributes: [...SNAP.attributes, { attributeId: "r.travel", status: "PARTIAL", usableAsFact: true, semanticCategory: "mobilidade", derivationMethod: "routing_travel_time" }] }, { attributesUsed: [...ATTRS, "r.travel"] }));
    expect(d.gateResults.G8_policy).toBe("FAIL");
    expect(d.blockingReasons.join()).toContain("R3");
  });
});

describe("demanda: sem sinal, no máximo RESEARCH_REQUIRED (qualquer que seja a nota)", () => {
  it("demanda desconhecida: a dimensão é null (não zero), a nota é a média dos conhecidos e a decisão é RESEARCH_REQUIRED", () => {
    const d = ev(snap({}, { demand: { value: null, source: null } }));
    expect(d.gateResults.G2_intent).toBe("PASS");
    expect(d.gateDetails.G2_intent.hypothesis).toBe(true);
    expect(d.decision).toBe("RESEARCH_REQUIRED");
    expect(d.scores!.search_demand.score).toBeNull();
    expect(d.weightCoverage).toBe(0.8);
    expect(d.totalScore).toBeGreaterThan(75); // a nota alta NÃO transforma hipótese em READY
    expect(d.eligible).toBe(false);
  });
  it("demanda observada entra na escala logarítmica e saturada", () => {
    expect(scoreDimensions(SNAP, POLICY).search_demand.score).toBe(100);
    expect(scoreDimensions(snap({}, { demand: { value: 99, source: "x" } }), POLICY).search_demand.score).toBeCloseTo(50, 2);
    expect(scoreDimensions(snap({}, { demand: { value: 0, source: "x" } }), POLICY).search_demand.score).toBe(0); // zero observado é 0 de verdade
  });
});

describe("limiares da política versionada: ≥75 READY, 60–<75 DATA_REQUIRED, <60 REJECTED", () => {
  const at = (n: number) => ev(snap({}, { commercialPotential: "high" }), one("business_relevance", { high: n, medium: 0, low: 0, none: 0 }));
  it("fronteiras exatas", () => {
    expect(at(75).decision).toBe("READY_FOR_BLUEPRINT");
    expect(at(74.999).decision).toBe("DATA_REQUIRED");
    expect(at(60).decision).toBe("DATA_REQUIRED");
    expect(at(59.999).decision).toBe("REJECTED");
    expect(at(0).decision).toBe("REJECTED");
  });
  it("os limiares vêm da política: mudar a política muda a decisão sem mudar o código", () => {
    expect(ev(snap({}, { commercialPotential: "high" }), { ...one("business_relevance", { high: 70, medium: 0, low: 0, none: 0 }), readyMin: 70 }).decision).toBe("READY_FOR_BLUEPRINT");
  });
  it("piso não compensatório: dimensão abaixo do piso → DATA_REQUIRED mesmo com total ≥ 75", () => {
    const p: EligibilityPolicy = { ...POLICY, weights: { ...POLICY.weights, user_utility: 0, business_relevance: 25 }, floors: { user_utility: 50 }, families: { F1: { ...POLICY.families.F1!, idealBlocks: 40 } } };
    const d = ev(SNAP, p);
    expect(d.totalScore).toBeGreaterThanOrEqual(75);
    expect(d.floorFailures).toEqual(["user_utility 10 < piso 50"]);
    expect(d.decision).toBe("DATA_REQUIRED");
  });
  it("cobertura de pesos abaixo do mínimo (dimensões demais desconhecidas) → DATA_REQUIRED, nunca nota inflada", () => {
    const d = ev(snap({ serp: { opportunity: null } }), { ...POLICY, minWeightCoverage: 0.99, families: { F1: { ...POLICY.families.F1!, geoScore: null } } });
    expect(d.weightCoverage).toBe(0.93);
    expect(d.decision).toBe("DATA_REQUIRED");
  });
  it("ausência não é zero: a nota é a média ponderada SÓ dos conhecidos", () => {
    const full = scoreDimensions(SNAP, POLICY); const noSerp = ev(snap({ serp: { opportunity: null } }));
    const known = DIMENSIONS.filter((k) => k !== "serp_opportunity");
    const expected = known.reduce((x, k) => x + POLICY.weights[k] * full[k].score!, 0) / known.reduce((x, k) => x + POLICY.weights[k], 0);
    expect(noSerp.totalScore).toBeCloseTo(expected, 2);
  });
});

describe("DETERMINISMO (snapshot, política e tempo controlados)", () => {
  it("mesma entrada + mesma política = a mesma decisão, em qualquer ordem das listas", () => {
    const a = ev(); const b = ev(snap({ facts: [...SNAP.facts].reverse(), attributes: [...SNAP.attributes].reverse() }));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(snapshotHash(snap({ facts: [...SNAP.facts].reverse(), attributes: [...SNAP.attributes].reverse() }))).toBe(snapshotHash(SNAP));
    for (let i = 0; i < 20; i++) expect(JSON.stringify(ev())).toBe(JSON.stringify(a));
  });
  it("o tempo é parte do snapshot: outro instante de referência muda o hash e pode mudar G7", () => {
    const late = snap({ referenceTime: "2027-03-01T00:00:00.000Z" });
    expect(snapshotHash(late)).not.toBe(snapshotHash(SNAP));
    expect(evaluateGates(SNAP, POLICY).G7_freshness.result).toBe("PASS");
    expect(evaluateGates(late, POLICY).G7_freshness.result).toBe("FAIL");
  });
  it("a política (versão) aparece na decisão e qualquer mudança de entrada muda o hash", () => {
    expect(evaluate(SNAP, POLICY, 7).policyVersion).toBe(7);
    expect(snapshotHash(snap({ varyingBlocks: 4 }))).not.toBe(snapshotHash(SNAP));
    expect(snapshotHash(snap({}, { demand: { value: 9_999, source: "fonte de teste" } }))).not.toBe(snapshotHash(SNAP));
  });
  it("a função não lê relógio nem aleatoriedade: o instante da decisão é o do snapshot", () => { expect(ev().evaluatedAt).toBe(REF); });
});

describe("validação da política", () => {
  it("política válida passa; pesos que não somam 100, limiares trocados e valores fora de faixa são recusados", () => {
    expect(validatePolicy(POLICY)).toEqual([]);
    expect(validatePolicy({ ...POLICY, weights: { ...POLICY.weights, search_demand: 21 } }).join()).toMatch(/somar 100/);
    expect(validatePolicy({ ...POLICY, readyMin: 50 }).join()).toMatch(/limiares inválidos/);
    expect(validatePolicy({ ...POLICY, minEvidenceConfidence: 1.2 }).join()).toMatch(/minEvidenceConfidence/);
    expect(validatePolicy({ ...POLICY, floors: { user_utility: 120 } }).join()).toMatch(/piso inválido/);
    expect(validatePolicy({ ...POLICY, families: { F1: { minBlocks: 5, idealBlocks: 2, maintenanceCost: 10, geoScore: null } } }).join()).toMatch(/família inválida/);
  });
});
