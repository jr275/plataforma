import { describe, expect, it } from "vitest";
import {
  competitionFactor, estimateUnits, fillMissingFactors, keywordOverview, limitsAndUsage, normalizeKeyword, resolveAhrefsConfig,
  toEvidence, UnitBudget, type AhrefsDeps, type AhrefsFetcher, type AhrefsLogEvent, type KeywordOverviewRequest,
} from "./ahrefs";
import { memoryCache } from "./provider-runtime";
import { computeScore } from "./score-v1";

// Fixtures SINTÉTICAS no formato documentado da API v3 da Ahrefs (keywords-explorer/overview e
// subscription-info/limits-and-usage). Nenhum teste usa rede nem chave real: o valor abaixo é um sentinela de teste.
const SENTINEL = "TESTKEY_sentinela_0123456789_abcdef";
const config = { apiKey: SENTINEL, unitBudget: 500 };
const NOW = new Date("2026-10-14T12:00:00Z");

const overview = (keywords: unknown[]) => ({ keywords });
const item = (over: Record<string, unknown> = {}) => ({ keyword: "apartamento em são paulo", volume: 12100, difficulty: 62, cpc: 85, serp_last_update: "2026-10-10T00:00:00Z", ...over });

interface Scripted { status: number; body?: unknown; headers?: Record<string, string>; throws?: { name: string } }
function fakeFetch(script: Scripted[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetcher: AhrefsFetcher = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const r = script.shift() ?? { status: 500 };
    if (r.throws) throw Object.assign(new Error("x"), r.throws);
    return { status: r.status, headers: { get: (n) => r.headers?.[n.toLowerCase()] ?? null }, json: async () => { if (r.body === undefined) throw new Error("not json"); return r.body; } };
  };
  return { fetcher, calls };
}

function deps(over: Partial<AhrefsDeps> & { fetch: AhrefsFetcher }): AhrefsDeps & { logs: AhrefsLogEvent[]; sleeps: number[] } {
  const logs: AhrefsLogEvent[] = [];
  const sleeps: number[] = [];
  return { config, cache: memoryCache(), budget: new UnitBudget(500), now: () => NOW, sleep: async (ms) => { sleeps.push(ms); }, log: (e) => logs.push(e), logs, sleeps, ...over };
}

const req = { keywords: ["apartamento em são paulo"], country: "BR" };

describe("configuração", () => {
  it("sem credencial: provider_not_configured, sem falhar globalmente", () => {
    expect(resolveAhrefsConfig({})).toMatchObject({ ok: false, status: "provider_not_configured", missing: ["AHREFS_API_KEY"] });
  });
  it("AHREFS_ENABLED=false desativa mesmo com chave", () => {
    expect(resolveAhrefsConfig({ AHREFS_API_KEY: SENTINEL, AHREFS_ENABLED: "false" })).toMatchObject({ ok: false });
  });
  it("formato inválido não ecoa o valor", () => {
    const r = resolveAhrefsConfig({ AHREFS_API_KEY: "<sua-chave>" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("sua-chave");
  });
  it("orçamento ausente fica null (consulta paga bloqueada); válido é lido", () => {
    expect(resolveAhrefsConfig({ AHREFS_API_KEY: SENTINEL })).toMatchObject({ ok: true, config: { unitBudget: null } });
    expect(resolveAhrefsConfig({ AHREFS_API_KEY: SENTINEL, AHREFS_UNIT_BUDGET: "300" })).toMatchObject({ ok: true, config: { unitBudget: 300 } });
  });
});

describe("custo e orçamento", () => {
  it("regra oficial: max(50, soma dos campos únicos × linhas)", () => {
    expect(estimateUnits(["keyword", "volume", "difficulty", "cpc", "serp_last_update"], 1)).toBe(50); // 23/linha < base
    expect(estimateUnits(["keyword", "volume", "difficulty", "cpc", "serp_last_update"], 5)).toBe(115); // 23 × 5
    expect(estimateUnits(["volume", "volume"], 10)).toBe(100); // campo repetido conta uma vez
  });
  it("sem AHREFS_UNIT_BUDGET nenhuma consulta paga sai", async () => {
    const { fetcher, calls } = fakeFetch([{ status: 200, body: overview([item()]) }]);
    const r = await keywordOverview(deps({ fetch: fetcher, config: { apiKey: SENTINEL, unitBudget: null } }), req);
    expect(r).toMatchObject({ status: "provider_not_configured", missing: ["AHREFS_UNIT_BUDGET"] });
    expect(calls).toHaveLength(0);
  });
  it("estourar o teto bloqueia ANTES da rede", async () => {
    const { fetcher, calls } = fakeFetch([{ status: 200, body: overview([item()]) }]);
    const r = await keywordOverview(deps({ fetch: fetcher, budget: new UnitBudget(40) }), req);
    expect(r).toMatchObject({ status: "provider_error" });
    expect(calls).toHaveLength(0);
  });
  it("pedido inválido (vírgula, país minúsculo, campo fora da lista, excesso de termos) não chega à rede", async () => {
    const { fetcher, calls } = fakeFetch([]);
    const d = deps({ fetch: fetcher });
    const bads: KeywordOverviewRequest[] = [
      { keywords: ["a,b"], country: "BR" }, { keywords: ["a"], country: "br" }, { keywords: [], country: "BR" },
      { keywords: Array.from({ length: 26 }, (_, i) => `k${i}`), country: "BR" },
      { keywords: ["a"], country: "BR", select: ["keyword", "target" as never] },
    ];
    for (const bad of bads) expect((await keywordOverview(d, bad)).status).toBe("provider_error");
    expect(calls).toHaveLength(0);
  });
});

describe("resposta válida, proveniência e normalização", () => {
  it("sucesso traz provedor, endpoint, mercado, data, custo estimado e tenant", async () => {
    const { fetcher, calls } = fakeFetch([{ status: 200, body: overview([item()]) }]);
    const r = await keywordOverview(deps({ fetch: fetcher, tenantId: "tenant-A" }), req);
    expect(r.status).toBe("success");
    if (r.status !== "success") return;
    expect(r.data[0]).toMatchObject({ source: "ahrefs", keyword: "apartamento em são paulo", country: "BR", volume: 12100, difficulty: 62, cpcUsdCents: 85 });
    expect(r.provenance).toMatchObject({ provider: "ahrefs", endpoint: "/keywords-explorer/overview", collectedAt: NOW.toISOString(), cacheHit: false, costUnits: 50, costSource: "estimated", tenantId: "tenant-A" });
    expect(r.provenance.params).toMatchObject({ country: "BR" });
    expect(calls[0]?.url).toContain("https://api.ahrefs.com/v3/keywords-explorer/overview?");
    expect(calls[0]?.url).toContain("country=BR");
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${SENTINEL}`);
  });
  it("zero real e ausência de dado são distintos", () => {
    const zero = normalizeKeyword({ keyword: "k", volume: 0, difficulty: null }, "BR");
    expect(zero.volume).toBe(0);
    expect(zero.difficulty).toBeNull();
    expect(zero.cpcUsdCents).toBeNull();
  });
  it("resposta sem nenhum campo mensurável é no_data, não sucesso", async () => {
    const { fetcher } = fakeFetch([{ status: 200, body: overview([{ keyword: "x", volume: null, difficulty: null }]) }]);
    expect((await keywordOverview(deps({ fetch: fetcher }), req)).status).toBe("no_data");
  });
  it("resposta vazia (lista vazia) é no_data", async () => {
    const { fetcher } = fakeFetch([{ status: 200, body: overview([]) }]);
    expect((await keywordOverview(deps({ fetch: fetcher }), req)).status).toBe("no_data");
  });
  it("volume 0 informado pela Ahrefs é dado (success)", async () => {
    const { fetcher } = fakeFetch([{ status: 200, body: overview([{ keyword: "x", volume: 0 }]) }]);
    expect((await keywordOverview(deps({ fetch: fetcher }), { keywords: ["x"], country: "BR" })).status).toBe("success");
  });
  it("resposta malformada é provider_error", async () => {
    for (const body of [{ unexpected: true }, { keywords: [{ volume: 1 }] }, { keywords: [{ keyword: "x", difficulty: 250 }] }, "texto"]) {
      const { fetcher } = fakeFetch([{ status: 200, body }]);
      expect(await keywordOverview(deps({ fetch: fetcher }), req)).toMatchObject({ status: "provider_error", reason: "resposta fora do contrato" });
    }
  });
  it("corpo que não é JSON é provider_error", async () => {
    const { fetcher } = fakeFetch([{ status: 200 }]);
    expect(await keywordOverview(deps({ fetch: fetcher }), req)).toMatchObject({ status: "provider_error", reason: "resposta não é JSON" });
  });
});

describe("falhas HTTP, timeout e retries", () => {
  it("401 = credencial recusada, sem retry", async () => {
    const { fetcher, calls } = fakeFetch([{ status: 401, body: ["Error", "Unauthorized"] }]);
    expect(await keywordOverview(deps({ fetch: fetcher }), req)).toMatchObject({ status: "provider_error", httpStatus: 401 });
    expect(calls).toHaveLength(1);
  });
  it("403 aponta plano, acesso e saldo", async () => {
    const { fetcher } = fakeFetch([{ status: 403, body: {} }]);
    const r = await keywordOverview(deps({ fetch: fetcher }), req);
    expect(r).toMatchObject({ status: "provider_error", httpStatus: 403 });
    expect((r as { reason: string }).reason).toContain("plano");
  });
  it("timeout é provider_error e NÃO é repetido", async () => {
    const { fetcher, calls } = fakeFetch([{ status: 0, throws: { name: "TimeoutError" } }]);
    expect(await keywordOverview(deps({ fetch: fetcher }), req)).toMatchObject({ status: "provider_error", reason: "tempo esgotado" });
    expect(calls).toHaveLength(1);
  });
  it("5xx é provider_error e NÃO é repetido (evita consumo duplicado)", async () => {
    const { fetcher, calls } = fakeFetch([{ status: 503, body: {} }, { status: 200, body: overview([item()]) }]);
    expect(await keywordOverview(deps({ fetch: fetcher }), req)).toMatchObject({ status: "provider_error", httpStatus: 503 });
    expect(calls).toHaveLength(1);
  });
  it("429 é repetido respeitando Retry-After e depois tem sucesso", async () => {
    const { fetcher, calls } = fakeFetch([{ status: 429, headers: { "retry-after": "7" } }, { status: 200, body: overview([item()]) }]);
    const d = deps({ fetch: fetcher });
    expect((await keywordOverview(d, req)).status).toBe("success");
    expect(calls).toHaveLength(2);
    expect(d.sleeps).toEqual([7000]);
  });
  it("429 contínuo: retries limitados (backoff) e erro final", async () => {
    const { fetcher, calls } = fakeFetch([{ status: 429 }, { status: 429 }, { status: 429 }, { status: 200, body: overview([item()]) }]);
    const d = deps({ fetch: fetcher });
    expect(await keywordOverview(d, req)).toMatchObject({ status: "provider_error", httpStatus: 429 });
    expect(calls).toHaveLength(3); // 1 + 2 retries; nunca em loop
    expect(d.sleeps).toEqual([1000, 2000]);
  });
});

describe("cache e prevenção de chamadas redundantes", () => {
  it("segunda chamada idêntica usa o cache: sem rede e sem custo; ordem dos termos não importa", async () => {
    const { fetcher, calls } = fakeFetch([{ status: 200, body: overview([item(), item({ keyword: "casa" })]) }]);
    const d = deps({ fetch: fetcher });
    const first = await keywordOverview(d, { keywords: ["casa", "apartamento em são paulo"], country: "BR" });
    const second = await keywordOverview(d, { keywords: ["apartamento em são paulo", "casa"], country: "BR" });
    expect(calls).toHaveLength(1);
    expect(first.status === "success" && first.provenance.cacheHit).toBe(false);
    expect(second.status === "success" && second.provenance).toMatchObject({ cacheHit: true, costUnits: 0 });
    expect(d.budget.summary.requests).toBe(1);
  });
  it("mercado diferente é outra entrada de cache", async () => {
    const { fetcher, calls } = fakeFetch([{ status: 200, body: overview([item()]) }, { status: 200, body: overview([item()]) }]);
    const d = deps({ fetch: fetcher });
    await keywordOverview(d, { ...req, country: "BR" });
    await keywordOverview(d, { ...req, country: "PT" });
    expect(calls).toHaveLength(2);
  });
  it("dado expirado dispara nova consulta (nunca serve dado vencido em silêncio)", async () => {
    const { fetcher, calls } = fakeFetch([{ status: 200, body: overview([item()]) }, { status: 200, body: overview([item({ volume: 999 })]) }]);
    const cache = memoryCache();
    await keywordOverview(deps({ fetch: fetcher, cache, now: () => new Date("2026-08-01T00:00:00Z") }), req);
    const later = await keywordOverview(deps({ fetch: fetcher, cache }), req);
    expect(calls).toHaveLength(2);
    expect(later.status === "success" && later.data[0]?.volume).toBe(999);
  });
});

describe("segredos e isolamento entre tenants", () => {
  it("a chave nunca aparece em logs, resultados, proveniência nem na URL", async () => {
    const ok = fakeFetch([{ status: 200, body: overview([item()]) }]);
    const d1 = deps({ fetch: ok.fetcher, tenantId: "t" });
    const r1 = await keywordOverview(d1, req);
    const bad = fakeFetch([{ status: 401, body: ["Error", "Unauthorized"] }]);
    const d2 = deps({ fetch: bad.fetcher });
    const r2 = await keywordOverview(d2, req);
    const usage = fakeFetch([{ status: 401, body: {} }]);
    const r3 = await limitsAndUsage({ config, fetch: usage.fetcher });
    const everything = JSON.stringify([r1, r2, r3, d1.logs, d2.logs, ok.calls.map((c) => c.url), bad.calls.map((c) => c.url)]);
    expect(everything).not.toContain(SENTINEL);
    expect(everything).not.toContain("TESTKEY_");
  });
  it("tenants distintos compartilham só o cache de dado PÚBLICO; o tenant fica na proveniência e nunca vai à Ahrefs", async () => {
    const { fetcher, calls } = fakeFetch([{ status: 200, body: overview([item()]) }]);
    const cache = memoryCache();
    const a = await keywordOverview(deps({ fetch: fetcher, cache, tenantId: "tenant-A" }), req);
    const b = await keywordOverview(deps({ fetch: fetcher, cache, tenantId: "tenant-B" }), req);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).not.toContain("tenant");
    expect(a.status === "success" && a.provenance.tenantId).toBe("tenant-A");
    expect(b.status === "success" && b.provenance.tenantId).toBe("tenant-B");
  });
});

describe("limits-and-usage (gratuito)", () => {
  it("confirma plano e saldo; não consome orçamento nem usa cache", async () => {
    const { fetcher, calls } = fakeFetch([{ status: 200, body: { limits_and_usage: { subscription: "Standard", units_limit_workspace: 400000, units_usage_workspace: 120, units_usage_api_key: 50, usage_reset_date: "2026-11-01" } } }]);
    const r = await limitsAndUsage({ config, fetch: fetcher, now: () => NOW });
    expect(r).toMatchObject({ status: "success", data: { subscription: "Standard", unitsLimitWorkspace: 400000, unitsUsageWorkspace: 120 }, provenance: { costUnits: 0 } });
    expect(calls[0]?.url).toBe("https://api.ahrefs.com/v3/subscription-info/limits-and-usage?");
  });
  it("401 vira provider_error com o motivo, sem dado", async () => {
    const { fetcher } = fakeFetch([{ status: 401, body: ["Error", "Unauthorized"] }]);
    expect(await limitsAndUsage({ config, fetch: fetcher })).toMatchObject({ status: "provider_error", httpStatus: 401 });
  });
});

describe("Opportunity Score: aditivo, sem substituir fontes", () => {
  const o = normalizeKeyword({ keyword: "k", volume: 100, difficulty: 40 }, "BR");
  it("difficulty ÷ 100 = competition estimado; sem dado = não avaliado", () => {
    expect(competitionFactor(o)).toEqual({ value: 0.4, origin: "estimated" });
    expect(competitionFactor(normalizeKeyword({ keyword: "k" }, "BR"))).toEqual({ value: null, origin: "not_evaluated" });
  });
  it("não sobrescreve um fator que outra fonte já mediu", () => {
    const existing = { competition: { value: 0.9, origin: "measured" as const }, demand: { value: 0.5, origin: "measured" as const } };
    const merged = fillMissingFactors(existing, { competition: competitionFactor(o) });
    expect(merged.competition).toEqual({ value: 0.9, origin: "measured" });
  });
  it("preenche o fator ausente ou não avaliado", () => {
    expect(fillMissingFactors({}, { competition: competitionFactor(o) }).competition).toEqual({ value: 0.4, origin: "estimated" });
    expect(fillMissingFactors({ competition: { value: null, origin: "not_evaluated" } }, { competition: competitionFactor(o) }).competition?.value).toBe(0.4);
  });
  it("falha da Ahrefs não derruba o motor: o score sai com os demais fatores e confiança menor", async () => {
    const { fetcher } = fakeFetch([{ status: 503, body: {} }]);
    const r = await keywordOverview(deps({ fetch: fetcher }), req);
    const ahrefsFactors = r.status === "success" ? { competition: competitionFactor(r.data[0]!) } : {};
    const score = computeScore(fillMissingFactors({ demand: { value: 0.7, origin: "measured" } }, ahrefsFactors));
    expect(score.total).not.toBeNull();
    expect(score.contributions.find((c) => c.factor === "competition")?.evaluated).toBe(false);
  });
  it("evidência traz fonte, data de coleta, data de referência, unidade e limitação", () => {
    const ev = toEvidence(normalizeKeyword({ keyword: "k", volume: 10, serp_last_update: "2026-10-10T00:00:00Z" }, "BR"), NOW.toISOString());
    expect(ev.length).toBeGreaterThanOrEqual(3);
    for (const e of ev) expect(e).toMatchObject({ source: "ahrefs", collectedAt: NOW.toISOString(), referenceDate: "2026-10-10T00:00:00Z" });
    expect(ev[0]?.limitation).toContain("Estimativa");
  });
});
