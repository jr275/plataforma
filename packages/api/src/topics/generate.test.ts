import { describe, expect, it } from "vitest";
import type { AttributeStat } from "../catalog/discovery";
import type { AttributeDefinition } from "../catalog/types";
import { generateTopics, normalizeDimensions, topicId, validateProposal, type Proposal, type ProposalContext } from "./generate";
import type { TopicEntity, TopicPattern } from "./types";

// Pack FICTÍCIO ("restaurantes"): o gerador é genérico.
const def = (attributeId: string, entityType: string): AttributeDefinition => ({ attributeId, entityType, name: attributeId, dataType: "numeric", origin: "OBSERVED", semanticCategory: "x", source: "t", sourceQuality: 0.9, maxAgeDays: null, derivationMethod: null, relatedEntities: [], supportedIntents: [], potentialPageFamilies: [] });
const cat = (status: Record<string, AttributeStat["status"]>) => Object.entries(status).map(([id, st]) => ({ definition: def(id, id.split(".")[0]!), status: st }));
const P: TopicPattern = { id: "rest-rating", queryPatternKey: "q", entityType: "restaurant", requiredAttributes: ["restaurant.rating"], optionalAttributes: ["restaurant.cuisine"], baseDimensions: { Topic: "Nota Média" }, geoGranularity: "neighborhood", intentType: "informational", family: "F1", userNeed: "ver a nota", queryTemplate: "nota de {name} em {qualifier}", evidenceRequired: ["rating"], commercialPotential: "low", relationshipsUsed: [], origin: "ATTRIBUTE" };
const E = (id: string, name: string, q: string | null = "Centro"): TopicEntity => ({ id, entityType: "restaurant", sourceKey: `k:${id}`, name, qualifier: q });
const T = "tenant-1";
const run = (o: Partial<Parameters<typeof generateTopics>[0]> = {}) => generateTopics({ tenantId: T, patterns: [P], catalog: cat({ "restaurant.rating": "VALID", "restaurant.cuisine": "PARTIAL" }), entities: [E("a", "Casa Azul"), E("b", "Bistrô Verde")], factsByEntity: new Map([["a", new Set(["restaurant.rating", "restaurant.cuisine"])], ["b", new Set(["restaurant.cuisine"])]]), ...o });

describe("identidade determinística do tópico", () => {
  it("normaliza chaves e valores (acento, caixa, espaços) e a ordem das chaves não importa", () => {
    expect(normalizeDimensions({ " Topic ": "  Nota   Média ", Cidade: "São Paulo" })).toEqual({ cidade: "sao paulo", topic: "nota media" });
    expect(topicId(T, { a: "x", b: "y" })).toBe(topicId(T, { b: "Y ", A: "X" }));
  });
  it("muda com o tenant e com qualquer dimensão; é um sha256", () => {
    const id = topicId(T, { a: "x" });
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(topicId("tenant-2", { a: "x" })).not.toBe(id);
    expect(topicId(T, { a: "y" })).not.toBe(id);
    expect(topicId(T, { a: "x", b: "z" })).not.toBe(id);
  });
});
describe("geração por padrão × entidade", () => {
  it("gera um tópico por entidade, com dados disponíveis e faltantes SEPARADOS; demanda desconhecida; consulta preenchida do nome", () => {
    const r = run();
    expect(r.topics).toHaveLength(2);
    const a = r.topics.find((t) => t.primaryEntityId === "a")!; const b = r.topics.find((t) => t.primaryEntityId === "b")!;
    expect(a).toMatchObject({ dataAvailable: ["restaurant.rating", "restaurant.cuisine"], dataMissing: [], queryHypothesis: "nota de Casa Azul em Centro", candidatePageFamily: "F1", origin: "ATTRIBUTE", parentTopicId: null });
    expect(b).toMatchObject({ dataAvailable: ["restaurant.cuisine"], dataMissing: ["restaurant.rating"] });
    expect(a.demandSignal).toEqual({ value: null, source: null, period: null, method: null, uncertainty: "sem fonte de demanda" });
    expect(a.dimensions).toEqual({ restaurant: "k:a", topic: "nota media" });
    expect(a.refreshDependencies).toEqual(["restaurant.rating"]);
  });
  it("é determinístico: a ordem das entidades e dos padrões não muda ids nem a ordem de saída", () => {
    const x = run(); const y = run({ entities: [E("b", "Bistrô Verde"), E("a", "Casa Azul")] });
    expect(y.topics.map((t) => t.topicId)).toEqual(x.topics.map((t) => t.topicId));
  });
  it("atributo exigido que não é VALID/PARTIAL (ou nem está declarado) pula o padrão INTEIRO, com o motivo", () => {
    for (const st of ["DATA_PENDING", "INVALID"] as const) {
      const r = run({ catalog: cat({ "restaurant.rating": st }) });
      expect(r.topics).toEqual([]);
      expect(r.skipped[0]).toMatchObject({ patternId: "rest-rating" });
      expect(r.skipped[0]!.reason).toContain(`restaurant.rating [${st}]`);
    }
    expect(run({ catalog: [] }).skipped[0]!.reason).toContain("não declarado");
  });
  it("sem entidades do tipo: nada é gerado e o motivo é registrado (R12)", () => {
    const r = run({ entities: [] });
    expect(r.topics).toEqual([]);
    expect(r.skipped[0]!.reason).toMatch(/não existem entidades/);
  });
  it("deduplicação exata: duas entidades com a mesma chave geram UM tópico", () => {
    const r = run({ entities: [E("a", "Casa Azul"), { ...E("a2", "Casa Azul (cópia)"), sourceKey: "k:a" }] });
    expect(r.topics).toHaveLength(1);
    expect(r.duplicates).toBe(1);
  });
  it("entidade de outro tipo não participa; qualificador ausente não deixa parênteses vazios", () => {
    const r = run({ entities: [{ ...E("z", "Praça"), entityType: "square" }, E("a", "Casa Azul", null)] });
    expect(r.topics).toHaveLength(1);
    expect(r.topics[0]!.queryHypothesis).toBe("nota de Casa Azul em");
  });
});
describe("propostas do Agente 2: o código valida, o que falha é descartado com motivo", () => {
  const ctx = (over: Partial<ProposalContext> = {}): ProposalContext => ({ entity: E("a", "Casa Azul"), catalogStatus: new Map([["restaurant.rating", "VALID"], ["restaurant.cuisine", "DATA_PENDING"]]), relationships: new Set(["near"]), families: new Set(["F1"]), dimensionIds: new Set(["topic", "cuisine"]), existingTopicIds: new Set(), tenantId: T, compatible: () => null, ...over });
  const prop = (o: Partial<Proposal> = {}): Proposal => ({ dimensions: { topic: "ranking" }, attributes_used: ["restaurant.rating"], relationships_used: ["near"], candidate_page_family: "F1", user_need: "x", query_hypothesis: "q", why_not_covered: "w", evidence_required: [], ...o });
  it("aceita a proposta válida e devolve o topic_id com a entidade primária", () => {
    const r = validateProposal(prop(), ctx());
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.topicId).toBe(topicId(T, { topic: "ranking", restaurant: "k:a" }));
  });
  it("descarta atributo inexistente, sem cobertura, relação/família/dimensão desconhecidas, sem atributo e campos vazios", () => {
    const bad = (p: Partial<Proposal>) => { const r = validateProposal(prop(p), ctx()); return r.ok ? [] : r.reasons.join("|"); };
    expect(bad({ attributes_used: ["restaurant.ghost"] })).toMatch(/inexistente/);
    expect(bad({ attributes_used: ["restaurant.cuisine"] })).toMatch(/sem cobertura suficiente/);
    expect(bad({ relationships_used: ["teleport"] })).toMatch(/relação desconhecida/);
    expect(bad({ candidate_page_family: "Z" })).toMatch(/família/);
    expect(bad({ dimensions: { moon: "x" } })).toMatch(/dimensão desconhecida/);
    expect(bad({ attributes_used: [] })).toMatch(/não usa nenhum atributo/);
    expect(bad({ why_not_covered: " " })).toMatch(/campos obrigatórios/);
  });
  it("descarta o incompatível pela matriz e a duplicata exata de tópico existente", () => {
    expect(validateProposal(prop(), ctx({ compatible: () => "regra X" }))).toEqual({ ok: false, reasons: ["incompatível: regra X"] });
    const id = topicId(T, { topic: "ranking", restaurant: "k:a" });
    expect(validateProposal(prop(), ctx({ existingTopicIds: new Set([id]) }))).toEqual({ ok: false, reasons: ["duplicata exata de um tópico existente"] });
  });
});
