// BANCADA da Fábrica (SOMENTE desenvolvimento, banco DESCARTÁVEL): sobre os tópicos reais já gerados, marca DEMANDA DE TESTE em N cidades, avalia a elegibilidade, cria blueprints, registra a exceção de SERP de teste e roda um LOTE com LLM
// ROTEIRIZADO (modo test_simulation, rotulado como tal em todas as telas). Aprova a primeira página. NADA aqui é resultado real de modelo; a demanda é sinal de teste; nada é publicado.
//   tsx dev-factory-seed.ts --env-var VAR --tenant UUID [--cities 3]
import { createAppPool, devIdentity, engine, eligibility, factory, provider, TEMPLATE_REGISTRY, withTenant, blueprintSpec } from "@plataforma/api";
import { routedLlm, A5, A7, A8 } from "../../../packages/api/src/runtime/test-llm";
import { AGENT_HEADER, AGENT_PROMPTS, AGENT_PROMPTS_SOURCE, AGENT_PROMPT_VERSION } from "./agent-prompts.generated";
import { realEstateCatalog } from "./attributes";
import { RECIPES } from "./blueprint-recipes";
import { DEFAULT_ELIGIBILITY_POLICY, coherence } from "./eligibility";
import { DEFAULT_QA_POLICY, RENDERERS } from "./recipe-renderers";
import { realEstateVertical } from "./vertical";

const arg = (name: string, fallback?: string): string => { const i = process.argv.indexOf(`--${name}`); const v = i >= 0 ? process.argv[i + 1] : fallback; if (!v) throw new Error(`falta --${name}`); return v; };
async function main(): Promise<void> {
  const envVar = arg("env-var"); const url = process.env[envVar];
  if (!url) throw new Error(`variável ${envVar} ausente`);
  if (!/host=%2F|host=\/|localhost|127\.0\.0\.1/.test(url)) throw new Error("recusado: só roda em banco local descartável (socket ou localhost)");
  const tenant = arg("tenant"); const n = Number(arg("cities", "3"));
  const pool = createAppPool(url, { max: 4 }); const id = devIdentity([tenant]); const now = new Date();
  const as = <T>(fn: Parameters<typeof withTenant<T>>[3]) => withTenant(pool, id, tenant, fn);
  try {
    const cities = await as(async (db) => (await db.query<{ id: string }>(`SELECT o.id FROM plataforma.growth_opportunity o JOIN plataforma.entity e ON e.id = o.primary_entity_id JOIN plataforma.fact f ON f.entity_id = e.id AND f.attribute_id = 'city.population_census_2022' AND f.superseded_at IS NULL WHERE o.pattern_key = 'topic-city-overview' ORDER BY (f.value #>> '{}')::numeric DESC LIMIT $1`, [n])).rows.map((r) => r.id));
    for (const oid of cities) await as((db) => db.query(`UPDATE plataforma.growth_opportunity SET demand_signal = '{"value": 10000, "source": "SINAL DE TESTE (bancada; não é demanda real)"}'::jsonb WHERE id = $1`, [oid]));
    const edeps = { verticalId: realEstateVertical.id, attributes: realEstateCatalog.attributes, defaultPolicy: DEFAULT_ELIGIBILITY_POLICY, coherence, now: () => now };
    const ev = await eligibility.runEvaluation(pool, id, tenant, edeps);
    const bpDeps = { vertical: realEstateVertical, recipes: RECIPES, templates: TEMPLATE_REGISTRY, attributes: realEstateCatalog.attributes, now: () => now };
    const ready = cities.slice(0, Math.max(0, cities.length - 1)); // a última fica sem exceção de SERP: mostra a espera por revisão humana
    for (const oid of ready) { await blueprintSpec.createSpecBlueprint(pool, id, tenant, bpDeps, { opportunityId: oid }); await engine.applySerpWaiver(pool, id, tenant, { opportunityId: oid, reason: "Exceção de SERP de BANCADA: não há provedor de SERP; nada é publicado." }); }
    const prompts = { version: AGENT_PROMPT_VERSION, sourceSha256: AGENT_PROMPTS_SOURCE.sha256, header: AGENT_HEADER, agents: Object.fromEntries(Object.entries(AGENT_PROMPTS).map(([k, v]) => [k, { name: v.name, body: v.body }])) };
    const llm = routedLlm({ 5: A5, 7: A7, 8: A8() });
    const env: factory.BatchEnv = { mode: "test_simulation", pool, identity: id, tenantId: tenant, tenantName: "Bancada da Fábrica", domainPack: { id: "real-estate", version: "0.1.0" },
      agents: { ctx: { fetch: llm, userAgent: provider.PUBLIC_UA, gate: new provider.RateGate({}), env: { ANTHROPIC_API_KEY: "sk-bancada-roteirizada" }, prompts, vars: { TENANT_NAME: "Bancada", DOMAIN_PACK: "real-estate", SCORE_BRAND: "Índice", EDITORIAL_STYLE: "direto", RICH_MIN: "0.8", MAX_PROPOSALS: "5", SCOPE: "SP" } }, budget: provider.RunBudget.create(), editorialStyle: "direto" },
      eligibility: edeps, blueprint: bpDeps, recipeQa: { vertical: realEstateVertical, recipes: RECIPES, renderers: RENDERERS, qaPolicy: { ...DEFAULT_QA_POLICY, maxSiblingSimilarity: 1, minVariableShare: 0, minSiblingsForComparison: 0 }, attributes: realEstateCatalog.attributes, now: () => now }, now: () => now };
    const { batch } = await factory.planBatch(pool, id, tenant, { name: "Lote de BANCADA (simulação)", config: { ...factory.DEFAULT_CONFIG, limit: 10, concurrency: 2, batchSize: 5 }, mode: "test_simulation", llmConfigured: true });
    await factory.confirmBatch(pool, id, tenant, { batchId: batch.id });
    const done = await factory.runBatch(env, batch.id);
    const first = await as(async (db) => (await db.query<{ opportunity_id: string }>(`SELECT opportunity_id FROM plataforma.qa_report WHERE outcome = 'QA_PASSED' ORDER BY seq LIMIT 1`)).rows[0]?.opportunity_id);
    const approval = first ? await factory.decidePages(pool, id, tenant, { opportunityIds: [first], decision: "APPROVED", reason: "Aprovação de BANCADA (simulação)." }) : [];
    console.log(JSON.stringify({ evaluation: { status: ev.status }, demandTestCities: cities.length, batch: { id: batch.id, status: done.status, estimate: batch.estimate }, approval }, null, 1));
  } finally { await pool.end(); }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
