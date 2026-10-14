import { REGIONS, UFS } from "../ingest/cities";
import type { ImportOrigin, ImportStatus } from "../ingest/run";

// Modelo do grafo de conhecimento (Slice 2, SEM persistência própria). Nós e arestas são DERIVADOS de dados já persistidos e verificados:
// cidades (colunas uf e region da fonte), execuções de importação (proveniência) e páginas geradas (vínculo gravado por chave estrangeira).
// Nada é inferido e nenhum nó ou aresta é inventado: tudo que aparece aqui existe numa linha do banco do tenant.

export const NODE_KINDS = ["city", "uf", "region", "page"] as const;
export type GraphNodeKind = (typeof NODE_KINDS)[number];
export const EDGE_KINDS = ["belongs_to_uf", "in_region", "has_page"] as const;
export type GraphEdgeKind = (typeof EDGE_KINDS)[number];

/** Natureza de um valor exibido: `fact` vem literalmente da fonte; `derived` é calculado a partir de fatos (contagem, vínculo). Não há `inference`. */
export type Basis = "fact" | "derived";
/** Como a aresta existe: coluna da fonte (cidade → UF, UF → região) ou vínculo gravado pelo sistema (cidade → página). */
export type EdgeBasis = "source_column" | "recorded_link";

export interface GraphNodeSummary { readonly ref: string; readonly kind: GraphNodeKind; readonly label: string; readonly detail: string | null }
export interface GraphAttribute { readonly label: string; readonly value: string; readonly basis: Basis }
export interface GraphSource {
  readonly runId: string; readonly sourceName: string; readonly origin: ImportOrigin; readonly fileName: string; readonly fileSha256: string;
  readonly status: ImportStatus; readonly importedAt: Date; readonly totalRows: number; readonly acceptedRows: number;
}
export interface GraphRecord { readonly rowNumber: number; readonly outcome: string; readonly raw: Readonly<Record<string, string>> }
export interface GraphProvenance { readonly sources: readonly GraphSource[]; readonly record: GraphRecord | undefined; readonly newestImportAt: Date | null; readonly oldestImportAt: Date | null }
export interface GraphLink { readonly label: string; readonly href: string }
export interface GraphSuggestion { readonly text: string; readonly href: string | null }
export interface GraphNodeDetail {
  readonly node: GraphNodeSummary;
  readonly attributes: readonly GraphAttribute[];
  readonly provenance: GraphProvenance;
  readonly counts: Readonly<Partial<Record<GraphNodeKind, number>>>;
  readonly links: readonly GraphLink[];
  readonly suggestions: readonly GraphSuggestion[];
}
export interface GraphEdge { readonly from: string; readonly to: string; readonly kind: GraphEdgeKind; readonly label: string; readonly basis: EdgeBasis }
export interface GraphExpansion {
  readonly center: GraphNodeSummary;
  readonly neighbors: readonly GraphNodeSummary[];
  readonly edges: readonly GraphEdge[];
  /** Quantos vizinhos existem por tipo (ignorando o filtro e o limite). */
  readonly totals: Readonly<Partial<Record<GraphNodeKind, number>>>;
  /** Quantos vizinhos por tipo foram devolvidos. */
  readonly shown: Readonly<Partial<Record<GraphNodeKind, number>>>;
  readonly truncated: boolean;
}
export interface GraphExpandOptions { readonly kinds?: readonly GraphNodeKind[]; readonly limit?: number }
export interface GraphSearchResult { readonly nodes: readonly GraphNodeSummary[]; readonly totals: Readonly<Partial<Record<GraphNodeKind, number>>> }
export interface GraphReader {
  node(ref: string): Promise<GraphNodeDetail | undefined>;
  expand(ref: string, options?: GraphExpandOptions): Promise<GraphExpansion | undefined>;
  search(q: string, options?: { readonly kinds?: readonly GraphNodeKind[]; readonly perKind?: number }): Promise<GraphSearchResult>;
}

export const EDGE_LABEL: Record<GraphEdgeKind, string> = { belongs_to_uf: "pertence à UF", in_region: "está na região", has_page: "tem a página" };
export const DEFAULT_EXPAND_LIMIT = 24;
export const MAX_EXPAND_LIMIT = 96;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface GraphRef { readonly kind: GraphNodeKind; readonly key: string }

/** Referência estável de um nó: `city:<uuid>`, `uf:SP`, `region:Sudeste`, `page:<uuid>`. Qualquer outra forma é inválida (devolve `undefined`). */
export function parseRef(ref: string): GraphRef | undefined {
  const i = ref.indexOf(":");
  if (i < 1) return undefined;
  const kind = ref.slice(0, i);
  const key = ref.slice(i + 1);
  if (kind === "city" || kind === "page") return UUID.test(key) ? { kind, key: key.toLowerCase() } : undefined;
  if (kind === "uf") return (UFS as readonly string[]).includes(key) ? { kind: "uf", key } : undefined;
  if (kind === "region") return (REGIONS as readonly string[]).includes(key) ? { kind: "region", key } : undefined;
  return undefined;
}
export const formatRef = (kind: GraphNodeKind, key: string): string => `${kind}:${key}`;
export const clampLimit = (n: number | undefined): number => Math.min(Math.max(Math.trunc(n ?? DEFAULT_EXPAND_LIMIT), 1), MAX_EXPAND_LIMIT);
