import type { graph } from "@plataforma/api";

// Disposição radial PURA e determinística da vizinhança de um nó: o nó escolhido no centro; vizinhos que não são cidades no anel interno; cidades no anel
// externo (dois anéis alternados quando há muitas). Só posiciona o que a expansão devolveu: não cria nós nem arestas.
export const VIEW = { width: 720, height: 560 } as const;
const CX = VIEW.width / 2;
const CY = VIEW.height / 2;
const INNER = 120;
const OUTER_ONE = 210;
const OUTER_TWO = [195, 245] as const;
const MANY = 36;
const LABEL_MAX = 24;
const LABEL_CHARS = 14;

export interface PlacedNode { readonly ref: string; readonly kind: graph.GraphNodeKind; readonly label: string; readonly shortLabel: string; readonly detail: string | null; readonly x: number; readonly y: number; readonly isCenter: boolean; readonly showLabel: boolean }
export interface PlacedEdge { readonly from: PlacedNode; readonly to: PlacedNode; readonly kind: graph.GraphEdgeKind; readonly label: string; readonly basis: graph.EdgeBasis }

const shorten = (s: string) => (s.length > LABEL_CHARS ? `${s.slice(0, LABEL_CHARS - 1)}…` : s);
const at = (r: number, angle: number) => ({ x: Math.round((CX + r * Math.cos(angle)) * 10) / 10, y: Math.round((CY + r * Math.sin(angle)) * 10) / 10 });

export function layoutRadial(expansion: graph.GraphExpansion): { nodes: PlacedNode[]; edges: PlacedEdge[] } {
  const place = (n: graph.GraphNodeSummary, pos: { x: number; y: number }, isCenter: boolean, showLabel: boolean): PlacedNode => ({ ref: n.ref, kind: n.kind, label: n.label, shortLabel: shorten(n.label), detail: n.detail, ...pos, isCenter, showLabel });
  const center = place(expansion.center, { x: CX, y: CY }, true, true);
  const inner = expansion.neighbors.filter((n) => n.kind !== "city");
  const outer = expansion.neighbors.filter((n) => n.kind === "city");
  const nodes: PlacedNode[] = [center];
  inner.forEach((n, i) => nodes.push(place(n, at(INNER, -Math.PI / 2 + (2 * Math.PI * i) / Math.max(inner.length, 1)), false, true)));
  outer.forEach((n, i) => {
    const r = outer.length <= MANY ? OUTER_ONE : OUTER_TWO[i % 2]!;
    const step = (2 * Math.PI) / Math.max(outer.length, 1);
    nodes.push(place(n, at(r, -Math.PI / 2 + step / 2 + step * i), false, i < LABEL_MAX));
  });
  const byRef = new Map(nodes.map((n) => [n.ref, n]));
  const edges: PlacedEdge[] = expansion.edges.flatMap((e) => {
    const from = byRef.get(e.from);
    const to = byRef.get(e.to);
    return from && to ? [{ from, to, kind: e.kind, label: e.label, basis: e.basis }] : [];
  });
  return { nodes, edges };
}
