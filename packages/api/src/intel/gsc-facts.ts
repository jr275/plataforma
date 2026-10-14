import type { SearchAnalyticsRow } from "./gsc";
import type { GscProperty } from "./gsc-diagnostics";

// Fatos de desempenho de busca normalizados a partir do Search Analytics. São OBSERVAÇÕES agregadas do Google:
// nada é inferido aqui (sem intenção, tópico ou entidade). Campos que a consulta não pediu ficam ausentes, nunca inventados.
// A classificação em tópicos/intenções acontece depois, separada, com confiança e evidência próprias.

export const FACT_DIMENSIONS = ["date", "query", "page", "country", "device", "searchAppearance"] as const;
export type FactDimension = (typeof FACT_DIMENSIONS)[number];
export type SearchType = "web" | "image" | "video" | "news" | "discover" | "googleNews";

export interface SearchFactProvenance {
  readonly source: "google_search_console";
  readonly property: string;
  readonly propertyKind: GscProperty["kind"];
  readonly searchType: SearchType;
  readonly dateRange: { readonly startDate: string; readonly endDate: string };
  readonly dimensions: readonly FactDimension[];
  readonly extractedAt: string;
}

export interface SearchPerformanceFact {
  readonly epistemic: "OBSERVED_TRUE";
  readonly date?: string;
  readonly query?: string;
  readonly page?: string;
  readonly country?: string;
  readonly device?: string;
  readonly searchAppearance?: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly ctr: number;
  readonly position: number;
  readonly provenance: SearchFactProvenance;
}

export interface NormalizeInput {
  readonly rows: readonly SearchAnalyticsRow[];
  readonly dimensions: readonly FactDimension[];
  readonly property: GscProperty;
  readonly searchType: SearchType;
  readonly dateRange: { readonly startDate: string; readonly endDate: string };
  readonly extractedAt: string;
}

export interface NormalizeOutput {
  readonly facts: readonly SearchPerformanceFact[];
  /** Linhas descartadas por não baterem com as dimensões pedidas: ficam contadas, nunca são "consertadas". */
  readonly rejected: number;
}

export function normalizeSearchFacts(input: NormalizeInput): NormalizeOutput {
  const provenance: SearchFactProvenance = {
    source: "google_search_console",
    property: input.property.value,
    propertyKind: input.property.kind,
    searchType: input.searchType,
    dateRange: input.dateRange,
    dimensions: [...input.dimensions],
    extractedAt: input.extractedAt,
  };
  const facts: SearchPerformanceFact[] = [];
  let rejected = 0;
  for (const row of input.rows) {
    if (row.keys.length !== input.dimensions.length || row.impressions < row.clicks) { rejected += 1; continue; }
    const keyed: Partial<Record<FactDimension, string>> = {};
    input.dimensions.forEach((d, i) => { keyed[d] = row.keys[i]; });
    facts.push({ epistemic: "OBSERVED_TRUE", ...keyed, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position, provenance });
  }
  return { facts, rejected };
}

export interface QueryPageOverlap {
  readonly query: string;
  readonly pages: readonly { readonly page: string; readonly impressions: number; readonly position: number }[];
}

/**
 * Sinal DERIVADO (não observação): queries para as quais 2+ páginas recebem impressões. Indica possível canibalização
 * ou sobreposição de alvo; a decisão continua humana. Exige fatos com dimensões query e page.
 */
export function overlappingTargets(facts: readonly SearchPerformanceFact[], minImpressions = 1): QueryPageOverlap[] {
  const byQuery = new Map<string, Map<string, { impressions: number; position: number }>>();
  for (const f of facts) {
    if (!f.query || !f.page || f.impressions < minImpressions) continue;
    const pages = byQuery.get(f.query) ?? new Map();
    const prev = pages.get(f.page);
    pages.set(f.page, prev ? { impressions: prev.impressions + f.impressions, position: Math.min(prev.position, f.position) } : { impressions: f.impressions, position: f.position });
    byQuery.set(f.query, pages);
  }
  return [...byQuery.entries()]
    .filter(([, pages]) => pages.size > 1)
    .map(([query, pages]) => ({ query, pages: [...pages.entries()].map(([page, v]) => ({ page, ...v })).sort((a, b) => b.impressions - a.impressions) }))
    .sort((a, b) => b.pages.length - a.pages.length || a.query.localeCompare(b.query));
}
