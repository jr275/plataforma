import { callProvider, type CallArgs } from "./store";
import type { ProviderResult } from "./contract";
import { publicJson, type PublicCtx } from "./public";

// OpenStreetMap via Overpass (público). Contagem de equipamentos num raio ao redor de um ponto. Uso restrito a JOBS: nunca em tempo de renderização (o cache é de 30 dias).
// Cobertura do OSM é irregular: a contagem é o que está MAPEADO, não o que existe, e o parser registra essa limitação. Só categorias de uma lista fechada entram na consulta (sem injeção).
export const OVERPASS_PROVIDER = "overpass";
export const POI_CATEGORIES = { school: 'node["amenity"="school"]', station: 'node["railway"="station"]', park: 'nwr["leisure"="park"]', supermarket: 'node["shop"="supermarket"]' } as const;
export type PoiCategory = keyof typeof POI_CATEGORIES;
export interface PoiCount { readonly category: PoiCategory; readonly count: number; readonly radiusM: number; readonly center: { readonly lat: number; readonly lon: number }; readonly limitation: string }

export function overpassQuery(category: PoiCategory, center: { lat: number; lon: number }, radiusM: number): string {
  if (!(category in POI_CATEGORIES)) throw new RangeError("categoria fora da lista permitida");
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lon) || Math.abs(center.lat) > 90 || Math.abs(center.lon) > 180) throw new RangeError("coordenadas inválidas");
  if (!Number.isInteger(radiusM) || radiusM < 100 || radiusM > 10_000) throw new RangeError("raio entre 100 e 10000 m");
  return `[out:json][timeout:25];(${POI_CATEGORIES[category]}(around:${radiusM},${center.lat.toFixed(5)},${center.lon.toFixed(5)}););out count;`;
}
export function parseOverpassCount(raw: unknown, category: PoiCategory, center: { lat: number; lon: number }, radiusM: number): PoiCount {
  const els = (raw as { elements?: unknown } | null)?.elements;
  const c = Array.isArray(els) ? (els as { type?: string; tags?: Record<string, string> }[]).find((e) => e.type === "count") : undefined;
  const total = c?.tags?.total;
  if (typeof total !== "string" || !/^\d+$/.test(total)) throw new Error("resposta do Overpass sem contagem");
  return { category, count: Number(total), radiusM, center, limitation: "contagem do que está mapeado no OpenStreetMap; a cobertura varia por região e não é um censo" };
}
export async function fetchPoiCount(c: Omit<CallArgs, "provider" | "endpoint" | "params" | "fetchRaw" | "ttlMs"> & { ctx: PublicCtx; category: PoiCategory; center: { lat: number; lon: number }; radiusM: number; ttlMs?: number }): Promise<ProviderResult<PoiCount>> {
  const data = overpassQuery(c.category, c.center, c.radiusM);
  const r = await callProvider({ ...c, provider: OVERPASS_PROVIDER, endpoint: "api/interpreter", params: { data }, ttlMs: c.ttlMs ?? 30 * 86_400_000, fetchRaw: () => publicJson(c.ctx, `https://overpass-api.de/api/interpreter?${new URLSearchParams({ data }).toString()}`) });
  if (r.state !== "ok") return r;
  try { return { state: "ok", data: parseOverpassCount(r.data, c.category, c.center, c.radiusM), provenance: r.provenance }; } catch (e) { return { state: "provider_error", provider: OVERPASS_PROVIDER, code: "parse", message: (e as Error).message, retryable: false }; }
}
