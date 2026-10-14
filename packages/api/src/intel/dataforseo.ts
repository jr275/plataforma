import { z } from "zod";
import type { ProviderResult } from "./provider-status";
import { cacheKey, type ProviderCache, type RunBudget } from "./provider-runtime";

// Adapter DataForSEO (Fase 2). Brasil: location_code 2076, language_code "pt". Credenciais só por nome de variável;
// o valor nunca é logado. Envelope e payloads validados com zod: resposta fora do contrato = provider_error, nunca dado.

export const DFS_BASE = "https://api.dataforseo.com";
export const BR_LOCATION = 2076;
export const PT_LANGUAGE = "pt";

export interface DataForSeoConfig { readonly login: string; readonly password: string }

export function resolveDataForSeoConfig(env: Readonly<Record<string, string | undefined>>):
  | { readonly ok: true; readonly config: DataForSeoConfig }
  | { readonly ok: false; readonly missing: readonly string[] } {
  const missing = ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"].filter((k) => !env[k]?.trim());
  if (missing.length) return { ok: false, missing };
  return { ok: true, config: { login: env.DATAFORSEO_LOGIN!.trim(), password: env.DATAFORSEO_PASSWORD!.trim() } };
}

const taskSchema = z.object({
  status_code: z.number(),
  status_message: z.string(),
  cost: z.number().nonnegative().default(0),
  result: z.array(z.unknown()).nullable().default(null),
});

export const envelopeSchema = z.object({
  status_code: z.number(),
  status_message: z.string(),
  cost: z.number().nonnegative().default(0),
  tasks: z.array(taskSchema).default([]),
});

export const searchVolumeItemSchema = z.object({
  keyword: z.string(),
  search_volume: z.number().int().nonnegative().nullable(),
  competition_index: z.number().nullable().optional(),
  cpc: z.number().nullable().optional(),
});
export type SearchVolumeItem = z.infer<typeof searchVolumeItemSchema>;

export const serpItemSchema = z.object({
  type: z.string(),
  rank_absolute: z.number().int().positive().optional(),
  rank_group: z.number().int().positive().optional(),
  domain: z.string().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
});
export const serpResultSchema = z.object({
  keyword: z.string(),
  check_url: z.string().optional(),
  item_types: z.array(z.string()).default([]),
  items: z.array(serpItemSchema).default([]),
});
export type SerpResult = z.infer<typeof serpResultSchema>;

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface DataForSeoDeps {
  readonly config: DataForSeoConfig;
  readonly cache: ProviderCache;
  readonly budget: RunBudget;
  readonly fetch: Fetcher;
  readonly now?: () => Date;
}

const OK = 20000;
const NO_DATA_CODES = new Set([40102]);

async function call<T>(deps: DataForSeoDeps, endpoint: string, payload: unknown, parse: (result: unknown[]) => T | null): Promise<ProviderResult<T>> {
  const key = cacheKey("dataforseo", endpoint, payload);
  const params = (Array.isArray(payload) ? payload[0] : payload) as Record<string, unknown>;
  const cached = await deps.cache.get(key);
  let body: unknown;
  let collectedAt: string;
  let costUsd: number;
  let cacheHit = false;

  if (cached) {
    ({ body, collectedAt, costUsd } = cached);
    cacheHit = true;
  } else {
    deps.budget.reserve();
    const auth = Buffer.from(`${deps.config.login}:${deps.config.password}`).toString("base64");
    let res: { status: number; json(): Promise<unknown> };
    try {
      res = await deps.fetch(`${DFS_BASE}${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      deps.budget.record({ provider: "dataforseo", endpoint, cacheKey: key, cacheHit: false, costUsd: 0, ok: false });
      return { status: "provider_error", provider: "dataforseo", endpoint, reason: `falha de rede: ${(err as Error).message}` };
    }
    if (res.status !== 200) {
      deps.budget.record({ provider: "dataforseo", endpoint, cacheKey: key, cacheHit: false, costUsd: 0, ok: false });
      return { status: "provider_error", provider: "dataforseo", endpoint, reason: `HTTP ${res.status}`, httpStatus: res.status };
    }
    body = await res.json();
    collectedAt = (deps.now?.() ?? new Date()).toISOString();
    const env = envelopeSchema.safeParse(body);
    costUsd = env.success ? env.data.cost : 0;
  }

  const env = envelopeSchema.safeParse(body);
  if (!env.success) {
    if (!cacheHit) deps.budget.record({ provider: "dataforseo", endpoint, cacheKey: key, cacheHit, costUsd, ok: false });
    return { status: "provider_error", provider: "dataforseo", endpoint, reason: "resposta fora do contrato" };
  }
  const task = env.data.tasks[0];
  if (env.data.status_code !== OK || !task || (task.status_code !== OK && !NO_DATA_CODES.has(task.status_code))) {
    deps.budget.record({ provider: "dataforseo", endpoint, cacheKey: key, cacheHit, costUsd, ok: false });
    return { status: "provider_error", provider: "dataforseo", endpoint, reason: `${task?.status_code ?? env.data.status_code}: ${task?.status_message ?? env.data.status_message}` };
  }

  if (!cacheHit) await deps.cache.set(key, { body, collectedAt, costUsd });
  deps.budget.record({ provider: "dataforseo", endpoint, cacheKey: key, cacheHit, costUsd, ok: true });
  const provenance = { provider: "dataforseo" as const, endpoint, params, collectedAt, cacheKey: key, cacheHit, costUsd };

  const parsed = task.result && task.result.length ? parse(task.result) : null;
  if (parsed === null) return { status: "no_data", provenance };
  return { status: "success", data: parsed, provenance };
}

/** Keywords Data / Google Ads search_volume (live) → fator Demand. */
export function searchVolume(deps: DataForSeoDeps, keywords: readonly string[]): Promise<ProviderResult<SearchVolumeItem[]>> {
  const payload = [{ keywords: [...keywords].sort(), location_code: BR_LOCATION, language_code: PT_LANGUAGE }];
  return call(deps, "/v3/keywords_data/google_ads/search_volume/live", payload, (result) => {
    const items = z.array(searchVolumeItemSchema).safeParse(result);
    if (!items.success) return null;
    const measurable = items.data.filter((i) => i.search_volume !== null);
    return measurable.length ? measurable : null;
  });
}

/** SERP Google Organic advanced (live) → top 10, SERP features, People Also Ask. */
export function serpOrganic(deps: DataForSeoDeps, keyword: string): Promise<ProviderResult<SerpResult>> {
  const payload = [{ keyword, location_code: BR_LOCATION, language_code: PT_LANGUAGE, depth: 10 }];
  return call(deps, "/v3/serp/google/organic/live/advanced", payload, (result) => {
    const first = serpResultSchema.safeParse(result[0]);
    return first.success && first.data.items.length ? first.data : null;
  });
}

/** Validação barata da Fase 0: GET gratuito /v3/appendix/user_data. Não consome orçamento. */
export async function checkDataForSeo(config: DataForSeoConfig, fetcher: Fetcher): Promise<"success" | "provider_error"> {
  const auth = Buffer.from(`${config.login}:${config.password}`).toString("base64");
  try {
    const res = await fetcher(`${DFS_BASE}/v3/appendix/user_data`, { method: "GET", headers: { Authorization: `Basic ${auth}` } });
    if (res.status !== 200) return "provider_error";
    const env = envelopeSchema.safeParse(await res.json());
    return env.success && env.data.status_code === OK ? "success" : "provider_error";
  } catch {
    return "provider_error";
  }
}
