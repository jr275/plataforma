import type { GraphEdge, GraphNode, KnowledgeGraph, NodeKind, Provenance, RelationType, Verification } from "./model";

export type GraphIndex = {
  byId: Map<string, GraphNode>;
  edgeById: Map<string, GraphEdge>;
  /** Arestas incidentes por nó (entrada e saída). */
  incident: Map<string, GraphEdge[]>;
};

export function indexGraph(graph: KnowledgeGraph): GraphIndex {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const edgeById = new Map(graph.edges.map((e) => [e.id, e]));
  const incident = new Map<string, GraphEdge[]>();
  for (const n of graph.nodes) incident.set(n.id, []);
  for (const e of graph.edges) {
    incident.get(e.source)?.push(e);
    incident.get(e.target)?.push(e);
  }
  return { byId, edgeById, incident };
}

export const otherEnd = (edge: GraphEdge, id: string) => (edge.source === id ? edge.target : edge.source);

export function neighbors(index: GraphIndex, id: string): string[] {
  return (index.incident.get(id) ?? []).map((e) => otherEnd(e, id));
}

/** Menor caminho (não direcionado) entre dois nós. Devolve ids de nós e de arestas, ou `null` se não houver. */
export function shortestPath(index: GraphIndex, from: string, to: string, allowed?: (n: GraphNode) => boolean): { nodeIds: string[]; edgeIds: string[] } | null {
  if (from === to) return { nodeIds: [from], edgeIds: [] };
  const prev = new Map<string, { node: string; edge: string }>();
  const queue = [from];
  const visited = new Set([from]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of index.incident.get(cur) ?? []) {
      const nxt = otherEnd(e, cur);
      if (visited.has(nxt)) continue;
      const node = index.byId.get(nxt);
      if (!node || (allowed && nxt !== to && !allowed(node))) continue;
      visited.add(nxt);
      prev.set(nxt, { node: cur, edge: e.id });
      if (nxt === to) {
        const nodeIds = [to];
        const edgeIds: string[] = [];
        let step = to;
        while (prev.has(step)) {
          const p = prev.get(step)!;
          edgeIds.unshift(p.edge);
          nodeIds.unshift(p.node);
          step = p.node;
        }
        return { nodeIds, edgeIds };
      }
      queue.push(nxt);
    }
  }
  return null;
}

export type GraphFilters = {
  kinds: ReadonlySet<NodeKind>;
  relations: ReadonlySet<RelationType>;
  provenances: ReadonlySet<Provenance>;
  verifications: ReadonlySet<Verification>;
};

export function filterGraph(graph: KnowledgeGraph, f: GraphFilters): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = graph.nodes.filter((n) => f.kinds.has(n.kind) && f.provenances.has(n.provenance) && f.verifications.has(n.verification));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target) && f.relations.has(e.type) && f.verifications.has(e.verification) && f.provenances.has(e.provenance));
  return { nodes, edges };
}

export const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function searchNodes(graph: KnowledgeGraph, query: string, limit = 8): GraphNode[] {
  const q = normalize(query.trim());
  if (!q) return [];
  return graph.nodes
    .filter((n) => normalize(`${n.label} ${n.summary}`).includes(q))
    .sort((a, b) => Number(normalize(b.label).startsWith(q)) - Number(normalize(a.label).startsWith(q)))
    .slice(0, limit);
}
