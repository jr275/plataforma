import { createHash } from "node:crypto";
import { classifyCityRows, type CityMapping, type ClassifiedRow } from "./cities";
import { parseCsv, type Delimiter } from "./csv";
import { withTenant, type PoolLike, type TenantDb } from "../tenant-context";
import type { VerifiedIdentity } from "../identity";

// Ciclo de vida de uma importação de cidades (ADR-017): três transações curtas por execução.
//   1. abre `import_run` como `running` e confirma (a execução existe mesmo que o resto falhe);
//   2. grava TODAS as `import_record`, faz o upsert das cidades aceitas e fecha a execução, tudo atômico;
//   3. se algo falhar (arquivo ilegível, mapeamento inválido, erro de banco), outra transação marca `failed` com o erro.
// O tenant vem da identidade verificada (withTenant); o isolamento é do RLS, não de filtros aqui.

export const MAX_IMPORT_ROWS = 20_000;
export type ImportOrigin = "real" | "test" | "manual";
export type ImportStatus = "running" | "succeeded" | "partial" | "failed";

export interface CityImportInput {
  /** Bytes do arquivo (UTF-8). O sha256 é calculado sobre estes bytes. */
  readonly content: Uint8Array;
  readonly fileName: string;
  readonly sourceName: string;
  readonly origin: ImportOrigin;
  readonly mapping: CityMapping;
  readonly delimiter?: Delimiter;
  readonly maxRows?: number;
}

export interface ImportResult {
  readonly runId: string;
  readonly status: Exclude<ImportStatus, "running">;
  readonly total: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly duplicate: number;
  readonly warnings: number;
  readonly error?: string;
}

const EMPTY = { total: 0, accepted: 0, rejected: 0, duplicate: 0, warnings: 0 };

/** Mensagem do erro sem detalhes de conexão nem segredos: só o texto do próprio erro, limitado. */
function safeMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/postgres(ql)?:\/\/\S+/gi, "[url removida]").slice(0, 1000);
}

export async function runCityImport(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, input: CityImportInput): Promise<ImportResult> {
  const sha = createHash("sha256").update(input.content).digest("hex");

  // 1. abre a execução
  const runId = await withTenant(pool, identity, tenantId, async (db) => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO plataforma.import_run (tenant_id, kind, source_name, file_name, file_sha256, origin, mapping, created_by)
       VALUES (plataforma.current_tenant_id(), 'csv', $1, $2, $3, $4, $5::jsonb, $6) RETURNING id`,
      [input.sourceName, input.fileName, sha, input.origin, JSON.stringify(input.mapping), identity.userId],
    );
    return r.rows[0]!.id;
  });

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(input.content);
    const parsed = parseCsv(text, { delimiter: input.delimiter, maxRows: input.maxRows ?? MAX_IMPORT_ROWS });
    const { rows, counts } = classifyCityRows(parsed, input.mapping);

    // 2. grava registros + cidades e fecha, atomicamente
    return await withTenant(pool, identity, tenantId, async (db) => {
      await persist(db, runId, rows);
      const accepted = counts.accepted;
      const status: ImportStatus = accepted === 0 ? "failed" : counts.rejected + counts.duplicate > 0 ? "partial" : "succeeded";
      const error = accepted === 0 ? "nenhuma linha foi aceita" : null;
      await db.query(
        `UPDATE plataforma.import_run SET status = $2, total_rows = $3, accepted_rows = $4, rejected_rows = $5, duplicate_rows = $6, error = $7, finished_at = now() WHERE id = $1`,
        [runId, status, counts.total, counts.accepted, counts.rejected, counts.duplicate, error],
      );
      return { runId, status: status as ImportResult["status"], ...counts, ...(error ? { error } : {}) };
    });
  } catch (e) {
    // 3. marca a falha numa transação separada (a do passo 2, se existiu, foi desfeita)
    const error = safeMessage(e);
    await withTenant(pool, identity, tenantId, async (db) => {
      await db.query(`UPDATE plataforma.import_run SET status = 'failed', error = $2, finished_at = now() WHERE id = $1 AND status = 'running'`, [runId, error]);
    });
    return { runId, status: "failed", ...EMPTY, error };
  }
}

const CHUNK = 1000;

async function persist(db: TenantDb, runId: string, rows: readonly ClassifiedRow[]): Promise<void> {
  const entity = new Map<string, string>(); // ibge_code → city.id
  const accepted = rows.filter((r) => r.city);
  for (let i = 0; i < accepted.length; i += CHUNK) {
    const slice = accepted.slice(i, i + CHUNK).map((r) => ({ ibge_code: r.city!.ibgeCode, name: r.city!.name, uf: r.city!.uf, region: r.city!.region, population: r.city!.population, population_year: r.city!.populationYear }));
    const res = await db.query<{ id: string; ibge_code: string }>(
      `INSERT INTO plataforma.city (tenant_id, ibge_code, name, uf, region, population, population_year, source_run_id)
       SELECT plataforma.current_tenant_id(), x.ibge_code, x.name, x.uf, x.region, x.population, x.population_year, $2
         FROM jsonb_to_recordset($1::jsonb) AS x(ibge_code text, name text, uf text, region text, population bigint, population_year smallint)
       ON CONFLICT (tenant_id, ibge_code) DO UPDATE
         SET name = EXCLUDED.name, uf = EXCLUDED.uf, region = EXCLUDED.region, population = EXCLUDED.population,
             population_year = EXCLUDED.population_year, source_run_id = EXCLUDED.source_run_id
       RETURNING id, ibge_code`,
      [JSON.stringify(slice), runId],
    );
    for (const r of res.rows) entity.set(r.ibge_code, r.id);
  }
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK).map((r) => ({ row_number: r.rowNumber, raw: r.raw, outcome: r.outcome, issues: r.issues, entity_id: r.outcome === "accepted" ? (entity.get(r.city!.ibgeCode) ?? null) : null }));
    await db.query(
      `INSERT INTO plataforma.import_record (tenant_id, run_id, row_number, raw, outcome, issues, entity_id)
       SELECT plataforma.current_tenant_id(), $2, x.row_number, x.raw, x.outcome, x.issues, x.entity_id
         FROM jsonb_to_recordset($1::jsonb) AS x(row_number int, raw jsonb, outcome text, issues jsonb, entity_id uuid)`,
      [JSON.stringify(slice), runId],
    );
  }
}
