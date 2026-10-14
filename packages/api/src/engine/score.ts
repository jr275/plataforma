import type { Basis } from "./truth";
import { DIMENSIONS, DIMENSION_INFO, OBJECTIVES, RISK_DIMENSIONS, configHash, isRisk, type DimensionId, type ObjectiveId, type ScoreConfig } from "./score-config";

// Opportunity Score V2 (ADR-023, seção 6). Estima a ATRATIVIDADE e a VIABILIDADE de uma oportunidade; não prevê ranking do Google nem citação por IA.
// Princípios: (1) dado ausente fica FORA da conta e é listado, nunca vira zero; (2) cada objetivo exige cobertura mínima; (3) valor comercial,
// viabilidade e descoberta continuam distintos; (4) toda penalidade e toda contribuição são explicadas; (5) o agregado nunca é um gate de publicação.
export const MODEL_VERSION = "opportunity-score/2.0.0";

export interface DimensionValue {
  readonly id: DimensionId;
  /** 0..1 no sentido nativo da dimensão (risco: 1 = pior). `null` = desconhecido. */
  readonly value: number | null;
  readonly basis: Basis;
  readonly source: string | null;
  readonly note: string;
  /** 0..1; 1 = incerteza máxima. */
  readonly uncertainty?: number;
  readonly evidenceIds?: readonly string[];
}
export type DimensionMap = Readonly<Record<DimensionId, DimensionValue>>;
/** Dimensão sem dado: `value` nulo e base `unknown`; nunca zero. */
export const unknownDimension = (id: DimensionId, note: string): DimensionValue => ({ id, value: null, basis: "unknown", source: null, note });
export interface ScoreInput { readonly dimensions: DimensionMap; /** A vertical considera o padrão estratégico (justificativa verificável sem demanda medida)? */ readonly strategic: boolean }

export interface Contribution { readonly dimension: DimensionId; readonly weight: number; readonly favorable: number; readonly raw: number; readonly points: number }
export interface ObjectiveResult {
  readonly id: ObjectiveId; readonly weight: number;
  /** 0..100 antes das penalidades; `null` = objetivo não calculável. */
  readonly score: number | null;
  /** 0..100 depois das penalidades. */
  readonly adjusted: number | null;
  readonly coverage: number; readonly minCoverage: number; readonly confidence: number | null;
  readonly contributions: readonly Contribution[];
  readonly missing: readonly DimensionId[];
  readonly reason: string | null;
}
export interface Penalty { readonly kind: "uncertainty" | "risk"; readonly objective: ObjectiveId; readonly dimension: DimensionId | null; readonly points: number; readonly detail: string }
export type PriorityKind = "overall" | "partial" | "none";
export interface Priority { readonly value: number | null; readonly kind: PriorityKind; readonly used: readonly ObjectiveId[]; readonly missingObjectives: readonly ObjectiveId[]; readonly note: string }
export interface EligibilityCheck { readonly code: string; readonly ok: boolean; readonly detail: string }
export interface ScoreResult {
  readonly model: string; readonly configHash: string;
  readonly objectives: Readonly<Record<ObjectiveId, ObjectiveResult>>;
  readonly priority: Priority; readonly penalties: readonly Penalty[];
  readonly missing: readonly { readonly dimension: DimensionId; readonly label: string; readonly needs: string }[];
  readonly confidence: number;
  readonly eligibility: { readonly eligible: boolean; readonly checks: readonly EligibilityCheck[] };
  readonly recommendation: { readonly code: string; readonly action: string };
  readonly explanations: readonly string[];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const r1 = (x: number) => Math.round(x * 10) / 10;
const favorable = (d: DimensionId, raw: number) => (isRisk(d) ? 1 - raw : raw);

function objective(id: ObjectiveId, input: ScoreInput, config: ScoreConfig): ObjectiveResult {
  const oc = config.objectives[id];
  const entries = Object.entries(oc.dimensions).filter(([, w]) => (w as number) > 0) as [DimensionId, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  const avail = entries.filter(([d]) => input.dimensions[d].value !== null);
  const availW = avail.reduce((s, [, w]) => s + w, 0);
  const missing = entries.filter(([d]) => input.dimensions[d].value === null).map(([d]) => d);
  const coverage = total === 0 ? 0 : availW / total;
  const base = { id, weight: oc.weight, coverage: r1(coverage * 1000) / 1000, minCoverage: oc.minCoverage, missing };
  if (avail.length === 0 || coverage < oc.minCoverage) {
    return { ...base, score: null, adjusted: null, confidence: null, contributions: [], reason: avail.length === 0 ? "nenhuma dimensão deste objetivo tem dado" : `cobertura ${Math.round(coverage * 100)}% abaixo do mínimo de ${Math.round(oc.minCoverage * 100)}%` };
  }
  const contributions: Contribution[] = avail.map(([d, w]) => { const raw = input.dimensions[d].value as number; const f = favorable(d, clamp01(raw)); return { dimension: d, weight: w, favorable: f, raw, points: 100 * (w / availW) * f }; });
  const score = contributions.reduce((s, c) => s + c.points, 0);
  const uncertainty = avail.reduce((s, [d, w]) => s + w * (input.dimensions[d].uncertainty ?? 0), 0) / availW;
  const confidence = clamp01(coverage * (1 - uncertainty));
  return { ...base, score, adjusted: score, confidence, contributions, reason: null };
}

function priority(objs: Readonly<Record<ObjectiveId, ObjectiveResult>>, config: ScoreConfig): Priority {
  const avail = OBJECTIVES.filter((o) => objs[o].adjusted !== null);
  const missingObjectives = OBJECTIVES.filter((o) => objs[o].adjusted === null);
  const geo = (list: readonly ObjectiveId[]) => {
    const w = list.reduce((s, o) => s + objs[o].weight, 0);
    if (w <= 0) return null;
    return 100 * Math.exp(list.reduce((s, o) => s + (objs[o].weight / w) * Math.log(Math.max(objs[o].adjusted as number, 1e-9) / 100), 0));
  };
  if (missingObjectives.length === 0) return { value: geo(avail), kind: "overall", used: avail, missingObjectives, note: "Média geométrica ponderada dos três objetivos: um objetivo fraco puxa o resultado para baixo (não há compensação total)." };
  if (avail.length >= config.priority.partialMinObjectives) return { value: geo(avail), kind: "partial", used: avail, missingObjectives, note: `PARCIAL: sem ${missingObjectives.map((o) => LABEL[o]).join(" e ")}. Não é o score geral; serve só para ordenar enquanto faltam dados.` };
  return { value: null, kind: "none", used: [], missingObjectives, note: "Poucos objetivos calculáveis: sem prioridade." };
}

export const LABEL: Record<ObjectiveId, string> = { commercial_value: "valor comercial", execution_feasibility: "viabilidade de execução", discovery_opportunity: "oportunidade de descoberta" };

/** Núcleo do cálculo, sem explicações (usado também pela análise de sensibilidade). */
function core(input: ScoreInput, config: ScoreConfig) {
  const penalties: Penalty[] = [];
  const raw = Object.fromEntries(OBJECTIVES.map((o) => [o, objective(o, input, config)])) as Record<ObjectiveId, ObjectiveResult>;
  const adjusted = { ...raw };
  for (const o of OBJECTIVES) {
    const r = raw[o];
    if (r.score === null || r.confidence === null) continue;
    let value = r.score;
    const uncertaintyLoss = value * config.uncertaintyFactor * (1 - r.confidence);
    if (uncertaintyLoss > 0.0001) { value -= uncertaintyLoss; penalties.push({ kind: "uncertainty", objective: o, dimension: null, points: uncertaintyLoss, detail: `${LABEL[o]}: confiança ${Math.round(r.confidence * 100)}% (cobertura ${Math.round(r.coverage * 100)}%) reduz o resultado em ${r1(uncertaintyLoss)} pontos` }); }
    if (o === "execution_feasibility") {
      for (const [dim, p] of Object.entries(config.riskPenalties) as ["evidence_risk" | "cannibalization_risk", { threshold: number; multiplier: number }][]) {
        const v = input.dimensions[dim].value;
        if (v !== null && v >= p.threshold) { const loss = value * (1 - p.multiplier); value -= loss; penalties.push({ kind: "risk", objective: o, dimension: dim, points: loss, detail: `${DIMENSION_INFO[dim].label} ${Math.round(v * 100)}% (limiar ${Math.round(p.threshold * 100)}%) multiplica a viabilidade por ${p.multiplier}` }); }
      }
    }
    adjusted[o] = { ...r, adjusted: value };
  }
  return { objectives: adjusted as Readonly<Record<ObjectiveId, ObjectiveResult>>, penalties, priority: priority(adjusted, config) };
}

/** Entrada inválida é erro, não correção silenciosa: todas as 15 dimensões presentes, valores em 0..1 ou nulos, `basis` coerente com o valor. */
export function validateInput(input: ScoreInput): string[] {
  const e: string[] = [];
  for (const d of DIMENSIONS) {
    const v = input.dimensions[d];
    if (!v) { e.push(`dimensão ausente: ${d}`); continue; }
    if (v.id !== d) e.push(`${d}: id divergente (${v.id})`);
    if (v.value !== null && !(typeof v.value === "number" && Number.isFinite(v.value) && v.value >= 0 && v.value <= 1)) e.push(`${d}: valor fora de 0..1`);
    if ((v.value === null) !== (v.basis === "unknown")) e.push(`${d}: valor ${v.value === null ? "nulo" : "presente"} incoerente com a base ${v.basis}`);
    if (v.uncertainty !== undefined && !(v.uncertainty >= 0 && v.uncertainty <= 1)) e.push(`${d}: incerteza fora de 0..1`);
  }
  return e;
}
const assertInput = (input: ScoreInput) => { const e = validateInput(input); if (e.length > 0) throw new TypeError(`entrada de score inválida: ${e.join("; ")}`); };

export function computeScore(input: ScoreInput, config: ScoreConfig): ScoreResult {
  assertInput(input);
  const { objectives, penalties, priority: pr } = core(input, config);
  const missing = DIMENSIONS.filter((d) => input.dimensions[d].value === null).map((d) => ({ dimension: d, label: DIMENSION_INFO[d].label, needs: DIMENSION_INFO[d].needs }));
  const confs = OBJECTIVES.map((o) => objectives[o].confidence).filter((c): c is number => c !== null);
  const confidence = confs.length === 0 ? 0 : confs.reduce((s, c) => s + c, 0) / OBJECTIVES.length; // objetivos não calculáveis contam zero
  const el = config.eligibility;
  const cv = objectives.commercial_value.adjusted, ef = objectives.execution_feasibility.adjusted, er = input.dimensions.evidence_risk.value, dm = input.dimensions.demand.value, cr = input.dimensions.cannibalization_risk.value;
  const checks: EligibilityCheck[] = [
    { code: "commercial_value_min", ok: cv !== null && cv >= el.minCommercialValue, detail: cv === null ? "valor comercial não calculável" : `valor comercial ${r1(cv)} (mínimo ${el.minCommercialValue})` },
    { code: "execution_feasibility_min", ok: ef !== null && ef >= el.minExecutionFeasibility, detail: ef === null ? "viabilidade não calculável" : `viabilidade ${r1(ef)} (mínimo ${el.minExecutionFeasibility})` },
    { code: "cannibalization_max", ok: cr === null || cr <= el.maxCannibalizationRisk, detail: cr === null ? "canibalização não medida (páginas do tenant desconhecidas)" : cr > el.maxCannibalizationRisk ? `risco de canibalização ${Math.round(cr * 100)}% (máximo ${Math.round(el.maxCannibalizationRisk * 100)}%): atualize a página existente em vez de criar outra` : `risco de canibalização ${Math.round(cr * 100)}% (máximo ${Math.round(el.maxCannibalizationRisk * 100)}%)` },
    { code: "evidence_risk_max", ok: er !== null && er <= el.maxEvidenceRisk, detail: er === null ? "risco de evidência desconhecido" : `risco de evidência ${Math.round(er * 100)}% (máximo ${Math.round(el.maxEvidenceRisk * 100)}%)` },
  ];
  if (el.requireStrategicOrDemand) checks.push({ code: "demand_or_strategic", ok: (dm !== null && dm > 0) || input.strategic, detail: dm !== null && dm > 0 ? "há demanda medida" : input.strategic ? "justificativa estratégica da vertical (demanda ainda não medida)" : "sem demanda medida e sem justificativa estratégica" });
  const eligible = checks.every((c) => c.ok);

  const explanations: string[] = [];
  for (const o of OBJECTIVES) {
    const r = objectives[o];
    if (r.adjusted === null) { explanations.push(`${cap(LABEL[o])}: não calculável (${r.reason}).`); continue; }
    const top = [...r.contributions].sort((a, b) => b.points - a.points).slice(0, 3).map((c) => `${DIMENSION_INFO[c.dimension].label} ${r1(c.points)}`).join(", ");
    explanations.push(`${cap(LABEL[o])}: ${r1(r.adjusted)} (bruto ${r1(r.score as number)}; cobertura ${Math.round(r.coverage * 100)}%). Maiores contribuições: ${top}.`);
  }
  explanations.push(pr.value === null ? `Prioridade: ${pr.note}` : `Prioridade ${pr.kind === "overall" ? "geral" : "PARCIAL"}: ${r1(pr.value)}. ${pr.note}`);
  for (const p of penalties) explanations.push(`Penalidade: ${p.detail}.`);
  if (missing.length > 0) explanations.push(`Sem dado (fora da conta): ${missing.map((m) => m.label).join(", ")}.`);

  let recommendation: ScoreResult["recommendation"];
  const failing = checks.find((c) => !c.ok);
  if (failing) recommendation = { code: `blocked_${failing.code}`, action: `Ainda não elegível: ${failing.detail}. Resolva isto antes de seguir.` };
  else if (pr.kind !== "overall") recommendation = { code: "proceed_to_serp_analysis", action: `Elegível, com ${missing.length} dimensão(ões) sem dado. Próximo passo: coletar demanda e SERP (conecte Search Console ou um provedor de SERP) para tornar a prioridade geral calculável.` };
  else recommendation = { code: "proceed_to_blueprint", action: "Elegível e com prioridade geral calculável. Próximo passo: blueprint da experiência." };
  return { model: MODEL_VERSION, configHash: configHash(config), objectives, priority: pr, penalties, missing, confidence, eligibility: { eligible, checks }, recommendation, explanations };
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface SensitivityRow { readonly kind: "objective" | "dimension"; readonly id: string; readonly objective: ObjectiveId | null; readonly down: number | null; readonly up: number | null; readonly swing: number }
export interface Sensitivity { readonly delta: number; readonly baseline: number | null; readonly min: number | null; readonly max: number | null; readonly stable: boolean; readonly rows: readonly SensitivityRow[] }

/** O quanto a prioridade muda quando cada peso varia em ±delta (relativo). Estável = a variação máxima é menor que `tolerance` pontos. */
export function sensitivity(input: ScoreInput, config: ScoreConfig, delta = 0.25, tolerance = 5): Sensitivity {
  assertInput(input);
  const base = core(input, config).priority.value;
  if (base === null) return { delta, baseline: null, min: null, max: null, stable: true, rows: [] };
  const withObj = (o: ObjectiveId, k: number): ScoreConfig => ({ ...config, objectives: { ...config.objectives, [o]: { ...config.objectives[o], weight: config.objectives[o].weight * k } } });
  const withDim = (o: ObjectiveId, d: DimensionId, k: number): ScoreConfig => ({ ...config, objectives: { ...config.objectives, [o]: { ...config.objectives[o], dimensions: { ...config.objectives[o].dimensions, [d]: (config.objectives[o].dimensions[d] ?? 0) * k } } } });
  const rows: SensitivityRow[] = [];
  const run = (cfg: ScoreConfig) => core(input, cfg).priority.value;
  for (const o of OBJECTIVES) { const down = run(withObj(o, 1 - delta)), up = run(withObj(o, 1 + delta)); rows.push({ kind: "objective", id: o, objective: o, down, up, swing: Math.abs((up ?? base) - (down ?? base)) }); }
  for (const o of OBJECTIVES) for (const [d, w] of Object.entries(config.objectives[o].dimensions) as [DimensionId, number][]) {
    if (!(w > 0) || input.dimensions[d].value === null) continue;
    const down = run(withDim(o, d, 1 - delta)), up = run(withDim(o, d, 1 + delta));
    rows.push({ kind: "dimension", id: d, objective: o, down, up, swing: Math.abs((up ?? base) - (down ?? base)) });
  }
  rows.sort((a, b) => b.swing - a.swing);
  const all = rows.flatMap((r) => [r.down, r.up]).filter((x): x is number => x !== null).concat(base);
  return { delta, baseline: base, min: Math.min(...all), max: Math.max(...all), stable: rows.every((r) => r.swing < tolerance), rows };
}

export { RISK_DIMENSIONS };
