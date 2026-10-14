import type { TenantDb } from "../tenant-context";
import { RunBudget, BudgetExceededError } from "./budget";
import { cacheKeyFor, providerError, type Provenance, type ProviderErrorCode, type ProviderResult } from "./contract";

// Persistência dos dados de provedores (ADR-027, migration 0011). Sempre dentro de `withTenant`: RLS decide o tenant, nunca o parâmetro.
export interface CallRecord { readonly id: string; readonly provider: string; readonly endpoint: string; readonly params: Record<string, unknown>; readonly cacheKey: string; readonly outcome: "ok" | "provider_error"; readonly costUsd: number; readonly response: unknown; readonly collectedAt: Date; readonly expiresAt: Date | null; readonly runId: string | null }
interface CallRow { id: string; provider: string; endpoint: string; params: Record<string, unknown>; cache_key: string; outcome: "ok" | "provider_error"; cost_usd: string; response: unknown; collected_at: Date; expires_at: Date | null; run_id: string | null }
const toCall = (r: CallRow): CallRecord => ({ id: r.id, provider: r.provider, endpoint: r.endpoint, params: r.params, cacheKey: r.cache_key, outcome: r.outcome, costUsd: Number(r.cost_usd), response: r.response, collectedAt: r.collected_at, expiresAt: r.expires_at, runId: r.run_id });
const CALL_COLS = "id, provider, endpoint, params, cache_key, outcome, cost_usd, response, collected_at, expires_at, run_id";

/** A resposta bruta mais recente, ainda válida em `now`, para a mesma chamada (mesma chave determinística). Erros nunca são reaproveitados. */
export async function findCachedCall(db: TenantDb, cacheKey: string, now: Date): Promise<CallRecord | null> {
  const r = await db.query<CallRow>(`SELECT ${CALL_COLS} FROM plataforma.provider_call WHERE cache_key = $1 AND outcome = 'ok' AND (expires_at IS NULL OR expires_at > $2) ORDER BY collected_at DESC LIMIT 1`, [cacheKey, now]);
  return r.rows[0] ? toCall(r.rows[0]) : null;
}
export async function recordCall(db: TenantDb, c: { provider: string; endpoint: string; params: Record<string, unknown>; cacheKey: string; runId: string | null; outcome: "ok" | "provider_error"; httpStatus?: number | null; errorCode?: string | null; costUsd: number; response: unknown; collectedAt: Date; ttlMs: number | null; actor: string }): Promise<CallRecord> {
  const expires = c.ttlMs === null ? null : new Date(c.collectedAt.getTime() + c.ttlMs);
  const r = await db.query<CallRow>(
    `INSERT INTO plataforma.provider_call (tenant_id, run_id, provider, endpoint, params, cache_key, outcome, http_status, error_code, cost_usd, response, collected_at, expires_at, created_by)
     VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13) RETURNING ${CALL_COLS}`,
    [c.runId, c.provider, c.endpoint, JSON.stringify(c.params), c.cacheKey, c.outcome, c.httpStatus ?? null, c.errorCode ?? null, c.costUsd, c.outcome === "ok" ? JSON.stringify(c.response) : null, c.collectedAt, expires, c.actor]);
  return toCall(r.rows[0]!);
}

/** Gasto gravado do tenant (todas as execuções), opcionalmente por provedor: base do teto global da unidade. */
export async function spentUsd(db: TenantDb, provider?: string): Promise<number> {
  const r = await db.query<{ s: string | null }>(`SELECT sum(cost_usd) AS s FROM plataforma.provider_call WHERE ($1::text IS NULL OR provider = $1)`, [provider ?? null]);
  return Number(r.rows[0]?.s ?? 0);
}
export interface RunCost { readonly provider: string; readonly requests: number; readonly errors: number; readonly costUsd: number }
/** Custo por execução, por provedor (só as requisições reais; respostas do cache não geram linha). */
export async function costByRun(db: TenantDb, runId: string): Promise<RunCost[]> {
  const r = await db.query<{ provider: string; n: string; e: string; c: string }>(`SELECT provider, count(*) AS n, count(*) FILTER (WHERE outcome = 'provider_error') AS e, coalesce(sum(cost_usd), 0) AS c FROM plataforma.provider_call WHERE run_id = $1 GROUP BY provider ORDER BY provider`, [runId]);
  return r.rows.map((x) => ({ provider: x.provider, requests: Number(x.n), errors: Number(x.e), costUsd: Number(x.c) }));
}

export interface LastCall { readonly provider: string; readonly outcome: "ok" | "provider_error"; readonly errorCode: string | null; readonly httpStatus: number | null; readonly at: Date }
/** A chamada mais recente de cada provedor (para o painel de integrações): o que foi OBSERVADO, não o que está configurado. */
export async function lastCallPerProvider(db: TenantDb): Promise<LastCall[]> {
  const r = await db.query<{ provider: string; outcome: "ok" | "provider_error"; error_code: string | null; http_status: number | null; collected_at: Date }>(`SELECT DISTINCT ON (provider) provider, outcome, error_code, http_status, collected_at FROM plataforma.provider_call ORDER BY provider, collected_at DESC`);
  return r.rows.map((x) => ({ provider: x.provider, outcome: x.outcome, errorCode: x.error_code, httpStatus: x.http_status, at: x.collected_at }));
}

export interface Fetched { readonly body: unknown; readonly costUsd: number; readonly httpStatus: number }
export class ProviderCallError extends Error { constructor(readonly code: ProviderErrorCode, message: string, readonly retryable = false, readonly httpStatus: number | null = null, readonly costUsd = 0) { super(message); this.name = "ProviderCallError"; } }
export interface CallArgs { readonly db: TenantDb; readonly provider: string; readonly endpoint: string; readonly params: Record<string, unknown>; readonly ttlMs: number | null; readonly budget: RunBudget; readonly runId: string | null; readonly actor: string; readonly now: () => Date; /** Pior caso de custo do endpoint, para a reserva do teto (0 se gratuito). */ readonly estimateUsd?: number; readonly fetchRaw: () => Promise<Fetched> }

/**
 * Executor único das chamadas: cache (por chave determinística) → reserva de orçamento → requisição → gravação da resposta bruta e do custo.
 * Devolve a resposta BRUTA com proveniência; os parsers de cada adapter normalizam. Falha vira `provider_error` (e é registrada); nada é inventado.
 */
export async function callProvider(a: CallArgs): Promise<ProviderResult<unknown>> {
  const cacheKey = cacheKeyFor(a.provider, a.endpoint, a.params);
  const now = a.now();
  const hit = await findCachedCall(a.db, cacheKey, now);
  const prov = (c: CallRecord, cached: boolean): Provenance => ({ provider: a.provider, endpoint: a.endpoint, params: a.params, collectedAt: c.collectedAt, costUsd: cached ? 0 : c.costUsd, cacheKey, cached, callId: c.id });
  if (hit) return { state: "ok", data: hit.response, provenance: prov(hit, true) };
  try { a.budget.reserve(a.estimateUsd ?? 0); } catch (e) {
    if (e instanceof BudgetExceededError) return providerError(a.provider, "budget_exceeded", e.message);
    throw e;
  }
  try {
    const f = await a.fetchRaw();
    a.budget.settle(f.costUsd);
    const rec = await recordCall(a.db, { provider: a.provider, endpoint: a.endpoint, params: a.params, cacheKey, runId: a.runId, outcome: "ok", httpStatus: f.httpStatus, costUsd: f.costUsd, response: f.body, collectedAt: now, ttlMs: a.ttlMs, actor: a.actor });
    return { state: "ok", data: rec.response, provenance: prov(rec, false) };
  } catch (e) {
    const err = e instanceof ProviderCallError ? e : new ProviderCallError("network", `falha inesperada: ${(e as Error).name}`, true);
    a.budget.settle(err.costUsd);
    await recordCall(a.db, { provider: a.provider, endpoint: a.endpoint, params: a.params, cacheKey, runId: a.runId, outcome: "provider_error", httpStatus: err.httpStatus, errorCode: err.code, costUsd: err.costUsd, response: null, collectedAt: now, ttlMs: null, actor: a.actor });
    return providerError(a.provider, err.code, err.message, err.retryable);
  }
}

// --- sinais, SERP e concorrentes -------------------------------------------------------------------
export interface SignalInput { readonly opportunityId: string; readonly factor: string; readonly value: number; readonly unit?: string | null; readonly basis: "observed" | "provider_metric" | "derived" | "inferred" | "estimated"; readonly confidence: number; readonly source: string; readonly collectedAt: Date; readonly expiresAt?: Date | null; readonly providerCallId?: string | null; readonly payload?: Record<string, unknown>; readonly note?: string | null }
export async function recordSignal(db: TenantDb, s: SignalInput): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO plataforma.opportunity_signal (tenant_id, opportunity_id, factor, value, unit, basis, confidence, source, collected_at, expires_at, provider_call_id, payload, note)
     VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12) RETURNING id`,
    [s.opportunityId, s.factor, s.value, s.unit ?? null, s.basis, s.confidence, s.source, s.collectedAt, s.expiresAt ?? null, s.providerCallId ?? null, JSON.stringify(s.payload ?? {}), s.note ?? null]);
  return r.rows[0]!.id;
}
export interface SignalRecord { readonly id: string; readonly opportunityId: string; readonly factor: string; readonly value: number; readonly unit: string | null; readonly basis: string; readonly confidence: number; readonly source: string; readonly collectedAt: Date; readonly expiresAt: Date | null; readonly providerCallId: string | null; readonly note: string | null }
/** O sinal mais recente por fator (os mais antigos continuam no histórico). Sinais vencidos ficam de fora quando `now` é informado. */
export async function latestSignals(db: TenantDb, opportunityId: string, now?: Date): Promise<SignalRecord[]> {
  const r = await db.query<{ id: string; opportunity_id: string; factor: string; value: string; unit: string | null; basis: string; confidence: string; source: string; collected_at: Date; expires_at: Date | null; provider_call_id: string | null; note: string | null }>(
    `SELECT DISTINCT ON (factor) id, opportunity_id, factor, value, unit, basis, confidence, source, collected_at, expires_at, provider_call_id, note FROM plataforma.opportunity_signal
      WHERE opportunity_id = $1 AND ($2::timestamptz IS NULL OR expires_at IS NULL OR expires_at > $2) ORDER BY factor, collected_at DESC, id`, [opportunityId, now ?? null]);
  return r.rows.map((x) => ({ id: x.id, opportunityId: x.opportunity_id, factor: x.factor, value: Number(x.value), unit: x.unit, basis: x.basis, confidence: Number(x.confidence), source: x.source, collectedAt: x.collected_at, expiresAt: x.expires_at, providerCallId: x.provider_call_id, note: x.note }));
}

export type CompetitorKind = "own" | "declared" | "observed";
/** Registra o domínio se ainda não existir (nunca rebaixa nem sobrescreve um `own`/`declared`) e devolve o id. */
export async function ensureCompetitor(db: TenantDb, domain: string, kind: CompetitorKind, actor: string, label?: string | null): Promise<string> {
  await db.query(`INSERT INTO plataforma.competitor (tenant_id, domain, label, kind, created_by) VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4) ON CONFLICT (tenant_id, domain) DO NOTHING`, [domain, label ?? null, kind, actor]);
  return (await db.query<{ id: string }>(`SELECT id FROM plataforma.competitor WHERE domain = $1`, [domain])).rows[0]!.id;
}

export interface SerpResultInput { readonly rank: number; readonly resultType: "organic" | "featured_snippet" | "local_pack" | "video" | "news" | "other"; readonly url: string; readonly domain: string; readonly title: string | null }
export interface SnapshotInput { readonly opportunityId: string | null; readonly providerCallId: string; readonly query: string; readonly country: string; readonly language: string; readonly locationCode: number | null; readonly locationName: string | null; readonly device: "desktop" | "mobile"; readonly capturedAt: Date; readonly features: readonly string[]; readonly peopleAlsoAsk: readonly unknown[]; readonly results: readonly SerpResultInput[]; readonly actor: string }
/** Grava o instantâneo, seus resultados e os concorrentes observados. Idempotente por chamada: a mesma resposta bruta gera no máximo UM instantâneo. */
export async function recordSerpSnapshot(db: TenantDb, s: SnapshotInput): Promise<{ id: string; created: boolean }> {
  const ex = await db.query<{ id: string }>(`SELECT id FROM plataforma.serp_snapshot WHERE provider_call_id = $1`, [s.providerCallId]);
  if (ex.rows[0]) return { id: ex.rows[0].id, created: false };
  const snap = await db.query<{ id: string }>(
    `INSERT INTO plataforma.serp_snapshot (tenant_id, opportunity_id, provider_call_id, query, country, language, location_code, location_name, device, captured_at, features, people_also_ask)
     VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb) RETURNING id`,
    [s.opportunityId, s.providerCallId, s.query, s.country, s.language, s.locationCode, s.locationName, s.device, s.capturedAt, [...s.features], JSON.stringify(s.peopleAlsoAsk)]);
  const id = snap.rows[0]!.id;
  for (const r of s.results) {
    const cid = await ensureCompetitor(db, r.domain, "observed", s.actor);
    await db.query(`INSERT INTO plataforma.serp_result (tenant_id, snapshot_id, rank, result_type, url, domain, title, competitor_id) VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7)`, [id, r.rank, r.resultType, r.url, r.domain, r.title, cid]);
  }
  return { id, created: true };
}
