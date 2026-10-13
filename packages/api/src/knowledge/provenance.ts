// Observação, evidência e confiança em dimensões separadas (ADR-021). Não existe agregação em nota única, de propósito.

export type Level = "high" | "medium" | "low" | "unknown";
export const LEVELS: readonly Level[] = ["high", "medium", "low", "unknown"];

/** Cinco dimensões independentes. Nenhuma função deste módulo as combina numa nota: falha crítica numa dimensão não pode ser escondida por média. */
export interface ConfidenceDimensions {
  readonly sourceQuality: Level;
  readonly directEvidence: Level;
  readonly consistency: Level;
  readonly recency: Level;
  readonly resolutionUncertainty: Level;
}
const DIMENSIONS: readonly (keyof ConfidenceDimensions)[] = ["sourceQuality", "directEvidence", "consistency", "recency", "resolutionUncertainty"];

/** O que foi visto, onde e quando. Imutável. O conteúdo bruto fica fora deste contrato (referência por hash). */
export interface Observation {
  readonly id: string;
  readonly sourceId: string;
  /** URL http(s) ou referência interna estável da origem. */
  readonly sourceRef: string;
  readonly observedAt: Date;
  readonly ingestedAt: Date;
  /** Quando a própria fonte diz ter atualizado o conteúdo (pode não existir). */
  readonly sourceUpdatedAt?: Date;
  /** sha256 (hex minúsculo) do conteúdo observado. */
  readonly contentHash: string;
  readonly parserVersion: string;
}

export interface TransformationStep { readonly name: string; readonly version: string }
export type EvidenceMethod = "direct_extraction" | "derivation" | "rule_inference" | "human_review";

export interface Evidence {
  readonly id: string;
  readonly observationId: string;
  /** Apoia ou contradiz a afirmação? Contradição é evidência, não ruído. */
  readonly supports: "supports" | "contradicts";
  readonly method: EvidenceMethod;
  readonly transformations: readonly TransformationStep[];
  readonly normalizationVersion?: string;
  /** Versões de fato de que esta evidência deriva (obrigatório em derivação e inferência por regra). */
  readonly derivedFrom: readonly string[];
  readonly confidence: ConfidenceDimensions;
}

const SHA256 = /^[0-9a-f]{64}$/;
const nonEmpty = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;

function isValidSourceRef(ref: string): boolean {
  if (/^https?:\/\//i.test(ref)) {
    try { return new URL(ref).hostname.length > 0; } catch { return false; }
  }
  // Referência interna: sem esquema (nada de file:, javascript:, ftp: etc.).
  return !/^[a-z][a-z0-9+.-]*:/i.test(ref);
}

export function validateObservation(o: Observation): string[] {
  const e: string[] = [];
  if (!nonEmpty(o.id)) e.push("id é obrigatório");
  if (!nonEmpty(o.sourceId)) e.push("sourceId é obrigatório");
  if (!nonEmpty(o.sourceRef) || !isValidSourceRef(o.sourceRef)) e.push("sourceRef deve ser URL http(s) ou referência interna sem esquema");
  if (Number.isNaN(o.observedAt.getTime())) e.push("observedAt inválido");
  if (Number.isNaN(o.ingestedAt.getTime())) e.push("ingestedAt inválido");
  if (o.ingestedAt.getTime() < o.observedAt.getTime()) e.push("ingestedAt não pode ser anterior a observedAt");
  if (o.sourceUpdatedAt && (Number.isNaN(o.sourceUpdatedAt.getTime()) || o.sourceUpdatedAt.getTime() > o.ingestedAt.getTime())) e.push("sourceUpdatedAt inválido ou posterior à ingestão");
  if (!SHA256.test(o.contentHash)) e.push("contentHash deve ser sha256 em hex minúsculo (64 caracteres)");
  if (!nonEmpty(o.parserVersion)) e.push("parserVersion é obrigatório");
  return e;
}

export function validateEvidence(ev: Evidence): string[] {
  const e: string[] = [];
  if (!nonEmpty(ev.id)) e.push("id é obrigatório");
  if (!nonEmpty(ev.observationId)) e.push("observationId é obrigatório");
  if ((ev.method === "derivation" || ev.method === "rule_inference") && ev.derivedFrom.length === 0) e.push("derivação e inferência por regra exigem derivedFrom");
  for (const t of ev.transformations) if (!nonEmpty(t.name) || !nonEmpty(t.version)) e.push("toda transformação precisa de nome e versão");
  for (const d of DIMENSIONS) if (!LEVELS.includes(ev.confidence[d])) e.push(`confidence.${d} inválido`);
  return e;
}
