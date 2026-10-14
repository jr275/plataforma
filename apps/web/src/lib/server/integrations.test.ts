import { describe, expect, it } from "vitest";
import { buildIntegrations, type ProbeInput } from "./integrations";

const ENV_OK = { NEXT_PUBLIC_SUPABASE_URL: "https://projeto-secreto.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_SEGREDO", PLATAFORMA_APP_DATABASE_URL: "postgresql://u:SENHA@host.neon.tech/db" };
const READY: ProbeInput["database"] = { state: "ready", data: { cities: 5571, realRuns: 1, lastRealRun: "succeeded" }, origin: { kind: "remote", host: "ep-x.neon.tech" } };
const AT = new Date("2026-10-13T15:00:00Z");
const withResearch = (research: { adapter: string; status: string; at: Date }[] | undefined): ProbeInput["database"] => ({ state: "ready", data: { cities: 645, realRuns: 1, lastRealRun: "succeeded", research }, origin: { kind: "local", host: "socket" } });
const get = (list: ReturnType<typeof buildIntegrations>, id: string) => list.find((e) => e.id === id)!;

describe("status das integrações: só o que foi verificado agora é 'operacional'", () => {
  it("tudo configurado e sondado: login e banco operacionais; IBGE operacional; as demais seguem bloqueadas", () => {
    const l = buildIntegrations({ env: ENV_OK, identity: "ok", database: READY });
    expect(get(l, "supabase-auth").status).toBe("operational");
    expect(get(l, "app-database").status).toBe("operational");
    expect(get(l, "app-database").detail).toContain("5.571");
    expect(get(l, "ibge-cities").status).toBe("operational");
    for (const id of ["ga4", "property-feed", "publication", "ai-citations"]) { expect(get(l, id).status, id).toBe("blocked_external"); expect(get(l, id).dependency, id).toMatch(/\S/); }
  });
  it("fontes bloqueadas NUNCA aparecem como operacionais, em nenhuma combinação de entradas", () => {
    for (const identity of ["ok", "unauthenticated", "not_configured", "error"] as const) for (const database of [READY, { state: "error" } as ProbeInput["database"], { state: "not_configured", missing: "x" } as ProbeInput["database"]]) {
      const l = buildIntegrations({ env: ENV_OK, identity, database });
      for (const id of ["ga4", "property-feed", "publication", "ai-citations"]) expect(get(l, id).status).toBe("blocked_external");
    }
  });
  it("variáveis ausentes: não configurado, com o que fazer; presentes mas sem sessão: configurado, NÃO verificado", () => {
    const none = buildIntegrations({ env: {}, identity: "not_configured", database: { state: "not_configured", missing: "banco" } });
    expect(get(none, "supabase-auth")).toMatchObject({ status: "not_configured", env: [{ name: "NEXT_PUBLIC_SUPABASE_URL", set: false }, { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", set: false }] });
    expect(get(none, "app-database").status).toBe("not_configured");
    const noSession = buildIntegrations({ env: ENV_OK, identity: "unauthenticated", database: { state: "unauthenticated" } });
    expect(get(noSession, "supabase-auth").status).toBe("configured_unverified");
    expect(get(noSession, "app-database").status).toBe("configured_unverified");
  });
  it("estados do banco: indisponível e erro viram 'falha agora'; migrations pendentes pedem autorização; vazio não é sucesso", () => {
    expect(get(buildIntegrations({ env: ENV_OK, identity: "ok", database: { state: "db_unavailable" } }), "app-database")).toMatchObject({ status: "error", detail: expect.stringContaining("não respondeu") });
    expect(get(buildIntegrations({ env: ENV_OK, identity: "ok", database: { state: "error" } }), "app-database").status).toBe("error");
    expect(get(buildIntegrations({ env: ENV_OK, identity: "ok", database: { state: "not_migrated" } }), "app-database")).toMatchObject({ status: "configured_unverified", dependency: expect.stringContaining("autorização") });
    const empty = buildIntegrations({ env: ENV_OK, identity: "ok", database: { state: "ready", data: { cities: 0, realRuns: 0, lastRealRun: null }, origin: undefined } });
    expect(get(empty, "ibge-cities").status).toBe("not_configured"); // banco respondeu, mas não há importação real
  });
  it("IBGE: importação real que falhou ou ficou parcial não conta como operacional", () => {
    for (const last of ["partial", "failed", "running"] as const) expect(get(buildIntegrations({ env: ENV_OK, identity: "ok", database: { state: "ready", data: { cities: 10, realRuns: 1, lastRealRun: last }, origin: undefined } }), "ibge-cities").status, last).not.toBe("operational");
  });
  it("NENHUM valor de configuração vaza: só nomes de variáveis e se estão definidas", () => {
    const json = JSON.stringify(buildIntegrations({ env: ENV_OK, identity: "ok", database: READY }));
    expect(json).not.toMatch(/SEGREDO|SENHA|projeto-secreto|postgresql:|sb_publishable|ep-x\.neon\.tech/);
    expect(json).toContain("PLATAFORMA_APP_DATABASE_URL");
  });
  it("variável vazia ou só com espaços conta como ausente", () => {
    const l = buildIntegrations({ env: { ...ENV_OK, NEXT_PUBLIC_SUPABASE_URL: "  ", PLATAFORMA_APP_DATABASE_URL: "" }, identity: "ok", database: READY });
    expect(get(l, "supabase-auth").status).toBe("not_configured");
    expect(get(l, "app-database").env[0]).toEqual({ name: "PLATAFORMA_APP_DATABASE_URL", set: false });
  });
});

describe("fontes de pesquisa (BCB, IBGE, Agência Brasil): operacional só depois de uma consulta REAL bem-sucedida registrada", () => {
  const ids = ["bcb-sgs", "ibge-news", "rss-news"];
  it("sem pesquisa registrada: não configurada, com o que fazer; nunca operacional", () => {
    for (const research of [[], undefined]) { const l = buildIntegrations({ env: ENV_OK, identity: "ok", database: withResearch(research) }); for (const id of ids) { expect(get(l, id).status, id).toBe("not_configured"); expect(get(l, id).dependency, id).toContain("pesquisa"); } }
  });
  it("sucesso na última pesquisa: operacional; parcial ou falha: erro (e não operacional); cada fonte por si", () => {
    const l = buildIntegrations({ env: ENV_OK, identity: "ok", database: withResearch([{ adapter: "bcb-sgs", status: "succeeded", at: AT }, { adapter: "ibge-news", status: "partial", at: AT }, { adapter: "rss-news", status: "failed", at: AT }]) });
    expect(get(l, "bcb-sgs").status).toBe("operational");
    expect(get(l, "ibge-news").status).toBe("error");
    expect(get(l, "rss-news").status).toBe("error");
    expect(get(l, "ibge-news").detail).toContain("parcial");
  });
  it("sem leitura do banco: nada de operacional; Trends e SERP seguem bloqueados em qualquer combinação", () => {
    for (const database of [{ state: "error" } as ProbeInput["database"], { state: "not_migrated" } as ProbeInput["database"], withResearch([{ adapter: "bcb-sgs", status: "succeeded", at: AT }])]) {
      const l = buildIntegrations({ env: ENV_OK, identity: "ok", database });
      if (database.state !== "ready") for (const id of ids) expect(get(l, id).status, id).toBe("configured_unverified");
      for (const id of ["dataforseo", "search-console", "anthropic-llm"]) expect(get(l, id).status, id).toBe("not_configured");
    }
  });
});

describe("provedores com credencial: o estado vem do que foi OBSERVADO", () => {
  const DFS = { DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" };
  const at = new Date("2026-10-14T12:00:00Z");
  const ready = (providers?: { provider: string; outcome: "ok" | "provider_error"; errorCode: string | null; at: Date }[]): ProbeInput["database"] => ({ state: "ready", data: { cities: 1, realRuns: 1, lastRealRun: "succeeded", ...(providers ? { providers } : {}) }, origin: undefined });
  it("variável ausente: não configurado, com os NOMES que faltam e sem valores", () => {
    const e = get(buildIntegrations({ env: { DATAFORSEO_LOGIN: "x" }, identity: "ok", database: ready([]) }), "dataforseo");
    expect(e.status).toBe("not_configured");
    expect(e.detail).toContain("DATAFORSEO_PASSWORD");
    expect(e.env).toEqual([{ name: "DATAFORSEO_LOGIN", set: true }, { name: "DATAFORSEO_PASSWORD", set: false }]);
    expect(JSON.stringify(e)).not.toMatch(/"x"|"y"/);
  });
  it("variáveis definidas e nenhuma chamada registrada: configurado, NÃO verificado", () => {
    expect(get(buildIntegrations({ env: DFS, identity: "ok", database: ready([]) }), "dataforseo").status).toBe("configured_unverified");
    expect(get(buildIntegrations({ env: DFS, identity: "ok", database: ready(undefined) }), "dataforseo").status).toBe("configured_unverified");
  });
  it("só uma chamada que respondeu torna operacional; credencial recusada é falha com o que fazer", () => {
    expect(get(buildIntegrations({ env: DFS, identity: "ok", database: ready([{ provider: "dataforseo", outcome: "ok", errorCode: null, at }]) }), "dataforseo").status).toBe("operational");
    const bad = get(buildIntegrations({ env: DFS, identity: "ok", database: ready([{ provider: "dataforseo", outcome: "provider_error", errorCode: "unauthorized", at }]) }), "dataforseo");
    expect(bad).toMatchObject({ status: "error", dependency: expect.stringContaining("credencial") });
    expect(bad.detail).toContain("recusou a credencial");
  });
  it("fontes públicas: sem chamada não é operacional; erro de limite aparece como falha", () => {
    expect(get(buildIntegrations({ env: {}, identity: "ok", database: ready([]) }), "gdelt").status).toBe("not_configured");
    expect(get(buildIntegrations({ env: {}, identity: "ok", database: ready([{ provider: "gdelt", outcome: "provider_error", errorCode: "rate_limited", at }]) }), "gdelt").status).toBe("error");
    expect(get(buildIntegrations({ env: {}, identity: "ok", database: ready([{ provider: "ibge-sidra", outcome: "ok", errorCode: null, at }]) }), "ibge-sidra").status).toBe("operational");
  });
});
