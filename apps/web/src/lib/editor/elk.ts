import ELK from "elkjs/lib/elk.bundled.js";
import type { PageDraft } from "@plataforma/api/src/draft";
import { NODE_H, NODE_W } from "./graph-adapter";

/** Layout em camadas (ELK) da esquerda para a direita. O ELK só calcula POSIÇÕES; regras de negócio nunca passam por aqui. Ação explícita da pessoa (ou primeira abertura). */
export async function autoLayout(draft: Pick<PageDraft, "nodes" | "edges">): Promise<Record<string, { x: number; y: number }>> {
  const g = await new ELK().layout({
    id: "root",
    layoutOptions: { "elk.algorithm": "layered", "elk.direction": "RIGHT", "elk.spacing.nodeNode": "24", "elk.layered.spacing.nodeNodeBetweenLayers": "72", "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX", "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES" },
    children: draft.nodes.map((n) => ({ id: n.id, width: NODE_W, height: NODE_H })),
    edges: draft.edges.map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
  });
  return Object.fromEntries((g.children ?? []).map((c) => [c.id, { x: Math.round(c.x ?? 0), y: Math.round(c.y ?? 0) }]));
}
