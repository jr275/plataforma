// Derivações puras sobre as fixtures: mantêm os números das telas consistentes entre si (tudo sai das mesmas listas).
import type { OpportunityStatus, WorkspaceData } from "./demo/types";

export type PipelineStage = { id: string; label: string; value: string; note: string; href: string; state: "ok" | "attention" | "idle" };

export function buildPipeline(d: WorkspaceData, statusOf: (id: string, original: OpportunityStatus) => OpportunityStatus): PipelineStage[] {
  const staleSources = d.sources.filter((s) => s.health !== "ok").length;
  const open = d.opportunities.filter((o) => statusOf(o.id, o.status) !== "dismissed");
  const decide = open.filter((o) => ["in_review", "blocked"].includes(statusOf(o.id, o.status))).length;
  const needsReview = d.knowledge.filter((k) => k.status !== "verified").length;
  return [
    { id: "sources", label: "Fontes", value: String(d.sources.length), note: staleSources ? `${staleSources} pedem atenção` : "todas saudáveis", href: "/data-sources", state: staleSources ? "attention" : "ok" },
    { id: "entities", label: "Entidades", value: String(d.entities.length), note: `${new Set(d.entities.map((e) => e.type)).size} tipos`, href: "/entities", state: "ok" },
    { id: "knowledge", label: "Conhecimento", value: String(d.knowledge.length), note: needsReview ? `${needsReview} para revisar` : "tudo verificado", href: "/knowledge", state: needsReview ? "attention" : "ok" },
    { id: "universe", label: "Buscas", value: String(d.queries.length), note: "consultas rastreadas", href: "/search-universe", state: "ok" },
    { id: "opportunities", label: "Oportunidades", value: String(open.length), note: decide ? `${decide} pedem decisão` : "nenhuma pede decisão", href: "/opportunities", state: decide ? "attention" : "ok" },
    { id: "pages", label: "Páginas", value: String(d.pages.length), note: "nenhuma publicada", href: "/pages", state: "idle" },
    { id: "visibility", label: "Visibilidade", value: "—", note: "sem medição real", href: "/analytics", state: "idle" },
  ];
}

export function entityGroups(d: WorkspaceData) {
  const map = new Map<string, string[]>();
  for (const e of d.entities) map.set(e.type, [...(map.get(e.type) ?? []), e.label]);
  return [...map.entries()].map(([type, labels]) => ({ id: type, label: type, count: labels.length, examples: labels.slice(0, 3) }));
}

/** Hash determinístico simples: os números de analytics são sempre os mesmos para as mesmas entradas. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

export type Range = 7 | 30 | 90;
export function analyticsFor(d: WorkspaceData, range: Range, cluster: string) {
  const clusters = [...new Set(d.queries.map((q) => q.cluster))];
  const chosen = cluster === "todos" ? clusters : clusters.filter((c) => c === cluster);
  const rows = chosen.map((c) => {
    const qs = d.queries.filter((q) => q.cluster === c).length;
    const impressions = Math.round((300 + hash(`${d.workspace.id}:${c}`) * 700) * qs * range);
    const clicks = Math.round(impressions * (0.02 + hash(`${c}:ctr`) * 0.04));
    return { cluster: c, queries: qs, impressions, clicks };
  });
  const buckets = 12;
  const total = rows.reduce((n, r) => n + r.impressions, 0);
  const series = Array.from({ length: buckets }, (_, i) => Math.round((total / buckets) * (0.7 + hash(`${d.workspace.id}:${cluster}:${range}:${i}`) * 0.6)));
  const impressions = rows.reduce((n, r) => n + r.impressions, 0);
  const clicks = rows.reduce((n, r) => n + r.clicks, 0);
  return { clusters, rows, series, impressions, clicks, ctr: impressions ? clicks / impressions : 0 };
}
