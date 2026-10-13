import type { TenantDb } from "../tenant-context";
import type { GateResult } from "./gates";
import type { RenderedPage } from "./city-overview";

// Leitura das páginas e execuções de geração (alimenta as telas). Só `db` de withTenant; o RLS isola os tenants.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GenerationRunSummary {
  readonly id: string; readonly templateKey: string; readonly templateVersion: number; readonly status: "running" | "succeeded" | "partial" | "failed";
  readonly totalItems: number; readonly generatedItems: number; readonly unchangedItems: number; readonly blockedItems: number;
  readonly error: string | null; readonly startedAt: Date; readonly finishedAt: Date | null; readonly createdBy: string;
}
export interface GenerationItemView { readonly entityId: string; readonly outcome: "generated" | "unchanged" | "blocked"; readonly gates: readonly GateResult[]; readonly pageId: string | null; readonly pageVersionId: string | null; readonly error: string | null }
export interface PageSummary { readonly id: string; readonly entityId: string; readonly path: string; readonly status: "draft" | "blocked"; readonly latestVersion: number; readonly updatedAt: Date }
export interface PageVersionView { readonly id: string; readonly version: number; readonly runId: string; readonly contentHash: string; readonly content: RenderedPage; readonly templateKey: string; readonly templateVersion: number; readonly createdAt: Date }

interface RunRow { id: string; template_key: string; template_version: number; status: GenerationRunSummary["status"]; total_items: number; generated_items: number; unchanged_items: number; blocked_items: number; error: string | null; started_at: Date; finished_at: Date | null; created_by: string }

export async function listGenerationRuns(db: TenantDb, options: { limit?: number } = {}): Promise<GenerationRunSummary[]> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 200);
  const r = await db.query<RunRow>(`SELECT id, template_key, template_version, status, total_items, generated_items, unchanged_items, blocked_items, error, started_at, finished_at, created_by FROM plataforma.generation_run ORDER BY started_at DESC, id LIMIT $1`, [limit]);
  return r.rows.map((x) => Object.freeze({ id: x.id, templateKey: x.template_key, templateVersion: x.template_version, status: x.status, totalItems: x.total_items, generatedItems: x.generated_items, unchangedItems: x.unchanged_items, blockedItems: x.blocked_items, error: x.error, startedAt: x.started_at, finishedAt: x.finished_at, createdBy: x.created_by }));
}

export async function listGenerationItems(db: TenantDb, runId: string): Promise<GenerationItemView[]> {
  if (!UUID.test(runId)) return [];
  const r = await db.query<{ entity_id: string; outcome: GenerationItemView["outcome"]; gates: GateResult[]; page_id: string | null; page_version_id: string | null; error: string | null }>(
    `SELECT i.entity_id, i.outcome, i.gates, i.page_id, i.page_version_id, i.error FROM plataforma.generation_item i JOIN plataforma.city c ON c.id = i.entity_id WHERE i.run_id = $1 ORDER BY c.ibge_code`, [runId]);
  return r.rows.map((x) => Object.freeze({ entityId: x.entity_id, outcome: x.outcome, gates: x.gates, pageId: x.page_id, pageVersionId: x.page_version_id, error: x.error }));
}

export async function listPages(db: TenantDb, options: { status?: "draft" | "blocked"; limit?: number } = {}): Promise<PageSummary[]> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 500);
  const r = await db.query<{ id: string; entity_id: string; path: string; status: "draft" | "blocked"; latest_version: number; updated_at: Date }>(
    `SELECT id, entity_id, path, status, latest_version, updated_at FROM plataforma.page WHERE ($1::text IS NULL OR status = $1) ORDER BY path LIMIT $2`, [options.status ?? null, limit]);
  return r.rows.map((x) => Object.freeze({ id: x.id, entityId: x.entity_id, path: x.path, status: x.status, latestVersion: x.latest_version, updatedAt: x.updated_at }));
}

/** Histórico completo de uma página, da versão mais nova para a mais antiga. */
export async function listPageVersions(db: TenantDb, pageId: string): Promise<PageVersionView[]> {
  if (!UUID.test(pageId)) return [];
  const r = await db.query<{ id: string; version: number; run_id: string; content_hash: string; content: RenderedPage; template_key: string; template_version: number; created_at: Date }>(
    `SELECT id, version, run_id, content_hash, content, template_key, template_version, created_at FROM plataforma.page_version WHERE page_id = $1 ORDER BY version DESC`, [pageId]);
  return r.rows.map((x) => Object.freeze({ id: x.id, version: x.version, runId: x.run_id, contentHash: x.content_hash, content: x.content, templateKey: x.template_key, templateVersion: x.template_version, createdAt: x.created_at }));
}

// ---- consultas para a interface (busca, detalhe de página e de execução) ------------------------------------------------------

export interface PageListItem extends PageSummary { readonly cityName: string; readonly uf: string; readonly region: string | null; readonly population: number | null; readonly populationYear: number | null }
export type PageSort = "path" | "updated" | "population";
export interface PageSearch { readonly q?: string; readonly status?: "draft" | "blocked"; readonly uf?: string; readonly sort?: PageSort; readonly dir?: "asc" | "desc"; readonly limit?: number; readonly offset?: number }

const SORT_SQL: Record<PageSort, string> = { path: "p.path", updated: "p.updated_at", population: "c.population" };
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

interface PageListRow { id: string; entity_id: string; path: string; status: "draft" | "blocked"; latest_version: number; updated_at: Date; name: string; uf: string; region: string | null; population: string | null; population_year: number | null }
const toListItem = (x: PageListRow): PageListItem => Object.freeze({ id: x.id, entityId: x.entity_id, path: x.path, status: x.status, latestVersion: x.latest_version, updatedAt: x.updated_at, cityName: x.name, uf: x.uf, region: x.region, population: x.population === null ? null : Number(x.population), populationYear: x.population_year });
const PAGE_COLS = "p.id, p.entity_id, p.path, p.status, p.latest_version, p.updated_at, c.name, c.uf, c.region, c.population, c.population_year";

/** Busca, filtro, ordenação e paginação de páginas (só colunas e direções de uma lista fechada; o texto vai por parâmetro). */
export async function searchPages(db: TenantDb, search: PageSearch = {}): Promise<{ rows: PageListItem[]; total: number }> {
  const limit = Math.min(Math.max(Math.trunc(search.limit ?? 25), 1), 100);
  const offset = Math.max(Math.trunc(search.offset ?? 0), 0);
  const sort = SORT_SQL[search.sort ?? "path"] ?? SORT_SQL.path;
  const dir = search.dir === "desc" ? "DESC" : "ASC";
  const q = (search.q ?? "").trim().slice(0, 80);
  const where = `($1::text IS NULL OR c.name ILIKE $1 ESCAPE '\\' OR p.path ILIKE $1 ESCAPE '\\') AND ($2::text IS NULL OR p.status = $2) AND ($3::text IS NULL OR c.uf = $3)`;
  const params = [q === "" ? null : `%${escapeLike(q)}%`, search.status ?? null, search.uf ? search.uf.toUpperCase() : null];
  const from = `FROM plataforma.page p JOIN plataforma.city c ON c.id = p.entity_id AND c.tenant_id = p.tenant_id`;
  const [rows, count] = await Promise.all([
    db.query<PageListRow>(`SELECT ${PAGE_COLS} ${from} WHERE ${where} ORDER BY ${sort} ${dir} NULLS LAST, p.path LIMIT $4 OFFSET $5`, [...params, limit, offset]),
    db.query<{ n: string }>(`SELECT count(*)::text AS n ${from} WHERE ${where}`, params),
  ]);
  return { rows: rows.rows.map(toListItem), total: Number(count.rows[0]!.n) };
}

export interface LatestAttempt { readonly runId: string; readonly startedAt: Date; readonly outcome: GenerationItemView["outcome"]; readonly gates: readonly GateResult[]; readonly error: string | null }
export interface PageDetail { readonly page: PageListItem; readonly versions: readonly PageVersionView[]; readonly latestAttempt: LatestAttempt | undefined }

/** Detalhe de uma página: dados da cidade de origem, todas as versões e o resultado dos gates da tentativa mais recente. */
export async function getPageDetail(db: TenantDb, pageId: string): Promise<PageDetail | undefined> {
  if (!UUID.test(pageId)) return undefined;
  const p = await db.query<PageListRow>(`SELECT ${PAGE_COLS} FROM plataforma.page p JOIN plataforma.city c ON c.id = p.entity_id AND c.tenant_id = p.tenant_id WHERE p.id = $1`, [pageId]);
  const row = p.rows[0];
  if (!row) return undefined;
  const page = toListItem(row);
  const versions = await listPageVersions(db, pageId);
  const a = await db.query<{ run_id: string; started_at: Date; outcome: GenerationItemView["outcome"]; gates: GateResult[]; error: string | null }>(
    `SELECT i.run_id, r.started_at, i.outcome, i.gates, i.error FROM plataforma.generation_item i JOIN plataforma.generation_run r ON r.id = i.run_id WHERE i.entity_id = $1 ORDER BY r.started_at DESC, i.created_at DESC LIMIT 1`, [page.entityId]);
  const at = a.rows[0];
  return { page, versions, latestAttempt: at ? { runId: at.run_id, startedAt: at.started_at, outcome: at.outcome, gates: at.gates, error: at.error } : undefined };
}

export interface GenerationItemDetail extends GenerationItemView { readonly ibgeCode: string; readonly cityName: string; readonly uf: string; readonly pagePath: string | null }
export interface GenerationRunDetail { readonly run: GenerationRunSummary; readonly scope: Record<string, unknown>; readonly items: readonly GenerationItemDetail[] }

export async function getGenerationRunDetail(db: TenantDb, runId: string): Promise<GenerationRunDetail | undefined> {
  if (!UUID.test(runId)) return undefined;
  const r = await db.query<RunRow & { scope: Record<string, unknown> }>(`SELECT id, template_key, template_version, status, total_items, generated_items, unchanged_items, blocked_items, error, started_at, finished_at, created_by, scope FROM plataforma.generation_run WHERE id = $1`, [runId]);
  const x = r.rows[0];
  if (!x) return undefined;
  const run: GenerationRunSummary = Object.freeze({ id: x.id, templateKey: x.template_key, templateVersion: x.template_version, status: x.status, totalItems: x.total_items, generatedItems: x.generated_items, unchangedItems: x.unchanged_items, blockedItems: x.blocked_items, error: x.error, startedAt: x.started_at, finishedAt: x.finished_at, createdBy: x.created_by });
  const it = await db.query<{ entity_id: string; outcome: GenerationItemView["outcome"]; gates: GateResult[]; page_id: string | null; page_version_id: string | null; error: string | null; ibge_code: string; name: string; uf: string; path: string | null }>(
    `SELECT i.entity_id, i.outcome, i.gates, i.page_id, i.page_version_id, i.error, c.ibge_code, c.name, c.uf, p.path
       FROM plataforma.generation_item i JOIN plataforma.city c ON c.id = i.entity_id LEFT JOIN plataforma.page p ON p.id = i.page_id
      WHERE i.run_id = $1 ORDER BY c.ibge_code`, [runId]);
  const items = it.rows.map((y) => Object.freeze({ entityId: y.entity_id, outcome: y.outcome, gates: y.gates, pageId: y.page_id, pageVersionId: y.page_version_id, error: y.error, ibgeCode: y.ibge_code, cityName: y.name, uf: y.uf, pagePath: y.path }));
  return { run, scope: x.scope, items };
}
