import type { WorkspaceData } from "@/data/demo/types";
import type { GraphEdge, GraphNode, KnowledgeGraph, NodeKind, RelationType, Verification } from "./model";

// Adaptador DEMONSTRATIVO: monta o grafo a partir das fixtures do workspace (entidades, conhecimento, fontes, páginas).
// Não inventa dados novos: só reorganiza o que as fixtures já contêm. Rótulos de relação entre entidades são
// derivados dos tipos das pontas e ficam marcados como "inferência" quando nenhum fato sustenta o par.

const ENTITY_KIND: Record<string, NodeKind> = { Pessoa: "entity", Produto: "entity", Organização: "organization", Lugar: "place", Conceito: "topic" };
const PRECEDENCE: Record<NodeKind, number> = { organization: 4, entity: 3, topic: 2, place: 1, page: 0, fact: 0, source: 0 };

function relationBetween(from: NodeKind, to: NodeKind): RelationType {
  const key = `${from}>${to}`;
  const table: Record<string, RelationType> = {
    "organization>entity": "supplies",
    "organization>place": "serves",
    "organization>topic": "applies",
    "organization>organization": "relates_to",
    "entity>entity": "part_of",
    "entity>topic": "governed_by",
    "entity>place": "located_in",
    "topic>place": "varies_by",
  };
  return table[key] ?? "relates_to";
}

const factVerification = { verified: "verified", needs_review: "unverified", expired: "expired" } as const satisfies Record<string, Verification>;
const sourceVerification = { ok: "verified", stale: "expired", error: "unverified", pending: "unverified" } as const satisfies Record<string, Verification>;

export function graphFromWorkspace(data: WorkspaceData): KnowledgeGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const sourceByName = new Map(data.sources.map((s) => [s.name, s]));

  for (const s of data.sources) {
    nodes.push({
      id: s.id,
      kind: "source",
      label: s.name,
      summary: s.description,
      verification: sourceVerification[s.health],
      provenance: "source",
      freshness: s.freshness,
      verifiedAt: s.freshness,
      attributes: [
        { label: "Tipo", value: s.type },
        { label: "Registros", value: s.records.toLocaleString("pt-BR") },
        { label: "Saúde", value: s.health },
      ],
      history: [{ when: s.freshness, actor: "Sincronização", text: `Última leitura da fonte (${s.health}).` }],
    });
  }

  for (const k of data.knowledge) {
    const source = data.sources.find((s) => s.id === k.sourceId);
    nodes.push({
      id: k.id,
      kind: "fact",
      label: k.title,
      summary: k.statement,
      verification: factVerification[k.status],
      provenance: "source",
      verifiedAt: k.updated,
      validUntil: k.validUntil,
      freshness: source?.freshness,
      attributes: [
        { label: "Confiança", value: k.confidence },
        { label: "Válido até", value: k.validUntil },
      ],
      history: [
        { when: k.updated, actor: k.status === "verified" ? "Revisão editorial" : "Agente de extração", text: k.status === "verified" ? "Fato verificado contra a fonte." : "Registro extraído; aguarda revisão." },
      ],
    });
    edges.push({ id: `${k.id}~${k.sourceId}`, source: k.id, target: k.sourceId, type: "evidenced_by", verification: factVerification[k.status], provenance: "source", evidenceIds: [k.id] });
  }

  for (const e of data.entities) {
    const facts = data.knowledge.filter((k) => k.entityIds.includes(e.id));
    const best = facts.find((k) => k.status === "verified") ?? facts[0];
    const sourceName = e.attributes.find((a) => a.label === "Fonte")?.value;
    const verification: Verification = best ? factVerification[best.status] : "unverified";
    nodes.push({
      id: e.id,
      kind: ENTITY_KIND[e.type] ?? "entity",
      label: e.label,
      summary: e.summary,
      verification,
      provenance: sourceName && sourceByName.has(sourceName) ? "source" : "inference",
      verifiedAt: best?.updated,
      freshness: sourceName ? sourceByName.get(sourceName)?.freshness : undefined,
      attributes: [{ label: "Tipo de domínio", value: e.type }, ...e.attributes],
      history: [
        { when: best?.updated ?? "sem registro", actor: "Modelagem", text: `Entidade ${e.type.toLowerCase()} modelada a partir de ${sourceName ?? "fonte não identificada"}.` },
        ...facts.map((k) => ({ when: k.updated, actor: "Conhecimento", text: `Vinculada ao fato "${k.title}".` })),
      ],
    });
    for (const k of facts) {
      edges.push({ id: `${k.id}~${e.id}`, source: k.id, target: e.id, type: "about", verification: factVerification[k.status], provenance: "source", evidenceIds: [k.id] });
    }
  }

  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
  const seen = new Set<string>();
  for (const e of data.entities) {
    for (const otherId of e.relatedIds) {
      if (!kindOf.has(otherId)) continue;
      const pair = [e.id, otherId].sort().join("|");
      if (seen.has(pair)) continue;
      seen.add(pair);
      const a = kindOf.get(e.id)!;
      const b = kindOf.get(otherId)!;
      const [from, to] = PRECEDENCE[a] >= PRECEDENCE[b] ? [e.id, otherId] : [otherId, e.id];
      const evidence = data.knowledge.filter((k) => k.entityIds.includes(from) && k.entityIds.includes(to));
      const verified = evidence.some((k) => k.status === "verified");
      edges.push({
        id: `${from}~${to}`,
        source: from,
        target: to,
        type: relationBetween(kindOf.get(from)!, kindOf.get(to)!),
        verification: verified ? "verified" : evidence.length ? "unverified" : "inferred",
        provenance: evidence.length ? "source" : "inference",
        evidenceIds: evidence.map((k) => k.id),
      });
    }
  }

  for (const p of data.pages) {
    nodes.push({
      id: p.id,
      kind: "page",
      label: p.title,
      summary: p.summary,
      verification: p.status === "ready" ? "verified" : "unverified",
      provenance: "curation",
      attributes: [
        { label: "Caminho", value: p.path },
        { label: "Formato", value: p.kind },
        { label: "Estado", value: p.status },
      ],
      history: p.gates.map((g) => ({ when: "último ciclo", actor: "Gate de qualidade", text: `${g.name}: ${g.status}.` })),
    });
    for (const id of p.entityIds) if (kindOf.has(id)) edges.push({ id: `${p.id}~${id}`, source: p.id, target: id, type: "covers", verification: "verified", provenance: "curation", evidenceIds: [] });
    for (const id of p.knowledgeIds) if (kindOf.has(id)) edges.push({ id: `${p.id}~${id}`, source: p.id, target: id, type: "cites", verification: "verified", provenance: "curation", evidenceIds: [id] });
  }

  return { tenantId: data.workspace.id, tenantName: data.workspace.name, isDemo: true, nodes, edges };
}

/** Acrescenta nós sintéticos (determinísticos) para demonstrar o comportamento com grafos densos. */
export function densify(graph: KnowledgeGraph, perEntity = 9): KnowledgeGraph {
  const nodes = [...graph.nodes];
  const edges = [...graph.edges];
  const anchors = graph.nodes.filter((n) => n.kind !== "fact" && n.kind !== "source" && n.kind !== "page");
  const kinds: NodeKind[] = ["fact", "page", "topic", "entity", "fact", "place"];
  anchors.forEach((anchor, ai) => {
    for (let i = 0; i < perEntity; i++) {
      const kind = kinds[(ai + i) % kinds.length];
      const id = `syn-${anchor.id}-${i}`;
      const verification: Verification = (["verified", "inferred", "unverified", "expired"] as const)[(ai * 3 + i) % 4];
      nodes.push({ id, kind, label: `${anchor.label} · ${i + 1}`, summary: "Nó sintético gerado apenas para demonstrar a densidade do grafo.", verification, provenance: "inference", attributes: [], history: [], synthetic: true });
      edges.push({ id: `${id}~${anchor.id}`, source: id, target: anchor.id, type: kind === "fact" ? "about" : kind === "page" ? "covers" : "relates_to", verification, provenance: "inference", evidenceIds: [] });
    }
  });
  return { ...graph, nodes, edges };
}
