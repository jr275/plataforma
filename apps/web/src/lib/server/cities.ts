import "server-only";
import { UFS, getCityDetail, searchCities, type CitySearch } from "@plataforma/api";
import { loadForTenant } from "./tenant-data";

// Dados da área "Cidades" (entidades reais e proveniência; ADR-018). Só funções tipadas de packages/api, sempre por withTenant. SOMENTE LEITURA.
export const CITY_PAGE_SIZE = 20;
const SORTS = ["name", "population", "ibge"] as const;
const PAGES = ["with", "without"] as const;

export interface CityParams { q: string; uf: string; pages: "" | (typeof PAGES)[number]; sort: (typeof SORTS)[number]; dir: "asc" | "desc"; page: number }

/** Lê os parâmetros da URL de forma defensiva: qualquer valor fora da lista volta ao padrão (nada vai cru para o banco). */
export function parseCityParams(raw: Record<string, string | string[] | undefined>): CityParams {
  const one = (k: string) => { const v = raw[k]; return typeof v === "string" ? v : ""; };
  const uf = one("uf").toUpperCase();
  const pages = one("pages");
  const sort = one("sort");
  const page = Number.parseInt(one("page"), 10);
  return {
    q: one("q").trim().slice(0, 80),
    uf: (UFS as readonly string[]).includes(uf) ? uf : "",
    pages: (PAGES as readonly string[]).includes(pages) ? (pages as CityParams["pages"]) : "",
    sort: (SORTS as readonly string[]).includes(sort) ? (sort as CityParams["sort"]) : "name",
    dir: one("dir") === "desc" ? "desc" : "asc",
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export function loadCities(p: CityParams) {
  const search: CitySearch = { q: p.q || undefined, uf: p.uf || undefined, hasPage: p.pages === "" ? undefined : p.pages === "with", sort: p.sort, dir: p.dir, limit: CITY_PAGE_SIZE, offset: (p.page - 1) * CITY_PAGE_SIZE };
  // Indicadores do workspace inteiro (sem filtros): total de cidades e quantas já têm página gerada. Calculados no banco, nunca estimados.
  return loadForTenant(async (db) => {
    const [cities, all, withPage] = await Promise.all([searchCities(db, search), searchCities(db, { limit: 1 }), searchCities(db, { hasPage: true, limit: 1 })]);
    return { cities, summary: { total: all.total, withPage: withPage.total } };
  });
}

export const loadCityDetail = (id: string) => loadForTenant(async (db) => ({ detail: await getCityDetail(db, id) }));
