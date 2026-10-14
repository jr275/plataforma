import type { ImportOrigin, ImportStatus } from "../ingest/run";

// Porta de dados do grafo: poucas consultas primitivas. O leitor (reader.ts) é a ÚNICA lógica de montagem de nós e arestas; o armazenamento
// SQL (produção) e o de memória (prévia de desenvolvimento e testes) só respondem a estas consultas.
export interface StoreCity { readonly id: string; readonly ibgeCode: string; readonly name: string; readonly uf: string; readonly region: string | null; readonly population: number | null; readonly populationYear: number | null; readonly sourceRunId: string }
export interface StoreSource { readonly runId: string; readonly sourceName: string; readonly origin: ImportOrigin; readonly fileName: string; readonly fileSha256: string; readonly status: ImportStatus; readonly importedAt: Date; readonly totalRows: number; readonly acceptedRows: number }
export interface StorePageLink { readonly id: string; readonly path: string; readonly status: "draft" | "blocked"; readonly latestVersion: number; readonly updatedAt: Date }
export interface StoreCityRecord { readonly city: StoreCity; readonly source: StoreSource; readonly record: { readonly rowNumber: number; readonly outcome: string; readonly raw: Readonly<Record<string, string>> } | undefined; readonly page: StorePageLink | undefined }
export interface StorePage { readonly page: StorePageLink; readonly city: StoreCity; readonly source: StoreSource }
export interface StoreAggregate { readonly cities: number; readonly withPopulation: number; readonly withPage: number; readonly sources: readonly StoreSource[] }
export interface StoreSearch {
  readonly cities: { readonly rows: readonly StoreCity[]; readonly total: number };
  readonly ufs: readonly { readonly code: string; readonly cities: number }[];
  readonly regions: readonly { readonly name: string; readonly cities: number }[];
  readonly pages: { readonly rows: readonly { readonly id: string; readonly path: string; readonly cityName: string; readonly uf: string }[]; readonly total: number };
}
export interface GraphStore {
  city(id: string): Promise<StoreCityRecord | undefined>;
  page(id: string): Promise<StorePage | undefined>;
  uf(code: string): Promise<(StoreAggregate & { readonly regions: readonly { readonly name: string; readonly cities: number }[] }) | undefined>;
  region(name: string): Promise<(StoreAggregate & { readonly ufs: readonly { readonly code: string; readonly cities: number }[] }) | undefined>;
  /** Cidades por população decrescente (empate pelo código IBGE), filtradas por UF ou região. */
  topCities(filter: { readonly uf?: string; readonly region?: string }, limit: number): Promise<readonly StoreCity[]>;
  search(q: string, perKind: number): Promise<StoreSearch>;
}
