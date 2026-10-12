import type { Level, OpportunityStatus } from "@/data/demo/types";
import type { Tone } from "@/components/ui/badge";

export const statusLabel: Record<OpportunityStatus, string> = {
  candidate: "Candidata",
  in_review: "Em revisão",
  ready: "Pronta para gates",
  blocked: "Bloqueada",
  dismissed: "Descartada",
};
export const statusTone: Record<OpportunityStatus, Tone> = { candidate: "neutral", in_review: "info", ready: "success", blocked: "danger", dismissed: "outline" };
export const levelTone: Record<Level, Tone> = { alta: "brand", média: "neutral", baixa: "outline" };

/** Transições locais (demonstração): o que o botão principal faz em cada estado. */
export const transition: Record<OpportunityStatus, { label: string; to: OpportunityStatus; done: string } | null> = {
  candidate: { label: "Enviar para revisão", to: "in_review", done: "Enviada para revisão (somente neste navegador)." },
  in_review: { label: "Aprovar para os gates", to: "ready", done: "Aprovada para os gates (somente neste navegador)." },
  ready: { label: "Voltar para revisão", to: "in_review", done: "Devolvida para revisão (somente neste navegador)." },
  blocked: { label: "Marcar bloqueio como resolvido", to: "candidate", done: "Bloqueio marcado como resolvido (somente neste navegador)." },
  dismissed: { label: "Restaurar oportunidade", to: "candidate", done: "Oportunidade restaurada (somente neste navegador)." },
};
