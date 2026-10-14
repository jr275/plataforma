import { describe, expect, it } from "vitest";
import { explanationErrors, normalizeIntents, blueprintFieldErrors, inventorySpec, intentSpec, type BlueprintDraftInput, type DecisionInput, type IntentInput } from "./agents";
import { fillTemplate, PromptError } from "./runner";

const DEC: DecisionInput = { topic_id: "t1", decision: "DATA_REQUIRED", eligible: false, gate_results: {}, gate_details: {}, blocking_reasons: [], missing_requirements: [], floor_failures: [], total_score: null, weight_coverage: null, recommended_action: "x", policy_version: 1 };
const exp = (explanation: string, next = "Obter dados.") => ({ topic_id: "t1", explanation, next_best_action: next });

describe("o código confere a explicação: não pode contradizer, suavizar nem reinterpretar a decisão (R7)", () => {
  it("explicação coerente passa", () => { expect(explanationErrors(exp("A decisão é DATA_REQUIRED. Falta unicidade. Obtenha mais blocos."), DEC)).toEqual([]); });
  it("cita outra decisão → erro", () => { expect(explanationErrors(exp("Na verdade é READY_FOR_BLUEPRINT."), DEC).join()).toMatch(/cita outra decisão/); });
  it("sugere prontidão ou aprovação que a decisão não tem → erro (na explicação e na próxima ação)", () => {
    for (const t of ["A página está pronta para publicação.", "O tópico foi aprovado.", "Ela pode ser publicada hoje.", "Está elegível para publicação."]) expect(explanationErrors(exp(t), DEC).join(), t).toMatch(/aprovação ou prontidão/);
    expect(explanationErrors(exp("Falta dado.", "Publicar agora, pode ser publicada."), DEC).join()).toMatch(/aprovação ou prontidão/);
  });
  it("para uma decisão READY a mesma frase é permitida; mais de 4 frases e topic_id trocado são erros", () => {
    expect(explanationErrors(exp("Está pronta para gerar o blueprint."), { ...DEC, decision: "READY_FOR_BLUEPRINT", eligible: true })).toEqual([]);
    expect(explanationErrors(exp("Um. Dois. Três. Quatro. Cinco."), DEC).join()).toMatch(/mais de 4 frases/);
    expect(explanationErrors({ ...exp("ok."), topic_id: "outro" }, DEC).join()).toMatch(/topic_id/);
  });
});

describe("prompts: nenhum placeholder cru é enviado", () => {
  it("preenche as variáveis e injeta o INPUT; variável sem valor lança PromptError listando todas", () => {
    expect(fillTemplate("Olá {{A}} e {{B}}", { A: "1", B: "2" })).toBe("Olá 1 e 2");
    expect(() => fillTemplate("{{A}} {{X}} {{Y}}", { A: "1" })).toThrow(PromptError);
    expect(() => fillTemplate("{{A}} {{X}} {{Y}}", { A: "1" })).toThrow(/X, Y/);
    expect(fillTemplate("sem variáveis", {})).toBe("sem variáveis");
  });
});

describe("Agente 3: o código recalcula demanda e necessidade não atendida a partir do INPUT", () => {
  const input: IntentInput = { topics: [{ topic_id: "t", dimensions: {}, query_hypothesis: "q", user_need: "n" }], demand_data: [{ query: "apartamento centro", value: null, impressions: 40, source: "GSC", period: "30d", method: "contagem" }], existing_pages: [] };
  const base = { topic_id: "t", what: "a", where: "b", why: "c", when: "d", for_whom: "e", intent_type: "local" as const, variants: [], query_hypothesis: "q", demand_signal: { value: null, source: "", period: "", uncertainty: "" } };
  it("impressões sem volume viram o valor observado; sem página existente a necessidade não atendida é verdadeira", () => {
    const [i] = normalizeIntents({ intents: [{ ...base, primary_keyword: "Apartamento Centro", demand_status: "OBSERVED", unmet_need: false }] }, input);
    expect(i).toMatchObject({ demandStatus: "OBSERVED", primaryKeyword: "Apartamento Centro", unmetNeed: true, demandSignal: { value: 40, source: "GSC" } });
    expect(i!.discrepancies.join()).toMatch(/valor de demanda|unmet_need/);
  });
  it("com página existente atendendo a consulta, a necessidade deixa de ser não atendida", () => {
    const [i] = normalizeIntents({ intents: [{ ...base, primary_keyword: "apartamento centro", demand_status: "OBSERVED", unmet_need: false }] }, { ...input, existing_pages: [{ url: "/x", queries: ["apartamento centro"] }] });
    expect(i!.unmetNeed).toBe(false);
  });
  it("o agente que afirma OBSERVED sem consulta correspondente é rebaixado para HYPOTHESIS com valor null", () => {
    const [i] = normalizeIntents({ intents: [{ ...base, primary_keyword: null, demand_status: "OBSERVED", demand_signal: { value: 500, source: "x", period: "y", uncertainty: "z" }, unmet_need: true }] }, input);
    expect(i).toMatchObject({ demandStatus: "HYPOTHESIS", primaryKeyword: null, demandSignal: { value: null, source: null } });
    expect(i!.discrepancies.length).toBeGreaterThanOrEqual(2);
  });
  it("a validação do agente recusa topic_id repetido, ausente ou fora do INPUT, e OBSERVED sem keyword", () => {
    const v = intentSpec(input).validate!;
    expect(v({ intents: [{ ...base, primary_keyword: null, demand_status: "HYPOTHESIS", unmet_need: false }, { ...base, primary_keyword: null, demand_status: "HYPOTHESIS", unmet_need: false }] }).join()).toMatch(/repetido/);
    expect(v({ intents: [] }).join()).toMatch(/sem modelagem/);
    expect(v({ intents: [{ ...base, topic_id: "zz", primary_keyword: null, demand_status: "OBSERVED", unmet_need: false }] }).join()).toMatch(/fora do INPUT[\s\S]*OBSERVED sem primary_keyword/);
  });
});

describe("Agentes 1 e 6: regras do código", () => {
  it("Agente 1: ordem decrescente exigida e entidades renomeadas recusadas", () => {
    const input = { scope: "s", richMin: 0.8, entities: [{ entity_id: "e", name: "N" }], attributes: [{ attribute_id: "a", entity_type: "c", family: "F", status: "VALID", coverage: 1, freshness_days: 1, confidence: 1, topics_unblocked: 1 }, { attribute_id: "b", entity_type: "c", family: "F", status: "VALID", coverage: 1, freshness_days: 1, confidence: 1, topics_unblocked: 5 }] };
    const g = (a: string, n: number) => ({ attribute_id: a, family: "F", topics_unblocked: n, collection_cost: "low" as const, suggested_source_class: "x", rationale: "y" });
    const v = inventorySpec(input).validate!;
    expect(v({ scope: "s", entities: [{ entity_id: "e", name: "Outro", families: {} }], top_gaps: [g("a", 1), g("b", 5)] }).join()).toMatch(/não estão ordenadas[\s\S]*renomeada/);
    expect(v({ scope: "s", entities: [], top_gaps: [g("b", 5), g("a", 1)] })).toEqual([]);
  });
  it("Agente 6: título acima de 60 caracteres com valores típicos, placeholder desconhecido, campo extra e consulta secundária fora das variantes", () => {
    const d: BlueprintDraftInput = { page_id: "p", fill: ["title_pattern", "target_query_cluster.secondary"], data_contract: [{ module_id: "m", fields: ["name"] }], intent: { variants: ["a"] }, related_pages: [], sample_values: { name: "x".repeat(70) } };
    const e = blueprintFieldErrors({ page_id: "p", fields: { title_pattern: "{name}", "target_query_cluster.secondary": ["a", "b"], extra: 1 }, notes: "" }, d);
    expect(e.join()).toMatch(/máximo 60/); expect(e.join()).toMatch(/fora de INPUT\.intent\.variants: b/); expect(e.join()).toMatch(/campo não pedido \(__FILL__\): extra/);
    expect(blueprintFieldErrors({ page_id: "p", fields: { title_pattern: "{ghost}" }, notes: "" }, d).join()).toMatch(/\{ghost\} não existe/);
  });
});
