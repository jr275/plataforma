// Catálogo de atributos (Incremento 1) para UM tenant, em banco DESCARTÁVEL: entidades e fatos de município a partir da importação REAL do IBGE, SIDRA real para os N municípios mais
// populosos e o Attribute Discovery com o relatório de lacunas. Credencial da APLICAÇÃO por variável NOMEADA; recusa bancos que não sejam locais.
//   tsx catalog-cli.ts --env-var VAR --tenant UUID [--sidra 20]
import { createAppPool, devIdentity, engine, catalog, provider, withTenant } from "@plataforma/api";
import { realEstateCatalog, realEstateFactConfidence } from "./attributes";

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
  try {
    const mat = await withTenant(pool, id, tenant, (db) => catalog.materializeCities(db, realEstateFactConfidence, now));
    // SIDRA real (sem custo) para os municípios mais populosos: a cobertura parcial resultante é REAL e aparece no relatório
    const top = await withTenant(pool, id, tenant, async (db) => (await db.query<{ ibge_code: string }>(`SELECT ibge_code FROM plataforma.city ORDER BY population DESC NULLS LAST, ibge_code LIMIT $1`, [sidraN])).rows.map((r) => r.ibge_code));
    const ctx = { fetch: realFetch, userAgent: provider.PUBLIC_UA, gate: new provider.RateGate(provider.PUBLIC_RATES) };
    const budget = provider.RunBudget.create();
    const got: { facts: provider.SidraCityFacts; provenance: provider.Provenance }[] = []; const failed: { ibge: string; state: string; code?: string }[] = [];
    for (const code of top) {
      const r = await withTenant(pool, id, tenant, (db) => provider.fetchSidraCity({ db, ctx, ibgeCode: code, budget, runId: null, actor: id.userId, now: () => now }));
      if (r.state === "ok") got.push({ facts: r.data, provenance: r.provenance }); else failed.push({ ibge: code, state: r.state, ...(r.state === "provider_error" ? { code: r.code } : {}) });
    }
    const sidra = await withTenant(pool, id, tenant, (db) => catalog.recordSidraFacts(db, got, realEstateFactConfidence, now));
    const cat = await withTenant(pool, id, tenant, (db) => catalog.runCatalog(db, realEstateCatalog, now, id.userId));
    const gaps = catalog.gapReport(cat.stats).map((s) => ({ attribute: s.definition.attributeId, status: s.status, unlocks: s.definition.potentialPageFamilies, reasons: s.reasons }));
    console.log(JSON.stringify({ materialized: mat, sidra: { requested: top.length, ok: got.length, failed, facts: sidra }, catalog: { runId: cat.runId, created: cat.created, policyVersion: cat.policyVersion, attributes: cat.stats.map((s) => ({ attribute: s.definition.attributeId, entityType: s.definition.entityType, status: s.status, coverage: s.coverage, withValue: s.entitiesWithValue, total: s.entitiesTotal, freshnessDays: s.freshnessDays, confidence: s.confidence, distribution: s.distribution, origin: s.definition.origin, usableAsFact: s.usableAsFact, reasons: s.reasons })) }, gaps, cost: budget.usage }));
  } finally { await pool.end(); }
}
main().catch((e) => { console.error(`ERRO: ${e instanceof Error ? e.message : String(e)}`); process.exit(2); });
