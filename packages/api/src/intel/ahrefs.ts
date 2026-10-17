import { z } from "zod";
import type { ProviderResult } from "./provider-status";
import { cacheKey, type ProviderCache } from "./provider-runtime";
import type { FactorInput, FactorName } from "./score-v1";

// Adapter Ahrefs API v3 (fonte COMPLEMENTAR, nunca substitui DataForSEO nem Search Console). Credencial só por nome de
// variável (AHREFS_API_KEY); o valor nunca é logado nem entra na chave de cache. Resposta fora do contrato =
// provider_error, nunca dado. Ausência de credencial, erro, "sem dados" e zero real são estados distintos.
//
// Custos (docs oficiais, "Limits & consumption"): cada requisição paga custa max(50, custo_por_linha × linhas); o custo
// por linha é a soma dos campos únicos pedidos (padrão 1 unidade; alguns, como volume e difficulty, 10). Requisições
// atendidas pelo cache da Ahrefs não consomem, mas isso não é observável daqui: o custo registrado é ESTIMADO
// (costSource = "estimated") até que a API reporte o consumo de forma verificada. Limite padrão: 60 req/min (HTTP 429).
//
// Multi-tenant: este adapter só consulta dados PÚBLICOS de mercado (métricas de palavra-chave) com a credencial global
// da plataforma. Nenhum dado de tenant vai na requisição e por isso a chave de cache NÃO inclui o tenant (cache
// compartilhado intencional). O tenant solicitante é gravado na proveniência. BYOK não está implementado: se um dia
// houver credencial por tenant, a chave de cache PRECISA incluir o tenant, e `target` (domínio do cliente) não pode ser
// consultado sem essa mudança.

export const AHREFS_BASE = "https://api.ahrefs.com/v3";
export const BASE_COST_UNITS = 50;
export const DEFAULT_FIELD_COST_UNITS = 1;
/** Campos com custo documentado acima do padrão em keywords-explorer/overview. */
export const FIELD_COST_UNITS: Readonly<Record<string, number>> = {
  difficulty: 10,
  global_volume: 10,
  parent_volume: 10,
  traffic_potential: 10,
  volume: 10,
};

export const OVERVIEW_ENDPOINT = "/keywords-explorer/overview";
export const USAGE_ENDPOINT = "/subscription-info/limits-and-usage";
export const MAX_KEYWORDS_PER_CALL = 25;
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_CACHE_MAX_AGE_DAYS = 30;
const MAX_RETRY_WAIT_MS = 60_000;

/** Colunas aceitas no select. Lista fechada: o custo por linha depende exatamente do que é pedido. */
export const OVERVIEW_FIELDS = ["keyword", "volume", "difficulty", "cpc", "traffic_potential", "global_volume", "parent_topic", "serp_last_update"] as const;
export type OverviewField = (typeof OVERVIEW_FIELDS)[number];
export const DEFAULT_OVERVIEW_SELECT: readonly OverviewField[] = ["keyword", "volume", "difficulty", "cpc", "serp_last_update"];

export interface AhrefsConfig {
  readonly apiKey: string;
  /** Teto de unidades por execução. Obrigatório para consultas pagas: sem ele, nenhuma consulta paga sai. */
  readonly unitBudget: number | null;
}

export type AhrefsConfigResolution =
  | { readonly ok: true; readonly config: AhrefsConfig }
  | { readonly ok: false; readonly status: "provider_not_configured"; readonly missing: readonly string[]; readonly detail: string };

export function resolveAhrefsConfig(env: Readonly<Record<string, string | undefined>>): AhrefsConfigResolution {
  if (env.AHREFS_ENABLED?.trim().toLowerCase() === "false") {
    return { ok: false, status: "provider_not_configured", missing: [], detail: "AHREFS_ENABLED=false: provedor desativado" };
  }
  const apiKey = env.AHREFS_API_KEY?.trim();
  if (!apiKey) return { ok: false, status: "provider_not_configured", missing: ["AHREFS_API_KEY"], detail: "credencial ausente" };
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(apiKey)) {
    // Nunca ecoa o valor: só diz que o formato é inválido.
    return { ok: false, status: "provider_not_configured", missing: ["AHREFS_API_KEY"], detail: "AHREFS_API_KEY com formato inválido" };
  }
  const rawBudget = env.AHREFS_UNIT_BUDGET?.trim();
  const unitBudget = rawBudget && /^[0-9]+$/.test(rawBudget) && Number(rawBudget) > 0 ? Number(rawBudget) : null;
  return { ok: true, config: { apiKey, unitBudget } };
}

export class UnitBudgetExceededError extends Error {
  constructor(readonly kind: "units" | "requests", detail: string) {
    super(detail);
    this.name = "UnitBudgetExceededError";
  }
}

/** Orçamento de uma execução em unidades da Ahrefs. Cache hit não reserva nada. */
export class UnitBudget {
  private spent = 0;
  private requests = 0;
  constructor(readonly unitLimit: number, readonly requestLimit: number = 20) {}

  reserve(estimatedUnits: number): void {
    if (this.requests >= this.requestLimit) throw new UnitBudgetExceededError("requests", `limite de ${this.requestLimit} requisições por execução atingido`);
    if (this.spent + estimatedUnits > this.unitLimit) {
      throw new UnitBudgetExceededError("units", `consulta estimada em ${estimatedUnits} unidades excede o teto de ${this.unitLimit} (já usadas: ${this.spent})`);
    }
    this.requests += 1;
    this.spent += estimatedUnits;
  }

  get summary() { return { units: this.spent, requests: this.requests, unitLimit: this.unitLimit }; }
}

/** Custo estimado pela regra oficial: max(base, soma dos campos únicos × linhas). */
export function estimateUnits(fields: readonly string[], rows: number): number {
  const perRow = [...new Set(fields)].reduce((sum, f) => sum + (FIELD_COST_UNITS[f] ?? DEFAULT_FIELD_COST_UNITS), 0);
  return Math.max(BASE_COST_UNITS, perRow * rows);
}

export type AhrefsFetcher = (
  url: string,
  init: { method: "GET"; headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ status: number; headers?: { get(name: string): string | null }; json(): Promise<unknown> }>;

export interface AhrefsLogEvent {
  readonly event: "request" | "cache_hit" | "retry" | "error" | "skipped";
  readonly provider: "ahrefs";
  readonly endpoint: string;
  readonly httpStatus?: number;
  readonly attempt?: number;
  readonly estimatedUnits?: number;
  readonly reason?: string;
}

export interface AhrefsDeps {
  readonly config: AhrefsConfig;
  readonly cache: ProviderCache;
  readonly budget: UnitBudget;
  readonly fetch: AhrefsFetcher;
  readonly tenantId?: string;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly log?: (event: AhrefsLogEvent) => void;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly cacheMaxAgeDays?: number;
}

/** fetch real: timeout por AbortSignal. Injetado para que os testes nunca toquem a rede. */
export const defaultAhrefsFetcher: AhrefsFetcher = (url, init) => fetch(url, init);

// ---- Schemas (validam o contrato documentado; nada além do que a doc define) ---------------------------------------

export const overviewItemSchema = z.object({
  keyword: z.string(),
  volume: z.number().int().nonnegative().nullable().optional(),
  difficulty: z.number().int().min(0).max(100).nullable().optional(),
  cpc: z.number().int().nonnegative().nullable().optional(),
  traffic_potential: z.number().int().nonnegative().nullable().optional(),
  global_volume: z.number().int().nonnegative().nullable().optional(),
  parent_topic: z.string().nullable().optional(),
  serp_last_update: z.string().nullable().optional(),
});
export const overviewResponseSchema = z.object({ keywords: z.array(overviewItemSchema) });

export const usageResponseSchema = z.object({
  limits_and_usage: z.object({
    subscription: z.string().optional(),
    units_limit_workspace: z.number().int().nullable().optional(),
    units_usage_workspace: z.number().int().nullable().optional(),
    units_limit_api_key: z.number().int().nullable().optional(),
    units_usage_api_key: z.number().int().optional(),
    usage_reset_date: z.string().optional(),
    api_key_expiration_date: z.string().optional(),
  }),
});

// ---- Modelo interno -------------------------------------------------------------------------------------------------

/** Observação normalizada. `null` = a Ahrefs não informou o campo; `0` = a Ahrefs informou zero. Nunca se confundem. */
export interface KeywordObservation {
  readonly source: "ahrefs";
  readonly keyword: string;
  readonly country: string;
  readonly volume: number | null;
  /** Escala 0 a 100 definida pela Ahrefs (Keyword Difficulty). */
  readonly difficulty: number | null;
  /** CPC em centavos de dólar (unidade documentada pela Ahrefs). */
  readonly cpcUsdCents: number | null;
  readonly trafficPotential: number | null;
  readonly globalVolume: number | null;
  readonly parentTopic: string | null;
  /** Última checagem da SERP pela Ahrefs (data de referência do provedor). */
  readonly serpLastUpdate: string | null;
}

export interface UsageSnapshot {
  readonly subscription: string | null;
  readonly unitsLimitWorkspace: number | null;
  readonly unitsUsageWorkspace: number | null;
  readonly unitsLimitApiKey: number | null;
  readonly unitsUsageApiKey: number | null;
  readonly usageResetDate: string | null;
  readonly apiKeyExpirationDate: string | null;
}

// ---- Cliente --------------------------------------------------------------------------------------------------------

type Raw = { readonly status: number; readonly body: unknown } | { readonly failure: "timeout" | "network" | "not_json" };

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function retryDelayMs(headers: { get(name: string): string | null } | undefined, attempt: number): number {
  const retryAfter = headers?.get("retry-after");
  const seconds = retryAfter && /^[0-9]+$/.test(retryAfter) ? Number(retryAfter) : null;
  const ms = seconds !== null ? seconds * 1000 : 1000 * 2 ** attempt;
  return Math.min(ms, MAX_RETRY_WAIT_MS);
}

async function httpGet(deps: AhrefsDeps, path: string, query: Record<string, string>): Promise<Raw> {
  const url = `${AHREFS_BASE}${path}?${new URLSearchParams(query).toString()}`;
  const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
  const sleep = deps.sleep ?? sleepDefault;
  for (let attempt = 0; ; attempt += 1) {
    deps.log?.({ event: "request", provider: "ahrefs", endpoint: path, attempt });
    let res: Awaited<ReturnType<AhrefsFetcher>>;
    try {
      res = await deps.fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${deps.config.apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (err) {
      const name = (err as { name?: string }).name;
      deps.log?.({ event: "error", provider: "ahrefs", endpoint: path, reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" });
      // Sem retry: não dá para saber se a Ahrefs já contabilizou a requisição (evita consumo duplicado).
      return { failure: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
    }
    // Só 429 é repetido (a requisição foi recusada). 5xx NÃO é repetido: pode ter consumido unidades.
    if (res.status === 429 && attempt < maxRetries) {
      const wait = retryDelayMs(res.headers, attempt);
      deps.log?.({ event: "retry", provider: "ahrefs", endpoint: path, httpStatus: 429, attempt: attempt + 1 });
      await sleep(wait);
      continue;
    }
    let body: unknown;
    try { body = await res.json(); } catch { return res.status >= 200 && res.status < 300 ? { failure: "not_json" } : { status: res.status, body: null }; }
    return { status: res.status, body };
  }
}

function httpFailureReason(status: number): string {
  if (status === 401) return "credencial recusada (HTTP 401): chave inválida, revogada ou de outro workspace";
  if (status === 402 || status === 403) return `acesso negado (HTTP ${status}): verifique o plano, o acesso à API e o saldo de unidades`;
  if (status === 429) return "limite de requisições excedido (HTTP 429) após tentativas limitadas";
  if (status >= 500) return `erro do provedor (HTTP ${status}); sem nova tentativa para não duplicar consumo`;
  return `HTTP ${status}`;
}

function failureResult<T>(deps: AhrefsDeps, endpoint: string, raw: Raw): ProviderResult<T> | null {
  if ("failure" in raw) {
    const reason = raw.failure === "timeout" ? "tempo esgotado" : raw.failure === "network" ? "falha de rede" : "resposta não é JSON";
    return { status: "provider_error", provider: "ahrefs", endpoint, reason };
  }
  if (raw.status < 200 || raw.status >= 300) {
    return { status: "provider_error", provider: "ahrefs", endpoint, reason: httpFailureReason(raw.status), httpStatus: raw.status };
  }
  void deps;
  return null;
}

// ---- Endpoints ------------------------------------------------------------------------------------------------------

export interface KeywordOverviewRequest {
  readonly keywords: readonly string[];
  /** ISO 3166-1 alfa-2, em maiúsculas (mercado). */
  readonly country: string;
  readonly select?: readonly OverviewField[];
}

/** Consulta PAGA: custo mínimo de 50 unidades. Só sai com AHREFS_UNIT_BUDGET definido e cabendo no orçamento. */
export async function keywordOverview(deps: AhrefsDeps, req: KeywordOverviewRequest): Promise<ProviderResult<KeywordObservation[]>> {
  const endpoint = OVERVIEW_ENDPOINT;
  const keywords = [...new Set(req.keywords.map((k) => k.trim()).filter(Boolean))].sort();
  const select = [...new Set(req.select ?? DEFAULT_OVERVIEW_SELECT)].sort();
  if (keywords.length === 0 || keywords.length > MAX_KEYWORDS_PER_CALL || keywords.some((k) => k.includes(",")) || !/^[A-Z]{2}$/.test(req.country)
    || select.some((f) => !(OVERVIEW_FIELDS as readonly string[]).includes(f)) || !select.includes("keyword")) {
    return { status: "provider_error", provider: "ahrefs", endpoint, reason: `pedido inválido (1 a ${MAX_KEYWORDS_PER_CALL} palavras-chave sem vírgula, país ISO em maiúsculas, select com "keyword")` };
  }

  const params = { country: req.country, keywords, select };
  const key = cacheKey("ahrefs", endpoint, params);
  const now = deps.now?.() ?? new Date();
  const maxAgeMs = (deps.cacheMaxAgeDays ?? DEFAULT_CACHE_MAX_AGE_DAYS) * 86_400_000;

  let body: unknown;
  let collectedAt: string;
  let cacheHit = false;
  const cached = await deps.cache.get(key);
  if (cached && now.getTime() - Date.parse(cached.collectedAt) <= maxAgeMs) {
    ({ body, collectedAt } = cached);
    cacheHit = true;
    deps.log?.({ event: "cache_hit", provider: "ahrefs", endpoint });
  } else {
    // Dado expirado = nova consulta (e novo custo); nunca se serve silenciosamente um dado vencido.
    if (deps.config.unitBudget === null) {
      deps.log?.({ event: "skipped", provider: "ahrefs", endpoint, reason: "AHREFS_UNIT_BUDGET ausente" });
      return { status: "provider_not_configured", provider: "ahrefs", missing: ["AHREFS_UNIT_BUDGET"] };
    }
    const estimatedUnits = estimateUnits(select, keywords.length);
    try { deps.budget.reserve(estimatedUnits); } catch (err) {
      deps.log?.({ event: "skipped", provider: "ahrefs", endpoint, estimatedUnits, reason: "orçamento" });
      return { status: "provider_error", provider: "ahrefs", endpoint, reason: (err as Error).message };
    }
    const raw = await httpGet(deps, endpoint, { select: select.join(","), country: req.country, keywords: keywords.join(",") });
    const failed = failureResult<KeywordObservation[]>(deps, endpoint, raw);
    if (failed) return failed;
    body = (raw as { body: unknown }).body;
    collectedAt = now.toISOString();
  }

  const parsed = overviewResponseSchema.safeParse(body);
  if (!parsed.success) return { status: "provider_error", provider: "ahrefs", endpoint, reason: "resposta fora do contrato" };

  if (!cacheHit) await deps.cache.set(key, { body, collectedAt, costUsd: 0 });
  const provenance = {
    provider: "ahrefs" as const, endpoint, params, collectedAt, cacheKey: key, cacheHit, costUsd: 0,
    costUnits: cacheHit ? 0 : estimateUnits(select, keywords.length), costSource: "estimated" as const,
    ...(deps.tenantId ? { tenantId: deps.tenantId } : {}),
  };
  const data = parsed.data.keywords.map((i) => normalizeKeyword(i, req.country));
  // "Sem dados" só quando a Ahrefs não devolveu nenhum campo mensurável; zero real continua sendo dado.
  const measurable = data.filter((d) => d.volume !== null || d.difficulty !== null || d.cpcUsdCents !== null || d.trafficPotential !== null);
  if (measurable.length === 0) return { status: "no_data", provenance };
  return { status: "success", data, provenance };
}

export function normalizeKeyword(item: z.infer<typeof overviewItemSchema>, country: string): KeywordObservation {
  return {
    source: "ahrefs",
    keyword: item.keyword,
    country,
    volume: item.volume ?? null,
    difficulty: item.difficulty ?? null,
    cpcUsdCents: item.cpc ?? null,
    trafficPotential: item.traffic_potential ?? null,
    globalVolume: item.global_volume ?? null,
    parentTopic: item.parent_topic ?? null,
    serpLastUpdate: item.serp_last_update ?? null,
  };
}

/** Consulta GRATUITA (documentada como "does not consume any API units"): confirma credencial, plano e saldo. Sem cache. */
export async function limitsAndUsage(deps: Pick<AhrefsDeps, "config" | "fetch" | "now" | "sleep" | "log" | "timeoutMs" | "maxRetries" | "tenantId">): Promise<ProviderResult<UsageSnapshot>> {
  const endpoint = USAGE_ENDPOINT;
  const full = { ...deps, cache: { get: async () => null, set: async () => undefined }, budget: new UnitBudget(0) } as AhrefsDeps;
  const raw = await httpGet(full, endpoint, {});
  const failed = failureResult<UsageSnapshot>(full, endpoint, raw);
  if (failed) return failed;
  const parsed = usageResponseSchema.safeParse((raw as { body: unknown }).body);
  if (!parsed.success) return { status: "provider_error", provider: "ahrefs", endpoint, reason: "resposta fora do contrato" };
  const u = parsed.data.limits_and_usage;
  const provenance = {
    provider: "ahrefs" as const, endpoint, params: {}, collectedAt: (deps.now?.() ?? new Date()).toISOString(), cacheKey: "", cacheHit: false,
    costUsd: 0, costUnits: 0, costSource: "reported" as const, ...(deps.tenantId ? { tenantId: deps.tenantId } : {}),
  };
  return {
    status: "success",
    provenance,
    data: {
      subscription: u.subscription ?? null,
      unitsLimitWorkspace: u.units_limit_workspace ?? null,
      unitsUsageWorkspace: u.units_usage_workspace ?? null,
      unitsLimitApiKey: u.units_limit_api_key ?? null,
      unitsUsageApiKey: u.units_usage_api_key ?? null,
      usageResetDate: u.usage_reset_date ?? null,
      apiKeyExpirationDate: u.api_key_expiration_date ?? null,
    },
  };
}

// ---- Integração com o Opportunity Score (aditiva; não altera pesos nem fórmula) --------------------------------------

/**
 * Keyword Difficulty da Ahrefs (0 a 100, definida por ela) → fator `competition` do score v1. A normalização é a escala
 * documentada (÷100), sem pesos novos. É ESTIMATIVA do provedor, não um resultado garantido. Sem dado = não avaliado.
 */
export function competitionFactor(o: KeywordObservation): FactorInput {
  return o.difficulty === null ? { value: null, origin: "not_evaluated" } : { value: o.difficulty / 100, origin: "estimated" };
}

/**
 * Preenche só os fatores AUSENTES; nunca sobrescreve uma fonte existente (DataForSEO, Search Console...). O demand não é
 * derivado aqui porque exigiria uma escala de referência de volume que ainda não foi definida e validada.
 */
export function fillMissingFactors(
  existing: Partial<Record<FactorName, FactorInput>>,
  ahrefs: Partial<Record<FactorName, FactorInput>>,
): Partial<Record<FactorName, FactorInput>> {
  const merged: Partial<Record<FactorName, FactorInput>> = { ...existing };
  for (const [name, input] of Object.entries(ahrefs) as [FactorName, FactorInput][]) {
    const current = merged[name];
    if (current === undefined || current.value === null || current.origin === "not_evaluated") merged[name] = input;
  }
  return merged;
}

export interface Evidence {
  readonly metric: string;
  readonly value: number | string | null;
  readonly unit: string;
  readonly definition: string;
  readonly source: "ahrefs";
  readonly endpoint: string;
  readonly collectedAt: string;
  readonly referenceDate: string | null;
  readonly limitation: string;
}

/** Evidência explicável: fonte, data, unidade, definição e limitação de cada número exibido. */
export function toEvidence(o: KeywordObservation, collectedAt: string): Evidence[] {
  const base = { source: "ahrefs" as const, endpoint: OVERVIEW_ENDPOINT, collectedAt, referenceDate: o.serpLastUpdate };
  const est = "Estimativa da Ahrefs; não é resultado garantido nem dado do Search Console.";
  return [
    { ...base, metric: `volume:${o.country}`, value: o.volume, unit: "buscas/mês", definition: "Média mensal estimada de buscas nos últimos 12 meses.", limitation: est },
    { ...base, metric: `difficulty:${o.country}`, value: o.difficulty, unit: "0 a 100", definition: "Dificuldade estimada para ranquear no top 10 orgânico.", limitation: est },
    { ...base, metric: `cpc:${o.country}`, value: o.cpcUsdCents, unit: "centavos de USD", definition: "Preço médio por clique pago.", limitation: est },
  ];
}
