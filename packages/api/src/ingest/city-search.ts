import type { TenantDb } from "../tenant-context";
import type { Issue, RowOutcome } from "./cities";
import type { City, ImportRecordView } from "./read";
import type { ImportOrigin, ImportStatus } from "./run";

// Entidades reais (cidades) e a proveniência da importação, para as telas. SOMENTE LEITURA: nenhuma função daqui escreve. Só `db` de
// withTenant; o RLS isola os tenants. Relações (UF, região) vêm apenas das colunas da própria fonte: nada é inferido nem inventado.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CitySort = "name" | "population" | "ibge";
export interface CitySearch { readonly q?: string; readonly uf?: string; readonly hasPage?: boolean; readonly sort?: CitySort; readonly dir?: "asc" | "desc"; readonly limit?: number; readonly offset?: number }
export interface CityListItem extends City {
  readonly sourceName: string;
  readonly sourceOrigin: ImportOrigin;
  readonly pageId: string | null;
  readonly pagePath: string | null;
  readonly pageStatus: "draft" | "blocked" | null;
}

/** Texto de busca normalizado: sem acento, minúsculo, espaços colapsados, no máximo 80 caracteres. */
export function normalizeSearchText(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
}
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

// Mesma normalização no SQL, sem extensão: troca as letras acentuadas (minúsculas e maiúsculas, para não depender do locale do banco).
const FROM = "áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ";
const TO = "aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN";
const NORM_NAME = `lower(translate(c.name, '${FROM}', '${TO}'))`;
const SORT_SQL: Record<CitySort, string> = { name: NORM_NAME, population: "c.population", ibge: "c.ibge_code" };

interface CityListRow {
  id: string; ibge_code: string; name: string; uf: string; region: string | null; population: string | null; population_year: number | null; source_run_id: string;
  source_name: string; origin: ImportOrigin; page_id: string | null; page_path: string | null; page_status: "draft" | "blocked" | null;
}
const toItem = (x: CityListRow): CityListItem => Object.freeze({
  id: x.id, ibgeCode: x.ibge_code, name: x.name, uf: x.uf, region: x.region, population: x.population === null ? null : Number(x.population), populationYear: x.population_year, sourceRunId: x.source_run_id,
  sourceName: x.source_name, sourceOrigin: x.origin, pageId: x.page_id, pagePath: x.page_path, pageStatus: x.page_status,
});
const FROM_JOINS = `FROM plataforma.city c
  JOIN plataforma.import_run r ON r.tenant_id = c.tenant_id AND r.id = c.source_run_id
  LEFT JOIN plataforma.page p ON p.tenant_id = c.tenant_id AND p.entity_kind = 'city' AND p.entity_id = c.id`;

/** Busca, filtro, ordenação e paginação de cidades (colunas e direções de uma lista fechada; o texto vai por parâmetro). */
export async function searchCities(db: TenantDb, search: CitySearch = {}): Promise<{ rows: CityListItem[]; total: number }> {
  const limit = Math.min(Math.max(Math.trunc(search.limit ?? 25), 1), 100);
  const offset = Math.max(Math.trunc(search.offset ?? 0), 0);
  const sort = SORT_SQL[search.sort ?? "name"] ?? SORT_SQL.name;
  const dir = search.dir === "desc" ? "DESC" : "ASC";
  const q = normalizeSearchText(search.q ?? "");
  const digits = /^\d+$/.test(q);
  // dígitos: prefixo do código IBGE; senão, trecho do nome normalizado
  const where = `($1::text IS NULL OR ($4::boolean AND c.ibge_code LIKE $1 ESCAPE '\\') OR (NOT $4::boolean AND ${NORM_NAME} LIKE $1 ESCAPE '\\'))
    AND ($2::text IS NULL OR c.uf = $2) AND ($3::boolean IS NULL OR (p.id IS NOT NULL) = $3)`;
  const like = q === "" ? null : digits ? `${escapeLike(q)}%` : `%${escapeLike(q)}%`;
  const params = [like, search.uf ? search.uf.toUpperCase() : null, search.hasPage ?? null, digits];
  const [rows, count] = await Promise.all([
    db.query<CityListRow>(
      `SELECT c.id, c.ibge_code, c.name, c.uf, c.region, c.population, c.population_year, c.source_run_id, r.source_name, r.origin, p.id AS page_id, p.path AS page_path, p.status AS page_status
         ${FROM_JOINS} WHERE ${where} ORDER BY ${sort} ${dir} NULLS LAST, c.ibge_code LIMIT $5 OFFSET $6`,
      [...params, limit, offset]),
    db.query<{ n: string }>(`SELECT count(*)::text AS n ${FROM_JOINS} WHERE ${where}`, params),
  ]);
  return { rows: rows.rows.map(toItem), total: Number(count.rows[0]!.n) };
}

export interface CitySource {
  readonly runId: string; readonly sourceName: string; readonly origin: ImportOrigin; readonly fileName: string; readonly fileSha256: string;
  readonly status: ImportStatus; readonly totalRows: number; readonly acceptedRows: number; readonly startedAt: Date; readonly finishedAt: Date | null;
}
export interface CityPageLink { readonly id: string; readonly path: string; readonly status: "draft" | "blocked"; readonly latestVersion: number; readonly updatedAt: Date }
export interface CityRelations {
  readonly uf: { readonly code: string; readonly cityCount: number };
  readonly region: { readonly name: string; readonly cityCount: number } | undefined;
}
export interface CityDetail { readonly city: City; readonly source: CitySource; readonly record: ImportRecordView | undefined; readonly page: CityPageLink | undefined; readonly relations: CityRelations }

/** Uma cidade com a origem da importação, a linha original recebida, a página gerada (se houver) e as relações derivadas da fonte. */
export async function getCityDetail(db: TenantDb, id: string): Promise<CityDetail | undefined> {
  if (!UUID.test(id)) return undefined;
  const c = await db.query<CityListRow & { r_file: string; r_sha: string; r_status: ImportStatus; r_total: number; r_accepted: number; r_started: Date; r_finished: Date | null }>(
    `SELECT c.id, c.ibge_code, c.name, c.uf, c.region, c.population, c.population_year, c.source_run_id, r.source_name, r.origin,
            NULL::uuid AS page_id, NULL::text AS page_path, NULL::text AS page_status,
            r.file_name AS r_file, r.file_sha256 AS r_sha, r.status AS r_status, r.total_rows AS r_total, r.accepted_rows AS r_accepted, r.started_at AS r_started, r.finished_at AS r_finished
       FROM plataforma.city c JOIN plataforma.import_run r ON r.tenant_id = c.tenant_id AND r.id = c.source_run_id WHERE c.id = $1`, [id]);
  const x = c.rows[0];
  if (!x) return undefined;
  const item = toItem(x);
  const city: City = { id: item.id, ibgeCode: item.ibgeCode, name: item.name, uf: item.uf, region: item.region, population: item.population, populationYear: item.populationYear, sourceRunId: item.sourceRunId };
  const [rec, pg, rel] = await Promise.all([
    db.query<{ row_number: number; raw: Record<string, string>; outcome: RowOutcome; issues: Issue[]; entity_id: string | null }>(
      `SELECT row_number, raw, outcome, issues, entity_id FROM plataforma.import_record WHERE run_id = $1 AND entity_id = $2 ORDER BY row_number LIMIT 1`, [x.source_run_id, id]),
    db.query<{ id: string; path: string; status: "draft" | "blocked"; latest_version: number; updated_at: Date }>(
      `SELECT id, path, status, latest_version, updated_at FROM plataforma.page WHERE entity_kind = 'city' AND entity_id = $1`, [id]),
    db.query<{ uf_n: string; region_n: string }>(
      `SELECT count(*) FILTER (WHERE uf = $1)::text AS uf_n, count(*) FILTER (WHERE $2::text IS NOT NULL AND region = $2)::text AS region_n FROM plataforma.city`, [x.uf, x.region]),
  ]);
  const r0 = rec.rows[0];
  const p0 = pg.rows[0];
  return {
    city,
    source: Object.freeze({ runId: x.source_run_id, sourceName: x.source_name, origin: x.origin, fileName: x.r_file, fileSha256: x.r_sha, status: x.r_status, totalRows: x.r_total, acceptedRows: x.r_accepted, startedAt: x.r_started, finishedAt: x.r_finished }),
    record: r0 ? Object.freeze({ rowNumber: r0.row_number, raw: r0.raw, outcome: r0.outcome, issues: r0.issues, entityId: r0.entity_id }) : undefined,
    page: p0 ? Object.freeze({ id: p0.id, path: p0.path, status: p0.status, latestVersion: p0.latest_version, updatedAt: p0.updated_at }) : undefined,
    relations: Object.freeze({ uf: { code: x.uf, cityCount: Number(rel.rows[0]!.uf_n) }, region: x.region ? { name: x.region, cityCount: Number(rel.rows[0]!.region_n) } : undefined }),
  };
}
