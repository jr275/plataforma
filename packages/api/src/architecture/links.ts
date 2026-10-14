import { createHash } from "node:crypto";
import { archetypeOf } from "./catalog";
import type { ArchetypeId, LinkRelation } from "./types";

// Grafo de links internos: nós = páginas candidatas/geradas, arestas = links REAIS do recipe (não propostas). Cada aresta é validada (destino existente e canônico, sem autolink, sem duplicata, relação permitida pelo
// archetype de origem, origem elegível pela política). A política padrão exige 3 inlinks contextuais válidos antes da publicação INDEXÁVEL; é configurável por tenant/archetype, com exceções EXPLÍCITAS (escopo, justificativa,
// responsável): nenhuma página inicial ou hub recebe bypass implícito. Compilar é idempotente (hash do conteúdo) e as sugestões são só recomendações (não viram arestas).
export interface LinkNode { readonly id: string; readonly url: string | null; readonly canonical: string | null; readonly archetypeId: ArchetypeId; readonly clusterId: string | null; readonly parentId: string | null;
  /** A origem pode contar como inlink? (ex.: já tem recipe e não foi rejeitada). */ readonly sourceEligible: boolean }
export interface RawLink { readonly fromId: string; readonly toPath: string; readonly relation: LinkRelation; readonly moduleId: string | null; readonly reason: string; readonly evidence?: readonly string[] }
export type InvalidReason = "SELF_LINK" | "DUPLICATE" | "DESTINATION_MISSING" | "NON_CANONICAL_DESTINATION" | "CONFLICTING_CANONICAL" | "SOURCE_INELIGIBLE" | "RELATION_NOT_ALLOWED" | "FORBIDDEN_DESTINATION";
export interface Edge extends RawLink { readonly toId: string | null; readonly state: "VALID" | "INVALID"; readonly invalidReason: InvalidReason | null }
export interface LinkException { readonly scope: { readonly opportunityId?: string; readonly archetypeId?: ArchetypeId }; readonly waivedMinInlinks: number; readonly reason: string; readonly approvedBy: string; readonly approvedAt: string; readonly expiresAt?: string }
export interface LinkPolicy { readonly version: string; readonly minInlinks: number; readonly byArchetype?: Readonly<Partial<Record<ArchetypeId, number>>>; readonly countFromIneligibleSources: boolean; readonly forbiddenPaths: readonly string[]; readonly exceptions: readonly LinkException[] }
export const DEFAULT_LINK_POLICY: LinkPolicy = { version: "1", minInlinks: 3, countFromIneligibleSources: false, forbiddenPaths: [], exceptions: [] };
export function validateLinkPolicy(p: LinkPolicy): string[] {
  const e: string[] = [];
  if (!Number.isInteger(p.minInlinks) || p.minInlinks < 1 || p.minInlinks > 50) e.push("minInlinks deve ser inteiro de 1 a 50");
  for (const [a, n] of Object.entries(p.byArchetype ?? {})) if (!archetypeOf(a) || !Number.isInteger(n) || n! < 1) e.push(`mínimo inválido para ${a}`);
  for (const x of p.exceptions) { if (x.reason.trim().length < 10) e.push("toda exceção exige justificativa (≥ 10 caracteres)"); if (!x.approvedBy.trim()) e.push("toda exceção exige responsável"); if (!x.scope.opportunityId && !x.scope.archetypeId) e.push("exceção sem escopo explícito"); if (x.waivedMinInlinks < 0) e.push("waivedMinInlinks inválido"); }
  for (const f of p.forbiddenPaths) try { new RegExp(f); } catch { e.push(`padrão proibido inválido: ${f}`); }
  return e;
}

export interface CompiledGraph { readonly edges: readonly Edge[]; readonly hash: string; readonly stats: { readonly nodes: number; readonly edges: number; readonly valid: number; readonly invalid: number; readonly byReason: Readonly<Record<string, number>> } }
export function compileLinkGraph(nodes: readonly LinkNode[], links: readonly RawLink[], policy: LinkPolicy = DEFAULT_LINK_POLICY): CompiledGraph {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byUrl = new Map<string, LinkNode[]>(); for (const n of nodes) if (n.url) byUrl.set(n.url, [...(byUrl.get(n.url) ?? []), n]);
  const canonCount = new Map<string, number>(); for (const n of nodes) if (n.canonical) canonCount.set(n.canonical, (canonCount.get(n.canonical) ?? 0) + 1);
  const forbidden = policy.forbiddenPaths.map((p) => new RegExp(p)); const seen = new Set<string>(); const edges: Edge[] = [];
  const ordered = [...links].sort((a, b) => (a.fromId + a.toPath + a.relation + (a.moduleId ?? "")).localeCompare(b.fromId + b.toPath + b.relation + (b.moduleId ?? "")));
  for (const l of ordered) {
    const src = byId.get(l.fromId); const dests = byUrl.get(l.toPath) ?? []; const dest = dests.length === 1 ? dests[0]! : null;
    let reason: InvalidReason | null = null;
    if (!src) reason = "DESTINATION_MISSING";
    else if (forbidden.some((f) => f.test(l.toPath))) reason = "FORBIDDEN_DESTINATION";
    else if (dests.length === 0) reason = "DESTINATION_MISSING";
    else if (dests.length > 1) reason = "CONFLICTING_CANONICAL";
    else if (dest!.id === l.fromId) reason = "SELF_LINK";
    else if (dest!.canonical && dest!.canonical !== dest!.url) reason = "NON_CANONICAL_DESTINATION";
    else if (dest!.canonical && (canonCount.get(dest!.canonical) ?? 0) > 1) reason = "CONFLICTING_CANONICAL";
    else if (!archetypeOf(src!.archetypeId)?.linkRules.allowedRelations.includes(l.relation)) reason = "RELATION_NOT_ALLOWED";
    else if (!src!.sourceEligible && !policy.countFromIneligibleSources) reason = "SOURCE_INELIGIBLE";
    else { const k = `${l.fromId}|${dest!.id}`; if (seen.has(k)) reason = "DUPLICATE"; else seen.add(k); }
    edges.push({ ...l, toId: dest?.id ?? null, state: reason ? "INVALID" : "VALID", invalidReason: reason });
  }
  const byReason: Record<string, number> = {}; for (const e of edges) if (e.invalidReason) byReason[e.invalidReason] = (byReason[e.invalidReason] ?? 0) + 1;
  const hash = createHash("sha256").update(JSON.stringify([nodes.map((n) => [n.id, n.url, n.canonical, n.archetypeId, n.sourceEligible]).sort(), edges.map((e) => [e.fromId, e.toId, e.toPath, e.relation, e.moduleId, e.state, e.invalidReason]), policy.version])).digest("hex");
  return { edges, hash, stats: { nodes: nodes.length, edges: edges.length, valid: edges.filter((e) => e.state === "VALID").length, invalid: edges.filter((e) => e.state === "INVALID").length, byReason } };
}

export interface InlinkEvaluation {
  readonly nodeId: string; readonly required: number; readonly valid: number; readonly passed: boolean; readonly ruleId: "INSUFFICIENT_CONTEXTUAL_INLINKS" | null;
  readonly exception: LinkException | null; readonly validEdges: readonly Edge[]; readonly rejected: readonly Edge[]; readonly missing: number;
  /** Recomendações (NÃO são arestas): páginas do mesmo cluster/pai que poderiam linkar de forma contextual. */ readonly suggestions: readonly { readonly fromId: string; readonly relation: LinkRelation; readonly why: string }[];
}
const active = (x: LinkException, now: Date) => !x.expiresAt || new Date(x.expiresAt) > now;
/** Inlinks VÁLIDOS e DISTINTOS (por origem). Exceção só vale se explícita e dentro do escopo; o resultado diz qual exceção foi aplicada. */
export function evaluateInlinks(nodeId: string, nodes: readonly LinkNode[], graph: CompiledGraph, policy: LinkPolicy = DEFAULT_LINK_POLICY, now: Date = new Date()): InlinkEvaluation {
  const node = nodes.find((n) => n.id === nodeId); if (!node) throw new Error(`nó desconhecido: ${nodeId}`);
  const base = policy.byArchetype?.[node.archetypeId] ?? policy.minInlinks;
  const exception = policy.exceptions.find((x) => active(x, now) && (x.scope.opportunityId === nodeId || (x.scope.opportunityId === undefined && x.scope.archetypeId === node.archetypeId))) ?? null;
  const required = exception ? exception.waivedMinInlinks : base;
  const inbound = graph.edges.filter((e) => e.toId === nodeId);
  const validEdges = inbound.filter((e) => e.state === "VALID"); const rejected = inbound.filter((e) => e.state === "INVALID");
  const valid = new Set(validEdges.map((e) => e.fromId)).size; const passed = valid >= required;
  const linkers = new Set(inbound.map((e) => e.fromId));
  const suggestions = passed ? [] : nodes.filter((n) => n.id !== nodeId && n.sourceEligible && !linkers.has(n.id) && (n.clusterId !== null && n.clusterId === node.clusterId || n.id === node.parentId || n.parentId === nodeId))
    .sort((a, b) => a.id.localeCompare(b.id)).slice(0, 8).map((n) => ({ fromId: n.id, relation: (n.id === node.parentId ? "child" : n.parentId === nodeId ? "parent" : "sibling") as LinkRelation, why: n.id === node.parentId ? "é a página pai" : n.parentId === nodeId ? "é página filha" : "pertence ao mesmo cluster" }))
    .filter((s) => archetypeOf(nodes.find((n) => n.id === s.fromId)!.archetypeId)?.linkRules.allowedRelations.includes(s.relation));
  return { nodeId, required, valid, passed, ruleId: passed ? null : "INSUFFICIENT_CONTEXTUAL_INLINKS", exception, validEdges, rejected, missing: Math.max(required - valid, 0), suggestions };
}
export function outlinksOf(nodeId: string, graph: CompiledGraph): { readonly valid: readonly Edge[]; readonly invalid: readonly Edge[] } {
  const out = graph.edges.filter((e) => e.fromId === nodeId); return { valid: out.filter((e) => e.state === "VALID"), invalid: out.filter((e) => e.state === "INVALID") };
}
