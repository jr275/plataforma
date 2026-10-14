// Operação de linha de comando: pesquisa de oportunidades da vertical imobiliária para UM tenant, consultando as fontes REAIS (BCB, IBGE, Agência Brasil).
// Usa a credencial da APLICAÇÃO (menlo_app); a URL vem de uma variável NOMEADA (o valor nunca é impresso). Uso (via scripts/verify-engine-live.sh):
//   tsx research-cli.ts --env-var VAR --tenant UUID [--entities 20] [--scope pilot-sao-paulo] [--adapters bcb-sgs,ibge-news,rss-news]
import { createAppPool, devIdentity, engine } from "@plataforma/api";
import { realEstateVertical } from "./vertical";

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
  const tenant = arg("tenant");
  const adapterIds = process.argv.includes("--adapters") ? arg("adapters").split(",") : undefined;
  const pool = createAppPool(url, { max: 2 });
  try {
    const r = await engine.runResearch(pool, devIdentity([tenant]), tenant,
      { vertical: realEstateVertical, adapters: [engine.bcbSgsAdapter, engine.ibgeNewsAdapter, engine.rssNewsAdapter], fetch: globalThis.fetch as unknown as engine.FetchLike },
      { entityLimit: Number(arg("entities", "20")), ...(adapterIds ? { adapterIds } : {}), ...(process.argv.includes("--scope") ? { scopeId: arg("scope") } : {}) });
    console.log(JSON.stringify(r));
    process.exitCode = r.status === "failed" ? 1 : 0;
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(`ERRO: ${e instanceof Error ? e.message : String(e)}`); process.exit(2); });
