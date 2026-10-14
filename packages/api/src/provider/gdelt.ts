import { callProvider, type CallArgs } from "./store";
import type { ProviderResult } from "./contract";
import { publicJson, type PublicCtx } from "./public";

// GDELT DOC 2.0 (público, 1 requisição a cada 5 s). Notícias complementares: é CONTEXTO e tendência de cobertura, não demanda de busca. Resposta `{}` = sem resultados (lista vazia), não erro.
export const GDELT_PROVIDER = "gdelt";
export interface GdeltArticle { readonly url: string; readonly title: string; readonly domain: string; readonly language: string; readonly sourceCountry: string; readonly seenAt: Date | null }

export function gdeltEndpoint(q: { query: string; timespan: string; maxRecords: number }): string {
  if (!/^\d{1,3}(h|d|w|m)$/.test(q.timespan) && !/^\d{1,4}min$/.test(q.timespan)) throw new RangeError("timespan inválido (ex.: 24h, 7d, 1w)");
  if (!Number.isInteger(q.maxRecords) || q.maxRecords < 1 || q.maxRecords > 75) throw new RangeError("maxRecords deve ficar entre 1 e 75");
  if (q.query.trim().length < 3 || q.query.length > 200) throw new RangeError("consulta com 3 a 200 caracteres");
  return `api/v2/doc/doc?${new URLSearchParams({ query: q.query, mode: "artlist", format: "json", sort: "datedesc", timespan: q.timespan, maxrecords: String(q.maxRecords) }).toString()}`;
}
// "20261013T120000Z"
const seen = (s: unknown): Date | null => { const m = typeof s === "string" ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s) : null; return m ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!)) : null; };

export function parseGdelt(raw: unknown): GdeltArticle[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("resposta do GDELT fora do formato esperado");
  const list = (raw as { articles?: unknown }).articles;
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error("campo articles inválido");
  const out: GdeltArticle[] = [];
  for (const a of list as Record<string, unknown>[]) {
    if (typeof a.url !== "string" || !/^https?:\/\//.test(a.url) || typeof a.title !== "string" || a.title.trim() === "") continue; // item sem URL ou título não vira notícia
    out.push({ url: a.url, title: a.title.trim().slice(0, 500), domain: String(a.domain ?? ""), language: String(a.language ?? ""), sourceCountry: String(a.sourcecountry ?? ""), seenAt: seen(a.seendate) });
  }
  return out;
}

export async function fetchGdelt(c: Omit<CallArgs, "provider" | "endpoint" | "params" | "fetchRaw" | "ttlMs"> & { ctx: PublicCtx; query: string; timespan?: string; maxRecords?: number; ttlMs?: number }): Promise<ProviderResult<GdeltArticle[]>> {
  const q = { query: c.query, timespan: c.timespan ?? "7d", maxRecords: c.maxRecords ?? 25 };
  const endpoint = gdeltEndpoint(q);
  const r = await callProvider({ ...c, provider: GDELT_PROVIDER, endpoint, params: q, ttlMs: c.ttlMs ?? 6 * 3_600_000, fetchRaw: () => publicJson(c.ctx, `https://api.gdeltproject.org/${endpoint}`) });
  if (r.state !== "ok") return r;
  try { return { state: "ok", data: parseGdelt(r.data), provenance: r.provenance }; } catch (e) { return { state: "provider_error", provider: GDELT_PROVIDER, code: "parse", message: (e as Error).message, retryable: false }; }
}
