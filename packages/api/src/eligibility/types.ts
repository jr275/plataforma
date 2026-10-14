import type { IntentType } from "../catalog/types";
import type { CommercialPotential, GeoGranularity } from "../topics/types";

// Elegibilidade (spec seções 8 e 9, ADR-030): FUNÇÃO PURA `evaluate(snapshot, policy)`. O snapshot congela TODAS as entradas (inclusive o instante de referência): mesma entrada + mesma política = mesma decisão.
// Gates e pisos são NÃO compensatórios: nota alta jamais supera um gate reprovado. O LLM só explica (ver `decision_explanation`); nunca decide.
export const GATES = ["G1_entity", "G2_intent", "G3_data_sufficiency", "G4_evidence", "G5_uniqueness", "G6_geo_semantic", "G7_freshness", "G8_policy", "G9_cannibalization"] as const;
export type GateId = (typeof GATES)[number];
export const DIMENSIONS = ["search_demand", "user_utility", "data_availability", "evidence_quality", "uniqueness", "business_relevance", "conversion_potential", "serp_opportunity", "graph_connectivity", "production_cost", "freshness", "geo_ai_discoverability"] as const;
export type DimensionId = (typeof DIMENSIONS)[number];
export const DECISIONS = ["READY_FOR_BLUEPRINT", "DATA_REQUIRED", "RESEARCH_REQUIRED", "REJECTED"] as const;
export type Decision = (typeof DECISIONS)[number];

export interface FamilyPolicy { readonly minBlocks: number; readonly idealBlocks: number; /** Custo de produção e manutenção, 0 (barato) a 100 (caro). */ readonly maintenanceCost: number; /** Preparo para descoberta por IA/GEO (0..100); null = desconhecido. */ readonly geoScore: number | null }
export interface EligibilityPolicy {
  readonly minResolutionConfidence: number; readonly minEvidenceConfidence: number; readonly minUniqueBlocks: number;
  readonly weights: Readonly<Record<DimensionId, number>>; readonly floors: Readonly<Partial<Record<DimensionId, number>>>;
  /** Total ≥ readyMin → READY; dataRequiredMin ≤ total < readyMin → DATA_REQUIRED; abaixo → REJECTED. */ readonly readyMin: number; readonly dataRequiredMin: number;
  /** Fração mínima do peso total com dimensões conhecidas para a nota valer (ausência de dado não é zero). */ readonly minWeightCoverage: number;
  readonly demandSaturation: number; readonly similarityThreshold: number; readonly uniquenessTarget: number;
  readonly businessRelevance: Readonly<Record<CommercialPotential, number>>; readonly conversion: Readonly<Record<IntentType, number>>;
  readonly families: Readonly<Record<string, FamilyPolicy>>;
  readonly connectivity: { readonly parent: number; readonly siblings: number; readonly children: number; readonly siblingCap: number; readonly childCap: number };
  /** Categorias semânticas de atributo proibidas como fato (R5). */ readonly forbiddenCategories: readonly string[];
}
export function validatePolicy(p: EligibilityPolicy): string[] {
  const e: string[] = [];
  const sum = DIMENSIONS.reduce((s, d) => s + (p.weights[d] ?? NaN), 0);
  if (!Number.isFinite(sum) || Math.abs(sum - 100) > 1e-9) e.push(`os pesos devem somar 100 (soma atual: ${sum})`);
  for (const d of DIMENSIONS) if (!(p.weights[d]! >= 0)) e.push(`peso inválido: ${d}`);
  for (const [d, f] of Object.entries(p.floors)) if (!DIMENSIONS.includes(d as DimensionId) || f! < 0 || f! > 100) e.push(`piso inválido: ${d}`);
  if (!(p.dataRequiredMin > 0 && p.dataRequiredMin < p.readyMin && p.readyMin <= 100)) e.push("limiares inválidos (0 < dataRequiredMin < readyMin ≤ 100)");
  for (const k of ["minResolutionConfidence", "minEvidenceConfidence", "minWeightCoverage", "similarityThreshold"] as const) if (!(p[k] >= 0 && p[k] <= 1)) e.push(`${k} fora de 0..1`);
  if (!(p.minUniqueBlocks >= 1) || !(p.demandSaturation > 0) || !(p.uniquenessTarget >= p.minUniqueBlocks)) e.push("parâmetros numéricos inválidos");
  for (const [f, v] of Object.entries(p.families)) if (!(v.minBlocks >= 1) || v.idealBlocks < v.minBlocks || v.maintenanceCost < 0 || v.maintenanceCost > 100) e.push(`família inválida: ${f}`);
  return e;
}

export interface FactRef { readonly factId: string; readonly attributeId: string; readonly confidence: number; readonly observedAt: string; readonly sourceName: string; readonly maxAgeDays: number | null }
export interface AttributeSnap { readonly attributeId: string; readonly status: string; readonly usableAsFact: boolean; readonly semanticCategory: string; readonly derivationMethod: string | null }
export interface Conflict { readonly topicId: string; readonly similarity: number; readonly resolved: boolean }
/** Tudo que a avaliação usa, congelado. O instante de referência faz parte do snapshot (testes controlam o tempo). */
export interface EligibilitySnapshot {
  readonly referenceTime: string; readonly tenantId: string;
  readonly topic: { readonly topicId: string; readonly origin: string; readonly family: string; readonly intentType: IntentType; readonly geoGranularity: GeoGranularity | null; readonly commercialPotential: string; readonly queryHypothesis: string; readonly parentTopicId: string | null;
    readonly demand: { readonly value: number | null; readonly source: string | null }; readonly attributesUsed: readonly string[]; readonly dataAvailable: readonly string[]; readonly dataMissing: readonly string[] };
  readonly entity: { readonly id: string; readonly status: string; readonly resolutionConfidence: number } | null;
  readonly attributes: readonly AttributeSnap[];
  /** Fatos correntes (com fonte) das entidades do tópico para os atributos usados. */ readonly facts: readonly FactRef[];
  /** Quantos blocos de dados VARIAM entre as instâncias da família (valores distintos > 1). */ readonly varyingBlocks: number;
  readonly coherenceConflicts: readonly string[];
  readonly conflicts: readonly Conflict[];
  readonly graph: { readonly siblings: number; readonly children: number };
  readonly serp: { readonly opportunity: number | null };
}

export interface GateResult { readonly result: "PASS" | "FAIL"; /** FAIL por falta de dado (reparável) ou por impedimento. */ readonly kind: "data" | "blocking" | null; readonly detail: string; readonly missing: readonly string[]; /** G2: passou só como hipótese (sem demanda observada). */ readonly hypothesis?: boolean }
export interface DimensionScore { readonly score: number | null; readonly weight: number; readonly floor: number | null; readonly inputs: Readonly<Record<string, unknown>>; readonly justification: string; readonly uncertainty: string }
export interface EligibilityDecision {
  readonly topicId: string; readonly eligible: boolean; readonly decision: Decision;
  readonly gateResults: Readonly<Record<GateId, "PASS" | "FAIL">>; readonly gateDetails: Readonly<Record<GateId, GateResult>>;
  readonly blockingReasons: readonly string[]; readonly missingRequirements: readonly string[];
  /** `null` = a pontuação não foi calculada porque um gate reprovou (a nota só existe depois dos gates). */ readonly scores: Readonly<Record<DimensionId, DimensionScore>> | null;
  readonly totalScore: number | null; readonly weightCoverage: number | null;
  readonly floorFailures: readonly string[];
  readonly evidenceRefs: readonly string[]; readonly policyVersion: number; readonly evaluatedAt: string; readonly recommendedAction: string;
}
