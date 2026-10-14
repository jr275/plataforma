// Fluxo do motor de páginas (Incrementos 1 a 4+) para UM tenant, em banco DESCARTÁVEL, com os dados REAIS disponíveis: importação do IBGE (SP), SIDRA real, catálogo de atributos, tópicos,
// combinações e elegibilidade. Mostra números reais e os bloqueios. Credencial da APLICAÇÃO por variável NOMEADA; recusa bancos que não sejam locais.
//   tsx engine-cli.ts --env-var VAR --tenant UUID [--sidra 20]
import { createAppPool, devIdentity, catalog, combination, eligibility, provider, topics, withTenant, type engine } from "@plataforma/api";
import { realEstateCatalog, realEstateFactConfidence } from "./attributes";
import { COMPATIBILITY_RULES, DEFAULT_COMBINATION_POLICY, FAMILIES as COMBINATION_FAMILIES, buildSpace } from "./combination";
import { DEFAULT_ELIGIBILITY_POLICY, coherence } from "./eligibility";
import { realEstateTopicPatterns } from "./topic-patterns";
import { realEstateVertical } from "./vertical";

const arg = (name: string, fallback?: string): string => { const i = process.argv.indexOf(`--${name}`); const v = i >= 0 ? process.argv[i + 1] : fallback; if (!v) throw new Error(`falta --${name}`); return v; };

async function main(): Promise<void> {
  const envVar = arg("env-var");
  if (!/^[A-Z_][A-Z0-9_]*$/.test(envVar)) throw new Error("nome de variável inválido");
  const url = process.env[envVar];
  if (!url) throw new Error(`variável ${envVar} ausente`);
  if (!/host=%2F|host=\/|localhost|127\.0\.0\.1/.test(url)) throw new Error("recusado: só roda em banco local descartável (socket ou localhost)");
  const tenant = arg("tenant"); const sidraN = Number(arg("sidra", "20"));
  const pool = createAppPool(url, { max: 3 });
  const id = devIdentity([tenant]);
  const realFetch = ((u: string, init?: Parameters<engine.FetchLike>[1]) => globalThis.fetch(u, init as RequestInit)) as unknown as engine.FetchLike;
  const now = new Date();
  const as = <T>(fn: Parameters<typeof withTenant<T>>[3]) => withTenant(pool, id, tenant, fn);
  const out: Record<string, unknown> = {};
  try {
    out.materialized = await as((db) => catalog.materializeCities(db, realEstateFactConfidence, now));
    const top = await as(async (db) => (await db.query<{ ibge_code: string }>(`SELECT ibge_code FROM plataforma.city ORDER BY population DESC NULLS LAST, ibge_code LIMIT $1`, [sidraN])).rows.map((r) => r.ibge_code));
    const ctx = { fetch: realFetch, userAgent: provider.PUBLIC_UA, gate: new provider.RateGate(provider.PUBLIC_RATES) }; const budget = provider.RunBudget.create();
    const got: { facts: provider.SidraCityFacts; provenance: provider.Provenance }[] = [];
    for (const code of top) { const r = await as((db) => provider.fetchSidraCity({ db, ctx, ibgeCode: code, budget, runId: null, actor: id.userId, now: () => now })); if (r.state === "ok") got.push({ facts: r.data, provenance: r.provenance }); }
    out.sidra = { requested: top.length, ok: got.length, facts: await as((db) => catalog.recordSidraFacts(db, got, realEstateFactConfidence, now)), cost: budget.usage };
    out.catalog = (await as((db) => catalog.runCatalog(db, realEstateCatalog, now, id.userId))).stats.map((s) => ({ attribute: s.definition.attributeId, status: s.status, coverage: s.coverage }));
    const tdeps = { vertical: realEstateVertical, catalog: realEstateCatalog, patterns: realEstateTopicPatterns, now: () => now };
    const t = await topics.runTopicGeneration(pool, id, tenant, tdeps); out.topics = { status: t.status, ...t.result };
    const cdeps = { vertical: realEstateVertical, families: COMBINATION_FAMILIES, rules: COMPATIBILITY_RULES, defaultPolicy: DEFAULT_COMBINATION_POLICY, buildSpace, now: () => now };
    out.combinations = {};
    for (const f of COMBINATION_FAMILIES) { const r = await combination.runCombinations(pool, id, tenant, cdeps, { familyId: f.id, rootLimit: 10 }); (out.combinations as Record<string, unknown>)[f.id] = r.result ?? { error: r.error }; }
    const edeps = { verticalId: realEstateVertical.id, attributes: realEstateCatalog.attributes, defaultPolicy: DEFAULT_ELIGIBILITY_POLICY, coherence, now: () => now };
    const e = await eligibility.runEvaluation(pool, id, tenant, edeps); out.evaluation = { status: e.status, ...e.result, error: e.error };
    const l = await as((db) => eligibility.listLatestDecisions(db, { limit: 5 }));
    out.sampleDecisions = l.rows.map((r) => ({ query: r.primaryQuery, decision: r.decision, status: r.status, total: r.totalScore, gatesFailed: Object.entries(r.gateResults).filter(([, v]) => v === "FAIL").map(([k]) => k), action: r.recommendedAction }));
    console.log(JSON.stringify(out));
  } finally { await pool.end(); }
}
main().catch((e) => { console.error(`ERRO: ${e instanceof Error ? e.message : String(e)}`); process.exit(2); });
