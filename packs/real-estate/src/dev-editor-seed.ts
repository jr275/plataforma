// Semente da BANCADA do editor de rascunho (somente desenvolvimento, banco DESCARTÁVEL): roda a pesquisa com as respostas REAIS capturadas das fontes (fixtures do motor,
// sem rede) e gera o blueprint de uma oportunidade com template real. A vertical é a imobiliária com DOIS ajustes de teste (padrão "city-overview" de valor alto e valor
// comercial mínimo 30), só para existir uma oportunidade elegível com template. Uso (via scripts/dev-editor.sh): tsx dev-editor-seed.ts --env-var VAR --tenant UUID
import { TEMPLATE_REGISTRY, createAppPool, devIdentity, engine, withTenant } from "@plataforma/api";
import { fakeFetch, fixture } from "../../../packages/api/src/engine/test-support/fake-fetch";
import { realEstateVertical } from "./vertical";

const arg = (name: string): string => { const i = process.argv.indexOf(`--${name}`); const v = i >= 0 ? process.argv[i + 1] : undefined; if (!v) throw new Error(`falta --${name}`); return v; };
const FEED = "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml";
async function main(): Promise<void> {
  const envVar = arg("env-var"); const url = process.env[envVar]; if (!url) throw new Error(`variável ${envVar} ausente`);
  const tenant = arg("tenant");
  const vertical = { ...realEstateVertical, scoring: { ...realEstateVertical.scoring, eligibility: { ...realEstateVertical.scoring.eligibility, minCommercialValue: 30 } }, patterns: realEstateVertical.patterns.map((p) => (p.key === "city-overview" ? { ...p, valueTier: "high" as const } : p)) };
  const routes = {
    "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/": { body: fixture("bcb-432.json") }, "https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/": { body: fixture("bcb-13522.json") }, "https://api.bcb.gov.br/dados/serie/bcdata.sgs.189/": { body: fixture("bcb-189.json") },
    "https://servicodados.ibge.gov.br/api/v3/noticias/": { body: fixture("ibge-news.json") }, "https://agenciabrasil.ebc.com.br/robots.txt": { body: fixture("agenciabrasil-robots.txt") }, [FEED]: { body: fixture("agenciabrasil-economia.xml") },
  };
  const pool = createAppPool(url, { max: 2 });
  const id = devIdentity([tenant]);
  try {
    const r = await engine.runResearch(pool, id, tenant, { vertical, adapters: [engine.bcbSgsAdapter, engine.ibgeNewsAdapter, engine.rssNewsAdapter], fetch: fakeFetch(routes), now: () => new Date("2026-10-13T15:00:00Z"), sleep: async () => undefined }, { entityLimit: 5 });
    const el = await withTenant(pool, id, tenant, (db) => engine.searchOpportunities(db, { status: "eligible", limit: 100 }));
    const pick = el.rows.find((x) => x.experience === "location_overview");
    if (!pick) throw new Error("nenhuma oportunidade elegível com template real");
    await engine.createBlueprint(pool, id, tenant, { vertical, templates: TEMPLATE_REGISTRY }, { opportunityId: pick.id });
    console.log(JSON.stringify({ research: r.status, opportunityId: pick.id, query: pick.primaryQuery }));
  } finally { await pool.end(); }
}
main().catch((e) => { console.error(`ERRO: ${e instanceof Error ? e.message : String(e)}`); process.exit(2); });
