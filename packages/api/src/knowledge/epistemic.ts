// Estados epistemológicos de uma afirmação e suas transições (ADR-021). Open-World: ausência de evidência não é falsidade.

export const EPISTEMIC_STATES = ["OBSERVED_TRUE", "OBSERVED_FALSE", "INFERRED_PROBABLE", "CONFLICTING", "UNKNOWN_STALE", "ABSENT"] as const;
export type EpistemicState = (typeof EPISTEMIC_STATES)[number];

/** Semântica de cada estado (documentação executável: também é o texto que as telas e os agentes devem respeitar). */
export const STATE_MEANING: Readonly<Record<EpistemicState, string>> = {
  OBSERVED_TRUE: "observado diretamente como verdadeiro, com evidência",
  OBSERVED_FALSE: "observado diretamente como falso (evidência NEGATIVA, diferente de ausência)",
  INFERRED_PROBABLE: "inferido por regra ou derivação; nunca é observação direta",
  CONFLICTING: "evidências incompatíveis; nada foi sobrescrito e nada foi resolvido",
  UNKNOWN_STALE: "já foi sabido, mas a validade expirou e ainda não foi revalidado",
  ABSENT: "não há afirmação registrada (não implica falsidade)",
};

export type TransitionReason = "new_observation" | "inference" | "conflicting_evidence" | "resolution" | "expiry" | "revalidation";

const REASON_TARGETS: Readonly<Record<TransitionReason, readonly EpistemicState[]>> = {
  new_observation: ["OBSERVED_TRUE", "OBSERVED_FALSE"],
  revalidation: ["OBSERVED_TRUE", "OBSERVED_FALSE"],
  resolution: ["OBSERVED_TRUE", "OBSERVED_FALSE"],
  inference: ["INFERRED_PROBABLE"],
  conflicting_evidence: ["CONFLICTING"],
  expiry: ["UNKNOWN_STALE"],
};

/** Transições válidas. Nenhuma leva de um estado com fato a ABSENT (Open-World). */
export const ALLOWED_TRANSITIONS: Readonly<Record<EpistemicState, readonly EpistemicState[]>> = {
  ABSENT: ["OBSERVED_TRUE", "OBSERVED_FALSE", "INFERRED_PROBABLE"],
  OBSERVED_TRUE: ["OBSERVED_TRUE", "OBSERVED_FALSE", "CONFLICTING", "UNKNOWN_STALE"],
  OBSERVED_FALSE: ["OBSERVED_TRUE", "OBSERVED_FALSE", "CONFLICTING", "UNKNOWN_STALE"],
  INFERRED_PROBABLE: ["INFERRED_PROBABLE", "OBSERVED_TRUE", "OBSERVED_FALSE", "CONFLICTING", "UNKNOWN_STALE"],
  CONFLICTING: ["OBSERVED_TRUE", "OBSERVED_FALSE", "UNKNOWN_STALE"],
  UNKNOWN_STALE: ["OBSERVED_TRUE", "OBSERVED_FALSE", "INFERRED_PROBABLE", "CONFLICTING"],
};

export interface TransitionRequest {
  readonly from: EpistemicState;
  readonly to: EpistemicState;
  readonly reason: TransitionReason;
  /** Evidências responsáveis pela transição (obrigatórias, exceto na expiração). */
  readonly evidenceIds: readonly string[];
}
export type TransitionCheck = { readonly ok: true } | { readonly ok: false; readonly code: "to_absent" | "not_allowed" | "reason_mismatch" | "evidence_required"; readonly message: string };

export function checkTransition(t: TransitionRequest): TransitionCheck {
  if (t.to === "ABSENT") return { ok: false, code: "to_absent", message: "ausência de evidência não apaga um fato (Open-World): use expiração ou encerramento de vigência" };
  if (!ALLOWED_TRANSITIONS[t.from].includes(t.to)) return { ok: false, code: "not_allowed", message: `transição ${t.from} → ${t.to} não é permitida` };
  if (!REASON_TARGETS[t.reason].includes(t.to)) return { ok: false, code: "reason_mismatch", message: `o motivo "${t.reason}" não leva a ${t.to}` };
  if (t.reason !== "expiry" && t.evidenceIds.length === 0) return { ok: false, code: "evidence_required", message: "a transição precisa citar ao menos uma evidência" };
  return { ok: true };
}

/** Só estes estados são observação direta. Inferência nunca é apresentada como observação. */
export const isDirectObservation = (s: EpistemicState): boolean => s === "OBSERVED_TRUE" || s === "OBSERVED_FALSE";

/** Política de consumo: quais estados um uso pode apresentar (por exemplo, uma resposta atual × uma reconstrução histórica). */
export interface ConsumptionPolicy { readonly name: string; readonly allow: readonly EpistemicState[]; readonly mustLabelInference: boolean }
export const POLICIES = {
  /** Resposta atual e afirmativa: só observação direta. Conflito, vencido, inferido e ausente são recusados. */
  assertive: { name: "assertive", allow: ["OBSERVED_TRUE", "OBSERVED_FALSE"], mustLabelInference: false },
  /** Resposta cautelosa: aceita inferência, que DEVE ser rotulada como tal. */
  hedged: { name: "hedged", allow: ["OBSERVED_TRUE", "OBSERVED_FALSE", "INFERRED_PROBABLE"], mustLabelInference: true },
  /** Reconstrução histórica: tudo o que foi registrado (nunca ABSENT). */
  historical: { name: "historical", allow: ["OBSERVED_TRUE", "OBSERVED_FALSE", "INFERRED_PROBABLE", "CONFLICTING", "UNKNOWN_STALE"], mustLabelInference: true },
} as const satisfies Record<string, ConsumptionPolicy>;

export const isEligible = (state: EpistemicState, policy: ConsumptionPolicy): boolean => policy.allow.includes(state);
