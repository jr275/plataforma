// Operação de linha de comando: gera rascunhos de páginas de cidade para UM tenant (ADR-020). Credencial da APLICAÇÃO (menlo_app),
// URI numa variável de ambiente NOMEADA (nunca impressa). Uso: tsx cli.ts --env-var NOME --tenant UUID --uf SP --limit 20
import { devIdentity } from "../dev-identity";
import { createAppPool } from "../pool";
import { meetsPilotAcceptance, runGeneration } from "./generate";

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
  const tenant = arg("tenant");
  const pool = createAppPool(url, { max: 2 });
  try {
    const r = await runGeneration(pool, devIdentity([tenant]), tenant, { scope: { uf: arg("uf"), limit: Number(arg("limit")) } });
    console.log(JSON.stringify({ runId: r.runId, status: r.status, total: r.total, generated: r.generated, unchanged: r.unchanged, blocked: r.blocked, pilotAcceptance: meetsPilotAcceptance(r) }));
    process.exitCode = r.status === "failed" ? 1 : 0;
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(`ERRO: ${e instanceof Error ? e.message : String(e)}`); process.exit(2); });
