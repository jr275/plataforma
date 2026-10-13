// Grafo de busca competitiva montado SÓ com relações gravadas no dataset (consulta→cluster, consulta→oportunidade,
// oportunidade→entidade/fonte, observação→oportunidade/entidade). Nenhuma aresta é criada para "preencher" o desenho.
import type { WorkspaceData } from "@/data/demo/types";

export type SGKind = "cluster" | "query" | "opportunity" | "finding" | "entity" | "source";
export type SGNode = { id: string; kind: SGKind; label: string; meta: string; href?: string };
export type SGEdge = { id: string; from: string; to: string; relation: string; source: string; record: string; meaning: string };

export const SG_COLUMNS: readonly { kind: SGKind; label: string }[] = [
  { kind: "cluster", label: "Clusters" },
  { kind: "query", label: "Consultas" },
  { kind: "opportunity", label: "Oportunidades" },
  { kind: "finding", label: "Observações" },
  { kind: "entity", label: "Entidades" },
  { kind: "source", label: "Fontes" },
];

const cid = (name: string) => `cluster:${name}`;

export function buildSearchGraph(d: WorkspaceData, cluster?: string) {
  const queries = d.queries.filter((q) => !cluster || q.cluster === cluster);
  const oppIds = new Set(queries.map((q) => q.opportunityId).filter((x): x is string => Boolean(x)));
  const opps = d.opportunities.filter((o) => oppIds.has(o.id));
  const findings = d.findings.filter((f) => f.opportunityId && oppIds.has(f.opportunityId));
  const entityIds = new Set([...opps.flatMap((o) => o.entityIds), ...findings.flatMap((f) => f.entityIds)]);
  const sourceIds = new Set(opps.flatMap((o) => o.sourceIds));

  const nodes: SGNode[] = [
    ...[...new Set(queries.map((q) => q.cluster))].map((c) => ({ id: cid(c), kind: "cluster" as const, label: c, meta: `${queries.filter((q) => q.cluster === c).length} consultas`, href: `/search-universe` })),
    ...queries.map((q) => ({ id: q.id, kind: "query" as const, label: q.text, meta: `${q.intent} · demanda ${q.demand} · ${q.trend}` })),
    ...opps.map((o) => ({ id: o.id, kind: "opportunity" as const, label: o.title, meta: `${o.kind} · ${o.intent}`, href: `/opportunities/${o.id}` })),
    ...findings.map((f) => ({ id: f.id, kind: "finding" as const, label: f.title, meta: `${f.section} · observação editorial` })),
    ...d.entities.filter((e) => entityIds.has(e.id)).map((e) => ({ id: e.id, kind: "entity" as const, label: e.label, meta: e.type, href: `/entities/${e.id}` })),
    ...d.sources.filter((s) => sourceIds.has(s.id)).map((s) => ({ id: s.id, kind: "source" as const, label: s.name, meta: `${s.type} · ${s.health}`, href: `/data-sources/${s.id}` })),
  ];

  const edges: SGEdge[] = [
    ...queries.map((q) => ({ id: `e:${q.id}:c`, from: cid(q.cluster), to: q.id, relation: "agrupa", source: "Universo de buscas", record: q.id, meaning: `A consulta “${q.text}” está classificada no cluster “${q.cluster}”.` })),
    ...queries.filter((q) => q.opportunityId && oppIds.has(q.opportunityId)).map((q) => ({ id: `e:${q.id}:o`, from: q.id, to: q.opportunityId!, relation: "sustenta", source: "Universo de buscas", record: q.id, meaning: "A demanda desta consulta é um dos motivos registrados da oportunidade." })),
    ...findings.map((f) => ({ id: `e:${f.id}:o`, from: f.opportunityId!, to: f.id, relation: "observada em", source: "Pesquisa editorial", record: f.id, meaning: `${f.summary} Evidência registrada: ${f.evidence.join("; ")}.` })),
    ...opps.flatMap((o) => o.entityIds.map((e) => ({ id: `e:${o.id}:${e}`, from: o.id, to: e, relation: "aborda", source: "Modelo de oportunidade", record: o.id, meaning: "A oportunidade declara esta entidade como tema da página." }))),
    ...findings.flatMap((f) => f.entityIds.map((e) => ({ id: `e:${f.id}:${e}`, from: f.id, to: e, relation: "menciona", source: "Pesquisa editorial", record: f.id, meaning: "A observação foi registrada sobre esta entidade." }))),
    ...opps.flatMap((o) => o.sourceIds.map((s) => ({ id: `e:${o.id}:${s}`, from: o.id, to: s, relation: "cita fonte", source: "Modelo de oportunidade", record: o.id, meaning: "Os fatos da futura página dependem desta fonte." }))),
  ].filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to));

  return { nodes, edges };
}
