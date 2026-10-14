import type { z } from "zod";

// Arquitetura de conteúdo (núcleo GENÉRICO, sem domínio): archetypes como contratos configuráveis e versionados, validação em camadas, grafo de links, intenção/canibalização, JSON-LD e o Quality Gate.
// Nada aqui conhece imóveis ou turismo: o domínio entra pelo Domain Pack (mapa de famílias, adaptadores de dados, extensões). URL é só UM dos sinais da arquitetura (não é a arquitetura).
export const ARCHETYPE_IDS = ["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09", "T10", "T11", "T12"] as const;
export type ArchetypeId = (typeof ARCHETYPE_IDS)[number];

/** Relações semânticas que o grafo de links entende (parent/child, hierarquia, coleção, comparação, intenção complementar…). */
export const LINK_RELATIONS = ["parent", "child", "region_to_city", "city_to_neighborhood", "destination_to_poi", "category_to_entity", "entity_to_experience", "comparison_to_entity", "cluster_to_page", "complementary_intent", "sibling", "breadcrumb"] as const;
export type LinkRelation = (typeof LINK_RELATIONS)[number];

export type Severity = "block_generation" | "block_indexing" | "warning";
export type RuleLayer = "schema" | "required" | "quality" | "provenance" | "eligibility";
/** Uma regra avaliada. `path` aponta para o dado; `evidence` guarda o que foi observado. */
export interface RuleResult { readonly id: string; readonly layer: RuleLayer; readonly severity: Severity; readonly passed: boolean; readonly message: string; readonly path?: string; readonly evidence?: unknown }
export interface Provenance { readonly path: string; readonly source: string; readonly sourceUrl?: string; readonly verifiedAt: string; readonly validUntil?: string }
export interface DensitySignal { readonly id: string; readonly weight: number; readonly description: string; /** Avalia o dado (já validado quanto ao schema) e diz se o sinal foi atingido. */ readonly test: (data: Record<string, unknown>) => { readonly ok: boolean; readonly detail: string } }
/** Perfil de densidade: configurável e versionado POR archetype (os pesos do T03 não valem para os outros). */
export interface DensityProfile { readonly version: string; readonly signals: readonly DensitySignal[]; /** Pontuação mínima (0..1) para elegibilidade de INDEXAÇÃO. */ readonly indexingThreshold: number }
export interface ArchetypeContract {
  readonly id: ArchetypeId; readonly key: string; readonly name: string; readonly version: string;
  readonly primaryIntent: { readonly primary: string; readonly secondary: string };
  /** Tipo da entidade principal (genérico: place, poi, experience, itinerary, business, topic, comparison, list). */ readonly mainEntityKind: string;
  /** Padrão de URL DE REFERÊNCIA; cada tenant configura o seu. */ readonly urlPattern: string;
  readonly expectedDensity: "high" | "medium" | "low";
  readonly aiPolicy: { readonly allowedSlots: readonly string[]; readonly factsFrom: "knowledge_graph_only"; readonly forbidden: readonly string[] };
  readonly schemaTypes: { readonly required: readonly string[]; readonly optional: readonly string[]; /** Tipos que só podem ser emitidos com dados reais que os sustentem (ex.: Offer). */ readonly conditional: readonly string[] };
  /** Schema (zod) do dado da página deste archetype: camada "schema validity". */ readonly schema: z.ZodType<Record<string, unknown>>;
  readonly requirements: readonly RuleSpec[];
  readonly density: DensityProfile;
  readonly linkRules: { readonly allowedRelations: readonly LinkRelation[]; /** Mínimo padrão de inlinks contextuais válidos para publicação indexável (o tenant pode alterar, com auditoria). */ readonly minInlinks: number };
  readonly canonical: { readonly rule: "self" | "parent" | "none" };
  readonly compatibleTemplates: readonly string[]; readonly modules: readonly string[];
  /** Regras específicas do archetype no Quality Gate (ids). */ readonly gateRules: readonly string[];
}
export interface RuleSpec { readonly id: string; readonly layer: Exclude<RuleLayer, "schema">; readonly severity: Severity; readonly message: string; readonly path?: string; readonly check: (data: Record<string, unknown>, ctx: { readonly provenance: readonly Provenance[]; readonly now: Date }) => { readonly passed: boolean; readonly evidence?: unknown } }

export type ValidationStatus = "VALID" | "VALID_WITH_WARNINGS" | "DATA_PENDING" | "INVALID";
export interface ValidationResult {
  readonly archetypeId: ArchetypeId; readonly contractVersion: string; readonly status: ValidationStatus;
  /** Densidade de dados 0..1 (null quando o dado nem passou no schema: nada é pontuado sobre dado inválido). */ readonly score: number | null;
  readonly isValidForIndexing: boolean; readonly isValidForGeneration: boolean;
  readonly issues: readonly RuleResult[]; readonly warnings: readonly RuleResult[]; readonly missingData: readonly string[]; readonly failedRules: readonly string[];
  readonly density: { readonly version: string; readonly threshold: number; readonly signals: readonly { readonly id: string; readonly weight: number; readonly ok: boolean; readonly detail: string }[] } | null;
  readonly evidence: readonly Provenance[];
}
