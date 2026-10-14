import type { ExecStatus, NodeValidity } from "@plataforma/api/src/draft";

export const EXEC_LABEL: Record<ExecStatus, string> = { done: "concluído", warning: "aviso", blocked: "bloqueado", pending: "pendente", not_evaluated: "não avaliado", unavailable: "indisponível" };
export const EXEC_TONE: Record<ExecStatus, string> = {
  done: "border-success/60 bg-success/10", warning: "border-warning/70 bg-warning/10", blocked: "border-destructive/70 bg-destructive/10",
  pending: "border-dashed border-border bg-card", not_evaluated: "border-dashed border-info/60 bg-card", unavailable: "border-dashed border-border bg-muted/40",
};
export const EXEC_DOT: Record<ExecStatus, string> = { done: "bg-success", warning: "bg-warning", blocked: "bg-destructive", pending: "bg-muted-foreground/50", not_evaluated: "bg-info", unavailable: "bg-muted-foreground/40" };
export const VALIDITY_LABEL: Record<NodeValidity, string> = { ok: "configuração válida", warning: "com avisos", error: "com erros" };
export const DIRTY_LABEL = "Alterações não salvas";
export const SAVE_LABEL = { idle: "Sem alterações", saving: "Salvando…", saved: "Rascunho salvo", error: "Falha ao salvar", conflict: "Conflito de versão" } as const;
