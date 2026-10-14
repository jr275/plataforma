import { CONTRACTS, draftToBlueprint, executionStates, type DraftContext, type ExecState, type NodeType, type NodeValidity, type PageDraft, type Validation } from "@plataforma/api/src/draft";
import type { Blueprint } from "@plataforma/api/src/engine/blueprint";
import type { GateReport } from "@plataforma/api/src/engine/experience-gates";

// Adaptador domínio -> grafo (React Flow). O grafo é uma PROJEÇÃO: nenhum estado de negócio nasce aqui. Posições vêm do rascunho; o que não tem posição ainda recebe
// uma provisória em colunas por tipo (o ELK só roda quando a pessoa pede ou na primeira abertura, nunca sobrescreve posições existentes).
export const NODE_W = 224, NODE_H = 84;
export type GraphNodeData = { readonly id: string; readonly type: NodeType; readonly label: string; readonly summary: string; readonly exec: ExecState; readonly validity: NodeValidity; readonly issues: number };
export interface GraphNode { readonly id: string; readonly position: { readonly x: number; readonly y: number }; readonly data: GraphNodeData }
export interface GraphEdge { readonly id: string; readonly source: string; readonly target: string; readonly invalid: boolean }
export interface Graph { readonly nodes: readonly GraphNode[]; readonly edges: readonly GraphEdge[] }

const COLUMN: Record<NodeType, number> = { opportunity: 0, search_intent: 1, entity: 1, data_source: 0, evidence_requirement: 2, page_template: 2, page_section: 3, internal_link: 3, seo_metadata: 3, structured_data: 3, quality_gate: 4, publication: 5 };
export function summarize(n: PageDraft["nodes"][number]): string {
  const c = n.config;
  switch (n.type) {
    case "page_template": return String(c.templateKey || "— sem template —");
    case "page_section": return `${c.order}. ${(c.heading as string) || c.sectionId}${c.enabled === false ? " (desligada)" : ""}`;
    case "internal_link": return String(c.path ?? "");
    case "structured_data": return String(c.type ?? "");
    case "data_source": return String(c.source ?? "");
    case "evidence_requirement": return String(c.requirementId ?? "");
    case "quality_gate": return String(c.gate ?? "");
    default: return "";
  }
}
/** Posição provisória (colunas por tipo, linhas por ordem) para nós ainda sem posição. */
export function provisional(draft: PageDraft): Record<string, { x: number; y: number }> {
  const rows = new Map<number, number>(); const out: Record<string, { x: number; y: number }> = {};
  for (const n of draft.nodes) { const col = COLUMN[n.type]; const row = rows.get(col) ?? 0; rows.set(col, row + 1); out[n.id] = { x: col * (NODE_W + 70), y: row * (NODE_H + 24) }; }
  return out;
}
export const needsLayout = (d: PageDraft): boolean => d.nodes.some((n) => !d.layout[n.id]);

export function toGraph(draft: PageDraft, ctx: DraftContext, base: Blueprint, report: GateReport | null, stale: boolean, validation: Validation): Graph {
  const bp = draftToBlueprint(draft, base, ctx);
  const exec = executionStates(draft, ctx, bp, report, stale);
  const prov = provisional(draft);
  const invalidEdges = new Set(validation.issues.filter((i) => i.edgeId).map((i) => i.edgeId!));
  return {
    nodes: draft.nodes.map((n) => ({ id: n.id, position: draft.layout[n.id] ?? prov[n.id]!, data: { id: n.id, type: n.type, label: CONTRACTS[n.type].label, summary: summarize(n), exec: exec[n.id]!, validity: validation.nodeValidity[n.id] ?? "ok", issues: validation.issues.filter((i) => i.nodeId === n.id && i.severity !== "info").length } })),
    edges: draft.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, invalid: invalidEdges.has(e.id) })),
  };
}
