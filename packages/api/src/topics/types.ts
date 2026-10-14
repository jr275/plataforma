import type { IntentType } from "../catalog/types";

// Tópico (hipótese de oportunidade), seção 4.5 da especificação. Núcleo GENÉRICO: padrões, famílias e dimensões vêm do pack (regra 10).
export const GEO_GRANULARITIES = ["property", "street", "neighborhood", "city", "region"] as const;
export type GeoGranularity = (typeof GEO_GRANULARITIES)[number];
export const TOPIC_ORIGINS = ["ATTRIBUTE", "RELATIONSHIP", "COMBINATION", "DEMAND_DATA", "GAP_ANALYSIS"] as const;
export type TopicOrigin = (typeof TOPIC_ORIGINS)[number];
export type CommercialPotential = "high" | "medium" | "low" | "none";

/** Padrão de tópico declarado pelo pack. `queryPatternKey` aponta o QueryPattern (topicOnly) da vertical que dá ao tópico o seu contrato de blueprint e geração. */
export interface TopicPattern {
  readonly id: string; readonly queryPatternKey: string; readonly entityType: string;
  readonly requiredAttributes: readonly string[]; readonly optionalAttributes: readonly string[];
  /** Dimensões fixas do padrão (ex.: tema). A entidade primária entra sempre como dimensão do tipo dela. */
  readonly baseDimensions: Readonly<Record<string, string>>;
  readonly geoGranularity: GeoGranularity; readonly intentType: IntentType; readonly family: string;
  readonly userNeed: string;
  /** `{name}` = nome da entidade; `{qualifier}` = qualificador (ex.: UF). */
  readonly queryTemplate: string;
  readonly evidenceRequired: readonly string[]; readonly commercialPotential: CommercialPotential;
  readonly relationshipsUsed: readonly string[]; readonly origin: TopicOrigin;
}
export interface TopicEntity { readonly id: string; readonly entityType: string; readonly sourceKey: string; readonly name: string; readonly qualifier: string | null }

export interface Topic {
  readonly topicId: string; readonly tenantId: string; readonly primaryEntityId: string; readonly primaryEntityType: string;
  readonly patternId: string; readonly queryPatternKey: string;
  readonly dimensions: Readonly<Record<string, string>>;
  readonly attributesUsed: readonly string[]; /** Subconjunto de `attributesUsed` sem o qual o tópico não tem dado suficiente. */ readonly requiredAttributes: readonly string[]; readonly relationshipsUsed: readonly string[];
  readonly geoGranularity: GeoGranularity; readonly intentType: IntentType; readonly queryHypothesis: string; readonly userNeed: string;
  readonly evidenceRequired: readonly string[]; readonly dataAvailable: readonly string[]; readonly dataMissing: readonly string[];
  readonly candidatePageFamily: string; readonly commercialPotential: CommercialPotential; readonly refreshDependencies: readonly string[];
  readonly origin: TopicOrigin; readonly parentTopicId: string | null;
  /** Demanda desconhecida até haver fonte: nunca preenchida (R11/R12). */
  readonly demandSignal: { readonly value: number | null; readonly source: string | null; readonly period: string | null; readonly method: string | null; readonly uncertainty: string | null };
}
export interface SkippedPattern { readonly patternId: string; readonly reason: string }
