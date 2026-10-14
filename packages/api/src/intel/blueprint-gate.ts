import { createHash } from "node:crypto";

// Versionamento do blueprint e do Experience Quality Gate (requisito 9.4). Cada resultado de gate fica preso ao hash da versão
// avaliada: qualquer alteração gera outro hash e o resultado antigo deixa de valer. not_evaluated e blocked nunca aprovam.

export const GATE_CATEGORIES = ["intent_match", "evidence", "local_relevance", "differentiation", "ux_structure", "compliance"] as const;
export type GateCategory = (typeof GATE_CATEGORIES)[number];
export type GateOutcome = "pass" | "fail" | "blocked" | "not_evaluated";

export interface BlueprintContent {
  readonly opportunityId: string;
  readonly archetype: string;
  readonly modules: readonly string[];
  readonly targetQuery: string;
  readonly notes?: string;
}

export interface GateCategoryResult {
  readonly category: GateCategory;
  readonly outcome: GateOutcome;
  readonly reasons: readonly string[];
  readonly missingData: readonly string[];
  readonly evidence: readonly string[];
}

export interface GateEvaluation {
  readonly blueprintHash: string;
  readonly evaluatedAt: string;
  readonly results: readonly GateCategoryResult[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function blueprintHash(content: BlueprintContent): string {
  return createHash("sha256").update(canonical(content)).digest("hex");
}

export type GateVerdict =
  | { readonly approved: true }
  | { readonly approved: false; readonly reason: "stale" | "incomplete" | "failed" | "not_evaluated"; readonly detail: string };

/** Decide no servidor se a versão ATUAL do blueprint está aprovada. Nunca herda aprovação de outra versão. */
export function gateVerdict(current: BlueprintContent, evaluation: GateEvaluation | null): GateVerdict {
  if (!evaluation) return { approved: false, reason: "not_evaluated", detail: "gate ainda não avaliado para esta versão" };
  if (evaluation.blueprintHash !== blueprintHash(current)) {
    return { approved: false, reason: "stale", detail: "o blueprint mudou depois da avaliação; reavaliar o gate" };
  }
  const byCategory = new Map(evaluation.results.map((r) => [r.category, r]));
  const missing = GATE_CATEGORIES.filter((c) => !byCategory.has(c));
  if (missing.length > 0) return { approved: false, reason: "incomplete", detail: `categorias sem resultado: ${missing.join(", ")}` };
  const notPassed = evaluation.results.filter((r) => r.outcome !== "pass");
  if (notPassed.length > 0) {
    const allPending = notPassed.every((r) => r.outcome === "not_evaluated");
    return {
      approved: false,
      reason: allPending ? "not_evaluated" : "failed",
      detail: notPassed.map((r) => `${r.category}=${r.outcome}`).join(", "),
    };
  }
  return { approved: true };
}
