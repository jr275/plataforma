import { DIMENSIONS, type DimensionId, type ScoreConfig } from "../score-config";
import { unknownDimension, type DimensionMap, type DimensionValue } from "../score";
import type { Basis } from "../truth";

// Configuração e entradas de TESTE (genéricas; nada de domínio real). Servem só para exercitar o comportamento do score.
export const TEST_CONFIG: ScoreConfig = {
  schema: "opportunity-score/v2",
  objectives: {
    commercial_value: { weight: 0.4, minCoverage: 0.5, dimensions: { demand: 3, intent: 3, buyer_stage: 1, business_value: 3, conversion_proximity: 2, pipeline_potential: 2 } },
    execution_feasibility: { weight: 0.35, minCoverage: 0.5, dimensions: { solution_fit: 3, evidence_availability: 3, evidence_risk: 2, cannibalization_risk: 2 } },
    discovery_opportunity: { weight: 0.25, minCoverage: 0.5, dimensions: { serp_opportunity: 2, authority_gap: 2, competition: 2, citation_potential: 1, information_gain: 2 } },
  },
  riskPenalties: { evidence_risk: { threshold: 0.7, multiplier: 0.6 }, cannibalization_risk: { threshold: 0.8, multiplier: 0.7 } },
  uncertaintyFactor: 0.5,
  categories: { valueTier: { high: 1, medium: 0.6, low: 0.3 }, experienceStatus: { supported: 1, planned: 0.5, unsupported: 0.1 }, requirementRisk: { critical: 0.9, important: 0.5, optional: 0.2 }, cannibalization: { overlap: 0.85, none: 0.1 } },
  priority: { partialMinObjectives: 2 },
  eligibility: { minCommercialValue: 40, minExecutionFeasibility: 40, maxEvidenceRisk: 0.7, maxCannibalizationRisk: 0.8, requireStrategicOrDemand: true },
};

export const dim = (id: DimensionId, value: number | null, basis: Basis = "derived", extra: Partial<DimensionValue> = {}): DimensionValue =>
  value === null ? unknownDimension(id, "sem dado") : { id, value, basis, source: "teste", note: "valor de teste", ...extra };
export const dims = (over: Partial<Record<DimensionId, number | null>> = {}): DimensionMap =>
  Object.fromEntries(DIMENSIONS.map((d) => [d, dim(d, over[d] ?? null)])) as unknown as DimensionMap;
/** Todas as dimensões com dado (para os cenários em que tudo é conhecido). */
export const full = (over: Partial<Record<DimensionId, number | null>> = {}): DimensionMap => dims({ ...Object.fromEntries(DIMENSIONS.map((d) => [d, 0.5])), ...over } as Record<DimensionId, number | null>);
