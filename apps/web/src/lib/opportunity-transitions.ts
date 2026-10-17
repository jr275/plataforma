import type { OpportunityStatus } from "@plataforma/api";

// Transições de status permitidas para uma oportunidade REAL. Módulo puro, usado pela interface (para mostrar só as ações válidas) e
// pelo servidor (que revalida: o formulário nunca é confiável). Não há DELETE (ADR-014): descartar é mudar o status, e é reversível.
// `blocked` não é oferecido como destino: o bloqueio vem dos gates, não de um clique.
export interface Transition { readonly to: OpportunityStatus; readonly label: string; readonly tone: "primary" | "secondary" | "danger" }

const DISMISS: Transition = { to: "dismissed", label: "Descartar", tone: "danger" };

export const TRANSITIONS: Readonly<Record<OpportunityStatus, readonly Transition[]>> = {
  candidate: [{ to: "in_review", label: "Enviar para revisão", tone: "primary" }, DISMISS],
  in_review: [{ to: "ready", label: "Aprovar para os gates", tone: "primary" }, { to: "candidate", label: "Voltar para candidata", tone: "secondary" }, DISMISS],
  ready: [{ to: "in_review", label: "Voltar para revisão", tone: "secondary" }, DISMISS],
  blocked: [{ to: "candidate", label: "Marcar bloqueio como resolvido", tone: "primary" }, DISMISS],
  dismissed: [{ to: "candidate", label: "Restaurar oportunidade", tone: "primary" }],
};

export function isAllowedTransition(from: OpportunityStatus, to: OpportunityStatus): boolean {
  return TRANSITIONS[from].some((t) => t.to === to);
}
