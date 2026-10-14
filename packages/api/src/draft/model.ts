import { CONTRACTS, GATE_IDS, NODE_TYPES, canConnectTypes, type NodeType } from "./contracts";
import { sig } from "./sig";

// Modelo de domínio do rascunho de blueprint (ADR-026): a FONTE da verdade da edição. O grafo do React Flow é só uma projeção deste modelo. Operações puras: cada uma
// devolve um rascunho novo ou um erro explicado; nada é alterado no lugar.
export type Config = Readonly<Record<string, string | number | boolean | readonly string[]>>;
export interface DraftNode { readonly id: string; readonly type: NodeType; readonly config: Config }
export interface DraftEdge { readonly id: string; readonly from: string; readonly to: string }
export interface PageDraft {
  readonly schema: "page-draft/v1";
  readonly nodes: readonly DraftNode[]; readonly edges: readonly DraftEdge[];
  /** Posições do canvas (só apresentação; fora da assinatura de conteúdo e do histórico de edição). */
  readonly layout: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
  /** Blueprint de que o rascunho nasceu (versão e assinatura do conteúdo base). */
  readonly basis: { readonly blueprintVersion: number; readonly blueprintSig: string };
}
export type OpResult = { readonly ok: true; readonly draft: PageDraft; readonly nodeId?: string } | { readonly ok: false; readonly error: string };
const fail = (error: string): OpResult => ({ ok: false, error });
const ok = (draft: PageDraft, nodeId?: string): OpResult => ({ ok: true, draft, ...(nodeId ? { nodeId } : {}) });

/** Assinatura do CONTEÚDO (nós e arestas): muda quando algo que afeta página, validação ou gates muda; posições não entram. */
export const contentSig = (d: PageDraft): string => sig({ n: [...d.nodes].sort((a, b) => (a.id < b.id ? -1 : 1)), e: [...d.edges].sort((a, b) => (a.id < b.id ? -1 : 1)) });
export const nodeById = (d: PageDraft, id: string): DraftNode | undefined => d.nodes.find((n) => n.id === id);
export const edgeId = (from: string, to: string): string => `${from}>${to}`;
const nextId = (d: PageDraft, type: NodeType): string => { let n = d.nodes.filter((x) => x.type === type).length + 1; while (d.nodes.some((x) => x.id === `${type}-${n}`)) n++; return `${type}-${n}`; };

/** Há caminho de `a` até `b`? (para recusar ciclos) */
export function reaches(edges: readonly DraftEdge[], a: string, b: string): boolean {
  const seen = new Set<string>(); const stack = [a];
  while (stack.length) { const x = stack.pop()!; if (x === b) return true; if (seen.has(x)) continue; seen.add(x); for (const e of edges) if (e.from === x) stack.push(e.to); }
  return false;
}

export function addNode(d: PageDraft, type: NodeType, config: Config = {}): OpResult {
  const c = CONTRACTS[type];
  if (!c) return fail("tipo de nó desconhecido");
  if (!c.addable) return fail(`nós do tipo “${c.label}” não podem ser adicionados (são fixos do modelo)`);
  if (c.singleton && d.nodes.some((n) => n.type === type)) return fail(`já existe um nó “${c.label}” (só pode haver um)`);
  const id = nextId(d, type);
  return ok({ ...d, nodes: [...d.nodes, { id, type, config }] }, id);
}
export function removeNode(d: PageDraft, id: string): OpResult {
  const n = nodeById(d, id);
  if (!n) return fail("nó inexistente");
  if (!CONTRACTS[n.type].removable) return fail(`o nó “${CONTRACTS[n.type].label}” é fixo e não pode ser removido`);
  const layout = { ...d.layout }; delete layout[id];
  return ok({ ...d, nodes: d.nodes.filter((x) => x.id !== id), edges: d.edges.filter((e) => e.from !== id && e.to !== id), layout });
}
export function updateConfig(d: PageDraft, id: string, patch: Config): OpResult {
  const n = nodeById(d, id);
  if (!n) return fail("nó inexistente");
  const spec = new Map(CONTRACTS[n.type].fields.map((f) => [f.key, f]));
  for (const k of Object.keys(patch)) {
    const f = spec.get(k);
    if (!f) return fail(`o campo “${k}” não existe no contrato de “${CONTRACTS[n.type].label}”`);
    if (f.locked) return fail(`o campo “${f.label}” é fixo`);
  }
  return ok({ ...d, nodes: d.nodes.map((x) => (x.id === id ? { ...x, config: { ...x.config, ...patch } } : x)) });
}
export function connect(d: PageDraft, from: string, to: string): OpResult {
  const a = nodeById(d, from), b = nodeById(d, to);
  if (!a || !b) return fail("nó inexistente");
  if (from === to) return fail("um nó não pode se ligar a si mesmo");
  if (!canConnectTypes(a.type, b.type)) return fail(`“${CONTRACTS[a.type].label}” não pode alimentar “${CONTRACTS[b.type].label}”: conexão incompatível com o modelo`);
  if (d.edges.some((e) => e.from === from && e.to === to)) return fail("essa conexão já existe");
  if (reaches(d.edges, to, from)) return fail("a conexão criaria um ciclo");
  return ok({ ...d, edges: [...d.edges, { id: edgeId(from, to), from, to }] });
}
/** Conexões estruturais do modelo (que o validador exige) não podem ser apagadas à mão: gate -> publicação. */
export function disconnect(d: PageDraft, id: string): OpResult {
  const e = d.edges.find((x) => x.id === id);
  if (!e) return fail("conexão inexistente");
  const a = nodeById(d, e.from)!, b = nodeById(d, e.to)!;
  if (a.type === "quality_gate" && b.type === "publication") return fail("a ligação de cada gate à decisão de publicação é obrigatória");
  if (a.type === "opportunity") return fail("as ligações que saem da oportunidade são fixas");
  return ok({ ...d, edges: d.edges.filter((x) => x.id !== id) });
}
export function setLayout(d: PageDraft, layout: PageDraft["layout"]): PageDraft { return { ...d, layout }; }

/** Leitura defensiva de um rascunho vindo de fora (cliente ou banco): estrutura, tipos, limites e chaves desconhecidas. Devolve o rascunho ou a lista de erros. */
export const MAX_NODES = 120, MAX_EDGES = 400;
export function parseDraft(input: unknown): { ok: true; draft: PageDraft } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const o = input as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || o.schema !== "page-draft/v1") return { ok: false, errors: ["esquema desconhecido"] };
  const extra = Object.keys(o).filter((k) => !["schema", "nodes", "edges", "layout", "basis"].includes(k));
  if (extra.length) errors.push(`campos desconhecidos: ${extra.join(", ")}`);
  if (!Array.isArray(o.nodes) || o.nodes.length > MAX_NODES) errors.push(`nodes deve ser uma lista de até ${MAX_NODES}`);
  if (!Array.isArray(o.edges) || o.edges.length > MAX_EDGES) errors.push(`edges deve ser uma lista de até ${MAX_EDGES}`);
  if (errors.length) return { ok: false, errors };
  const nodes: DraftNode[] = [];
  for (const n of o.nodes as unknown[]) {
    const x = n as Record<string, unknown>;
    if (!x || typeof x.id !== "string" || !/^[a-z_]+-\d{1,4}$/.test(x.id) || !NODE_TYPES.includes(x.type as NodeType) || typeof x.config !== "object" || x.config === null || Array.isArray(x.config)) { errors.push(`nó inválido: ${JSON.stringify(x?.id ?? null)}`); continue; }
    const cfg: Record<string, string | number | boolean | string[]> = {};
    for (const [k, v] of Object.entries(x.config as Record<string, unknown>)) {
      if (typeof v === "string" && v.length <= 500) cfg[k] = v;
      else if (typeof v === "number" && Number.isFinite(v)) cfg[k] = v;
      else if (typeof v === "boolean") cfg[k] = v;
      else if (Array.isArray(v) && v.length <= 30 && v.every((i) => typeof i === "string" && i.length <= 120)) cfg[k] = v as string[];
      else errors.push(`valor inválido em ${x.id}.${k}`);
    }
    nodes.push({ id: x.id, type: x.type as NodeType, config: cfg });
  }
  const edges: DraftEdge[] = [];
  for (const e of o.edges as unknown[]) {
    const x = e as Record<string, unknown>;
    if (!x || typeof x.id !== "string" || typeof x.from !== "string" || typeof x.to !== "string") { errors.push("conexão inválida"); continue; }
    edges.push({ id: x.id, from: x.from, to: x.to });
  }
  const layout: Record<string, { x: number; y: number }> = {};
  for (const [k, v] of Object.entries((o.layout ?? {}) as Record<string, unknown>)) {
    const p = v as { x?: unknown; y?: unknown };
    if (typeof p?.x === "number" && typeof p?.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 1e5 && Math.abs(p.y) < 1e5) layout[k] = { x: p.x, y: p.y }; else errors.push(`posição inválida para ${k}`);
  }
  const b = o.basis as { blueprintVersion?: unknown; blueprintSig?: unknown } | undefined;
  if (!b || !Number.isInteger(b.blueprintVersion) || (b.blueprintVersion as number) < 1 || typeof b.blueprintSig !== "string" || b.blueprintSig.length > 64) errors.push("base do blueprint inválida");
  if (errors.length) return { ok: false, errors };
  return { ok: true, draft: { schema: "page-draft/v1", nodes, edges, layout, basis: { blueprintVersion: b!.blueprintVersion as number, blueprintSig: b!.blueprintSig as string } } };
}

/** Resumo das mudanças RELEVANTES entre duas versões (para o histórico): nós adicionados, removidos e campos editados; conexões; posições não contam. */
export interface Change { readonly kind: "node_added" | "node_removed" | "field_changed" | "edge_added" | "edge_removed"; readonly id: string; readonly field?: string }
export function diffDrafts(prev: PageDraft | null, next: PageDraft): Change[] {
  const out: Change[] = [];
  const pn = new Map((prev?.nodes ?? []).map((n) => [n.id, n]));
  const nn = new Map(next.nodes.map((n) => [n.id, n]));
  for (const [id, n] of nn) {
    const p = pn.get(id);
    if (!p) { out.push({ kind: "node_added", id }); continue; }
    for (const k of new Set([...Object.keys(p.config), ...Object.keys(n.config)])) if (sig(p.config[k] ?? null) !== sig(n.config[k] ?? null)) out.push({ kind: "field_changed", id, field: k });
  }
  for (const id of pn.keys()) if (!nn.has(id)) out.push({ kind: "node_removed", id });
  const pe = new Set((prev?.edges ?? []).map((e) => e.id)), ne = new Set(next.edges.map((e) => e.id));
  for (const id of ne) if (!pe.has(id)) out.push({ kind: "edge_added", id });
  for (const id of pe) if (!ne.has(id)) out.push({ kind: "edge_removed", id });
  return out;
}
export { GATE_IDS };
