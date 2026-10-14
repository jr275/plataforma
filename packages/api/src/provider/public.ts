import { SourceError, httpGet, type FetchLike } from "../engine/http";
import { ProviderCallError, type Fetched } from "./store";
import { RateGate } from "./rate";

// Transporte das fontes públicas (sem credencial): HTTPS público, limite de tempo/tamanho, User-Agent identificado e intervalo mínimo por host.
export interface PublicCtx { readonly fetch: FetchLike; readonly userAgent: string; readonly gate: RateGate }
export const PUBLIC_UA = "plataforma-research/0.1 (pesquisa de oportunidades; contato do dono do projeto)";

const CODE: Record<string, ProviderCallError["code"]> = { timeout: "timeout", network: "network", too_large: "parse", invalid_url: "provider_rejected", http: "http" };
/** GET JSON de uma fonte pública; mapeia os erros de transporte para os códigos do contrato (429 → rate_limited). Custo sempre 0. */
export async function publicJson(ctx: PublicCtx, url: string): Promise<Fetched> {
  const host = new URL(url).hostname;
  await ctx.gate.wait(host);
  try {
    const r = await httpGet(ctx.fetch, url, { userAgent: ctx.userAgent, accept: "application/json", timeoutMs: 30_000 });
    let body: unknown;
    try { body = JSON.parse(r.text); } catch { throw new ProviderCallError("parse", `resposta de ${host} não é JSON`, false, r.status); }
    return { body, costUsd: 0, httpStatus: r.status };
  } catch (e) {
    if (e instanceof ProviderCallError) throw e;
    if (e instanceof SourceError) throw new ProviderCallError(e.status === 429 ? "rate_limited" : e.status === 401 || e.status === 403 ? "unauthorized" : (CODE[e.code] ?? "http"), e.message, e.retryable, e.status ?? null);
    throw e;
  }
}
