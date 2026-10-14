// Execução PILOTO local do Opportunity Engine (Unidade 2) para UM tenant, em banco DESCARTÁVEL: pesquisa com as fontes públicas REAIS (BCB, IBGE, Agência Brasil), escopo da vertical,
// SIDRA real conferido contra a importação, blueprint, (opcional) exceção de SERP rotulada como local, geração até QA e funil com números. Credencial da APLICAÇÃO (menlo_app) por variável NOMEADA.
//   tsx pilot-cli.ts --env-var VAR --tenant UUID [--scope pilot-sao-paulo] [--entities 5] [--waive] [--generate 3]
// Sem credencial de DataForSEO/GSC/Anthropic: demanda, SERP, concorrência e classificação por LLM ficam DESCONHECIDOS (o relatório diz quais). Nunca roda contra o banco do aplicativo.
import { TEMPLATE_REGISTRY, createAppPool, devIdentity, engine, provider, withTenant } from "@plataforma/api";
import { realEstateVertical } from "./vertical";

const flag = (n: string) => process.argv.includes(`--${n}`);
const arg = (name: string, fallback?: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : fallback;
  if (!v) throw new Error(`falta --${name}`);
  return v;
};

async function main(): Promise<void> {
  const envVar = arg("env-var");
  if (!/^[A-Z_][A-Z0-9_]*$/.test(envVar)) throw new Error("nome de variável inválido");
  const url = process.env[envVar];
  if (!url) throw new Error(`variável ${envVar} ausente`);
  if (!/host=%2F|host=\/|localhost|127\.0\.0\.1/.test(url)) throw new Error("recusado: o piloto só roda em banco local descartável (socket ou localhost)");
  const tenant = arg("tenant"); const scopeId = arg("scope", "pilot-sao-paulo"); const entities = Number(arg("entities", "5")); const generateN = Number(arg("generate", "3"));
  const realFetch = ((u: string, init?: Parameters<engine.FetchLike>[1]) => globalThis.fetch(u, init as RequestInit)) as unknown as engine.FetchLike;
  const pool = createAppPool(url, { max: 3 });
  const id = devIdentity([tenant]);
  const vdeps = { vertical: realEstateVertical, templates: TEMPLATE_REGISTRY };
  const as = <T>(fn: Parameters<typeof withTenant<T>>[3]) => withTenant(pool, id, tenant, fn);
  const out: Record<string, unknown> = { scope: scopeId };
  try {
    // 1. pesquisa real nas fontes públicas, recortada pelo escopo
    const r = await engine.runResearch(pool, id, tenant, { vertical: realEstateVertical, adapters: [engine.bcbSgsAdapter, engine.ibgeNewsAdapter, engine.rssNewsAdapter], fetch: realFetch }, { entityLimit: entities, scopeId });
    out.research = { runId: r.runId, status: r.status, scope: r.scope, adapters: r.adapters.map((a) => ({ adapter: a.adapter, status: a.status, requests: a.requests, kept: a.kept, inserted: a.inserted, errors: a.errors.map((e) => e.code) })), evidence: r.evidence, opportunities: r.opportunities, scores: r.scores };

    // 2. SIDRA real (população do Censo 2022) conferida contra a importação do tenant; nenhum custo
    const gate = new provider.RateGate(provider.PUBLIC_RATES);
    const ctx = { fetch: realFetch, userAgent: provider.PUBLIC_UA, gate };
    const budget = provider.RunBudget.create();
    const cities = await as(async (db) => (await db.query<{ ibge_code: string; name: string; population: string | null; population_year: number | null }>(`SELECT ibge_code, name, population, population_year FROM plataforma.city WHERE ibge_code = ANY($1::text[])`, [realEstateVertical.scopes!.find((s) => s.id === scopeId)!.entityCodes])).rows);
    const sidra = [];
    for (const c of cities) {
      const s = await as((db) => provider.fetchSidraCity({ db, ctx, ibgeCode: c.ibge_code, budget, runId: r.runId, actor: id.userId, now: () => new Date() }));
      sidra.push({ city: c.name, ibge: c.ibge_code, importedPopulation: c.population === null ? null : Number(c.population), importedYear: c.population_year, sidra: s.state === "ok" ? s.data : { state: s.state } , match: s.state === "ok" && c.population !== null ? s.data.population === Number(c.population) : null });
    }
    out.sidra = sidra;

    // 3. provedores sem credencial: estados explícitos (nada é consultado)
    const env = process.env; const missing = (names: readonly string[]) => provider.missingEnv(env, names);
    out.providers = { dataforseo: missing(provider.DATAFORSEO_ENV).length ? { state: "provider_not_configured", missing: missing(provider.DATAFORSEO_ENV) } : { state: "credentials_present_unverified" }, searchConsole: missing(provider.GSC_ENV).length ? { state: "provider_not_configured", missing: missing(provider.GSC_ENV) } : { state: "credentials_present_unverified" }, llm: missing(provider.LLM_ENV).length ? { state: "provider_not_configured", missing: missing(provider.LLM_ENV) } : { state: "credentials_present_unverified" } };

    // 4. blueprint das elegíveis; exceção de SERP só se pedida (rotulada como local) ; geração até QA
    const eligible = await as((db) => engine.searchOpportunities(db, { status: "eligible", limit: 100 }));
    const blueprints = [];
    for (const o of eligible.rows) {
      const b = await engine.createBlueprint(pool, id, tenant, vdeps, { opportunityId: o.id });
      blueprints.push({ query: o.primaryQuery, ready: b.record.ready, template: b.record.templateKey, blockers: [...new Set(b.record.report.blockers.map((x) => x.key))] });
    }
    out.blueprints = blueprints;
    const generated = [];
    if (flag("waive")) {
      for (const o of eligible.rows.filter((x) => x.experience === "location_overview").slice(0, generateN)) {
        try {
          await engine.applySerpWaiver(pool, id, tenant, { opportunityId: o.id, reason: "Piloto LOCAL em banco descartável: exceção de SERP de demonstração (não há provedor de SERP com credencial válida); não autoriza publicação." });
          const g = await engine.generateFromBlueprint(pool, id, tenant, vdeps, { opportunityId: o.id });
          generated.push({ query: o.primaryQuery, outcome: g.record.outcome, qaPassed: g.record.qaPassed, from: g.from, to: g.to, path: g.record.path, gates: g.record.gates.map((x) => `${x.gate}:${x.outcome}`) });
        } catch (e) { generated.push({ query: o.primaryQuery, error: e instanceof Error ? e.message : String(e) }); }
      }
    }
    out.generated = generated;

    // 5. funil, top 10, rejeitadas e custo (tudo lido do banco)
    const all = await as((db) => engine.searchOpportunities(db, { limit: 100, sort: "priority" }));
    const rejected = await as(async (db) => (await db.query<{ primary_query: string; validation: { reasons: string[] } }>(`SELECT primary_query, validation FROM plataforma.growth_opportunity WHERE status = 'rejected' ORDER BY primary_query LIMIT 3`)).rows);
    const funnel = await as(async (db) => (await db.query<{ status: string; n: string }>(`SELECT status, count(*) AS n FROM plataforma.growth_opportunity GROUP BY status`)).rows);
    const pages = await as(async (db) => (await db.query<{ n: string; q: string }>(`SELECT count(*) AS n, count(*) FILTER (WHERE qa_passed) AS q FROM plataforma.opportunity_page`)).rows[0]!);
    const cost = await as((db) => provider.costByRun(db, r.runId));
    const demand = await as(async (db) => (await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.opportunity_signal`)).rows[0]!.n);
    out.funnel = { byStatus: Object.fromEntries(funnel.map((x) => [x.status, Number(x.n)])), total: all.total, eligibleFlag: all.rows.filter((x) => x.eligible).length, pagesGenerated: Number(pages.n), qaPassed: Number(pages.q), demandSignals: Number(demand) };
    out.top = all.rows.slice(0, 10).map((x) => ({ query: x.primaryQuery, status: x.status, priority: x.priority, kind: x.priorityKind, confidence: x.confidence, unknownDimensions: x.unknownDimensions, intent: x.intent, experience: x.experience }));
    out.rejected = rejected.map((x) => ({ query: x.primary_query, reasons: x.validation.reasons }));
    out.cost = { requestsUsed: budget.usage.requests, costUsd: budget.usage.costUsd, byProvider: cost };
    console.log(JSON.stringify(out));
  } finally { await pool.end(); }
}
main().catch((e) => { console.error(`ERRO: ${e instanceof Error ? e.message : String(e)}`); process.exit(2); });
