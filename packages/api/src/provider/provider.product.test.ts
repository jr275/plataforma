import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb, devIdentity, runCityImport, withTenant } from "../index";
import { productPoolConfig } from "../testing/pool-config";
import { realEstateVertical } from "../../../../packs/real-estate/src/vertical";
import { bcbSgsAdapter, ibgeNewsAdapter, rssNewsAdapter, runResearch, searchOpportunities } from "../engine";
import { fakeFetch, fixture, type Route } from "../engine/test-support/fake-fetch";
import { PUBLIC_UA, ProviderCallError, RateGate, RunBudget, cacheKeyFor, callProvider, costByRun, ensureCompetitor, fetchGdelt, fetchSidraCity, findCachedCall, latestSignals, recordSerpSnapshot, recordSignal, spentUsd, type Fetched } from "./index";

// Dados de provedores contra o esquema REAL (migration 0011) num PostgreSQL descartável: cache determinístico, custo, orçamento, erros, sinais, SERP, concorrentes e isolamento. Tenants U e V.
const U = "fb666666-6666-4666-8666-666666666666";
const V = "fb777777-7777-4777-8777-777777777777";
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv", import.meta.url));
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };
const FEED = "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml";
const OK: Record<string, Route> = {
  "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/": { body: fixture("bcb-432.json") }, "https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/": { body: fixture("bcb-13522.json") }, "https://api.bcb.gov.br/dados/serie/bcdata.sgs.189/": { body: fixture("bcb-189.json") },
  "https://servicodados.ibge.gov.br/api/v3/noticias/": { body: fixture("ibge-news.json") }, "https://agenciabrasil.ebc.com.br/robots.txt": { body: fixture("agenciabrasil-robots.txt") }, [FEED]: { body: fixture("agenciabrasil-economia.xml") },
};
const T0 = new Date("2026-10-13T15:00:00Z");
let now = T0;
let pool: pg.Pool;
let opp = ""; let runId = "";
const id = () => devIdentity([U, V]);
const as = <X>(t: string, fn: (db: TenantDb) => Promise<X>) => withTenant(pool, id(), t, fn);
beforeAll(async () => {
  pool = new pg.Pool(productPoolConfig(4)); pool.on("error", () => undefined);
  for (const t of [U, V]) await runCityImport(pool, id(), t, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: MAPPING });
  const r = await runResearch(pool, id(), U, { vertical: realEstateVertical, adapters: [bcbSgsAdapter, ibgeNewsAdapter, rssNewsAdapter], fetch: fakeFetch(OK), now: () => T0, sleep: async () => undefined }, { entityLimit: 2 });
  runId = r.runId;
  opp = (await as(U, (db) => searchOpportunities(db, { limit: 5 }))).rows[0]!.id;
});
afterAll(async () => { await pool.end(); });

const ok = (body: unknown, costUsd = 0.0006): Fetched => ({ body, costUsd, httpStatus: 200 });
const args = (db: TenantDb, budget: RunBudget, fetchRaw: () => Promise<Fetched>, over: Partial<Parameters<typeof callProvider>[0]> = {}) =>
  ({ db, provider: "dataforseo", endpoint: "keywords_data/google_ads/search_volume/live", params: { keywords: ["a"], location_code: 2076 }, ttlMs: 7 * 86_400_000, budget, runId, actor: "teste", now: () => now, fetchRaw, ...over });

describe("cache determinístico, custo e orçamento", () => {
  it("a primeira chamada vai ao provedor e grava a resposta bruta com custo; a segunda vem do cache sem requisição", async () => {
    let calls = 0; const budget = RunBudget.create();
    const first = await as(U, (db) => callProvider(args(db, budget, async () => { calls++; return ok({ result: [1] }); })));
    expect(first).toMatchObject({ state: "ok", data: { result: [1] } });
    if (first.state !== "ok") throw new Error();
    expect(first.provenance).toMatchObject({ cached: false, costUsd: 0.0006, provider: "dataforseo" });
    expect(first.provenance.cacheKey).toBe(cacheKeyFor("dataforseo", "keywords_data/google_ads/search_volume/live", { location_code: 2076, keywords: ["a"] }));
    const second = await as(U, (db) => callProvider(args(db, budget, async () => { calls++; return ok({ result: [2] }); })));
    expect(calls).toBe(1);
    expect(second).toMatchObject({ state: "ok", data: { result: [1] } });
    if (second.state === "ok") expect(second.provenance).toMatchObject({ cached: true, costUsd: 0, callId: first.provenance.callId });
    expect(budget.usage.requests).toBe(1);
  });
  it("o cache expira: depois do TTL a chamada é refeita e o histórico guarda as duas respostas", async () => {
    let calls = 0; now = new Date(T0.getTime() + 8 * 86_400_000);
    const r = await as(U, (db) => callProvider(args(db, RunBudget.create(), async () => { calls++; return ok({ result: [3] }); })));
    now = T0;
    expect(calls).toBe(1);
    expect(r).toMatchObject({ state: "ok", data: { result: [3] } });
    const n = await as(U, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.provider_call WHERE provider = 'dataforseo' AND cache_key = $1`, [cacheKeyFor("dataforseo", "keywords_data/google_ads/search_volume/live", { keywords: ["a"], location_code: 2076 })])).rows[0]!.n));
    expect(n).toBe(2);
  });
  it("o cache é por tenant: outro tenant não reaproveita nem enxerga a resposta", async () => {
    const key = cacheKeyFor("dataforseo", "keywords_data/google_ads/search_volume/live", { keywords: ["a"], location_code: 2076 });
    expect(await as(V, (db) => findCachedCall(db, key, T0))).toBeNull();
    expect(await as(V, (db) => spentUsd(db))).toBe(0);
    let calls = 0;
    await as(V, (db) => callProvider(args(db, RunBudget.create(), async () => { calls++; return ok({ result: [9] }); }, { runId: null })));
    expect(calls).toBe(1);
  });
  it("a falha é registrada como provider_error, não é reaproveitada e a próxima chamada tenta de novo", async () => {
    const params = { keywords: ["falha"] }; let calls = 0;
    const bad = await as(U, (db) => callProvider(args(db, RunBudget.create(), async () => { calls++; throw new ProviderCallError("unauthorized", "HTTP 401", false, 401); }, { params })));
    expect(bad).toMatchObject({ state: "provider_error", code: "unauthorized", retryable: false });
    const good = await as(U, (db) => callProvider(args(db, RunBudget.create(), async () => { calls++; return ok({ result: [] }, 0); }, { params })));
    expect(calls).toBe(2);
    expect(good.state).toBe("ok");
    const rows = await as(U, async (db) => (await db.query<{ outcome: string; error_code: string | null; http_status: number | null }>(`SELECT outcome, error_code, http_status FROM plataforma.provider_call WHERE params @> '{"keywords":["falha"]}' ORDER BY collected_at, outcome`)).rows);
    expect(rows.map((r) => r.outcome).sort()).toEqual(["ok", "provider_error"]);
    expect(rows.find((r) => r.outcome === "provider_error")).toMatchObject({ error_code: "unauthorized", http_status: 401 });
  });
  it("uma exceção inesperada do transporte também vira provider_error, sem vazar a mensagem original", async () => {
    const r = await as(U, (db) => callProvider(args(db, RunBudget.create(), async () => { throw new Error("segredo=abc123"); }, { params: { keywords: ["boom"] } })));
    expect(r).toMatchObject({ state: "provider_error", code: "network" });
    expect(JSON.stringify(r)).not.toContain("abc123");
  });
  it("estourar o limite por execução recusa ANTES de chamar o provedor e não grava nada", async () => {
    const budget = RunBudget.create({ maxRequests: 1 }); let calls = 0; const before = await as(U, (db) => spentUsd(db));
    await as(U, (db) => callProvider(args(db, budget, async () => { calls++; return ok({}); }, { params: { keywords: ["b1"] } })));
    const r = await as(U, (db) => callProvider(args(db, budget, async () => { calls++; return ok({}); }, { params: { keywords: ["b2"] } })));
    expect(calls).toBe(1);
    expect(r).toMatchObject({ state: "provider_error", code: "budget_exceeded" });
    const n = await as(U, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.provider_call WHERE params @> '{"keywords":["b2"]}'`)).rows[0]!.n));
    expect(n).toBe(0);
    expect(await as(U, (db) => spentUsd(db))).toBeCloseTo(before + 0.0006, 6);
  });
  it("o teto global de custo usa o gasto GRAVADO: com o gasto anterior perto do teto, a chamada é recusada", async () => {
    const spent = await as(U, (db) => spentUsd(db));
    expect(spent).toBeGreaterThan(0);
    const budget = RunBudget.create({ spentBeforeUsd: spent, capUsd: spent + 0.0001 });
    const r = await as(U, (db) => callProvider(args(db, budget, async () => ok({}), { params: { keywords: ["teto"] }, estimateUsd: 0.01 })));
    expect(r).toMatchObject({ state: "provider_error", code: "budget_exceeded" });
  });
  it("o custo por execução soma só as requisições reais e separa os erros", async () => {
    const c = await as(U, (db) => costByRun(db, runId));
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ provider: "dataforseo" });
    expect(c[0]!.errors).toBeGreaterThanOrEqual(2);
    expect(c[0]!.costUsd).toBeCloseTo(0.0018, 6);
    expect(await as(V, (db) => costByRun(db, runId))).toEqual([]);
  });
});

describe("sinais: ausência não vira linha", () => {
  it("grava métrica de provedor ligada à resposta bruta e devolve o mais recente por fator", async () => {
    const callId = await as(U, async (db) => (await db.query<{ id: string }>(`SELECT id FROM plataforma.provider_call WHERE outcome = 'ok' LIMIT 1`)).rows[0]!.id);
    await as(U, async (db) => {
      await recordSignal(db, { opportunityId: opp, factor: "search_volume", value: 1000, unit: "searches/month", basis: "provider_metric", confidence: 0.9, source: "dataforseo", collectedAt: T0, providerCallId: callId });
      await recordSignal(db, { opportunityId: opp, factor: "search_volume", value: 1200, unit: "searches/month", basis: "provider_metric", confidence: 0.9, source: "dataforseo", collectedAt: new Date(T0.getTime() + 1000), providerCallId: callId });
    });
    const l = await as(U, (db) => latestSignals(db, opp));
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ factor: "search_volume", value: 1200, basis: "provider_metric", providerCallId: callId });
    expect(await as(U, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.opportunity_signal`)).rows[0]!.n))).toBe(2);
  });
  it("métrica de provedor sem a resposta bruta é recusada pelo banco", async () => {
    await expect(as(U, (db) => recordSignal(db, { opportunityId: opp, factor: "cpc", value: 1, basis: "provider_metric", confidence: 0.5, source: "x", collectedAt: T0 }))).rejects.toThrow(/check constraint/);
  });
  it("sinal vencido sai da leitura atual mas permanece no histórico", async () => {
    await as(U, (db) => recordSignal(db, { opportunityId: opp, factor: "trend", value: 5, basis: "derived", confidence: 0.4, source: "regra", collectedAt: T0, expiresAt: new Date(T0.getTime() + 1000) }));
    expect((await as(U, (db) => latestSignals(db, opp, new Date(T0.getTime() + 500)))).map((s) => s.factor).sort()).toEqual(["search_volume", "trend"]);
    expect((await as(U, (db) => latestSignals(db, opp, new Date(T0.getTime() + 5000)))).map((s) => s.factor)).toEqual(["search_volume"]);
  });
  it("o outro tenant não vê os sinais nem grava para a oportunidade alheia", async () => {
    expect(await as(V, (db) => latestSignals(db, opp))).toEqual([]);
    await expect(as(V, (db) => recordSignal(db, { opportunityId: opp, factor: "search_volume", value: 1, basis: "observed", confidence: 0.5, source: "x", collectedAt: T0 }))).rejects.toThrow(/foreign key/);
  });
});

describe("SERP e concorrentes", () => {
  const snap = (callId: string, over: Partial<Parameters<typeof recordSerpSnapshot>[1]> = {}) => ({ opportunityId: opp, providerCallId: callId, query: "apartamento à venda em campinas", country: "BR", language: "pt-BR", locationCode: 2076, locationName: "Brazil", device: "desktop" as const, capturedAt: T0, features: ["people_also_ask"], peopleAlsoAsk: [{ question: "Quanto custa?" }], actor: "teste",
    results: [{ rank: 1, resultType: "organic" as const, url: "https://portal.com.br/a", domain: "portal.com.br", title: "A" }, { rank: 2, resultType: "organic" as const, url: "https://portal.com.br/b", domain: "portal.com.br", title: "B" }, { rank: 3, resultType: "organic" as const, url: "https://blog.com.br/c", domain: "blog.com.br", title: null }], ...over });
  it("grava o instantâneo, os resultados e um concorrente por domínio; repetir a mesma resposta não duplica", async () => {
    const callId = await as(U, async (db) => (await db.query<{ id: string }>(`SELECT id FROM plataforma.provider_call WHERE outcome = 'ok' ORDER BY collected_at LIMIT 1`)).rows[0]!.id);
    const a = await as(U, (db) => recordSerpSnapshot(db, snap(callId)));
    const b = await as(U, (db) => recordSerpSnapshot(db, snap(callId)));
    expect(a.created).toBe(true); expect(b).toEqual({ id: a.id, created: false });
    const rows = await as(U, async (db) => (await db.query<{ rank: number; domain: string; page_type: string | null; kind: string }>(`SELECT r.rank, r.domain, r.page_type, c.kind FROM plataforma.serp_result r JOIN plataforma.competitor c ON c.id = r.competitor_id ORDER BY r.rank`)).rows);
    expect(rows).toEqual([{ rank: 1, domain: "portal.com.br", page_type: null, kind: "observed" }, { rank: 2, domain: "portal.com.br", page_type: null, kind: "observed" }, { rank: 3, domain: "blog.com.br", page_type: null, kind: "observed" }]);
    expect(await as(U, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.competitor`)).rows[0]!.n))).toBe(2);
  });
  it("um concorrente declarado ou próprio não é rebaixado quando aparece numa SERP", async () => {
    const own = await as(U, (db) => ensureCompetitor(db, "meusite.com.br", "own", "teste"));
    const again = await as(U, (db) => ensureCompetitor(db, "meusite.com.br", "observed", "teste"));
    expect(again).toBe(own);
    expect(await as(U, async (db) => (await db.query<{ kind: string }>(`SELECT kind FROM plataforma.competitor WHERE id = $1`, [own])).rows[0]!.kind)).toBe("own");
  });
  it("o outro tenant não enxerga snapshots, resultados nem concorrentes, e não pode apontar para a chamada alheia", async () => {
    for (const t of ["serp_snapshot", "serp_result", "competitor", "provider_call", "opportunity_signal"]) {
      expect(await as(V, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.${t} WHERE tenant_id <> plataforma.current_tenant_id()`)).rows[0]!.n))).toBe(0);
    }
    const callU = await as(U, async (db) => (await db.query<{ id: string }>(`SELECT id FROM plataforma.provider_call WHERE outcome = 'ok' LIMIT 1`)).rows[0]!.id);
    await expect(as(V, (db) => recordSerpSnapshot(db, snap(callU, { opportunityId: null })))).rejects.toThrow(/foreign key/);
  });
  it("a aplicação só consegue classificar o resultado (nunca mudar a posição) e o histórico não é apagável", async () => {
    await as(U, async (db) => { await db.query(`UPDATE plataforma.serp_result SET page_type = 'portal', classification = '{"by":"rule"}'::jsonb WHERE rank = 1`); });
    await expect(as(U, (db) => db.query(`UPDATE plataforma.serp_result SET rank = 9`))).rejects.toThrow(/permission denied/);
    await expect(as(U, (db) => db.query(`DELETE FROM plataforma.serp_snapshot`))).rejects.toThrow(/permission denied/);
    await expect(as(U, (db) => db.query(`UPDATE plataforma.provider_call SET cost_usd = 0`))).rejects.toThrow(/permission denied/);
  });
});

describe("fontes públicas pelo executor (SIDRA real, GDELT limitado)", () => {
  const pfx = (n: string) => readFileSync(new URL(`./__fixtures__/${n}`, import.meta.url), "utf8");
  const pub = (routes: Record<string, Route>) => ({ fetch: fakeFetch(routes), userAgent: PUBLIC_UA, gate: new RateGate({}) });
  it("SIDRA: grava a resposta bruta com custo 0 e proveniência; a segunda chamada vem do cache", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const ctx = { fetch: fakeFetch({ "https://apisidra.ibge.gov.br/": { body: pfx("sidra-4714-3550308.json") } }, calls), userAgent: PUBLIC_UA, gate: new RateGate({}) };
    const run = () => as(U, (db) => fetchSidraCity({ db, ctx, ibgeCode: "3550308", budget: RunBudget.create(), runId, actor: "teste", now: () => now }));
    const a = await run(); const b = await run();
    expect(calls).toHaveLength(1);
    expect(a).toMatchObject({ state: "ok", data: { population: 11451999, year: 2022 }, provenance: { provider: "ibge-sidra", costUsd: 0, cached: false } });
    expect(b).toMatchObject({ state: "ok", provenance: { cached: true, costUsd: 0 } });
  });
  it("GDELT 429 (resposta real) vira provider_error rate_limited, é registrado e não vira cache", async () => {
    const r = await as(U, (db) => fetchGdelt({ db, ctx: pub({ "https://api.gdeltproject.org/": { status: 429, body: pfx("gdelt-429.txt") } }), query: "financiamento imobiliario", budget: RunBudget.create(), runId, actor: "teste", now: () => now }));
    expect(r).toMatchObject({ state: "provider_error", code: "rate_limited", retryable: true });
    const ok = await as(U, (db) => fetchGdelt({ db, ctx: pub({ "https://api.gdeltproject.org/": { body: pfx("gdelt-empty.json") } }), query: "financiamento imobiliario", budget: RunBudget.create(), runId, actor: "teste", now: () => now }));
    expect(ok).toMatchObject({ state: "ok", data: [] });
  });
});

describe("escopo piloto (São Paulo primeiro; Rio e BH configurados)", () => {
  const deps = { vertical: realEstateVertical, adapters: [bcbSgsAdapter, ibgeNewsAdapter, rssNewsAdapter], fetch: fakeFetch(OK), now: () => T0, sleep: async () => undefined };
  it("um escopo desconhecido é recusado antes de abrir a execução", async () => {
    await expect(runResearch(pool, id(), V, deps, { scopeId: "nao-existe" })).rejects.toThrow(/escopo desconhecido/);
    expect(await as(V, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.research_run`)).rows[0]!.n))).toBe(0);
  });
  it("só São Paulo gera oportunidades; Rio e BH aparecem como AUSENTES (não importadas), sem inventar entidades", async () => {
    const r = await runResearch(pool, id(), V, deps, { scopeId: "pilot-three-capitals", entityLimit: 5 });
    expect(r.status).toBe("succeeded");
    expect(r.scope).toEqual({ id: "pilot-three-capitals", label: expect.any(String), requested: ["3550308", "3304557", "3106200"], found: ["3550308"], missing: ["3304557", "3106200"] });
    const l = await as(V, (db) => searchOpportunities(db, { limit: 100 }));
    expect(l.rows.length).toBeGreaterThan(5);
    const entities = await as(V, async (db) => (await db.query<{ n: string | null }>(`SELECT DISTINCT c.name AS n FROM plataforma.growth_opportunity o JOIN plataforma.city c ON c.id = o.entity_id`)).rows.map((x) => x.n));
    expect(entities).toEqual(["São Paulo"]);
    const params = await as(V, async (db) => (await db.query<{ params: { scope?: string } }>(`SELECT params FROM plataforma.research_run`)).rows[0]!.params);
    expect(params.scope).toBe("pilot-three-capitals");
  });
  it("sem demanda de busca nenhuma oportunidade tem prioridade geral nem é declarada elegível por volume", async () => {
    const l = await as(V, (db) => searchOpportunities(db, { limit: 100 }));
    expect(l.rows.some((x) => x.priorityKind === "overall")).toBe(false);
    const demand = await as(V, async (db) => (await db.query<{ d: { basis: string; value: unknown } }>(`SELECT DISTINCT demand AS d FROM plataforma.growth_opportunity`)).rows.map((x) => x.d));
    expect(demand).toHaveLength(1);
    expect(demand[0]).toMatchObject({ basis: "unknown", value: null });
    expect(await as(V, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.opportunity_signal`)).rows[0]!.n))).toBe(0);
  });
});
