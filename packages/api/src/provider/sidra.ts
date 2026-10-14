import { callProvider, type CallArgs } from "./store";
import type { ProviderResult } from "./contract";
import { publicJson, type PublicCtx } from "./public";

// SIDRA/IBGE (API pública, sem credencial). Tabela 4714 (Censo 2022: população residente, área e densidade) por município. É dado ESTRUTURAL para fatos de blueprint e
// evidência; NÃO é demanda de busca. Valor ausente ou sigilado na fonte ("-", "..", "...", "X") vira `null` (desconhecido), nunca 0.
export const SIDRA_PROVIDER = "ibge-sidra";
export const SIDRA_VARIABLES = { population: "93", density: "614" } as const;
export interface SidraCityFacts { readonly ibgeCode: string; readonly name: string; readonly year: number | null; readonly population: number | null; readonly densityPerKm2: number | null }

export function sidraEndpoint(ibgeCode: string): string {
  if (!/^\d{7}$/.test(ibgeCode)) throw new RangeError("código IBGE de município precisa ter 7 dígitos");
  return `values/t/4714/n6/${ibgeCode}/v/${SIDRA_VARIABLES.population},${SIDRA_VARIABLES.density}/p/last`;
}
const num = (v: unknown): number | null => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);

/** Normaliza a resposta (lista com cabeçalho na posição 0). Resposta fora do formato lança; nunca devolve valores adivinhados. */
export function parseSidraCity(raw: unknown, ibgeCode: string): SidraCityFacts {
  if (!Array.isArray(raw) || raw.length < 1 || typeof raw[0] !== "object") throw new Error("resposta do SIDRA fora do formato esperado");
  const rows = (raw.slice(1) as Record<string, unknown>[]).filter((r) => r.D1C === ibgeCode);
  if (rows.length === 0) return { ibgeCode, name: "", year: null, population: null, densityPerKm2: null };
  const by = (v: string) => rows.find((r) => r.D2C === v);
  const pop = by(SIDRA_VARIABLES.population); const den = by(SIDRA_VARIABLES.density);
  const year = num((pop ?? den)?.D3C);
  return { ibgeCode, name: String((pop ?? den)!.D1N ?? ""), year: year === null ? null : Math.trunc(year), population: num(pop?.V) === null ? null : Math.trunc(num(pop?.V)!), densityPerKm2: num(den?.V) };
}

export async function fetchSidraCity(c: Omit<CallArgs, "provider" | "endpoint" | "params" | "fetchRaw" | "ttlMs"> & { ctx: PublicCtx; ibgeCode: string; ttlMs?: number }): Promise<ProviderResult<SidraCityFacts>> {
  const endpoint = sidraEndpoint(c.ibgeCode);
  const r = await callProvider({ ...c, provider: SIDRA_PROVIDER, endpoint, params: { ibgeCode: c.ibgeCode }, ttlMs: c.ttlMs ?? 90 * 86_400_000, fetchRaw: () => publicJson(c.ctx, `https://apisidra.ibge.gov.br/${endpoint}`) });
  if (r.state !== "ok") return r;
  try { return { state: "ok", data: parseSidraCity(r.data, c.ibgeCode), provenance: r.provenance }; } catch (e) { return { state: "provider_error", provider: SIDRA_PROVIDER, code: "parse", message: (e as Error).message, retryable: false }; }
}
