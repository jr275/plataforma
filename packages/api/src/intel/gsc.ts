import { readFileSync } from "node:fs";
import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";

// Adapter Search Console (Fase 2). Credencial somente leitura, em duas formas: GSC_CREDENTIALS_FILE (local, fora do repo)
// ou GSC_SERVICE_ACCOUNT_JSON_BASE64 (Vercel/v0). Sem credencial válida → provider_not_configured, sem mock.

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export const serviceAccountSchema = z.object({
  type: z.literal("service_account"),
  client_email: z.string().email(),
  private_key: z.string().includes("PRIVATE KEY"),
  token_uri: z.string().url().default("https://oauth2.googleapis.com/token"),
});
export type ServiceAccount = z.infer<typeof serviceAccountSchema>;

export interface GscConfig { readonly siteUrl: string; readonly account: ServiceAccount }

export type GscConfigResolution =
  | { readonly ok: true; readonly config: GscConfig }
  | { readonly ok: false; readonly status: "provider_not_configured"; readonly missing: readonly string[]; readonly detail: string };

export function resolveGscConfig(
  env: Readonly<Record<string, string | undefined>>,
  readFile: (path: string) => string = (p) => readFileSync(p, "utf8"),
): GscConfigResolution {
  const missing: string[] = [];
  const siteUrl = env.GSC_SITE_URL?.trim();
  if (!siteUrl) missing.push("GSC_SITE_URL");
  else if (!/^sc-domain:[a-z0-9.-]+$/i.test(siteUrl) && !/^https?:\/\//.test(siteUrl)) {
    return { ok: false, status: "provider_not_configured", missing: ["GSC_SITE_URL"], detail: "GSC_SITE_URL não é uma propriedade válida (ex.: sc-domain:remax.com.br)" };
  }

  let raw: string | null = null;
  if (env.GSC_CREDENTIALS_FILE?.trim()) {
    try { raw = readFile(env.GSC_CREDENTIALS_FILE.trim()); } catch { raw = null; }
  } else if (env.GSC_SERVICE_ACCOUNT_JSON_BASE64?.trim()) {
    raw = Buffer.from(env.GSC_SERVICE_ACCOUNT_JSON_BASE64.trim(), "base64").toString("utf8");
  }
  if (raw === null) missing.push("GSC_CREDENTIALS_FILE|GSC_SERVICE_ACCOUNT_JSON_BASE64");
  if (missing.length) return { ok: false, status: "provider_not_configured", missing, detail: "credencial ausente" };

  let json: unknown;
  try { json = JSON.parse(raw!); } catch {
    return { ok: false, status: "provider_not_configured", missing: ["GSC_SERVICE_ACCOUNT_JSON_BASE64"], detail: "credencial não decodifica para JSON" };
  }
  const account = serviceAccountSchema.safeParse(json);
  if (!account.success) {
    return { ok: false, status: "provider_not_configured", missing: ["GSC_SERVICE_ACCOUNT_JSON_BASE64"], detail: "JSON não é uma service account válida" };
  }
  return { ok: true, config: { siteUrl: siteUrl!, account: account.data } };
}

export async function signAssertion(account: ServiceAccount, now: Date = new Date()): Promise<string> {
  const key = await importPKCS8(account.private_key, "RS256");
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ scope: GSC_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.client_email)
    .setAudience(account.token_uri)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(key);
}

export const searchAnalyticsRowSchema = z.object({
  keys: z.array(z.string()),
  clicks: z.number().nonnegative(),
  impressions: z.number().nonnegative(),
  ctr: z.number().nonnegative(),
  position: z.number().positive(),
});
export const searchAnalyticsSchema = z.object({ rows: z.array(searchAnalyticsRowSchema).optional() });
export type SearchAnalyticsRow = z.infer<typeof searchAnalyticsRowSchema>;

export interface SearchAnalyticsRequest {
  readonly startDate: string;
  readonly endDate: string;
  readonly dimensions: readonly ("query" | "page")[];
  readonly rowLimit: number;
  readonly pageContains?: string;
}

export function buildSearchAnalyticsBody(req: SearchAnalyticsRequest) {
  return {
    startDate: req.startDate,
    endDate: req.endDate,
    dimensions: [...req.dimensions],
    rowLimit: req.rowLimit,
    ...(req.pageContains
      ? { dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "contains", expression: req.pageContains }] }] }
      : {}),
  };
}

export function searchAnalyticsUrl(siteUrl: string): string {
  return `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
}

/** Janela padrão de 90 dias terminando 3 dias atrás (os dados do GSC chegam com atraso). */
export function last90Days(now: Date = new Date()): { startDate: string; endDate: string } {
  const end = new Date(now.getTime() - 3 * 86400000);
  const start = new Date(end.getTime() - 89 * 86400000);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

/** Risco de canibalização: quantas páginas nossas já recebem impressões para a query, e a melhor posição. */
export function cannibalization(rows: readonly SearchAnalyticsRow[], query: string): { pages: number; bestPosition: number | null } {
  const q = query.trim().toLowerCase();
  const matching = rows.filter((r) => r.keys[0]?.toLowerCase() === q && r.impressions > 0);
  const pages = new Set(matching.map((r) => r.keys[1])).size;
  const bestPosition = matching.length ? Math.min(...matching.map((r) => r.position)) : null;
  return { pages, bestPosition };
}
