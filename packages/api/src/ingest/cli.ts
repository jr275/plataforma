// Operação de linha de comando: importa um CSV de cidades para UM tenant (ADR-017). Roda com a credencial da APLICAÇÃO
// (menlo_app), nunca a do dono; a URL vem de uma variável de ambiente NOMEADA (o valor nunca é impresso). Uso (via
// scripts/neon-import-cities.sh):  tsx cli.ts --env-var NEON_APP_URL --tenant UUID --file caminho.csv --origin real --source IBGE
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { devIdentity } from "../dev-identity";
import { createAppPool } from "../pool";
import { runCityImport, type ImportOrigin } from "./run";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v) throw new Error(`falta --${name}`);
  return v;
}

async function main(): Promise<void> {
  const envVar = arg("env-var");
  if (!/^[A-Z_][A-Z0-9_]*$/.test(envVar)) throw new Error("nome de variável inválido");
  const url = process.env[envVar];
  if (!url) throw new Error(`variável ${envVar} ausente`);
  const origin = arg("origin") as ImportOrigin;
  if (!["real", "test", "manual"].includes(origin)) throw new Error("--origin deve ser real, test ou manual");
  const tenant = arg("tenant");
  const file = arg("file");

  const pool = createAppPool(url, { max: 2 });
  try {
    const r = await runCityImport(pool, devIdentity([tenant]), tenant, {
      content: readFileSync(file), fileName: basename(file), sourceName: arg("source"), origin,
      mapping: { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" },
    });
    console.log(JSON.stringify(r));
    process.exitCode = r.status === "failed" ? 1 : 0;
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(`ERRO: ${e instanceof Error ? e.message : String(e)}`); process.exit(2); });
