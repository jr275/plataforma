import type { GateResult } from "@plataforma/api";
import type { Tone } from "@/components/ui/badge";

const dt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
export const formatDateTime = (d: Date | string): string => dt.format(typeof d === "string" ? new Date(d) : d);
export const formatInt = (n: number): string => n.toLocaleString("pt-BR");

export const PAGE_STATUS: Record<"draft" | "blocked", { label: string; tone: Tone }> = { draft: { label: "Rascunho", tone: "info" }, blocked: { label: "Bloqueada", tone: "danger" } };
export const RUN_STATUS: Record<"running" | "succeeded" | "partial" | "failed", { label: string; tone: Tone }> = {
  running: { label: "Em andamento", tone: "info" }, succeeded: { label: "Concluída", tone: "success" }, partial: { label: "Parcial", tone: "warning" }, failed: { label: "Falhou", tone: "danger" },
};
export const OUTCOME: Record<"generated" | "unchanged" | "blocked", { label: string; tone: Tone }> = { generated: { label: "Gerada", tone: "success" }, unchanged: { label: "Inalterada", tone: "neutral" }, blocked: { label: "Bloqueada", tone: "danger" } };
export const GATE_OUTCOME: Record<GateResult["outcome"], { label: string; tone: Tone }> = { pass: { label: "Passou", tone: "success" }, fail: { label: "Reprovou", tone: "danger" }, skipped: { label: "Não avaliado", tone: "outline" } };
export const GATE_LABEL: Record<GateResult["gate"], string> = {
  required_fields: "Campos obrigatórios e origem real", url_unique: "URL única no workspace", url_stable: "URL estável (não muda)", metadata_valid: "Título, meta e h1 válidos", links_resolve: "Links internos existem", facts_traceable: "Fatos com fonte; números só vindos de fatos",
};
