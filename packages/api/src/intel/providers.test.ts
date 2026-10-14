import { describe, expect, it } from "vitest";
import { resolveDataForSeoConfig, searchVolume, serpOrganic, type Fetcher } from "./dataforseo";
import { buildSearchAnalyticsBody, cannibalization, last90Days, resolveGscConfig } from "./gsc";
import { memoryCache, RunBudget } from "./provider-runtime";

// Fixtures SINTÉTICAS no formato documentado da DataForSEO v3. Devem ser substituídas por respostas reais gravadas
// assim que as credenciais forem válidas (Fase 2). Nenhuma delas é usada fora dos testes.
const envelope = (taskStatus: number, result: unknown[] | null, cost = 0.05) => ({
  status_code: 20000, status_message: "Ok.", cost,
  tasks: [{ status_code: taskStatus, status_message: taskStatus === 20000 ? "Ok." : "No Search Results.", cost, result }],
});

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    const r = responses.shift() ?? { status: 500, body: {} };
    return { status: r.status, json: async () => r.body };
  };
  return { fetcher, calls };
}

const config = { login: "l", password: "p" };

describe("DataForSEO", () => {
  it("sem credencial → não configurado, com os nomes que faltam", () => {
    expect(resolveDataForSeoConfig({})).toEqual({ ok: false, missing: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"] });
  });

  it("sucesso traz proveniência completa (provedor, endpoint, parâmetros, data, custo)", async () => {
    const { fetcher } = fakeFetch([{ status: 200, body: envelope(20000, [{ keyword: "apartamento são paulo", search_volume: 12100 }]) }]);
    const budget = new RunBudget();
    const r = await searchVolume({ config, cache: memoryCache(), budget, fetch: fetcher, now: () => new Date("2026-10-14T00:00:00Z") }, ["apartamento são paulo"]);
    expect(r.status).toBe("success");
    if (r.status !== "success") return;
    expect(r.data[0]?.search_volume).toBe(12100);
    expect(r.provenance).toMatchObject({ provider: "dataforseo", endpoint: "/v3/keywords_data/google_ads/search_volume/live", collectedAt: "2026-10-14T00:00:00.000Z", costUsd: 0.05, cacheHit: false });
    expect(r.provenance.params).toMatchObject({ location_code: 2076, language_code: "pt" });
  });

  it("volume null não vira 0: resultado é no_data", async () => {
    const { fetcher } = fakeFetch([{ status: 200, body: envelope(20000, [{ keyword: "x", search_volume: null }]) }]);
    const r = await searchVolume({ config, cache: memoryCache(), budget: new RunBudget(), fetch: fetcher }, ["x"]);
    expect(r.status).toBe("no_data");
  });

  it("HTTP 401 é provider_error, nunca dado", async () => {
    const { fetcher } = fakeFetch([{ status: 401, body: {} }]);
    const r = await serpOrganic({ config, cache: memoryCache(), budget: new RunBudget(), fetch: fetcher }, "casa à venda");
    expect(r).toMatchObject({ status: "provider_error", httpStatus: 401 });
  });

  it("resposta fora do contrato é provider_error", async () => {
    const { fetcher } = fakeFetch([{ status: 200, body: { unexpected: true } }]);
    const r = await serpOrganic({ config, cache: memoryCache(), budget: new RunBudget(), fetch: fetcher }, "casa à venda");
    expect(r.status).toBe("provider_error");
  });

  it("segunda chamada idêntica usa o cache: sem rede e sem custo", async () => {
    const serp = envelope(20000, [{ keyword: "casa", item_types: ["organic"], items: [{ type: "organic", rank_absolute: 1, domain: "a.com.br", url: "https://a.com.br" }] }]);
    const { fetcher, calls } = fakeFetch([{ status: 200, body: serp }]);
    const deps = { config, cache: memoryCache(), budget: new RunBudget(), fetch: fetcher };
    await serpOrganic(deps, "casa");
    const second = await serpOrganic(deps, "casa");
    expect(calls).toHaveLength(1);
    expect(second.status === "success" && second.provenance.cacheHit).toBe(true);
    expect(deps.budget.summary).toMatchObject({ requests: 1, costUsd: 0.05, cacheHitRate: 0.5 });
  });

  it("erro de provedor não é gravado no cache", async () => {
    const { fetcher, calls } = fakeFetch([{ status: 500, body: {} }, { status: 500, body: {} }]);
    const deps = { config, cache: memoryCache(), budget: new RunBudget(), fetch: fetcher };
    await serpOrganic(deps, "casa");
    await serpOrganic(deps, "casa");
    expect(calls).toHaveLength(2);
  });
});

describe("Search Console", () => {
  it("sem credencial → provider_not_configured", () => {
    expect(resolveGscConfig({ GSC_SITE_URL: "sc-domain:remax.com.br" })).toMatchObject({ ok: false, status: "provider_not_configured" });
  });

  it("base64 que não é JSON → provider_not_configured com motivo", () => {
    const r = resolveGscConfig({ GSC_SITE_URL: "sc-domain:remax.com.br", GSC_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from("nao-json").toString("base64") });
    expect(r).toMatchObject({ ok: false, detail: "credencial não decodifica para JSON" });
  });

  it("site inválido é recusado", () => {
    expect(resolveGscConfig({ GSC_SITE_URL: "remax" })).toMatchObject({ ok: false, missing: ["GSC_SITE_URL"] });
  });

  it("aceita credencial por arquivo", () => {
    const account = { type: "service_account", client_email: "sa@p.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n" };
    const r = resolveGscConfig({ GSC_SITE_URL: "sc-domain:remax.com.br", GSC_CREDENTIALS_FILE: "/fora/do/repo.json" }, () => JSON.stringify(account));
    expect(r.ok).toBe(true);
  });

  it("monta consulta de 90 dias com filtro de página", () => {
    const w = last90Days(new Date("2026-10-14T00:00:00Z"));
    expect(w).toEqual({ startDate: "2026-07-14", endDate: "2026-10-11" });
    expect(buildSearchAnalyticsBody({ ...w, dimensions: ["query", "page"], rowLimit: 1000, pageContains: "/sao-paulo" }).dimensionFilterGroups?.[0]?.filters[0]).toMatchObject({ dimension: "page", expression: "/sao-paulo" });
  });

  it("canibalização: conta páginas distintas e a melhor posição; sem linhas é null, não 0", () => {
    const rows = [
      { keys: ["apartamento sp", "/a"], clicks: 1, impressions: 10, ctr: 0.1, position: 8 },
      { keys: ["apartamento sp", "/b"], clicks: 0, impressions: 4, ctr: 0, position: 14 },
    ];
    expect(cannibalization(rows, "Apartamento SP")).toEqual({ pages: 2, bestPosition: 8 });
    expect(cannibalization([], "x")).toEqual({ pages: 0, bestPosition: null });
  });
});
