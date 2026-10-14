import { normalizeSearchText } from "../ingest/city-search";
import type { GraphStore, StoreAggregate, StoreCity, StorePageLink, StoreSource } from "./store";

// Armazenamento em MEMÓRIA do grafo: mesma porta do SQL, para a prévia de desenvolvimento (sem banco nem login) e para testes do leitor.
// Os dados vêm de quem constrói (por exemplo, o extrato REAL do IBGE versionado); nada é inventado aqui. Um teste de produto confere que as
// respostas coincidem com as do armazenamento SQL sobre os mesmos dados.
export interface MemoryGraphInput {
  readonly cities: readonly StoreCity[];
  readonly sources: readonly StoreSource[];
  readonly pages?: readonly { readonly page: StorePageLink; readonly cityId: string }[];
  readonly records?: ReadonlyMap<string, { readonly rowNumber: number; readonly outcome: string; readonly raw: Readonly<Record<string, string>> }>;
}

export function createMemoryGraphStore(input: MemoryGraphInput): GraphStore {
  const byId = new Map(input.cities.map((c) => [c.id, c]));
  const sources = new Map(input.sources.map((s) => [s.runId, s]));
  const pageOf = new Map((input.pages ?? []).map((p) => [p.cityId, p.page]));
  const pageById = new Map((input.pages ?? []).map((p) => [p.page.id, p]));
  const srcOf = (c: StoreCity): StoreSource => sources.get(c.sourceRunId)!;
  const order = (a: StoreCity, b: StoreCity) => (b.population ?? -1) - (a.population ?? -1) || (a.ibgeCode < b.ibgeCode ? -1 : 1);
  const agg = (rows: readonly StoreCity[]): StoreAggregate => {
    const ids = [...new Set(rows.map((c) => c.sourceRunId))].map((id) => sources.get(id)!).sort((a, b) => b.importedAt.getTime() - a.importedAt.getTime() || (a.runId < b.runId ? -1 : 1)).slice(0, 10);
    return { cities: rows.length, withPopulation: rows.filter((c) => c.population !== null).length, withPage: rows.filter((c) => pageOf.has(c.id)).length, sources: ids };
  };
  const group = <K extends string>(rows: readonly StoreCity[], key: (c: StoreCity) => K | null) => {
    const m = new Map<K, number>();
    for (const c of rows) { const k = key(c); if (k !== null) m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  };
  const UFS_ALL = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
  const REGIONS_ALL = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"];
  return {
    async city(id) {
      const c = byId.get(id.toLowerCase());
      return c ? { city: c, source: srcOf(c), record: input.records?.get(c.id), page: pageOf.get(c.id) } : undefined;
    },
    async page(id) {
      const p = pageById.get(id.toLowerCase());
      const c = p ? byId.get(p.cityId) : undefined;
      return p && c ? { page: p.page, city: c, source: srcOf(c) } : undefined;
    },
    async uf(code) {
      const rows = input.cities.filter((c) => c.uf === code);
      if (rows.length === 0) return undefined;
      const g = group(rows, (c) => c.region);
      return { ...agg(rows), regions: [...g.entries()].map(([name, cities]) => ({ name, cities })).sort((a, b) => b.cities - a.cities || (a.name < b.name ? -1 : 1)) };
    },
    async region(name) {
      const rows = input.cities.filter((c) => c.region === name);
      if (rows.length === 0) return undefined;
      const g = group(rows, (c) => c.uf);
      return { ...agg(rows), ufs: [...g.entries()].map(([code, cities]) => ({ code, cities })).sort((a, b) => (a.code < b.code ? -1 : 1)) };
    },
    async topCities(filter, limit) {
      return input.cities.filter((c) => (!filter.uf || c.uf === filter.uf) && (!filter.region || c.region === filter.region)).sort(order).slice(0, limit);
    },
    async search(q, perKind) {
      const n = normalizeSearchText(q);
      const digits = /^\d+$/.test(n);
      const norm = (s: string) => normalizeSearchText(s);
      const cities = n === "" ? input.cities : input.cities.filter((c) => (digits ? c.ibgeCode.startsWith(n) : norm(c.name).includes(n)));
      const sorted = [...cities].sort((a, b) => (norm(a.name) < norm(b.name) ? -1 : norm(a.name) > norm(b.name) ? 1 : a.ibgeCode < b.ibgeCode ? -1 : 1));
      const ufCount = group(input.cities, (c) => c.uf);
      const regCount = group(input.cities, (c) => c.region);
      const pages = n === "" ? [] : [...pageById.values()].filter((p) => p.page.path.toLowerCase().includes(n)).sort((a, b) => (a.page.path < b.page.path ? -1 : 1));
      return {
        cities: { rows: sorted.slice(0, perKind), total: sorted.length },
        ufs: n === "" ? [] : UFS_ALL.filter((u) => u.toLowerCase().startsWith(n) && ufCount.has(u)).map((u) => ({ code: u, cities: ufCount.get(u)! })),
        regions: n === "" ? [] : REGIONS_ALL.filter((g) => norm(g).includes(n) && regCount.has(g)).map((g) => ({ name: g, cities: regCount.get(g)! })),
        pages: { rows: pages.slice(0, perKind).map((p) => { const c = byId.get(p.cityId)!; return { id: p.page.id, path: p.page.path, cityName: c.name, uf: c.uf }; }), total: pages.length },
      };
    },
  };
}
