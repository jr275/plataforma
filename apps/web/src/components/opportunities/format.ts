import type { engine as E } from "@plataforma/api";
import type { Tone } from "@/components/ui/badge";

/** A prioridade NUNCA se apresenta sozinha: o rótulo diz de quantos objetivos ela vem. */
export const PRIORITY_KIND: Record<string, { label: string; tone: Tone }> = {
  overall: { label: "Geral (3 objetivos)", tone: "success" },
  partial: { label: "Parcial", tone: "warning" },
  none: { label: "Sem prioridade", tone: "outline" },
};
export const BASIS_LABEL: Record<string, string> = { observed: "observado", provider_metric: "métrica do provedor", derived: "derivado", inferred: "inferido", estimated: "estimado", unknown: "desconhecido" };
export const BASIS_TONE: Record<string, Tone> = { observed: "success", provider_metric: "success", derived: "info", inferred: "warning", estimated: "warning", unknown: "outline" };
export const OBJECTIVE_LABEL: Record<E.ObjectiveId, string> = { commercial_value: "Valor comercial", execution_feasibility: "Viabilidade de execução", discovery_opportunity: "Oportunidade de descoberta" };
export const num1 = (n: number | null): string => (n === null ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });
export const formatDate = (d: Date | string): string => date.format(typeof d === "string" ? new Date(d) : d);
export const ADAPTER_LABEL: Record<string, string> = { "bcb-sgs": "Banco Central (SGS)", "ibge-news": "Notícias do IBGE", "rss-news": "Agência Brasil (RSS)" };
