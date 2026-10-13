import type { TenantDb } from "../tenant-context";
import type { Issue, RowOutcome } from "./cities";
import type { ImportOrigin, ImportStatus } from "./run";

// Leitura do que a importação gravou (alimenta a tela "Fluxo de dados"). Só `db` de withTenant; o RLS isola os tenants.

export interface ImportRunSummary {
  readonly id: string;
  readonly sourceName: string;
  readonly fileName: string;
  readonly fileSha256: string;
  readonly origin: ImportOrigin;
  readonly status: ImportStatus;
  readonly totalRows: number;
  readonly acceptedRows: number;
  readonly rejectedRows: number;
  readonly duplicateRows: number;
  readonly error: string | null;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly createdBy: string;
}

export interface ImportRecordView {
  readonly rowNumber: number;
  readonly raw: Readonly<Record<string, string>>;
  readonly outcome: RowOutcome;
  readonly issues: readonly Issue[];
  readonly entityId: string | null;
}

export interface City {
  readonly id: string;
  readonly ibgeCode: string;
  readonly name: string;
  readonly uf: string;
  readonly region: string | null;
  readonly population: number | null;
  readonly populationYear: number | null;
  readonly sourceRunId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_COLUMNS = "id, source_name, file_name, file_sha256, origin, status, total_rows, accepted_rows, rejected_rows, duplicate_rows, error, started_at, finished_at, created_by";

interface RunRow {
  id: string; source_name: string; file_name: string; file_sha256: string; origin: ImportOrigin; status: ImportStatus;
  total_rows: number; accepted_rows: number; rejected_rows: number; duplicate_rows: number; error: string | null;
  started_at: Date; finished_at: Date | null; created_by: string;
}
const toRun = (r: RunRow): ImportRunSummary => Object.freeze({
  id: r.id, sourceName: r.source_name, fileName: r.file_name, fileSha256: r.file_sha256, origin: r.origin, status: r.status,
  totalRows: r.total_rows, acceptedRows: r.accepted_rows, rejectedRows: r.rejected_rows, duplicateRows: r.duplicate_rows,
  error: r.error, startedAt: r.started_at, finishedAt: r.finished_at, createdBy: r.created_by,
});

/** Execuções do tenant corrente, da mais recente para a mais antiga. */
export async function listImportRuns(db: TenantDb, options: { limit?: number } = {}): Promise<ImportRunSummary[]> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 200);
  const r = await db.query<RunRow>(`SELECT ${RUN_COLUMNS} FROM plataforma.import_run ORDER BY started_at DESC, id LIMIT $1`, [limit]);
  return r.rows.map(toRun);
}

export async function getImportRun(db: TenantDb, id: string): Promise<ImportRunSummary | undefined> {
  if (!UUID.test(id)) return undefined;
  const r = await db.query<RunRow>(`SELECT ${RUN_COLUMNS} FROM plataforma.import_run WHERE id = $1`, [id]);
  return r.rows[0] ? toRun(r.rows[0]) : undefined;
}

/** Registros de uma execução (por padrão, todos), em ordem de linha. */
export async function listImportRecords(db: TenantDb, runId: string, options: { outcome?: RowOutcome; limit?: number; offset?: number } = {}): Promise<ImportRecordView[]> {
  if (!UUID.test(runId)) return [];
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 1000);
  const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
  const r = await db.query<{ row_number: number; raw: Record<string, string>; outcome: RowOutcome; issues: Issue[]; entity_id: string | null }>(
    `SELECT row_number, raw, outcome, issues, entity_id FROM plataforma.import_record
      WHERE run_id = $1 AND ($2::text IS NULL OR outcome = $2) ORDER BY row_number LIMIT $3 OFFSET $4`,
    [runId, options.outcome ?? null, limit, offset],
  );
  return r.rows.map((x) => Object.freeze({ rowNumber: x.row_number, raw: x.raw, outcome: x.outcome, issues: x.issues, entityId: x.entity_id }));
}

interface CityRow { id: string; ibge_code: string; name: string; uf: string; region: string | null; population: string | null; population_year: number | null; source_run_id: string }
/** Cidades do tenant corrente por UF e nome. `population` (bigint) volta como texto do driver e é convertida aqui. */
export async function listCities(db: TenantDb, options: { uf?: string; limit?: number; offset?: number } = {}): Promise<City[]> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 1000);
  const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
  const r = await db.query<CityRow>(
    `SELECT id, ibge_code, name, uf, region, population, population_year, source_run_id FROM plataforma.city
      WHERE ($1::text IS NULL OR uf = $1) ORDER BY uf, name, id LIMIT $2 OFFSET $3`,
    [options.uf ? options.uf.toUpperCase() : null, limit, offset],
  );
  return r.rows.map((x) => Object.freeze({ id: x.id, ibgeCode: x.ibge_code, name: x.name, uf: x.uf, region: x.region, population: x.population === null ? null : Number(x.population), populationYear: x.population_year, sourceRunId: x.source_run_id }));
}

export async function countCities(db: TenantDb): Promise<number> {
  const r = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM plataforma.city`);
  return Number(r.rows[0]!.n);
}
