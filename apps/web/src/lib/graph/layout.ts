import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import type { GraphEdge, GraphNode } from "./model";

export type Point = { x: number; y: number };
type SimNode = SimulationNodeDatum & { id: string; kind: GraphNode["kind"] };

const RING: Record<GraphNode["kind"], number> = { organization: 0, entity: 0, topic: 0.2, place: 0.2, fact: 0.65, page: 0.85, source: 1 };

/** Hash estável para posições iniciais determinísticas (mesmo grafo → mesmo layout). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

/**
 * Layout de forças executado de forma síncrona. Camadas: domínio no centro, evidências e páginas na periferia.
 * Posições anteriores são reaproveitadas para que a expansão progressiva não reembaralhe o que o usuário já leu.
 */
export function computeLayout(nodes: readonly GraphNode[], edges: readonly GraphEdge[], previous?: ReadonlyMap<string, Point>): Map<string, Point> {
  const dense = nodes.length > 60;
  const simNodes: SimNode[] = nodes.map((n) => {
    const prev = previous?.get(n.id);
    const angle = hash(n.id) * Math.PI * 2;
    const r = 80 + RING[n.kind] * 260;
    return { id: n.id, kind: n.kind, x: prev?.x ?? Math.cos(angle) * r, y: prev?.y ?? Math.sin(angle) * r, fx: undefined, fy: undefined };
  });
  const links: SimulationLinkDatum<SimNode>[] = edges.map((e) => ({ source: e.source, target: e.target }));

  const sim = forceSimulation(simNodes)
    .force("link", forceLink<SimNode, SimulationLinkDatum<SimNode>>(links).id((d) => d.id).distance(dense ? 46 : 118).strength(0.55))
    .force("charge", forceManyBody().strength(dense ? -110 : -520))
    .force("collide", forceCollide<SimNode>(dense ? 16 : 40))
    .force("x", forceX<SimNode>(0).strength((d) => 0.04 + (1 - RING[d.kind]) * 0.05))
    .force("y", forceY<SimNode>(0).strength((d) => 0.04 + (1 - RING[d.kind]) * 0.05))
    .stop();

  const ticks = previous?.size ? 160 : 320;
  for (let i = 0; i < ticks; i++) sim.tick();

  return new Map(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
}

export function bounds(points: Iterable<Point>): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}
