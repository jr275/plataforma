import { createHash } from "node:crypto";
import type { ExperienceStatus, RequirementWeight, ValueTier } from "./vertical";

// Configuração do Opportunity Score V2 (ADR-023, seção 6): esquema versionado, pesos e regras por tenant e vertical. Nada aqui é fórmula universal:
// cada vertical entrega a versão 1; cada tenant pode criar novas versões imutáveis.
export const DIMENSIONS = [
  "demand", "intent", "buyer_stage", "business_value", "solution_fit", "conversion_proximity", "pipeline_potential", "evidence_availability",
  "information_gain", "citation_potential", "serp_opportunity", "authority_gap", "competition", "cannibalization_risk", "evidence_risk",
] as const;
export type DimensionId = (typeof DIMENSIONS)[number];
export const OBJECTIVES = ["commercial_value", "execution_feasibility", "discovery_opportunity"] as const;
export type ObjectiveId = (typeof OBJECTIVES)[number];

/** Dimensões de RISCO: o valor bruto é "quanto pior, maior" (0 = sem risco); na conta entram invertidas (1 - valor). */
export const RISK_DIMENSIONS: readonly DimensionId[] = ["competition", "cannibalization_risk", "evidence_risk"];
export const isRisk = (d: DimensionId): boolean => RISK_DIMENSIONS.includes(d);

export const DIMENSION_INFO: Record<DimensionId, { label: string; needs: string }> = {
  demand: { label: "Demanda", needs: "volume de busca medido (Search Console, Trends ou provedor autorizado)" },
  intent: { label: "Intenção", needs: "classificação da intenção do padrão ou da query" },
  buyer_stage: { label: "Estágio do comprador", needs: "estágio definido pela vertical" },
  business_value: { label: "Valor para o negócio", needs: "valor do padrão definido pela vertical" },
  solution_fit: { label: "Aderência à solução", needs: "experiência recomendada e seu suporte na plataforma" },
  conversion_proximity: { label: "Proximidade de conversão", needs: "intenção e estágio definidos pela vertical" },
  pipeline_potential: { label: "Potencial de pipeline", needs: "dados de conversão e funil do tenant (GA4, CRM)" },
  evidence_availability: { label: "Disponibilidade de evidências", needs: "requisitos de evidência do padrão e dados reais do tenant" },
  information_gain: { label: "Ganho de informação", needs: "análise de SERP e comparação com o que já existe" },
  citation_potential: { label: "Potencial de citação", needs: "análise de SERP e das respostas de mecanismos de IA" },
  serp_opportunity: { label: "Oportunidade na SERP", needs: "SERP observada (provedor de SERP autorizado)" },
  authority_gap: { label: "Lacuna de autoridade", needs: "SERP observada e dados de domínios concorrentes" },
  competition: { label: "Concorrência", needs: "SERP observada (provedor de SERP autorizado)" },
  cannibalization_risk: { label: "Risco de canibalização", needs: "páginas existentes do tenant para a mesma entidade e intenção" },
  evidence_risk: { label: "Risco de evidência", needs: "requisitos de evidência do padrão e dados reais do tenant" },
};

export interface ObjectiveConfig {
  /** Peso do objetivo na prioridade geral. */
  readonly weight: number;
  /** Fração mínima (0..1) dos pesos das dimensões do objetivo que precisa ter dado para o objetivo existir. */
  readonly minCoverage: number;
  readonly dimensions: Readonly<Partial<Record<DimensionId, number>>>;
}
export interface ScoreConfig {
  readonly schema: "opportunity-score/v2";
  readonly objectives: Readonly<Record<ObjectiveId, ObjectiveConfig>>;
  /** Penalidade na viabilidade quando um risco bruto atinge o limiar (multiplicador < 1). */
  readonly riskPenalties: Readonly<Partial<Record<"evidence_risk" | "cannibalization_risk", { readonly threshold: number; readonly multiplier: number }>>>;
  /** 0..1: o quanto a falta de cobertura e a incerteza reduzem cada objetivo. */
  readonly uncertaintyFactor: number;
  /** Tabelas de conversão de categorias da vertical em números (documentadas e editáveis). */
  readonly categories: {
    readonly valueTier: Readonly<Record<ValueTier, number>>;
    readonly experienceStatus: Readonly<Record<ExperienceStatus, number>>;
    /** Risco atribuído a um requisito de evidência AUSENTE, por peso do requisito. */
    readonly requirementRisk: Readonly<Record<RequirementWeight, number>>;
    /** Risco de canibalização quando já existe página para a mesma entidade e experiência / quando não existe. */
    readonly cannibalization: { readonly overlap: number; readonly none: number };
  };
  readonly priority: { readonly partialMinObjectives: number };
  readonly eligibility: { readonly minCommercialValue: number; readonly minExecutionFeasibility: number; readonly maxEvidenceRisk: number; readonly maxCannibalizationRisk: number; readonly requireStrategicOrDemand: boolean };
}

const unit = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;
const pos = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0;
export function validateScoreConfig(c: ScoreConfig): string[] {
  const e: string[] = [];
  if (c.schema !== "opportunity-score/v2") e.push("esquema desconhecido");
  let totalObjectiveWeight = 0;
  for (const o of OBJECTIVES) {
    const oc = c.objectives?.[o];
    if (!oc) { e.push(`objetivo ausente: ${o}`); continue; }
    if (!pos(oc.weight)) e.push(`${o}: peso inválido`);
    totalObjectiveWeight += pos(oc.weight) ? oc.weight : 0;
    if (!unit(oc.minCoverage)) e.push(`${o}: cobertura mínima fora de 0..1`);
    const entries = Object.entries(oc.dimensions ?? {});
    if (entries.length === 0) e.push(`${o}: sem dimensões`);
    let sum = 0;
    for (const [d, w] of entries) {
      if (!(DIMENSIONS as readonly string[]).includes(d)) e.push(`${o}: dimensão desconhecida (${d})`);
      else if (!pos(w)) e.push(`${o}: peso inválido em ${d}`);
      else sum += w as number;
    }
    if (entries.length > 0 && sum <= 0) e.push(`${o}: a soma dos pesos das dimensões é zero`);
  }
  if (totalObjectiveWeight <= 0) e.push("a soma dos pesos dos objetivos é zero");
  // uma dimensão pertence a um só objetivo (senão a contribuição seria contada duas vezes)
  const seen = new Map<string, ObjectiveId>();
  for (const o of OBJECTIVES) for (const [d, w] of Object.entries(c.objectives?.[o]?.dimensions ?? {})) if ((w as number) > 0) { const prev = seen.get(d); if (prev && prev !== o) e.push(`dimensão ${d} com peso em dois objetivos (${prev} e ${o})`); seen.set(d, o); }
  if (!unit(c.uncertaintyFactor)) e.push("fator de incerteza fora de 0..1");
  for (const [k, p] of Object.entries(c.riskPenalties ?? {})) if (!unit(p?.threshold) || !(typeof p?.multiplier === "number" && p.multiplier > 0 && p.multiplier <= 1)) e.push(`penalidade de risco inválida (${k})`);
  for (const t of ["high", "medium", "low"] as const) if (!unit(c.categories?.valueTier?.[t])) e.push(`categoria valueTier.${t} inválida`);
  for (const t of ["supported", "planned", "unsupported"] as const) if (!unit(c.categories?.experienceStatus?.[t])) e.push(`categoria experienceStatus.${t} inválida`);
  for (const t of ["critical", "important", "optional"] as const) if (!unit(c.categories?.requirementRisk?.[t])) e.push(`categoria requirementRisk.${t} inválida`);
  if (!unit(c.categories?.cannibalization?.overlap) || !unit(c.categories?.cannibalization?.none)) e.push("categoria de canibalização inválida");
  if (!Number.isInteger(c.priority?.partialMinObjectives) || c.priority.partialMinObjectives < 1 || c.priority.partialMinObjectives > 3) e.push("partialMinObjectives deve ser 1, 2 ou 3");
  const el = c.eligibility;
  if (!el || ![el.minCommercialValue, el.minExecutionFeasibility].every((x) => typeof x === "number" && x >= 0 && x <= 100) || !unit(el.maxEvidenceRisk) || !unit(el.maxCannibalizationRisk)) e.push("elegibilidade inválida");
  return e;
}

const canon = (x: unknown): unknown => Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, canon(v)])) : x;
/** Hash estável da configuração (independe da ordem das chaves): identifica a versão usada num cálculo. */
export const configHash = (c: ScoreConfig): string => createHash("sha256").update(JSON.stringify(canon(c))).digest("hex");

export interface ConfigChange { readonly path: string; readonly from: unknown; readonly to: unknown }
/** Diferenças folha a folha entre duas versões (para "o que mudou" ao comparar versões). */
export function diffConfigs(a: unknown, b: unknown, path = ""): ConfigChange[] {
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a as object), ...Object.keys(b as object)])].sort();
    return keys.flatMap((k) => diffConfigs((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [{ path, from: a, to: b }];
}
