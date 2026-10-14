import { describe, expect, it } from "vitest";
import { compareScores } from "./compare";
import { computeScore } from "./score";
import type { ScoreConfig } from "./score-config";
import { TEST_CONFIG, dims, full } from "./test-support/score-fixtures";

const d = full({ demand: 0.2, business_value: 0.9, serp_opportunity: 0.4 });
const heavy = (w: number): ScoreConfig => ({ ...TEST_CONFIG, objectives: { ...TEST_CONFIG.objectives, commercial_value: { ...TEST_CONFIG.objectives.commercial_value, dimensions: { ...TEST_CONFIG.objectives.commercial_value.dimensions, demand: w } } } });

describe("comparação entre dois cálculos: o que mudou e por quê", () => {
  it("mesma entrada e mesma configuração: nada mudou (e o texto diz isso)", () => {
    const a = computeScore({ dimensions: d, strategic: true }, TEST_CONFIG);
    const c = compareScores(a, a, TEST_CONFIG, TEST_CONFIG);
    expect(c.changed).toBe(false);
    expect(c.summary[0]).toBe("Prioridade: sem mudança.");
    expect(c.config).toEqual([]);
    expect(c.contributions).toEqual([]);
  });
  it("aumentar o peso da demanda (que é baixa) piora o valor comercial, e a explicação aponta a dimensão e a configuração alterada", () => {
    const a = computeScore({ dimensions: d, strategic: true }, TEST_CONFIG);
    const b = computeScore({ dimensions: d, strategic: true }, heavy(12));
    const c = compareScores(a, b, TEST_CONFIG, heavy(12));
    expect(c.changed).toBe(true);
    expect(c.objectives.find((o) => o.id === "commercial_value")!.delta!).toBeLessThan(0);
    expect(c.priority.delta!).toBeLessThan(0);
    const cv = c.contributions.filter((x) => x.objective === "commercial_value");
    expect(cv.map((x) => x.dimension)).toContain("demand");
    expect(cv.find((x) => x.dimension === "business_value")!.delta).toBeLessThan(0); // o peso extra da demanda dilui a participação do valor de negócio (alto)
    const raw = (r: typeof a) => r.objectives.commercial_value.score!;
    expect(cv.reduce((n, x) => n + x.delta, 0)).toBeCloseTo(raw(b) - raw(a), 6); // as contribuições RECONCILIAM com a mudança do objetivo
    expect(c.config).toEqual([{ path: "objectives.commercial_value.dimensions.demand", from: 3, to: 12 }]);
    const text = c.summary.join("\n");
    expect(text).toContain("Valor comercial:");
    expect(text).toContain("Maior mudança:");
    expect(text).toContain("objectives.commercial_value.dimensions.demand");
  });
  it("um objetivo que passa a ser calculável, uma penalidade nova e a perda de elegibilidade aparecem no resumo", () => {
    const before = computeScore({ dimensions: dims({ intent: 0.9, business_value: 0.9, conversion_proximity: 0.8, buyer_stage: 0.6, solution_fit: 1, evidence_availability: 1, evidence_risk: 0.1, cannibalization_risk: 0.1 }), strategic: true }, TEST_CONFIG);
    const after = computeScore({ dimensions: dims({ intent: 0.9, business_value: 0.9, conversion_proximity: 0.8, buyer_stage: 0.6, solution_fit: 1, evidence_availability: 1, evidence_risk: 0.95, cannibalization_risk: 0.1, serp_opportunity: 0.5, authority_gap: 0.5, competition: 0.5 }), strategic: true }, TEST_CONFIG);
    const c = compareScores(before, after);
    const text = c.summary.join("\n");
    expect(text).toContain("Oportunidade de descoberta: passou a ser calculável");
    expect(text).toContain("Nova penalidade: risk / execution_feasibility / evidence_risk");
    expect(text).toContain("Deixou de ser elegível.");
    expect(c.eligibility).toEqual({ from: true, to: false });
    expect(c.priority).toMatchObject({ kindFrom: "partial", kindTo: "overall" });
  });
  it("diferenças ínfimas (< 0,05) não contam como mudança", () => {
    const a = computeScore({ dimensions: full({ demand: 0.5 }), strategic: true }, TEST_CONFIG);
    const b = computeScore({ dimensions: full({ demand: 0.5000001 }), strategic: true }, TEST_CONFIG);
    expect(compareScores(a, b).changed).toBe(false);
  });
});
