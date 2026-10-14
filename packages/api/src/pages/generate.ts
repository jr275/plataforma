import type { VerifiedIdentity } from "../identity";
import type { City } from "../ingest/read";
import { UFS } from "../ingest/cities";
import { withTenant, type PoolLike, type TenantDb } from "../tenant-context";
import { CITY_OVERVIEW, cityPath, templateHash, type CityTemplate } from "./city-overview";
import { GATES, evaluateCity, type ExistingPage, type GateResult, type GenerationContext, type ItemEvaluation } from "./gates";

// Geração de páginas de cidade em lote (ADR-020). Três transações por execução, como a importação (ADR-017):
//   1. abre `generation_run` como `running` e confirma;
//   2. avalia TODAS as cidades (render + 6 gates), grava um `generation_item` por cidade, as páginas `draft` e as versões novas, e fecha;
//   3. se a execução falhar, outra transação a marca `failed` (reprocessar é seguro: a idempotência é por hash de conteúdo).
// Cada item persiste dentro de um SAVEPOINT: a falha de um não afeta os demais. Nada é publicado: todas as páginas ficam `draft`.

export const MAX_GENERATION_ITEMS = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Prazo padrão (minutos) depois do qual uma execução ainda em `running` é considerada abandonada. */
export const DEFAULT_STALE_AFTER_MINUTES = 15;
/** Critério de ACEITE do lote piloto (não uma proibição: reprocessar uma única página continua permitido). */
export const PILOT_MIN_VALID = 10;

/** O escopo pede cidades que não existem neste tenant. Lançado ANTES de abrir a execução: nada foi gravado. */
export class GenerationScopeError extends Error {
  readonly code = "GENERATION_SCOPE";
  readonly missingIds: readonly string[];
  constructor(missingIds: readonly string[]) {
    super(`o escopo cita ${missingIds.length} cidade(s) que não existe(m) neste tenant: ${missingIds.join(", ")}`);
    this.name = "GenerationScopeError";
    this.missingIds = missingIds;
  }
}

/** Já existe uma execução de geração em andamento neste tenant. Nada foi gravado; tente de novo quando ela terminar. */
export class GenerationBusyError extends Error {
  readonly code = "GENERATION_BUSY";
  readonly activeRunId: string;
  constructor(activeRunId: string) {
    super(`já existe uma execução de geração em andamento neste tenant (${activeRunId}); aguarde ela terminar e tente de novo`);
    this.name = "GenerationBusyError";
    this.activeRunId = activeRunId;
  }
}

export type GenerationScope = { readonly uf: string; readonly limit: number } | { readonly cityIds: readonly string[] };

export interface GenerationInput {
  readonly scope: GenerationScope;
  /** Caminhos que existem no site (hubs, por exemplo). Sem destino, o render não emite link. */
  readonly knownPaths?: readonly string[];
  readonly template?: CityTemplate;
  /** Links internos candidatos (ex.: os configurados no editor); só os que apontam para caminhos conhecidos são emitidos. Sem isso, valem os padrões do template. */
  readonly linkCandidates?: readonly { readonly path: string; readonly text: string }[];
  /** Minutos sem fechamento a partir dos quais uma execução em `running` é abandonada (padrão 15). */
  readonly staleAfterMinutes?: number;
  /** SÓ PARA TESTES: injeta falhas para provar o isolamento por item e o reprocessamento. */
  readonly faults?: { readonly item?: (cityId: string) => void | Promise<void>; readonly close?: () => void | Promise<void> };
}

export interface GenerationItemSummary { readonly cityId: string; readonly ibgeCode: string; readonly outcome: "generated" | "unchanged" | "blocked"; readonly failedGates: readonly string[]; readonly error?: string }
export interface GenerationResult {
  readonly runId: string;
  readonly status: "succeeded" | "partial" | "failed";
  readonly total: number;
  readonly generated: number;
  readonly unchanged: number;
  readonly blocked: number;
  readonly items: readonly GenerationItemSummary[];
  readonly error?: string;
}

function validateScope(scope: GenerationScope): void {
  if ("cityIds" in scope) {
    if (scope.cityIds.length < 1 || scope.cityIds.length > MAX_GENERATION_ITEMS || scope.cityIds.some((i) => !UUID.test(i))) throw new TypeError(`cityIds deve ter de 1 a ${MAX_GENERATION_ITEMS} UUIDs`);
    return;
  }
  if (!(UFS as readonly string[]).includes(scope.uf)) throw new TypeError("UF inválida");
  if (!Number.isInteger(scope.limit) || scope.limit < 1 || scope.limit > MAX_GENERATION_ITEMS) throw new TypeError(`limit deve ser inteiro de 1 a ${MAX_GENERATION_ITEMS}`);
}

export function meetsPilotAcceptance(r: Pick<GenerationResult, "generated" | "unchanged">): boolean {
  return r.generated + r.unchanged >= PILOT_MIN_VALID;
}

/**
 * Recuperação de execuções ABANDONADAS (processo que morreu entre abrir e fechar). Regra: `running` + `started_at` mais antigo que o
 * prazo => `failed` com motivo "abandonada". Transições de estado: running -> succeeded | partial | failed (terminais); o fechamento
 * só vale se a execução ainda está `running`, então uma execução abandonada que volta a andar NÃO consegue fechar nem gravar.
 */
export async function recoverStaleGenerationRuns(db: TenantDb, staleAfterMinutes: number = DEFAULT_STALE_AFTER_MINUTES): Promise<string[]> {
  if (!Number.isInteger(staleAfterMinutes) || staleAfterMinutes < 1) throw new TypeError("staleAfterMinutes deve ser inteiro >= 1");
  const r = await db.query<{ id: string }>(
    `UPDATE plataforma.generation_run
        SET status = 'failed', finished_at = now(), error = 'abandonada: sem fechamento em ' || $1::text || ' minutos'
      WHERE status = 'running' AND started_at < now() - make_interval(mins => $1)
      RETURNING id`, [staleAfterMinutes]);
  return r.rows.map((x) => x.id);
}

const safeMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/postgres(ql)?:\/\/\S+/gi, "[url removida]").slice(0, 1000);

interface Candidate { readonly city: City; readonly run: { id: string; sourceName: string; origin: "real" | "test" | "manual"; status: "running" | "succeeded" | "partial" | "failed"; fileSha256: string; finishedAt: Date | null } }
interface CandidateRow { id: string; ibge_code: string; name: string; uf: string; region: string | null; population: string | null; population_year: number | null; source_run_id: string; r_source: string; r_origin: "real" | "test" | "manual"; r_status: "running" | "succeeded" | "partial" | "failed"; r_sha: string; r_finished: Date | null }

const CAND_SELECT = `SELECT c.id, c.ibge_code, c.name, c.uf, c.region, c.population, c.population_year, c.source_run_id,
       r.source_name AS r_source, r.origin AS r_origin, r.status AS r_status, r.file_sha256 AS r_sha, r.finished_at AS r_finished
  FROM plataforma.city c JOIN plataforma.import_run r ON r.id = c.source_run_id`;

/** Seleção determinística: por UF, as maiores populações (empate pelo código IBGE); ou por lista explícita. */
export async function selectCandidates(db: TenantDb, scope: GenerationScope): Promise<Candidate[]> {
  validateScope(scope);
  const rows = "cityIds" in scope
    ? (await db.query<CandidateRow>(`${CAND_SELECT} WHERE c.id = ANY($1::uuid[]) ORDER BY c.ibge_code`, [[...scope.cityIds]])).rows
    : (await db.query<CandidateRow>(`${CAND_SELECT} WHERE c.uf = $1 ORDER BY c.population DESC NULLS LAST, c.ibge_code LIMIT $2`, [scope.uf, scope.limit])).rows;
  return rows.map((x) => ({
    city: { id: x.id, ibgeCode: x.ibge_code, name: x.name, uf: x.uf, region: x.region, population: x.population === null ? null : Number(x.population), populationYear: x.population_year, sourceRunId: x.source_run_id },
    run: { id: x.source_run_id, sourceName: x.r_source, origin: x.r_origin, status: x.r_status, fileSha256: x.r_sha, finishedAt: x.r_finished },
  }));
}

async function loadContext(db: TenantDb, candidates: readonly Candidate[], template: CityTemplate, knownPaths: readonly string[], linkCandidates?: readonly { path: string; text: string }[]): Promise<GenerationContext> {
  const ids = candidates.map((c) => c.city.id);
  const existing = new Map<string, ExistingPage>();
  const pages = await db.query<{ id: string; version_id: string; entity_id: string; path: string; status: "draft" | "blocked"; latest_version: number; content_hash: string }>(
    `SELECT p.id, pv.id AS version_id, p.entity_id, p.path, p.status, p.latest_version, pv.content_hash
       FROM plataforma.page p JOIN plataforma.page_version pv ON pv.page_id = p.id AND pv.version = p.latest_version
      WHERE p.entity_id = ANY($1::uuid[])`, [ids]);
  for (const r of pages.rows) existing.set(r.entity_id, { id: r.id, versionId: r.version_id, path: r.path, status: r.status, latestVersion: r.latest_version, latestHash: r.content_hash });

  // Donos de caminho, título e meta entre as páginas que NÃO são do lote (as do lote entram conforme são avaliadas).
  const paths = candidates.map((c) => cityPath(c.city.uf, c.city.name));
  const owners = await db.query<{ path: string; entity_id: string }>(`SELECT path, entity_id FROM plataforma.page WHERE path = ANY($1::text[])`, [paths]);
  const pathOwners = new Map(owners.rows.map((r) => [r.path, r.entity_id]));
  const titleOwners = new Map<string, string>();
  const metaOwners = new Map<string, string>();
  const meta = await db.query<{ entity_id: string; title: string; meta: string }>(
    `SELECT p.entity_id, pv.content->>'title' AS title, pv.content->>'metaDescription' AS meta
       FROM plataforma.page p JOIN plataforma.page_version pv ON pv.page_id = p.id AND pv.version = p.latest_version
      WHERE p.entity_id <> ALL($1::uuid[])`, [ids]);
  for (const r of meta.rows) { titleOwners.set(r.title, r.entity_id); metaOwners.set(r.meta, r.entity_id); }
  return { template, knownPaths: new Set(knownPaths), pathOwners, titleOwners, metaOwners, existingByEntity: existing, ...(linkCandidates ? { linkCandidates } : {}) };
}

function isUniqueViolation(e: unknown, constraint: string): boolean {
  const x = e as { code?: string; constraint?: string; cause?: unknown } | null;
  if (!x) return false;
  if (x.code === "23505" && x.constraint === constraint) return true;
  return x.cause !== undefined && x.cause !== e ? isUniqueViolation(x.cause, constraint) : false;
}

const gatesJson = (g: readonly GateResult[]): string => JSON.stringify(g);

export async function runGeneration(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, input: GenerationInput): Promise<GenerationResult> {
  validateScope(input.scope);
  const template = input.template ?? CITY_OVERVIEW;
  const knownPaths = input.knownPaths ?? [];

  // 0. Pré-voo (uma transação curta): recupera execuções abandonadas e confere que TODOS os ids pedidos existem neste tenant.
  const staleAfter = input.staleAfterMinutes ?? DEFAULT_STALE_AFTER_MINUTES;
  const missing = await withTenant(pool, identity, tenantId, async (db) => {
    await recoverStaleGenerationRuns(db, staleAfter);
    if (!("cityIds" in input.scope)) return [] as string[];
    const found = await db.query<{ id: string }>(`SELECT id FROM plataforma.city WHERE id = ANY($1::uuid[])`, [[...input.scope.cityIds]]);
    const have = new Set(found.rows.map((x) => x.id.toLowerCase()));
    return input.scope.cityIds.filter((i) => !have.has(i.toLowerCase()));
  });
  if (missing.length > 0) throw new GenerationScopeError(missing);

  // 1. Abre a execução. O índice parcial (0007) permite uma só em andamento por tenant: a segunda é recusada com erro claro.
  let runId: string;
  try {
    runId = await withTenant(pool, identity, tenantId, async (db) => {
      const r = await db.query<{ id: string }>(
        `INSERT INTO plataforma.generation_run (tenant_id, template_key, template_version, template_hash, scope, created_by)
         VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4::jsonb, $5) RETURNING id`,
        [template.key, template.version, templateHash(template), JSON.stringify(input.scope), identity.userId]);
      return r.rows[0]!.id;
    });
  } catch (e) {
    if (isUniqueViolation(e, "generation_run_one_running_idx")) {
      const active = await withTenant(pool, identity, tenantId, async (db) => (await db.query<{ id: string }>(`SELECT id FROM plataforma.generation_run WHERE status = 'running' LIMIT 1`)).rows[0]?.id);
      throw new GenerationBusyError(active ?? "desconhecida");
    }
    throw e;
  }

  try {
    return await withTenant(pool, identity, tenantId, async (db) => {
      const candidates = await selectCandidates(db, input.scope);
      if (candidates.length === 0) throw new Error("nenhuma cidade selecionada");
      const ctx = await loadContext(db, candidates, template, knownPaths, input.linkCandidates);
      const ordered = [...candidates].sort((a, b) => (a.city.ibgeCode < b.city.ibgeCode ? -1 : 1)); // primeira ocorrência vale, de forma determinística
      const items: GenerationItemSummary[] = [];
      let n = 0;

      for (const c of ordered) {
        const ev = evaluateCity(c.city, c.run, ctx);
        const sp = `item_${++n}`;
        await db.query(`SAVEPOINT ${sp}`);
        try {
          if (input.faults?.item) await input.faults.item(c.city.id);
          const persisted = await persistItem(db, runId, c.city, ev);
          await db.query(`RELEASE SAVEPOINT ${sp}`);
          if (ev.outcome !== "blocked" && ev.page) { // reserva caminho, título e meta para os próximos itens do lote
            ctx.pathOwners.set(ev.page.path, c.city.id); ctx.titleOwners.set(ev.page.title, c.city.id); ctx.metaOwners.set(ev.page.metaDescription, c.city.id);
          }
          items.push({ cityId: c.city.id, ibgeCode: c.city.ibgeCode, outcome: persisted, failedGates: ev.gates.filter((g) => g.outcome === "fail").map((g) => g.gate) });
        } catch (e) {
          await db.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          await db.query(`RELEASE SAVEPOINT ${sp}`);
          const error = safeMessage(e);
          await db.query(
            `INSERT INTO plataforma.generation_item (tenant_id, run_id, entity_id, outcome, gates, page_id, error) VALUES (plataforma.current_tenant_id(), $1, $2, 'blocked', $3::jsonb, $4, $5)`,
            [runId, c.city.id, gatesJson(ev.gates), ev.existing?.id ?? null, error]);
          items.push({ cityId: c.city.id, ibgeCode: c.city.ibgeCode, outcome: "blocked", failedGates: ev.gates.filter((g) => g.outcome === "fail").map((g) => g.gate), error });
        }
      }

      if (input.faults?.close) await input.faults.close();
      const count = (o: GenerationItemSummary["outcome"]) => items.filter((i) => i.outcome === o).length;
      const generated = count("generated"), unchanged = count("unchanged"), blocked = count("blocked");
      const status = generated + unchanged === 0 ? "failed" : blocked > 0 ? "partial" : "succeeded";
      const error = status === "failed" ? "nenhum item foi gerado nem confirmado como inalterado" : null;
      const closed = await db.query(
        `UPDATE plataforma.generation_run SET status = $2, total_items = $3, generated_items = $4, unchanged_items = $5, blocked_items = $6, error = $7, finished_at = now() WHERE id = $1 AND status = 'running'`,
        [runId, status, items.length, generated, unchanged, blocked, error]);
      // Se a execução já foi encerrada (abandonada e recuperada por outra), NADA do que esta fez pode valer: desfaz a transação inteira.
      if (closed.rowCount !== 1) throw new Error("execução abandonada: já foi encerrada por outra execução; nada foi gravado");
      return { runId, status: status as GenerationResult["status"], total: items.length, generated, unchanged, blocked, items, ...(error ? { error } : {}) };
    });
  } catch (e) {
    const error = safeMessage(e);
    await withTenant(pool, identity, tenantId, async (db) => {
      await db.query(`UPDATE plataforma.generation_run SET status = 'failed', error = $2, finished_at = now() WHERE id = $1 AND status = 'running'`, [runId, error]);
    });
    return { runId, status: "failed", total: 0, generated: 0, unchanged: 0, blocked: 0, items: [], error };
  }
}

/** Grava o item e o que ele implica (página, versão). Devolve o desfecho efetivo. */
async function persistItem(db: TenantDb, runId: string, city: City, ev: ItemEvaluation): Promise<"generated" | "unchanged" | "blocked"> {
  let pageId: string | null = ev.existing?.id ?? null;
  let versionId: string | null = null;

  if (ev.outcome === "generated" && ev.page) {
    const page = ev.page;
    let version = 1;
    if (ev.existing) {
      version = ev.existing.latestVersion + 1;
      await db.query(`UPDATE plataforma.page SET latest_version = $2, status = 'draft' WHERE id = $1`, [ev.existing.id, version]);
    } else {
      const p = await db.query<{ id: string }>(
        `INSERT INTO plataforma.page (tenant_id, entity_kind, entity_id, path, latest_version, status) VALUES (plataforma.current_tenant_id(), 'city', $1, $2, 1, 'draft') RETURNING id`,
        [city.id, page.path]);
      pageId = p.rows[0]!.id;
    }
    const v = await db.query<{ id: string }>(
      `INSERT INTO plataforma.page_version (tenant_id, page_id, version, run_id, content, content_hash, template_key, template_version, template_hash)
       VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4::jsonb, $5, $6, $7, $8) RETURNING id`,
      [pageId, version, runId, JSON.stringify(page), page.contentHash, page.template.key, page.template.version, page.template.hash]);
    versionId = v.rows[0]!.id;
  } else if (ev.outcome === "unchanged" && ev.existing) {
    versionId = ev.existing.versionId;
    if (ev.existing.status === "blocked") await db.query(`UPDATE plataforma.page SET status = 'draft' WHERE id = $1`, [ev.existing.id]);
  } else if (ev.outcome === "blocked" && ev.existing && ev.existing.status !== "blocked") {
    await db.query(`UPDATE plataforma.page SET status = 'blocked' WHERE id = $1`, [ev.existing.id]);
  }

  await db.query(
    `INSERT INTO plataforma.generation_item (tenant_id, run_id, entity_id, outcome, gates, page_id, page_version_id) VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4::jsonb, $5, $6)`,
    [runId, city.id, ev.outcome, gatesJson(ev.gates), pageId, versionId]);
  return ev.outcome;
}

export { GATES };
