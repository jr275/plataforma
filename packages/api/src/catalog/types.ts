// Camada de dados do motor de páginas (ADR-029). Núcleo GENÉRICO: tipos de entidade, atributos e famílias de página são declarados por um pack (regra 10); nada de domínio aqui.
export const DATA_TYPES = ["numeric", "categorical", "geographic", "temporal", "relational", "derived", "contextual", "commercial", "semantic", "qualitative"] as const;
export type DataType = (typeof DATA_TYPES)[number];
export type Origin = "OBSERVED" | "DERIVED" | "INFERRED";
export type ValidationStatus = "VALID" | "PARTIAL" | "DATA_PENDING" | "INVALID";
export const INTENT_TYPES = ["transactional", "commercial", "informational", "local", "comparative", "seasonal", "question"] as const;
export type IntentType = (typeof INTENT_TYPES)[number];

/** Declaração de um atributo pelo pack. `INFERRED` nunca é usado como fato em página. */
export interface AttributeDefinition {
  readonly attributeId: string; readonly entityType: string; readonly name: string; readonly dataType: DataType; readonly origin: Origin;
  readonly semanticCategory: string; readonly source: string; readonly sourceQuality: number | null;
  /** Idade máxima aceitável da observação, em dias (política de frescor); `null` = não expira. */
  readonly maxAgeDays: number | null;
  readonly derivationMethod: string | null; readonly relatedEntities: readonly string[];
  readonly supportedIntents: readonly IntentType[]; readonly potentialPageFamilies: readonly string[];
}
export interface EntityTypeDefinition { readonly entityType: string; readonly label: string }

/** Política de descoberta, VERSIONADA por tenant (nunca constantes no código). */
export interface DiscoveryPolicy {
  /** Cobertura a partir da qual o atributo é VALID. */
  readonly minCoverageValid: number;
  /** Cobertura mínima para PARTIAL (abaixo disso, sem dados suficientes: DATA_PENDING). */
  readonly minCoveragePartial: number;
  /** Confiança média mínima para VALID. */
  readonly minConfidence: number;
}
export interface CatalogPack { readonly entityTypes: readonly EntityTypeDefinition[]; readonly attributes: readonly AttributeDefinition[]; readonly defaultPolicy: DiscoveryPolicy }

export function validatePack(p: CatalogPack): string[] {
  const e: string[] = [];
  const types = new Set(p.entityTypes.map((t) => t.entityType));
  if (types.size !== p.entityTypes.length) e.push("tipo de entidade duplicado");
  const ids = new Set<string>();
  for (const a of p.attributes) {
    if (ids.has(a.attributeId)) e.push(`atributo duplicado: ${a.attributeId}`);
    ids.add(a.attributeId);
    if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(a.attributeId)) e.push(`${a.attributeId}: id inválido`);
    if (!a.attributeId.startsWith(`${a.entityType}.`)) e.push(`${a.attributeId}: o id deve começar pelo tipo de entidade (${a.entityType}.)`);
    if (!types.has(a.entityType)) e.push(`${a.attributeId}: tipo de entidade desconhecido`);
    for (const r of a.relatedEntities) if (!types.has(r)) e.push(`${a.attributeId}: entidade relacionada desconhecida (${r})`);
    if (a.origin === "DERIVED" && !a.derivationMethod) e.push(`${a.attributeId}: atributo derivado exige o método de derivação`);
    if (a.origin !== "DERIVED" && a.derivationMethod) e.push(`${a.attributeId}: só atributos derivados têm método de derivação`);
    if (a.sourceQuality !== null && (a.sourceQuality < 0 || a.sourceQuality > 1)) e.push(`${a.attributeId}: qualidade da fonte fora de 0..1`);
    if (a.maxAgeDays !== null && (!Number.isInteger(a.maxAgeDays) || a.maxAgeDays < 1)) e.push(`${a.attributeId}: validade em dias inválida`);
  }
  const pol = p.defaultPolicy;
  if (!(pol.minCoverageValid > 0 && pol.minCoverageValid <= 1) || !(pol.minCoveragePartial >= 0 && pol.minCoveragePartial < pol.minCoverageValid) || !(pol.minConfidence >= 0 && pol.minConfidence <= 1)) e.push("política de descoberta inválida (partial < valid ≤ 1; confiança 0..1)");
  return e;
}
