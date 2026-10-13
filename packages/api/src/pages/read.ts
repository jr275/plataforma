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
