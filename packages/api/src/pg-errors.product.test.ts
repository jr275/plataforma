import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devIdentity, isUndefinedTable, withTenant, type TenantDb } from "./index";
import { productPoolConfig } from "./testing/pool-config";

// Erros REAIS do PostgreSQL (cluster descartável, papel menlo_app): só 42P01 é "migrations pendentes".
const T = "f5555555-5555-4555-8555-555555555555";
let pool: pg.Pool;
beforeAll(() => { pool = new pg.Pool(productPoolConfig(2)); pool.on("error", () => undefined); });
afterAll(async () => { await pool.end(); });
const run = (fn: (db: TenantDb) => Promise<unknown>) => withTenant(pool, devIdentity([T]), T, fn).then(() => undefined, (e: unknown) => e);

describe("classificação de erros reais do PostgreSQL", () => {
  it("tabela inexistente (42P01) é reconhecida, mesmo atravessando withTenant", async () => {
    const e = (await run((db) => db.query("SELECT 1 FROM plataforma.tabela_que_nao_existe")))!;
    expect((e as { code?: string }).code).toBe("42P01");
    expect(isUndefinedTable(e)).toBe(true);
  });
  it("schema ausente numa consulta também é 42P01 (para o PostgreSQL, a relação não existe)", async () => {
    const e = await run((db) => db.query("SELECT count(*) FROM plataforma_ausente.page"));
    expect((e as { code?: string }).code).toBe("42P01");
    expect(isUndefinedTable(e)).toBe(true);
  });
  for (const [nome, sql, code] of [
    ["divisão por zero", "SELECT 1/0", "22012"],
    ["coluna inexistente", "SELECT coluna_que_nao_existe FROM plataforma.city", "42703"],
    ["permissão negada", "SELECT * FROM plataforma.tenant", "42501"],
    ["sintaxe inválida", "SELEC 1", "42601"],
    ["violação de CHECK", "INSERT INTO plataforma.page (tenant_id, entity_kind, entity_id, path, latest_version, status) VALUES (plataforma.current_tenant_id(), 'city', gen_random_uuid(), '/x', 1, 'published')", "23514"],
  ] as const) {
    it(`${nome} (${code}) NÃO é classificada como migrations pendentes`, async () => {
      const e = (await run((db) => db.query(sql)))!;
      expect((e as { code?: string }).code).toBe(code);
      expect(isUndefinedTable(e)).toBe(false);
    });
  }
  it("falha de conexão (servidor inexistente) NÃO é migrations pendentes", async () => {
    const dead = new pg.Pool({ host: "127.0.0.1", port: 1, user: "x", database: "x", connectionTimeoutMillis: 2000, max: 1 });
    dead.on("error", () => undefined);
    const e = await withTenant(dead, devIdentity([T]), T, (db) => db.query("SELECT 1")).then(() => undefined, (x: unknown) => x);
    await dead.end();
    expect(e).toBeDefined();
    expect(isUndefinedTable(e)).toBe(false);
  });
});
