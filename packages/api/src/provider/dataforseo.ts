import { callProvider, ProviderCallError, type CallArgs, type Fetched } from "./store";
import { missingEnv, notConfigured, providerError, type EnvLike, type ProviderResult } from "./contract";
import { publicJson, type PublicCtx } from "./public";

// DataForSEO (ADR-027): keywords, SERP, notícias, Trends e backlinks. Credencial só por NOME de variável. Sem credencial: `provider_not_configured` (nenhuma requisição, nada gravado).
// Credencial rejeitada (HTTP 401): `provider_error` `unauthorized`, sem repetir a chamada. Custo = o campo `cost` da resposta (nunca estimado); a reserva do teto usa um pior caso
// conservador, que NÃO é preço contratual. Fixtures são CONSTRUÍDAS da documentação (a credencial foi rejeitada, nenhuma resposta real foi obtida): provam o parser, não a fonte.
export const DATAFORSEO_PROVIDER = "dataforseo";
export const DATAFORSEO_ENV = ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"] as const;
export const BRAZIL = { locationCode: 2076, languageCode: "pt" } as const;
const BASE = "https://api.dataforseo.com/v3/";

export interface DfsCtx extends PublicCtx { readonly env: EnvLike }
export type Place = { readonly locationCode?: number; readonly locationName?: string; readonly languageCode?: string };
const placeBody = (p: Place | undefined) => ({ ...(p?.locationName ? { location_name: p.locationName } : { location_code: p?.locationCode ?? BRAZIL.locationCode }), language_code: p?.languageCode ?? BRAZIL.languageCode });

type Base = Omit<CallArgs, "provider" | "endpoint" | "params" | "fetchRaw" | "ttlMs" | "estimateUsd">;
interface Spec { readonly endpoint: string; readonly body: Record<string, unknown>; readonly ttlMs: number; readonly estimateUsd: number }

// Pior caso para a RESERVA do orçamento (não é preço): o custo real vem da resposta.
const DAY = 86_400_000;
export const ENDPOINTS = {
  searchVolume: { path: "keywords_data/google_ads/search_volume/live", estimateUsd: 0.1, ttlMs: 30 * DAY },
  keywordDifficulty: { path: "dataforseo_labs/google/bulk_keyword_difficulty/live", estimateUsd: 0.05, ttlMs: 30 * DAY },
  relatedKeywords: { path: "dataforseo_labs/google/related_keywords/live", estimateUsd: 0.05, ttlMs: 30 * DAY },
  keywordSuggestions: { path: "dataforseo_labs/google/keyword_suggestions/live", estimateUsd: 0.05, ttlMs: 30 * DAY },
  serpOrganic: { path: "serp/google/organic/live/advanced", estimateUsd: 0.02, ttlMs: 3 * DAY },
  serpNews: { path: "serp/google/news/live/advanced", estimateUsd: 0.02, ttlMs: 6 * 3_600_000 },
  trends: { path: "keywords_data/google_trends/explore/live", estimateUsd: 0.05, ttlMs: 7 * DAY },
  backlinksSummary: { path: "backlinks/summary/live", estimateUsd: 0.05, ttlMs: 14 * DAY },
} as const;

function assertKeywords(k: readonly string[], max: number): void {
  if (k.length < 1 || k.length > max || k.some((x) => typeof x !== "string" || x.trim() === "" || x.length > 80)) throw new RangeError(`informe de 1 a ${max} termos de até 80 caracteres`);
}
// --- construtores de requisição (puros) ---------------------------------------------------------------
export const searchVolumeSpec = (keywords: readonly string[], place?: Place): Spec => { assertKeywords(keywords, 1000); return { endpoint: ENDPOINTS.searchVolume.path, body: { keywords: [...keywords], ...placeBody(place) }, ttlMs: ENDPOINTS.searchVolume.ttlMs, estimateUsd: ENDPOINTS.searchVolume.estimateUsd }; };
export const keywordDifficultySpec = (keywords: readonly string[], place?: Place): Spec => { assertKeywords(keywords, 1000); return { endpoint: ENDPOINTS.keywordDifficulty.path, body: { keywords: [...keywords], ...placeBody(place) }, ttlMs: ENDPOINTS.keywordDifficulty.ttlMs, estimateUsd: ENDPOINTS.keywordDifficulty.estimateUsd }; };
export const relatedKeywordsSpec = (seed: string, limit: number, place?: Place): Spec => { assertKeywords([seed], 1); if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new RangeError("limite entre 1 e 200"); return { endpoint: ENDPOINTS.relatedKeywords.path, body: { keyword: seed, limit, include_seed_keyword: false, ...placeBody(place) }, ttlMs: ENDPOINTS.relatedKeywords.ttlMs, estimateUsd: ENDPOINTS.relatedKeywords.estimateUsd }; };
export const keywordSuggestionsSpec = (seed: string, limit: number, place?: Place): Spec => { assertKeywords([seed], 1); if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new RangeError("limite entre 1 e 200"); return { endpoint: ENDPOINTS.keywordSuggestions.path, body: { keyword: seed, limit, include_seed_keyword: false, ...placeBody(place) }, ttlMs: ENDPOINTS.keywordSuggestions.ttlMs, estimateUsd: ENDPOINTS.keywordSuggestions.estimateUsd }; };
export const serpOrganicSpec = (query: string, o: { place?: Place; device?: "desktop" | "mobile"; depth?: number } = {}): Spec => {
  assertKeywords([query], 1);
  const depth = o.depth ?? 10; if (!Number.isInteger(depth) || depth < 10 || depth > 100 || depth % 10 !== 0) throw new RangeError("depth múltiplo de 10 entre 10 e 100");
  return { endpoint: ENDPOINTS.serpOrganic.path, body: { keyword: query, device: o.device ?? "desktop", depth, ...placeBody(o.place) }, ttlMs: ENDPOINTS.serpOrganic.ttlMs, estimateUsd: ENDPOINTS.serpOrganic.estimateUsd * (depth / 10) };
};
export const serpNewsSpec = (query: string, place?: Place): Spec => { assertKeywords([query], 1); return { endpoint: ENDPOINTS.serpNews.path, body: { keyword: query, ...placeBody(place) }, ttlMs: ENDPOINTS.serpNews.ttlMs, estimateUsd: ENDPOINTS.serpNews.estimateUsd }; };
export const trendsSpec = (keywords: readonly string[], o: { place?: Place; timeRange?: "past_12_months" | "past_5_years" | "past_90_days" } = {}): Spec => {
  assertKeywords(keywords, 5);
  return { endpoint: ENDPOINTS.trends.path, body: { keywords: [...keywords], time_range: o.timeRange ?? "past_12_months", ...(o.place?.locationName ? { location_name: o.place.locationName } : { location_code: o.place?.locationCode ?? BRAZIL.locationCode }), language_code: o.place?.languageCode ?? BRAZIL.languageCode }, ttlMs: ENDPOINTS.trends.ttlMs, estimateUsd: ENDPOINTS.trends.estimateUsd };
};
export const backlinksSummarySpec = (domain: string): Spec => {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) throw new RangeError("domínio inválido (sem protocolo nem caminho)");
  return { endpoint: ENDPOINTS.backlinksSummary.path, body: { target: domain, include_subdomains: true }, ttlMs: ENDPOINTS.backlinksSummary.ttlMs, estimateUsd: ENDPOINTS.backlinksSummary.estimateUsd };
};

// --- transporte ---------------------------------------------------------------------------------------------
interface Envelope { status_code?: number; status_message?: string; cost?: number; tasks?: { status_code?: number; status_message?: string; cost?: number; result?: unknown }[] }
const code = (n: number | undefined): ProviderCallError["code"] => (n !== undefined && n >= 40100 && n < 40200 ? "unauthorized" : n === 40202 || n === 429 ? "rate_limited" : "provider_rejected");
/** Valida o envelope da DataForSEO: 20000 no topo e na tarefa. O custo informado vale mesmo quando a tarefa falha. */
export function checkEnvelope(raw: unknown): { cost: number; result: unknown } {
  const e = raw as Envelope | null;
  if (!e || typeof e !== "object" || !Array.isArray(e.tasks)) throw new ProviderCallError("parse", "resposta fora do formato da DataForSEO", false);
  const cost = typeof e.cost === "number" && e.cost >= 0 ? e.cost : 0;
  if (e.status_code !== 20000) throw new ProviderCallError(code(e.status_code), `DataForSEO ${e.status_code}: ${String(e.status_message ?? "").slice(0, 120)}`, e.status_code === 40202, null, cost);
  const t = e.tasks[0];
  if (!t) throw new ProviderCallError("parse", "resposta sem tarefa", false, null, cost);
  if (t.status_code !== 20000) throw new ProviderCallError(code(t.status_code), `DataForSEO tarefa ${t.status_code}: ${String(t.status_message ?? "").slice(0, 120)}`, false, null, cost);
  return { cost, result: t.result ?? null };
}
const authHeader = (env: EnvLike): string => `Basic ${Buffer.from(`${env.DATAFORSEO_LOGIN!.trim()}:${env.DATAFORSEO_PASSWORD!.trim()}`).toString("base64")}`;

/** Executa uma especificação: sem credencial devolve `provider_not_configured` ANTES de qualquer requisição ou gravação. A resposta bruta fica em `provider_call` com o custo real. */
export async function runDfs(ctx: DfsCtx, base: Base, spec: Spec): Promise<ProviderResult<unknown>> {
  const missing = missingEnv(ctx.env, DATAFORSEO_ENV);
  if (missing.length > 0) return notConfigured(DATAFORSEO_PROVIDER, missing);
  const url = `${BASE}${spec.endpoint}`;
  const fetchRaw = async (): Promise<Fetched> => {
    const f = await publicJson(ctx, url, { method: "POST", body: JSON.stringify([spec.body]), headers: { Authorization: authHeader(ctx.env), "Content-Type": "application/json" } });
    const { cost } = checkEnvelope(f.body);
    return { body: f.body, costUsd: cost, httpStatus: f.httpStatus };
  };
  const r = await callProvider({ ...base, provider: DATAFORSEO_PROVIDER, endpoint: spec.endpoint, params: spec.body, ttlMs: spec.ttlMs, estimateUsd: spec.estimateUsd, fetchRaw });
  return r;
}
/** Aplica um parser à resposta bruta; falha de formato vira `provider_error` `parse` (a resposta bruta já ficou gravada). */
export function parsed<T>(r: ProviderResult<unknown>, parse: (result: unknown) => T): ProviderResult<T> {
  if (r.state !== "ok") return r;
  try { return { state: "ok", data: parse(checkEnvelope(r.data).result), provenance: r.provenance }; } catch (e) { return providerError(DATAFORSEO_PROVIDER, "parse", (e as Error).message); }
}

// --- parsers (puros): ausência é null, nunca 0 --------------------------------------------------------------
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
const first = (result: unknown): Record<string, unknown> => { const r = Array.isArray(result) ? result[0] : null; if (!r || typeof r !== "object") throw new Error("resultado vazio ou fora do formato"); return r as Record<string, unknown>; };

export interface KeywordMetric { readonly keyword: string; readonly searchVolume: number | null; readonly cpc: number | null; readonly competition: number | null; readonly monthly: readonly { year: number; month: number; volume: number | null }[] }
export function parseSearchVolume(result: unknown): KeywordMetric[] {
  if (!Array.isArray(result)) throw new Error("resultado fora do formato");
  return (result as Record<string, unknown>[]).flatMap((r) => {
    const keyword = str(r.keyword); if (!keyword) return [];
    const idx = num(r.competition_index);
    return [{ keyword, searchVolume: num(r.search_volume), cpc: num(r.cpc), competition: idx === null ? null : idx / 100, monthly: arr(r.monthly_searches).flatMap((m) => (num(m.year) !== null && num(m.month) !== null ? [{ year: m.year as number, month: m.month as number, volume: num(m.search_volume) }] : [])) }];
  });
}
export interface KeywordDifficulty { readonly keyword: string; readonly difficulty: number | null }
export function parseKeywordDifficulty(result: unknown): KeywordDifficulty[] {
  const r = first(result);
  return arr(r.items).flatMap((i) => { const keyword = str(i.keyword); return keyword ? [{ keyword, difficulty: num(i.keyword_difficulty) }] : []; });
}
export interface RelatedKeyword { readonly keyword: string; readonly searchVolume: number | null; readonly cpc: number | null; readonly difficulty: number | null; readonly intent: string | null }
export function parseKeywordList(result: unknown): RelatedKeyword[] {
  const r = first(result);
  return arr(r.items).flatMap((i) => {
    const kd = (i.keyword_data ?? i) as Record<string, unknown>;
    const keyword = str(kd.keyword); if (!keyword) return [];
    const info = (kd.keyword_info ?? {}) as Record<string, unknown>; const props = (kd.keyword_properties ?? {}) as Record<string, unknown>; const intent = (kd.search_intent_info ?? {}) as Record<string, unknown>;
    return [{ keyword, searchVolume: num(info.search_volume), cpc: num(info.cpc), difficulty: num(props.keyword_difficulty), intent: str(intent.main_intent) }];
  });
}
export interface SerpItem { readonly rank: number; readonly resultType: "organic" | "featured_snippet" | "local_pack" | "video" | "news" | "other"; readonly url: string; readonly domain: string; readonly title: string | null }
export interface SerpObservation { readonly query: string; readonly locationCode: number | null; readonly languageCode: string | null; readonly capturedAt: Date | null; readonly features: readonly string[]; readonly peopleAlsoAsk: readonly string[]; readonly totalResults: number | null; readonly items: readonly SerpItem[] }
const RESULT_TYPE: Record<string, SerpItem["resultType"]> = { organic: "organic", featured_snippet: "featured_snippet", local_pack: "local_pack", video: "video", top_stories: "news", news_search: "news" };
const dateOf = (s: unknown): Date | null => { if (typeof s !== "string") return null; const d = new Date(s.replace(" +00:00", "Z").replace(" ", "T")); return Number.isNaN(d.getTime()) ? null : d; };
const hostOf = (u: string): string | null => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } };
export function parseSerp(result: unknown): SerpObservation {
  const r = first(result);
  const query = str(r.keyword); if (!query) throw new Error("SERP sem a consulta");
  const items: SerpItem[] = [];
  for (const i of arr(r.items)) {
    const type = RESULT_TYPE[String(i.type)]; const url = str(i.url); const domain = str(i.domain) ?? (url ? hostOf(url) : null); const rank = num(i.rank_group) ?? num(i.rank_absolute);
    if (!type || !url || !/^https?:\/\//.test(url) || !domain || rank === null || rank < 1 || rank > 100) continue; // item sem posição, URL ou domínio não entra
    items.push({ rank, resultType: type, url, domain: domain.replace(/^www\./, "").toLowerCase(), title: str(i.title) });
  }
  const paa = arr(r.items).filter((i) => i.type === "people_also_ask").flatMap((i) => arr(i.items).flatMap((q) => { const t = str(q.title); return t ? [t] : []; }));
  const features = Array.isArray(r.item_types) ? (r.item_types as unknown[]).filter((x): x is string => typeof x === "string" && x !== "organic") : [];
  return { query, locationCode: num(r.location_code), languageCode: str(r.language_code), capturedAt: dateOf(r.datetime), features, peopleAlsoAsk: paa, totalResults: num(r.se_results_count), items };
}
export interface NewsItem { readonly title: string; readonly url: string; readonly domain: string | null; readonly source: string | null; readonly publishedAt: Date | null }
export function parseSerpNews(result: unknown): NewsItem[] {
  const r = first(result);
  return arr(r.items).flatMap((i) => {
    const title = str(i.title); const url = str(i.url);
    if (!title || !url || !/^https?:\/\//.test(url)) return [];
    return [{ title: title.slice(0, 500), url, domain: str(i.domain), source: str(i.source), publishedAt: dateOf(i.timestamp) ?? dateOf(i.date) }];
  });
}
export interface TrendSeries { readonly keywords: readonly string[]; readonly points: readonly { readonly from: string; readonly to: string; readonly values: readonly (number | null)[] }[]; readonly averages: readonly (number | null)[] }
export function parseTrends(result: unknown): TrendSeries {
  const r = first(result);
  const g = arr(r.items).find((i) => i.type === "google_trends_graph");
  if (!g) throw new Error("resposta sem série do Google Trends");
  const keywords = Array.isArray(g.keywords) ? (g.keywords as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const points = arr(g.data).flatMap((d) => {
    const from = str(d.date_from); const to = str(d.date_to); if (!from || !to) return [];
    const missing = d.missing_data === true; const vals = Array.isArray(d.values) ? (d.values as unknown[]) : [];
    return [{ from, to, values: vals.map((v) => (missing ? null : num(v))) }];
  });
  return { keywords, points, averages: Array.isArray(g.averages) ? (g.averages as unknown[]).map(num) : [] };
}
export interface BacklinksSummary { readonly target: string; readonly rank: number | null; readonly backlinks: number | null; readonly referringDomains: number | null; readonly referringMainDomains: number | null }
export function parseBacklinksSummary(result: unknown): BacklinksSummary {
  const r = first(result);
  const target = str(r.target); if (!target) throw new Error("resumo sem o domínio");
  return { target, rank: num(r.rank), backlinks: num(r.backlinks), referringDomains: num(r.referring_domains), referringMainDomains: num(r.referring_main_domains) };
}

// --- operações tipadas (execução + parser) ------------------------------------------------------------------
export const dfsSearchVolume = async (c: DfsCtx, b: Base, keywords: readonly string[], place?: Place) => parsed(await runDfs(c, b, searchVolumeSpec(keywords, place)), parseSearchVolume);
export const dfsKeywordDifficulty = async (c: DfsCtx, b: Base, keywords: readonly string[], place?: Place) => parsed(await runDfs(c, b, keywordDifficultySpec(keywords, place)), parseKeywordDifficulty);
export const dfsRelatedKeywords = async (c: DfsCtx, b: Base, seed: string, limit: number, place?: Place) => parsed(await runDfs(c, b, relatedKeywordsSpec(seed, limit, place)), parseKeywordList);
export const dfsKeywordSuggestions = async (c: DfsCtx, b: Base, seed: string, limit: number, place?: Place) => parsed(await runDfs(c, b, keywordSuggestionsSpec(seed, limit, place)), parseKeywordList);
export const dfsSerp = async (c: DfsCtx, b: Base, query: string, o?: Parameters<typeof serpOrganicSpec>[1]) => parsed(await runDfs(c, b, serpOrganicSpec(query, o)), parseSerp);
export const dfsSerpNews = async (c: DfsCtx, b: Base, query: string, place?: Place) => parsed(await runDfs(c, b, serpNewsSpec(query, place)), parseSerpNews);
export const dfsTrends = async (c: DfsCtx, b: Base, keywords: readonly string[], o?: Parameters<typeof trendsSpec>[1]) => parsed(await runDfs(c, b, trendsSpec(keywords, o)), parseTrends);
export const dfsBacklinks = async (c: DfsCtx, b: Base, domain: string) => parsed(await runDfs(c, b, backlinksSummarySpec(domain)), parseBacklinksSummary);

/**
 * AI Optimization (menções e respostas de LLMs): NESTA unidade só existe o CONTRATO (base para Citation Potential na próxima). Nenhuma chamada é feita e o estado é sempre
 * `contract_only`: não há implementação para chamar nem resultado para exibir.
 */
export interface AiMentionQuery { readonly target: string; readonly kind: "domain" | "keyword"; readonly engine: "chat_gpt" | "google"; readonly locationCode: number; readonly languageCode: string }
export interface AiMentionObservation { readonly query: AiMentionQuery; readonly capturedAt: Date; readonly mentions: number | null; readonly citedUrls: readonly string[] }
export const AI_OPTIMIZATION_STATE = "contract_only" as const;
