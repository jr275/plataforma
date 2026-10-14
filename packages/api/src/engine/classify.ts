import { jaccard, normalizeQuery, tokens } from "./normalize";
import { extractEntities, type EntityIndex, type EntityRecord } from "./entities";
import type { QueryPattern, VerticalDefinition } from "./vertical";

// Classificação e agrupamento de queries (ADR-023, seção 5). Uma query só entra num cluster se casar com UM padrão da vertical (e, quando o padrão
// pede, com UMA entidade real). Casar parecido com padrões de INTENÇÕES diferentes é ambíguo: a query fica sem cluster, nunca é forçada.
export const MATCH_THRESHOLD = 0.6;
export const MARGIN = 0.15;

export type Classification =
  | { readonly status: "matched"; readonly pattern: QueryPattern; readonly entity: EntityRecord | null; readonly score: number }
  | { readonly status: "ambiguous"; readonly reason: string; readonly candidates: readonly string[] }
  | { readonly status: "unmatched"; readonly reason: string };

const template = (t: string, syn: Readonly<Record<string, string>>) => tokens(t.replace(/\{entity\}/g, " "), syn);

export function classifyQuery(def: VerticalDefinition, index: EntityIndex, query: string): Classification {
  const syn = def.synonyms ?? {};
  const ex = extractEntities(index, query);
  if (ex.ambiguous.length > 0 && ex.resolved.length === 0) return { status: "ambiguous", reason: `a entidade "${query}" casa com mais de uma (${ex.ambiguous[0]!.candidates.map((c) => `${c.name}${c.qualifier ? `/${c.qualifier}` : ""}`).join(", ")}); informe o qualificador`, candidates: [] };
  if (ex.resolved.length > 1) return { status: "ambiguous", reason: "a query cita mais de uma entidade", candidates: ex.resolved.map((m) => m.record.name) };
  const entity = ex.resolved[0]?.record ?? null;
  const q = entity ? ex.residual.map((t) => syn[t] ?? t) : tokens(query, syn);
  const scored = def.patterns
    .filter((p) => (p.entityKind === null) === (entity === null) && (p.entityKind === null || p.entityKind === entity!.kind))
    .map((p) => ({ p, score: Math.max(...p.templates.map((t) => jaccard(q, template(t, syn)))) }))
    .sort((a, b) => b.score - a.score || (a.p.key < b.p.key ? -1 : 1));
  const best = scored[0];
  if (!best || best.score < MATCH_THRESHOLD) return { status: "unmatched", reason: best ? `nenhum padrão da vertical se aproxima o bastante (melhor: ${best.p.key}, ${Math.round(best.score * 100)}%)` : "nenhum padrão aplicável (tipo de entidade ou ausência de entidade)" };
  const rival = scored.find((s) => s.p.intent !== best.p.intent);
  if (rival && best.score - rival.score < MARGIN) return { status: "ambiguous", reason: `casa quase igualmente com intenções diferentes (${best.p.key}: ${Math.round(best.score * 100)}% e ${rival.p.key}: ${Math.round(rival.score * 100)}%)`, candidates: [best.p.key, rival.p.key] };
  return { status: "matched", pattern: best.p, entity, score: best.score };
}

export const entityRef = (e: EntityRecord | null): string => (e ? `${e.kind}:${e.id}` : "-");
/** Chave do cluster: padrão + intenção + entidade. O padrão fixa a intenção; ela aparece na chave para ficar legível e auditável. */
export const clusterKey = (p: QueryPattern, e: EntityRecord | null): string => `${p.key}:${p.intent}:${entityRef(e)}`;

export interface ClusterMember { readonly text: string; readonly normalized: string; readonly score: number; readonly count: number }
export interface QueryCluster { readonly key: string; readonly pattern: QueryPattern; readonly entity: EntityRecord | null; readonly members: readonly ClusterMember[] }
export interface Unclassified { readonly text: string; readonly status: "ambiguous" | "unmatched"; readonly reason: string }

export function clusterQueries(def: VerticalDefinition, index: EntityIndex, queries: readonly string[]): { clusters: QueryCluster[]; unclassified: Unclassified[] } {
  const clusters = new Map<string, { pattern: QueryPattern; entity: EntityRecord | null; members: Map<string, ClusterMember> }>();
  const unclassified: Unclassified[] = [];
  for (const text of queries) {
    const c = classifyQuery(def, index, text);
    if (c.status !== "matched") { unclassified.push({ text, status: c.status, reason: c.reason }); continue; }
    const key = clusterKey(c.pattern, c.entity);
    const cl = clusters.get(key) ?? { pattern: c.pattern, entity: c.entity, members: new Map() };
    const norm = normalizeQuery(text, def.synonyms ?? {});
    const prev = cl.members.get(norm);
    cl.members.set(norm, prev ? { ...prev, count: prev.count + 1 } : { text, normalized: norm, score: c.score, count: 1 });
    clusters.set(key, cl);
  }
  return { clusters: [...clusters.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, v]) => ({ key, pattern: v.pattern, entity: v.entity, members: [...v.members.values()] })), unclassified };
}
