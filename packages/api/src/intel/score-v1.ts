// Opportunity Score v1 de produção para a vertical imobiliária (regra 3.4). Substitui a versão "ilustrativa" do demo.
// Fator sem dado medido = "not_evaluated": sai do denominador e reduz a confiança (regra 3.3). Nunca vira zero.

export type FactorName = "demand" | "competition" | "authority_gap" | "trend" | "cannibalization_risk" | "business_fit";
export type Origin = "measured" | "derived" | "estimated" | "demo" | "unavailable" | "not_evaluated";

export interface FactorConfig {
  readonly weight: number;
  /** true = valor alto é bom; false = valor alto é ruim (o score usa 1 - valor). */
  readonly higherIsBetter: boolean;
  readonly rationale: string;
}

export interface ScoreConfig {
  readonly version: string;
  readonly vertical: "real_estate";
  readonly factors: Readonly<Record<FactorName, FactorConfig>>;
}

export const SCORE_CONFIG_V1: ScoreConfig = {
  version: "real_estate.v1",
  vertical: "real_estate",
  factors: {
    demand: {
      weight: 0.3,
      higherIsBetter: true,
      rationale: "Volume de busca mensal (Google Ads via DataForSEO) é o teto de tráfego; em imóveis a demanda local é o principal limitador de leads.",
    },
    competition: {
      weight: 0.2,
      higherIsBetter: false,
      rationale: "Keyword difficulty (DataForSEO Labs): portais nacionais dominam termos genéricos; dificuldade alta reduz a chance de ranquear.",
    },
    authority_gap: {
      weight: 0.15,
      higherIsBetter: false,
      rationale: "Diferença de autoridade (backlinks) entre o top 10 e remax.com.br; lacuna grande exige mais tempo e links do que conteúdo.",
    },
    business_fit: {
      weight: 0.15,
      higherIsBetter: true,
      rationale: "Aderência ao negócio (intenção transacional/comercial e buyer stage) — classificação do LLM, nunca um número fornecido por ele.",
    },
    trend: {
      weight: 0.1,
      higherIsBetter: true,
      rationale: "Google Trends (DataForSEO): demanda crescente compensa volume atual menor; peso baixo pela volatilidade sazonal do mercado.",
    },
    cannibalization_risk: {
      weight: 0.1,
      higherIsBetter: false,
      rationale: "Search Console: se remax.com.br já ranqueia com outra página para a query, uma nova página pode canibalizar a existente.",
    },
  },
};

export interface FactorInput {
  /** Valor normalizado em [0, 1]; null quando não há dado. */
  readonly value: number | null;
  readonly origin: Origin;
}

export interface FactorContribution {
  readonly factor: FactorName;
  readonly origin: Origin;
  readonly value: number | null;
  readonly weight: number;
  readonly contribution: number | null;
  readonly evaluated: boolean;
}

export interface ScoreResult {
  readonly configVersion: string;
  /** null quando nenhum fator foi avaliado — ausência total não é score 0. */
  readonly total: number | null;
  /** Fração do peso total coberta por fatores avaliados, em [0, 1]. */
  readonly confidence: number;
  readonly contributions: readonly FactorContribution[];
  readonly explanation: readonly string[];
}

const EVALUABLE: ReadonlySet<Origin> = new Set(["measured", "derived", "estimated"]);

export function computeScore(
  inputs: Partial<Record<FactorName, FactorInput>>,
  config: ScoreConfig = SCORE_CONFIG_V1,
  options: { readonly allowDemo?: boolean } = {},
): ScoreResult {
  const contributions: FactorContribution[] = [];
  const explanation: string[] = [];
  let weighted = 0;
  let evaluatedWeight = 0;
  let totalWeight = 0;

  for (const [factor, cfg] of Object.entries(config.factors) as [FactorName, FactorConfig][]) {
    totalWeight += cfg.weight;
    const input = inputs[factor];
    const origin: Origin = input?.origin ?? "not_evaluated";
    const usable = input !== undefined && input.value !== null && Number.isFinite(input.value)
      && (EVALUABLE.has(origin) || (origin === "demo" && options.allowDemo === true));

    if (!usable) {
      contributions.push({ factor, origin: input?.value === null || !input ? "not_evaluated" : origin, value: null, weight: cfg.weight, contribution: null, evaluated: false });
      explanation.push(`${factor}: não avaliado (fora do denominador).`);
      continue;
    }
    const clamped = Math.min(1, Math.max(0, input.value as number));
    const oriented = cfg.higherIsBetter ? clamped : 1 - clamped;
    const contribution = oriented * cfg.weight;
    weighted += contribution;
    evaluatedWeight += cfg.weight;
    contributions.push({ factor, origin, value: clamped, weight: cfg.weight, contribution, evaluated: true });
    explanation.push(`${factor}: ${origin}, valor ${clamped.toFixed(2)} × peso ${cfg.weight} = ${contribution.toFixed(3)}.`);
  }

  const total = evaluatedWeight > 0 ? Math.round((weighted / evaluatedWeight) * 1000) / 10 : null;
  const confidence = totalWeight > 0 ? Math.round((evaluatedWeight / totalWeight) * 100) / 100 : 0;
  return { configVersion: config.version, total, confidence, contributions, explanation };
}

export function assertConfigValid(config: ScoreConfig): void {
  const sum = Object.values(config.factors).reduce((s, f) => s + f.weight, 0);
  if (Math.abs(sum - 1) > 1e-9) throw new Error(`pesos de ${config.version} somam ${sum}, esperado 1`);
  for (const [name, f] of Object.entries(config.factors)) {
    if (!(f.weight > 0)) throw new Error(`peso inválido em ${name}`);
    if (f.rationale.trim().length < 20) throw new Error(`justificativa ausente em ${name}`);
  }
}
