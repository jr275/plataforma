import type { Tone } from "@/components/ui/badge";

// Rótulos e tons do Control Plane do motor. A cor nunca é a única informação: todo estado tem texto.
export const RUN_STATE: Record<string, { label: string; tone: Tone }> = {
  succeeded: { label: "Sucesso", tone: "success" }, failed: { label: "Falhou", tone: "danger" }, invalid_output: { label: "Saída inválida", tone: "danger" },
  timed_out: { label: "Tempo esgotado", tone: "warning" }, cancelled: { label: "Cancelada", tone: "neutral" }, not_configured: { label: "Não configurado (bloqueio externo)", tone: "outline" },
};
export const STEP_STATE: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Pendente", tone: "outline" }, RUNNING: { label: "Em execução", tone: "info" }, SUCCEEDED: { label: "Concluído", tone: "success" }, FAILED: { label: "Falhou", tone: "danger" },
  SKIPPED: { label: "Pulado", tone: "neutral" }, BLOCKED: { label: "Bloqueado", tone: "warning" }, CANCELLED: { label: "Cancelado", tone: "neutral" },
};
export const PIPELINE_STATE: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Pendente", tone: "outline" }, RUNNING: { label: "Em execução", tone: "info" }, SUCCEEDED: { label: "Concluída", tone: "success" }, FAILED: { label: "Falhou", tone: "danger" },
  CANCELLED: { label: "Cancelada", tone: "neutral" }, BLOCKED: { label: "Bloqueada", tone: "warning" }, NEEDS_REVIEW: { label: "Aguardando revisão humana", tone: "info" },
};
export const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  APPROVED: { label: "Apta à revisão de publicação (nada publicado)", tone: "success" }, BLOCKED: { label: "Bloqueada", tone: "danger" }, NEEDS_REVIEW: { label: "Precisa de revisão humana", tone: "warning" },
};
export const PROMPT_STATE: Record<string, { label: string; tone: Tone }> = { DRAFT: { label: "Rascunho", tone: "info" }, ACTIVE: { label: "Ativa", tone: "success" }, DEPRECATED: { label: "Descontinuada", tone: "neutral" } };
export const MODE: Record<string, { label: string; tone: Tone }> = { real: { label: "Execução real", tone: "success" }, test_simulation: { label: "SIMULAÇÃO DE TESTE (LLM roteirizado)", tone: "warning" } };
export const FAILURE_KIND: Record<string, string> = { invalid_output: "saída inválida após as correções", timeout: "tempo esgotado", rate_limited: "limite de taxa", transient: "falha transitória (rede/5xx)", budget: "orçamento", permanent: "falha permanente (credencial/rejeição)", cancelled: "cancelada", loop_guard: "proteção contra laço" };
export const QA_STATUS: Record<string, { label: string; tone: Tone }> = { PASS: { label: "Passou", tone: "success" }, FAIL: { label: "Reprovou", tone: "danger" }, NOT_RUN: { label: "Não rodou", tone: "outline" } };
export const DECISION_TONE: Record<string, Tone> = { READY_FOR_BLUEPRINT: "success", DATA_REQUIRED: "warning", RESEARCH_REQUIRED: "info", REJECTED: "danger" };
export const json = (v: unknown, max = 20_000): string => { const s = JSON.stringify(v, null, 2) ?? "null"; return s.length > max ? `${s.slice(0, max)}\n… (${s.length - max} caracteres omitidos)` : s; };
export const ms = (n: number | null): string => (n === null ? "—" : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);

export const STAGE_TONE: Record<string, Tone> = { candidate: "outline", blueprint: "info", generated: "info", awaiting_qa: "warning", awaiting_approval: "warning", approved: "success", preview: "success", published: "success" };
export const DEPLOY_STATE: Record<string, { label: string; tone: Tone }> = {
  QUEUED: { label: "Na fila", tone: "outline" }, BUILDING: { label: "Build em andamento", tone: "info" }, READY: { label: "Pronto (não verificado)", tone: "info" }, FAILED: { label: "Falhou", tone: "danger" },
  CANCELED: { label: "Cancelado", tone: "neutral" }, VERIFICATION_PENDING: { label: "Verificação pendente", tone: "warning" }, VERIFIED: { label: "Verificado", tone: "success" },
};
export const BATCH_STATE: Record<string, { label: string; tone: Tone }> = { PLANNED: { label: "Planejado (não confirmado)", tone: "outline" }, CONFIRMED: { label: "Confirmado (não iniciado)", tone: "info" }, RUNNING: { label: "Em execução", tone: "info" }, COMPLETED: { label: "Concluído", tone: "success" }, CANCELLED: { label: "Cancelado", tone: "neutral" }, FAILED: { label: "Falhou", tone: "danger" } };
export const QA_OUTCOME: Record<string, { label: string; tone: Tone }> = { QA_PASSED: { label: "QA aprovado", tone: "success" }, QA_FAILED: { label: "QA reprovado", tone: "danger" }, QA_INCOMPLETE: { label: "QA incompleto", tone: "warning" } };
export const pct = (x: number | null): string => (x === null ? "—" : `${Math.round(x * 100)}%`);
export const dur = (n: number | null): string => (n === null ? "—" : n < 1000 ? `${Math.round(n)} ms` : n < 60_000 ? `${(n / 1000).toFixed(1)} s` : n < 3_600_000 ? `${(n / 60_000).toFixed(1)} min` : `${(n / 3_600_000).toFixed(1)} h`);
