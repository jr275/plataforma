import { createSign } from "node:crypto";
import { callProvider, ProviderCallError, type CallArgs, type Fetched } from "./store";
import { missingEnv, notConfigured, providerError, type EnvLike, type ProviderResult } from "./contract";
import { publicJson, type PublicCtx } from "./public";

// Search Console (ADR-027), SOMENTE LEITURA, por conta de serviço (GSC_CLIENT_EMAIL, GSC_PRIVATE_KEY, GSC_SITE_URL). O JWT é assinado aqui (RS256) e trocado por um token de acesso que fica só
// em memória (nunca em `provider_call`). Alimenta canibalização e posição atual; sem linhas para a propriedade, os fatores continuam DESCONHECIDOS (nunca zero).
export const GSC_PROVIDER = "google-search-console";
export const GSC_ENV = ["GSC_CLIENT_EMAIL", "GSC_PRIVATE_KEY", "GSC_SITE_URL"] as const;
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const b64u = (b: Buffer | string): string => Buffer.from(b).toString("base64url");

/** A chave privada pode vir com `\n` literais (formato comum em variáveis de ambiente). */
export const normalizePrivateKey = (k: string): string => k.replace(/\\n/g, "\n").trim();
export function buildServiceJwt(email: string, privateKey: string, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000);
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64u(JSON.stringify({ iss: email, scope: GSC_SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${head}.${claim}`).sign(normalizePrivateKey(privateKey));
  return `${head}.${claim}.${b64u(sig)}`;
}

export interface GscCtx extends PublicCtx { readonly env: EnvLike }
const tokens = new Map<string, { token: string; until: number }>();
async function accessToken(ctx: GscCtx, now: Date): Promise<string> {
  const email = ctx.env.GSC_CLIENT_EMAIL!.trim();
  const hit = tokens.get(email);
  if (hit && hit.until > now.getTime() + 60_000) return hit.token;
  let jwt: string;
  try { jwt = buildServiceJwt(email, ctx.env.GSC_PRIVATE_KEY!, now); } catch { throw new ProviderCallError("unauthorized", "a chave privada da conta de serviço é inválida", false); }
  const f = await publicJson(ctx, TOKEN_URL, { method: "POST", body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }).toString(), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  const t = f.body as { access_token?: unknown; expires_in?: unknown };
  if (typeof t.access_token !== "string") throw new ProviderCallError("unauthorized", "o Google não devolveu um token de acesso", false);
  tokens.set(email, { token: t.access_token, until: now.getTime() + (typeof t.expires_in === "number" ? t.expires_in : 3600) * 1000 });
  return t.access_token;
}
export const clearGscTokenCache = (): void => tokens.clear();

export interface GscQuery { readonly startDate: string; readonly endDate: string; readonly dimensions: readonly ("query" | "page" | "date" | "country" | "device")[]; readonly rowLimit?: number; readonly startRow?: number }
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function gscBody(q: GscQuery): Record<string, unknown> {
  if (!DATE.test(q.startDate) || !DATE.test(q.endDate) || q.startDate > q.endDate) throw new RangeError("intervalo de datas inválido (AAAA-MM-DD, início ≤ fim)");
  if (q.dimensions.length < 1 || q.dimensions.length > 3) throw new RangeError("de 1 a 3 dimensões");
  const limit = q.rowLimit ?? 1000; if (!Number.isInteger(limit) || limit < 1 || limit > 25000) throw new RangeError("rowLimit entre 1 e 25000");
  return { startDate: q.startDate, endDate: q.endDate, dimensions: [...q.dimensions], rowLimit: limit, startRow: q.startRow ?? 0, dataState: "final" };
}

export interface GscRow { readonly keys: readonly string[]; readonly clicks: number; readonly impressions: number; readonly ctr: number | null; readonly position: number | null }
/** `{}` (sem a chave `rows`) significa que NÃO há dados no período: lista vazia. Isso não é "posição 0" nem "zero cliques": quem consome trata como desconhecido. */
export function parseGsc(raw: unknown): GscRow[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("resposta do Search Console fora do formato");
  const rows = (raw as { rows?: unknown }).rows;
  if (rows === undefined) return [];
  if (!Array.isArray(rows)) throw new Error("campo rows inválido");
  return (rows as Record<string, unknown>[]).flatMap((r) => {
    const keys = Array.isArray(r.keys) ? (r.keys as unknown[]).filter((k): k is string => typeof k === "string") : [];
    if (keys.length === 0 || typeof r.clicks !== "number" || typeof r.impressions !== "number") return [];
    return [{ keys, clicks: r.clicks, impressions: r.impressions, ctr: typeof r.ctr === "number" ? r.ctr : null, position: typeof r.position === "number" ? r.position : null }];
  });
}

export async function fetchGsc(ctx: GscCtx, base: Omit<CallArgs, "provider" | "endpoint" | "params" | "fetchRaw" | "ttlMs">, q: GscQuery): Promise<ProviderResult<GscRow[]>> {
  const missing = missingEnv(ctx.env, GSC_ENV);
  if (missing.length > 0) return notConfigured(GSC_PROVIDER, missing);
  const site = ctx.env.GSC_SITE_URL!.trim();
  if (!/^(https?:\/\/[^\s/]+\/?|sc-domain:[a-z0-9.-]+)$/i.test(site)) return providerError(GSC_PROVIDER, "provider_rejected", "GSC_SITE_URL deve ser uma URL de propriedade (https://…/) ou sc-domain:dominio");
  const body = gscBody(q);
  const endpoint = `webmasters/v3/sites/{site}/searchAnalytics/query`;
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
  const fetchRaw = async (): Promise<Fetched> => {
    const token = await accessToken(ctx, base.now());
    return publicJson(ctx, url, { method: "POST", body: JSON.stringify(body), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  };
  const r = await callProvider({ ...base, provider: GSC_PROVIDER, endpoint, params: { site, ...body }, ttlMs: 24 * 3_600_000, fetchRaw });
  if (r.state !== "ok") return r;
  try { return { state: "ok", data: parseGsc(r.data), provenance: r.provenance }; } catch (e) { return providerError(GSC_PROVIDER, "parse", (e as Error).message); }
}

/** Páginas próprias que já aparecem para uma consulta (canibalização). Sem NENHUMA linha de dados, o resultado é `unknown` (não "nenhuma página"). */
export type OwnPages = { readonly state: "unknown"; readonly reason: string } | { readonly state: "known"; readonly pages: readonly { page: string; impressions: number; position: number | null }[] };
export function ownPagesForQuery(rows: readonly GscRow[], query: string): OwnPages {
  if (rows.length === 0) return { state: "unknown", reason: "o Search Console não devolveu dados para a propriedade no período (propriedade nova ou sem impressões): nada pode ser afirmado" };
  const q = query.trim().toLowerCase();
  const pages = rows.filter((r) => r.keys.length >= 2 && r.keys[0]!.toLowerCase() === q).map((r) => ({ page: r.keys[1]!, impressions: r.impressions, position: r.position }));
  return { state: "known", pages };
}
