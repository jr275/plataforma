import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  classifyApiError,
  diagnoseGscConfiguration,
  lastSevenCompleteDays,
  parseGscCredential,
  parseGscProperty,
  redactSecrets,
  toProviderStatus,
  validateGscConnection,
  validationEvent,
  type GoogleFetch,
  type GscValidationResult,
} from "./gsc-diagnostics";
import { normalizeSearchFacts, overlappingTargets } from "./gsc-facts";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const SA = { type: "service_account", project_id: "gsc-extractor-511218", client_email: "gsc-reader@gsc-extractor-511218.iam.gserviceaccount.com", private_key: PEM, token_uri: "https://oauth2.googleapis.com/token" };
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
const NOW = new Date("2026-10-14T12:00:00Z");
const env = (over: Record<string, string | undefined> = {}) => ({ GSC_SERVICE_ACCOUNT_JSON_BASE64: b64(SA), GSC_SITE_URL: "sc-domain:remax.com.br", ...over });

type Route = { status: number; body: unknown } | "timeout" | "network";
function fakeGoogle(routes: { token?: Route; sites?: Route; query?: Route }) {
  const calls: { url: string; method: string; body?: string; auth?: string }[] = [];
  const fetch: GoogleFetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body, auth: init.headers.Authorization });
    const route = url.includes("oauth2") ? routes.token : url.endsWith("/sites") ? routes.sites : routes.query;
    const r = route ?? { status: 200, body: {} };
    if (r === "network") throw new TypeError("fetch failed");
    if (r === "timeout") {
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    }
    return { status: r.status, json: async () => r.body };
  };
  return { fetch, calls };
}
const okToken: Route = { status: 200, body: { access_token: "ya29.secret-token-value", expires_in: 3599 } };
const okSites: Route = { status: 200, body: { siteEntry: [{ siteUrl: "sc-domain:remax.com.br", permissionLevel: "siteRestrictedUser" }] } };

async function run(routes: Parameters<typeof fakeGoogle>[0], e = env(), timeoutMs = 50) {
  const g = fakeGoogle(routes);
  const result = await validateGscConnection({ env: e, fetch: g.fetch, now: () => NOW, timeoutMs });
  return { result, calls: g.calls };
}
const check = (r: GscValidationResult, id: string) => r.checks.find((c) => c.id === id)?.state;

describe("propriedade", () => {
  it("distingue domínio e prefixo de URL, sem substituir um pelo outro", () => {
    expect(parseGscProperty("sc-domain:remax.com.br")).toEqual({ ok: true, property: { value: "sc-domain:remax.com.br", kind: "domain" } });
    expect(parseGscProperty("https://www.remax.com.br/")).toEqual({ ok: true, property: { value: "https://www.remax.com.br/", kind: "url_prefix" } });
  });
  it.each(["sc-domain:https://remax.com.br", "sc-domain:remax.com.br/imoveis", "https://www.remax.com.br", "ftp://remax.com.br/", "remax.com.br", "https://x.com/?a=1"])("rejeita %s", (v) => {
    expect(parseGscProperty(v).ok).toBe(false);
  });
});

describe("credencial", () => {
  it("ausente → not_configured", () => {
    const r = diagnoseGscConfiguration({ GSC_SITE_URL: "sc-domain:remax.com.br" });
    expect(r.status).toBe("not_configured");
    expect(r.error?.code).toBe("credentials_missing");
    expect(check(r, "credentials_configured")).toBe("failed");
  });
  it("JSON cru no lugar do base64 é identificado especificamente", () => {
    const r = parseGscCredential({ GSC_SERVICE_ACCOUNT_JSON_BASE64: JSON.stringify(SA) });
    expect(r).toMatchObject({ ok: false, code: "credential_raw_json" });
  });
  it("base64 malformado", () => {
    expect(parseGscCredential({ GSC_SERVICE_ACCOUNT_JSON_BASE64: "não%%base64!!" })).toMatchObject({ ok: false, code: "credential_not_base64" });
  });
  it("base64 válido que não é JSON", () => {
    expect(parseGscCredential({ GSC_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from("isso não é json").toString("base64") })).toMatchObject({ ok: false, code: "credential_not_json" });
  });
  it("cliente OAuth Desktop nunca é tratado como service account", () => {
    const oauth = { installed: { client_id: "1.apps.googleusercontent.com", project_id: "gsc-extractor-511218", client_secret: "GOCSPX-supersecret", redirect_uris: ["http://localhost"] } };
    const r = diagnoseGscConfiguration(env({ GSC_SERVICE_ACCOUNT_JSON_BASE64: b64(oauth) }));
    expect(r.status).toBe("invalid_credentials");
    expect(r.error?.code).toBe("credential_oauth_client");
    expect(JSON.stringify(r)).not.toContain("GOCSPX");
  });
  it("campos obrigatórios ausentes são listados pelo nome, sem valores", () => {
    const r = parseGscCredential({ GSC_SERVICE_ACCOUNT_JSON_BASE64: b64({ type: "service_account", client_email: "a@b.iam.gserviceaccount.com" }) });
    expect(r).toMatchObject({ ok: false, code: "credential_missing_fields", missingFields: ["private_key"] });
  });
  it("configuração local válida NÃO vira connected", () => {
    const r = diagnoseGscConfiguration(env(), { now: () => NOW });
    expect(r.status).toBe("configured_not_validated");
    expect(r.identity?.clientEmail).toBe(SA.client_email);
    expect(check(r, "authentication")).toBe("pending");
    expect(check(r, "search_analytics")).toBe("pending");
    expect(JSON.stringify(r)).not.toContain("PRIVATE KEY");
  });
  it("propriedade inválida com credencial válida → invalid_property", () => {
    expect(diagnoseGscConfiguration(env({ GSC_SITE_URL: "remax.com.br" })).status).toBe("invalid_property");
  });
});

describe("validação ao vivo (Google simulado)", () => {
  it("sucesso com linhas → connected, consulta de 7 dias completos, escopo só leitura", async () => {
    const { result, calls } = await run({ token: okToken, sites: okSites, query: { status: 200, body: { rows: [{ keys: ["2026-10-05"], clicks: 3, impressions: 40, ctr: 0.075, position: 8.1 }] } } });
    expect(result.status).toBe("connected");
    expect(result.rowsReturned).toBe(1);
    expect(result.dateRange).toEqual({ startDate: "2026-10-05", endDate: "2026-10-11" });
    expect(result.checks.every((c) => c.state === "passed")).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET", "POST"]);
    expect(calls[2]!.url).toContain(encodeURIComponent("sc-domain:remax.com.br"));
    expect(toProviderStatus(result.status)).toBe("success");
  });
  it("sucesso sem linhas → connected_no_data, não falha", async () => {
    const { result } = await run({ token: okToken, sites: okSites, query: { status: 200, body: {} } });
    expect(result.status).toBe("connected_no_data");
    expect(result.rowsReturned).toBe(0);
    expect(result.error).toBeNull();
    expect(toProviderStatus(result.status)).toBe("no_data");
  });
  it("autenticação recusada → invalid_credentials (auth_failed)", async () => {
    const { result } = await run({ token: { status: 400, body: { error: "invalid_grant", error_description: "Invalid JWT Signature." } } });
    expect(result.status).toBe("invalid_credentials");
    expect(result.error).toMatchObject({ code: "auth_failed", httpStatus: 400, upstreamReason: "invalid_grant" });
    expect(check(result, "authentication")).toBe("failed");
    expect(check(result, "api_access")).toBe("not_checked");
    expect(JSON.stringify(result)).not.toContain("Invalid JWT Signature");
  });
  it("API desabilitada → api_not_enabled_or_unavailable", async () => {
    const { result } = await run({ token: okToken, sites: { status: 403, body: { error: { code: 403, status: "PERMISSION_DENIED", message: "Google Search Console API has not been used in project 123", details: [{ reason: "SERVICE_DISABLED" }] } } } });
    expect(result.status).toBe("api_not_enabled_or_unavailable");
    expect(result.error?.code).toBe("api_disabled");
    expect(result.remediation?.actor).toBe("administrador do Google Cloud");
    expect(JSON.stringify(result)).not.toContain("has not been used");
  });
  it("API indisponível (5xx)", async () => {
    const { result } = await run({ token: okToken, sites: { status: 503, body: { error: { status: "UNAVAILABLE" } } } });
    expect(result.error?.code).toBe("api_unavailable");
  });
  it("propriedade não acessível → permission_denied com orientação de acesso", async () => {
    const { result } = await run({ token: okToken, sites: { status: 200, body: { siteEntry: [{ siteUrl: "sc-domain:outro.com.br", permissionLevel: "siteOwner" }] } } });
    expect(result.status).toBe("permission_denied");
    expect(result.error?.code).toBe("property_not_found");
    expect(check(result, "api_access")).toBe("passed");
    expect(check(result, "property_access")).toBe("failed");
  });
  it("não troca prefixo de URL por propriedade de domínio", async () => {
    const { result } = await run({ token: okToken, sites: okSites }, env({ GSC_SITE_URL: "https://www.remax.com.br/" }));
    expect(result.error?.code).toBe("property_not_found");
    expect(result.explanation).toMatch(/outro tipo/);
  });
  it("usuário não verificado não conta como acesso", async () => {
    const { result } = await run({ token: okToken, sites: { status: 200, body: { siteEntry: [{ siteUrl: "sc-domain:remax.com.br", permissionLevel: "siteUnverifiedUser" }] } } });
    expect(result.error?.code).toBe("property_unverified");
  });
  it("permissão negada na consulta", async () => {
    const { result } = await run({ token: okToken, sites: okSites, query: { status: 403, body: { error: { errors: [{ reason: "forbidden" }] } } } });
    expect(result.status).toBe("permission_denied");
    expect(check(result, "search_analytics")).toBe("failed");
  });
  it("rate limit → provider_error (rate_limited), não credencial inválida", async () => {
    const { result } = await run({ token: okToken, sites: okSites, query: { status: 429, body: { error: { status: "RESOURCE_EXHAUSTED" } } } });
    expect(result.status).toBe("provider_error");
    expect(result.error?.code).toBe("rate_limited");
  });
  it("timeout é abortado e classificado", async () => {
    const { result } = await run({ token: okToken, sites: "timeout" });
    expect(result.error?.code).toBe("timeout");
    expect(result.status).toBe("provider_error");
  });
  it("falha de rede", async () => {
    const { result } = await run({ token: "network" });
    expect(result.error?.code).toBe("network_error");
  });
  it("resposta fora do contrato não vira dado", async () => {
    const { result } = await run({ token: okToken, sites: okSites, query: { status: 200, body: { rows: "x" } } });
    expect(result.error?.code).toBe("unexpected_response");
  });
  it("configuração inválida não faz nenhuma chamada externa", async () => {
    const { result, calls } = await run({}, env({ GSC_SERVICE_ACCOUNT_JSON_BASE64: JSON.stringify(SA) }));
    expect(result.status).toBe("invalid_credentials");
    expect(calls).toHaveLength(0);
  });
  it("o token de acesso nunca aparece no resultado nem no evento", async () => {
    const { result } = await run({ token: okToken, sites: okSites, query: { status: 200, body: {} } });
    const serialized = JSON.stringify([result, validationEvent(result, { tenantId: "t1" })]);
    expect(serialized).not.toContain("ya29");
    expect(serialized).not.toContain("PRIVATE KEY");
  });
});

describe("sanitização e mapeamento", () => {
  it("só motivos da lista permitida passam", () => {
    expect(classifyApiError(400, { error: { message: "segredo do upstream", errors: [{ reason: "algo-desconhecido" }] } })).toEqual({ code: "upstream_error", httpStatus: 400, upstreamReason: undefined });
  });
  it("redactSecrets remove chave, token, JWT e segredo OAuth", () => {
    const text = `${PEM} Bearer ya29.abc eyJhbGciOi.eyJzdWIi.c2ln GOCSPX-abc123`;
    const out = redactSecrets(text);
    expect(out).not.toMatch(/PRIVATE KEY-----\n[A-Za-z0-9]/);
    expect(out).not.toContain("ya29.abc");
    expect(out).not.toContain("eyJhbGciOi");
    expect(out).not.toContain("GOCSPX-abc123");
  });
  it("janela de 7 dias completos termina 3 dias antes de hoje (UTC)", () => {
    expect(lastSevenCompleteDays(new Date("2026-03-02T01:00:00Z"))).toEqual({ startDate: "2026-02-21", endDate: "2026-02-27" });
  });
  it("evento operacional carrega o tenant e nenhum dado sensível", () => {
    const r = diagnoseGscConfiguration(env(), { now: () => NOW });
    expect(validationEvent(r, { tenantId: "tenant-a" })).toMatchObject({ tenantId: "tenant-a", propertyKind: "domain", errorCode: null });
  });
});

describe("fatos de desempenho", () => {
  const property = { value: "sc-domain:remax.com.br", kind: "domain" as const };
  const base = { property, searchType: "web" as const, dateRange: { startDate: "2026-10-05", endDate: "2026-10-11" }, extractedAt: NOW.toISOString() };
  it("preserva proveniência e não inventa dimensões não pedidas", () => {
    const { facts, rejected } = normalizeSearchFacts({ ...base, dimensions: ["query", "page"], rows: [
      { keys: ["casas em campinas", "https://www.remax.com.br/a"], clicks: 2, impressions: 30, ctr: 0.066, position: 7 },
      { keys: ["só uma chave"], clicks: 0, impressions: 1, ctr: 0, position: 50 },
    ] });
    expect(rejected).toBe(1);
    expect(facts[0]).toMatchObject({ epistemic: "OBSERVED_TRUE", query: "casas em campinas", page: "https://www.remax.com.br/a", provenance: { property: "sc-domain:remax.com.br", searchType: "web" } });
    expect(facts[0]).not.toHaveProperty("country");
    expect(facts[0]).not.toHaveProperty("device");
  });
  it("sobreposição de alvo é sinal derivado e exige 2+ páginas", () => {
    const { facts } = normalizeSearchFacts({ ...base, dimensions: ["query", "page"], rows: [
      { keys: ["apartamento campinas", "/a"], clicks: 1, impressions: 20, ctr: 0.05, position: 9 },
      { keys: ["apartamento campinas", "/b"], clicks: 0, impressions: 12, ctr: 0, position: 14 },
      { keys: ["casa sorocaba", "/c"], clicks: 0, impressions: 5, ctr: 0, position: 20 },
    ] });
    const overlaps = overlappingTargets(facts);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.pages.map((p) => p.page)).toEqual(["/a", "/b"]);
  });
});
