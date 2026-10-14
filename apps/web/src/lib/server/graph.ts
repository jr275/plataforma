import "server-only";
import { graph } from "@plataforma/api";
import { loadForTenant } from "./tenant-data";

// Dados do Knowledge Graph (workspace de exploração). Só funções de packages/api, sempre por withTenant. SOMENTE LEITURA, sem migration:
// nós e relações são derivados de cidades, importações e páginas já persistidas; nada é inferido nem inventado.
export const DEFAULT_LIMIT = graph.DEFAULT_EXPAND_LIMIT;
export const LIMIT_STEP = 24;
export const STARTER_REGIONS = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"] as const;

export interface GraphParams { node: string; q: string; kinds: graph.GraphNodeKind[]; limit: number }

/** Lê a URL de forma defensiva: referência inválida some, tipos fora da lista somem, limite fica entre 1 e 96. */
export function parseGraphParams(raw: Record<string, string | string[] | undefined>): GraphParams {
  const one = (k: string) => { const v = raw[k]; return typeof v === "string" ? v : ""; };
  const node = graph.parseRef(one("node")) ? one("node") : "";
  const kinds = [...new Set(one("kinds").split(",").filter((k): k is graph.GraphNodeKind => (graph.NODE_KINDS as readonly string[]).includes(k)))];
  const limit = Number.parseInt(one("limit"), 10);
  return { node, q: one("q").trim().slice(0, 80), kinds, limit: Number.isInteger(limit) ? graph.clampLimit(limit) : DEFAULT_LIMIT };
}

/** Mantém busca, filtros e limite ao navegar entre nós (a URL é o estado: dá para compartilhar, voltar e atualizar). */
export function graphHref(p: GraphParams, over: Partial<GraphParams> = {}, base = "/graph"): string {
  const n = { ...p, ...over };
  const q = new URLSearchParams();
  if (n.node) q.set("node", n.node);
  if (n.q) q.set("q", n.q);
  if (n.kinds.length > 0 && n.kinds.length < graph.NODE_KINDS.length) q.set("kinds", n.kinds.join(","));
  if (n.limit !== DEFAULT_LIMIT) q.set("limit", String(n.limit));
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

export interface GraphWorkspaceData {
  /** Detalhe do nó pedido (inspetor). */
  detail: graph.GraphNodeDetail | undefined;
  expansion: graph.GraphExpansion | undefined;
  /** Um nó foi pedido na URL e não existe neste workspace (não é erro de infraestrutura). */
  nodeMissing: boolean;
  search: graph.GraphSearchResult | undefined;
  /** Pontos de partida reais (regiões existentes) quando nenhum nó está selecionado. */
  starters: graph.GraphNodeSummary[];
  now: Date;
}

/** Monta o que a tela precisa a partir de QUALQUER leitor (SQL em produção; memória na prévia de desenvolvimento). */
export async function loadGraphWorkspace(reader: graph.GraphReader, p: GraphParams, now: Date = new Date()): Promise<GraphWorkspaceData> {
  const kinds = p.kinds.length > 0 ? p.kinds : undefined;
  const [detail, expansion, search, starterDetails] = await Promise.all([
    p.node ? reader.node(p.node) : Promise.resolve(undefined),
    p.node ? reader.expand(p.node, { kinds, limit: p.limit }) : Promise.resolve(undefined),
    p.q ? reader.search(p.q, { kinds, perKind: 8 }) : Promise.resolve(undefined),
    p.node ? Promise.resolve([]) : Promise.all(STARTER_REGIONS.map((r) => reader.node(graph.formatRef("region", r)))),
  ]);
  return { detail, expansion, nodeMissing: Boolean(p.node) && !detail, search, starters: starterDetails.flatMap((d) => (d ? [d.node] : [])), now };
}

export const loadGraph = (p: GraphParams) => loadForTenant((db) => loadGraphWorkspace(graph.createGraphReader(graph.createSqlGraphStore(db)), p));
