import type pg from "pg";

// Configuração de conexão dos testes de PRODUTO: um URI remoto com TLS (branch temporário do Neon, via scripts/test-neon.sh) ou o socket
// do cluster descartável (scripts/test-schema.sh). Sem nenhuma das duas variáveis, o teste FALHA (nunca é pulado). Só usado por testes.
function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`variável ${name} ausente: rode pelo script (pnpm test:schema)`);
  return v;
}

export function productPoolConfig(max = 4): pg.PoolConfig {
  const url = process.env.PLATAFORMA_TEST_PG_URL;
  if (url) {
    const u = new URL(url);
    return { host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1), ssl: { rejectUnauthorized: true }, max };
  }
  return { host: env("PLATAFORMA_TEST_PG_SOCKET_DIR"), port: Number(env("PLATAFORMA_TEST_PG_PORT")), database: env("PLATAFORMA_TEST_PG_DATABASE"), user: "menlo_app", max };
}
