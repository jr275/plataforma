// Ciclo de vida da oportunidade, validado no servidor. "published" e posteriores são inalcançáveis nesta unidade:
// nenhuma publicação nem indexação é permitida (seção 7). A UI nunca substitui esta validação (9.4).

export const STAGES = [
  "discovered", "validated", "scored", "eligible", "serp_collected", "blueprinted",
  "gate_approved", "draft_generated", "rejected", "published", "indexed",
] as const;
export type Stage = (typeof STAGES)[number];

export const BLOCKED_TARGETS: ReadonlySet<Stage> = new Set(["published", "indexed"]);

const ALLOWED: Readonly<Record<Stage, readonly Stage[]>> = {
  discovered: ["validated", "rejected"],
  validated: ["scored", "rejected"],
  scored: ["eligible", "rejected"],
  eligible: ["serp_collected", "rejected"],
  serp_collected: ["blueprinted", "rejected"],
  blueprinted: ["gate_approved", "rejected"],
  gate_approved: ["draft_generated", "blueprinted"],
  draft_generated: ["blueprinted"],
  rejected: ["discovered"],
  published: [],
  indexed: [],
};

export interface TransitionRequest {
  readonly from: Stage;
  readonly to: Stage;
  readonly actor: string;
  readonly reason: string;
}

export type TransitionDecision =
  | { readonly ok: true; readonly from: Stage; readonly to: Stage; readonly actor: string; readonly reason: string; readonly at: string }
  | { readonly ok: false; readonly code: "blocked_target" | "invalid_transition" | "missing_reason" | "missing_actor"; readonly detail: string };

export function decideTransition(req: TransitionRequest, now: Date = new Date()): TransitionDecision {
  if (BLOCKED_TARGETS.has(req.to)) {
    return { ok: false, code: "blocked_target", detail: `transição para "${req.to}" é bloqueada no servidor nesta unidade` };
  }
  if (!req.actor.trim()) return { ok: false, code: "missing_actor", detail: "ator ausente" };
  if (!req.reason.trim()) return { ok: false, code: "missing_reason", detail: "motivo obrigatório" };
  if (!ALLOWED[req.from].includes(req.to)) {
    return { ok: false, code: "invalid_transition", detail: `"${req.from}" → "${req.to}" não é permitida` };
  }
  return { ok: true, from: req.from, to: req.to, actor: req.actor, reason: req.reason, at: now.toISOString() };
}
