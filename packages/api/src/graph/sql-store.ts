import { REGIONS, UFS } from "../ingest/cities";
import { getCityDetail, normalizeSearchText, searchCities } from "../ingest/city-search";
import type { TenantDb } from "../tenant-context";
import type { GraphStore, StoreAggregate, StoreCity, StorePageLink, StoreSource } from "./store";

// Armazenamento SQL do grafo: SOMENTE LEITURA, só `db` de withTenant (o RLS isola os tenants). Sem migration: lê city, import_run, import_record e page.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

interface CityRow { id: string; ibge_code: string; name: string; uf: string; region: string | null; population: string | null; population_year: number | null; source_run_id: string }
const toCity = (x: CityRow): StoreCity => ({ id: x.id, ibgeCode: x.ibge_code, name: x.name, uf: x.uf, region: x.region, population: x.population === null ? null : Number(x.population), populationYear: x.population_year, sourceRunId: x.source_run_id });
interface SourceRow { id: string; source_name: string; origin: StoreSource["origin"]; file_name: string; file_sha256: string; status: StoreSource["status"]; imported_at: Date; total_rows: number; accepted_rows: number }
const toSource = (x: SourceRow): StoreSource => ({ runId: x.id, sourceName: x.source_name, origin: x.origin, fileName: x.file_name, fileSha256: x.file_sha256, status: x.status, importedAt: x.imported_at, totalRows: x.total_rows, acceptedRows: x.accepted_rows });
const CITY_COLS = "c.id, c.ibge_code, c.name, c.uf, c.region, c.population, c.population_year, c.source_run_id";
const SOURCE_COLS = "r.id, r.source_name, r.origin, r.file_name, r.file_sha256, r.status, coalesce(r.finished_at, r.started_at) AS imported_at, r.total_rows, r.accepted_rows";
const JOIN_RUN = "JOIN plataforma.import_run r ON r.tenant_id = c.tenant_id AND r.id = c.source_run_id";
const JOIN_PAGE = "LEFT JOIN plataforma.page p ON p.tenant_id = c.tenant_id AND p.entity_kind = 'city' AND p.entity_id = c.id";

export function createSqlGraphStore(db: TenantDb): GraphStore {
  async function aggregate(where: string, param: string): Promise<(StoreAggregate & { empty: boolean }) | undefined> {
    const [n, src] = await Promise.all([
      db.query<{ n: string; n_pop: string; n_page: string }>(`SELECT count(*)::text AS n, count(c.population)::text AS n_pop, count(p.id)::text AS n_page FROM plataforma.city c ${JOIN_PAGE} WHERE ${where}`, [param]),
      db.query<SourceRow>(`SELECT DISTINCT ${SOURCE_COLS} FROM plataforma.city c ${JOIN_RUN} WHERE ${where} ORDER BY imported_at DESC, r.id LIMIT 10`, [param]),
    ]);
    const cities = Number(n.rows[0]!.n);
    if (cities === 0) return undefined;
    return { cities, withPopulation: Number(n.rows[0]!.n_pop), withPage: Number(n.rows[0]!.n_page), sources: src.rows.map(toSource), empty: false };
  }
  return {
    async city(id) {
      const d = await getCityDetail(db, id);
      if (!d) return undefined;
      return {
        city: { ...d.city },
        source: { runId: d.source.runId, sourceName: d.source.sourceName, origin: d.source.origin, fileName: d.source.fileName, fileSha256: d.source.fileSha256, status: d.source.status, importedAt: d.source.finishedAt ?? d.source.startedAt, totalRows: d.source.totalRows, acceptedRows: d.source.acceptedRows },
        record: d.record ? { rowNumber: d.record.rowNumber, outcome: d.record.outcome, raw: d.record.raw } : undefined,
        page: d.page ? { id: d.page.id, path: d.page.path, status: d.page.status, latestVersion: d.page.latestVersion, updatedAt: d.page.updatedAt } : undefined,
      };
    },
    async page(id) {
      if (!UUID.test(id)) return undefined;
      const r = await db.query<CityRow & SourceRow & { page_id: string; path: string; p_status: StorePageLink["status"]; latest_version: number; updated_at: Date; src_id: string }>(
        `SELECT ${CITY_COLS}, p.id AS page_id, p.path, p.status AS p_status, p.latest_version, p.updated_at, r.id AS src_id, r.source_name, r.origin, r.file_name, r.file_sha256, r.status, coalesce(r.finished_at, r.started_at) AS imported_at, r.total_rows, r.accepted_rows
           FROM plataforma.page p JOIN plataforma.city c ON c.tenant_id = p.tenant_id AND c.id = p.entity_id ${JOIN_RUN} WHERE p.id = $1 AND p.entity_kind = 'city'`, [id]);
      const x = r.rows[0];
      if (!x) return undefined;
      return { page: { id: x.page_id, path: x.path, status: x.p_status, latestVersion: x.latest_version, updatedAt: x.updated_at }, city: toCity(x), source: toSource({ ...x, id: x.src_id }) };
    },
    async uf(code) {
      const a = await aggregate("c.uf = $1", code);
      if (!a) return undefined;
      const g = await db.query<{ region: string; n: string }>(`SELECT region, count(*)::text AS n FROM plataforma.city WHERE uf = $1 AND region IS NOT NULL GROUP BY region ORDER BY count(*) DESC, region`, [code]);
      return { cities: a.cities, withPopulation: a.withPopulation, withPage: a.withPage, sources: a.sources, regions: g.rows.map((x) => ({ name: x.region, cities: Number(x.n) })) };
    },
    async region(name) {
      const a = await aggregate("c.region = $1", name);
      if (!a) return undefined;
      const g = await db.query<{ uf: string; n: string }>(`SELECT uf, count(*)::text AS n FROM plataforma.city WHERE region = $1 GROUP BY uf ORDER BY uf`, [name]);
      return { cities: a.cities, withPopulation: a.withPopulation, withPage: a.withPage, sources: a.sources, ufs: g.rows.map((x) => ({ code: x.uf, cities: Number(x.n) })) };
    },
    async topCities(filter, limit) {
      const r = await db.query<CityRow>(`SELECT ${CITY_COLS} FROM plataforma.city c WHERE ($1::text IS NULL OR c.uf = $1) AND ($2::text IS NULL OR c.region = $2) ORDER BY c.population DESC NULLS LAST, c.ibge_code LIMIT $3`, [filter.uf ?? null, filter.region ?? null, limit]);
      return r.rows.map(toCity);
    },
    async search(q, perKind) {
      const n = normalizeSearchText(q);
      const cities = await searchCities(db, { q, limit: perKind });
      const ufCodes = n === "" ? [] : (UFS as readonly string[]).filter((u) => u.toLowerCase().startsWith(n));
      const regionNames = n === "" ? [] : (REGIONS as readonly string[]).filter((g) => normalizeSearchText(g).includes(n));
      const like = n === "" ? null : `%${escapeLike(n)}%`;
      const [ufs, regions, pages, pageTotal] = await Promise.all([
        ufCodes.length ? db.query<{ uf: string; n: string }>(`SELECT uf, count(*)::text AS n FROM plataforma.city WHERE uf = ANY($1::text[]) GROUP BY uf ORDER BY uf`, [ufCodes]) : Promise.resolve({ rows: [] as { uf: string; n: string }[] }),
        regionNames.length ? db.query<{ region: string; n: string }>(`SELECT region, count(*)::text AS n FROM plataforma.city WHERE region = ANY($1::text[]) GROUP BY region ORDER BY region`, [regionNames]) : Promise.resolve({ rows: [] as { region: string; n: string }[] }),
        like ? db.query<{ id: string; path: string; name: string; uf: string }>(`SELECT p.id, p.path, c.name, c.uf FROM plataforma.page p JOIN plataforma.city c ON c.tenant_id = p.tenant_id AND c.id = p.entity_id WHERE p.entity_kind = 'city' AND p.path ILIKE $1 ESCAPE '\\' ORDER BY p.path LIMIT $2`, [like, perKind]) : Promise.resolve({ rows: [] as { id: string; path: string; name: string; uf: string }[] }),
        like ? db.query<{ n: string }>(`SELECT count(*)::text AS n FROM plataforma.page p WHERE p.entity_kind = 'city' AND p.path ILIKE $1 ESCAPE '\\'`, [like]) : Promise.resolve({ rows: [{ n: "0" }] }),
      ]);
      return {
        cities: { rows: cities.rows.map((x) => ({ id: x.id, ibgeCode: x.ibgeCode, name: x.name, uf: x.uf, region: x.region, population: x.population, populationYear: x.populationYear, sourceRunId: x.sourceRunId })), total: cities.total },
        ufs: ufs.rows.map((x) => ({ code: x.uf, cities: Number(x.n) })),
        regions: regions.rows.map((x) => ({ name: x.region, cities: Number(x.n) })),
        pages: { rows: pages.rows.map((x) => ({ id: x.id, path: x.path, cityName: x.name, uf: x.uf })), total: Number(pageTotal.rows[0]!.n) },
      };
    },
  };
}
