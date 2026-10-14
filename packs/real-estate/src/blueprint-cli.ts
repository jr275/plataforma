// Operação de linha de comando: gera o blueprint de TODAS as oportunidades elegíveis de UM tenant e imprime o roadmap (ADR-024). Credencial da APLICAÇÃO (menlo_app);
// a URL vem de uma variável NOMEADA (o valor nunca é impresso). Uso (via scripts/verify-engine-live.sh):  tsx blueprint-cli.ts --env-var VAR --tenant UUID
import { TEMPLATE_REGISTRY, createAppPool, devIdentity, engine, withTenant } from "@plataforma/api";
import { realEstateVertical } from "./vertical";

const arg = (name: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v) throw new Error(`falta --${name}`);
  return v;
};

async function main(): Promise<void> {
  const envVar = arg("env-var");
  if (!/^[A-Z_][A-Z0-9_]*$/.test(envVar)) throw new Error("nome de variável inválido");
  const url = process.env[envVar];
  if (!url) throw new Error(`variável ${envVar} ausente`);
  const tenant = arg("tenant");
  const pool = createAppPool(url, { max: 2 });
  const identity = devIdentity([tenant]);
  try {
    const eligible = await withTenant(pool, identity, tenant, (db) => engine.searchOpportunities(db, { status: "eligible", limit: 100 }));
    const out: unknown[] = [];
    for (const o of eligible.rows) {
      const r = await engine.createBlueprint(pool, identity, tenant, { vertical: realEstateVertical, templates: TEMPLATE_REGISTRY }, { opportunityId: o.id });
      out.push({ query: o.primaryQuery, created: r.created, version: r.record.version, ready: r.record.ready, template: r.record.templateKey, transitioned: r.transitioned, gates: Object.fromEntries(r.record.report.gates.map((g) => [g.gate, g.outcome])), blockers: r.record.report.blockers.map((b) => b.key) });
    }
    const roadmap = await withTenant(pool, identity, tenant, (db) => engine.loadRoadmap(db, realEstateVertical, { perLane: 3 }));
    console.log(JSON.stringify({ blueprints: out, roadmap: { counts: roadmap.counts, total: roadmap.total, blockers: roadmap.blockers.slice(0, 6) } }));
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(`ERRO: ${e instanceof Error ? e.message : String(e)}`); process.exit(2); });
