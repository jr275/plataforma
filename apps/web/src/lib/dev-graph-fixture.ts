import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cityPath, classifyCityRows, graph, normalizeSearchText, parseCsv, type CityListItem } from "@plataforma/api";

// FIXTURE DE DESENVOLVIMENTO (nunca em produção): o extrato REAL do IBGE (SP, 2026-10-12) em memória, para ver o grafo e as cidades sem login nem banco.
// A origem é declarada como "test": os DADOS são reais, mas esta importação é simulada (nada foi persistido). As 20 maiores populações recebem uma página
// rascunho de exemplo só para exibir relações cidade → página. Nada aqui é enviado a um banco.
const CSV = path.resolve(process.cwd(), "../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv");
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" } as const;
const RUN = "00000000-0000-4000-8000-00000000f1f0";
const SOURCE: graph.StoreSource = { runId: RUN, sourceName: "IBGE (extrato de desenvolvimento)", origin: "test", fileName: "sp-ibge-2026-10-12.csv", fileSha256: "0".repeat(64), status: "succeeded", importedAt: new Date("2026-10-12T20:00:00Z"), totalRows: 645, acceptedRows: 645 };

let cache: { cities: graph.StoreCity[]; pages: { page: graph.StorePageLink; cityId: string }[] } | undefined;
function data() {
  if (cache) return cache;
  const { rows } = classifyCityRows(parseCsv(readFileSync(CSV, "utf8")), MAPPING);
  const cities: graph.StoreCity[] = rows.flatMap((r) => (r.city ? [{ id: `00000000-0000-4000-8000-${r.city.ibgeCode.padStart(12, "0")}`, ibgeCode: r.city.ibgeCode, name: r.city.name, uf: r.city.uf, region: r.city.region, population: r.city.population, populationYear: r.city.populationYear, sourceRunId: RUN }] : []));
  const top = [...cities].filter((c) => c.population !== null).sort((a, b) => b.population! - a.population! || (a.ibgeCode < b.ibgeCode ? -1 : 1)).slice(0, 20);
  const pages = top.map((c) => ({ cityId: c.id, page: { id: `00000000-0000-4000-9000-${c.ibgeCode.padStart(12, "0")}`, path: cityPath(c.uf, c.name), status: "draft" as const, latestVersion: 1, updatedAt: new Date("2026-10-13T03:10:00Z") } }));
  cache = { cities, pages };
  return cache;
}

export const devGraphReader = (): graph.GraphReader => {
  const d = data();
  return graph.createGraphReader(graph.createMemoryGraphStore({ cities: d.cities, sources: [SOURCE], pages: d.pages }));
};

const NAME_KEY = (s: string) => normalizeSearchText(s);
/** Lista de cidades da prévia (filtro, ordenação e paginação simples, só para a revisão visual; a semântica real é testada contra o PostgreSQL). */
export function devCityList(p: { q: string; uf: string; pages: "" | "with" | "without"; sort: "name" | "population" | "ibge"; dir: "asc" | "desc"; page: number }, size: number) {
  const d = data();
  const pageOf = new Map(d.pages.map((x) => [x.cityId, x.page]));
  const n = normalizeSearchText(p.q);
  const digits = /^\d+$/.test(n);
  let rows = d.cities.filter((c) => (n === "" || (digits ? c.ibgeCode.startsWith(n) : NAME_KEY(c.name).includes(n))) && (!p.uf || c.uf === p.uf) && (p.pages === "" || (p.pages === "with") === pageOf.has(c.id)));
  const cmp: Record<typeof p.sort, (a: graph.StoreCity, b: graph.StoreCity) => number> = { name: (a, b) => (NAME_KEY(a.name) < NAME_KEY(b.name) ? -1 : 1), population: (a, b) => (a.population ?? -1) - (b.population ?? -1), ibge: (a, b) => (a.ibgeCode < b.ibgeCode ? -1 : 1) };
  rows = [...rows].sort((a, b) => (p.dir === "desc" ? -1 : 1) * cmp[p.sort](a, b));
  const items: CityListItem[] = rows.slice((p.page - 1) * size, p.page * size).map((c) => { const pg = pageOf.get(c.id); return { ...c, sourceName: SOURCE.sourceName, sourceOrigin: SOURCE.origin, pageId: pg?.id ?? null, pagePath: pg?.path ?? null, pageStatus: pg?.status ?? null }; });
  return { rows: items, total: rows.length, summary: { total: d.cities.length, withPage: d.pages.length } };
}
