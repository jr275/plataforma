import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TenantAccessDeniedError,
  UnsafeConnectionError,
  devIdentity,
  withTenant,
  type PoolLike,
} from "./index";

// Testes contra um PostgreSQL 16 REAL e descartável (scripts/test-api.sh), conectando como menlo_app (sem superusuário,
// sem BYPASSRLS) na fixture do harness de RLS. Passam pela API (withTenant), nunca pelo SQL direto. Sem a variável de
// ambiente o teste FALHA: nunca é pulado em silêncio.
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TABLE = "rls_fixture.tenant_item";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`variável ${name} ausente: rode pelo script (pnpm test:api), que prepara o PostgreSQL descartável`);
  return value;
}

const base = () => ({
  host: env("PLATAFORMA_TEST_PG_SOCKET_DIR"),
  port: Number(env("PLATAFORMA_TEST_PG_PORT")),
  database: env("PLATAFORMA_TEST_PG_DATABASE"),
});

const ROLLBACK = new Error("desfazer de propósito");

/** Executa fn dentro de withTenant e força o ROLLBACK ao final, devolvendo o que fn calculou. */
async function inTenantThenRollback<T>(pool: PoolLike, tenant: string, fn: (db: Parameters<Parameters<typeof withTenant<T>>[3]>[0]) => Promise<T>): Promise<T> {
  let value!: T;
  await expect(
    withTenant(pool, devIdentity([A, B]), tenant, async (db) => {
      value = await fn(db);
      throw ROLLBACK;
    }),
  ).rejects.toBe(ROLLBACK);
  return value;
}

let app: pg.Pool; // menlo_app, uma única conexão: a mesma conexão é reutilizada (como num pool de transação)
let pair: pg.Pool; // menlo_app, duas conexões (concorrência)
let privileged: pg.Pool; // superusuário do cluster descartável

beforeAll(() => {
  app = new pg.Pool({ ...base(), user: "menlo_app", max: 1 });
  pair = new pg.Pool({ ...base(), user: "menlo_app", max: 2 });
  privileged = new pg.Pool({ ...base(), user: "rls_bootstrap", max: 1 });
});
afterAll(async () => {
  await Promise.all([app.end(), pair.end(), privileged.end()]);
});

const payloads = async (pool: PoolLike, tenant: string) =>
  withTenant(pool, devIdentity([A, B]), tenant, async (db) => {
    const r = await db.query<{ payload: string }>(`SELECT payload FROM ${TABLE} ORDER BY payload`);
    return r.rows.map((x) => x.payload);
  });

describe("isolamento pela API contra PostgreSQL real (papel menlo_app)", () => {
  it("o servidor é PostgreSQL 16 e a conexão é o papel de aplicação sem privilégios", async () => {
    const r = await app.query("SELECT current_setting('server_version_num')::int AS v, current_user AS u, (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS p");
    expect(r.rows[0].v).toBeGreaterThanOrEqual(160000);
    expect(r.rows[0].v).toBeLessThan(170000);
    expect(r.rows[0].u).toBe("menlo_app");
    expect(r.rows[0].p).toBe(false);
  });

  it("o tenant A lê só as próprias linhas; o B, só as dele", async () => {
    expect(await payloads(app, A)).toEqual(["A-1", "A-2"]);
    expect(await payloads(app, B)).toEqual(["B-1", "B-2"]);
  });

  it("o tenant A não consegue inserir uma linha para o B (42501)", async () => {
    await expect(
      withTenant(app, devIdentity([A, B]), A, (db) =>
        db.query(`INSERT INTO ${TABLE} (tenant_id, payload) VALUES ($1, 'forjada')`, [B]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("o tenant A atualiza e apaga 0 linhas do B, e consegue inserir a própria (controle positivo, desfeito)", async () => {
    const counts = await inTenantThenRollback(app, A, async (db) => {
      const upd = await db.query(`UPDATE ${TABLE} SET payload = 'x' WHERE tenant_id = $1`, [B]);
      const del = await db.query(`DELETE FROM ${TABLE} WHERE tenant_id = $1`, [B]);
      const ins = await db.query(`INSERT INTO ${TABLE} (tenant_id, payload) VALUES ($1, 'A-nova')`, [A]);
      return { upd: upd.rowCount, del: del.rowCount, ins: ins.rowCount };
    });
    expect(counts).toEqual({ upd: 0, del: 0, ins: 1 });
    expect(await payloads(app, B)).toEqual(["B-1", "B-2"]);
    expect(await payloads(app, A)).toEqual(["A-1", "A-2"]);
  });

  it("identidade sem acesso ao tenant: recusada, sem consulta ao banco", async () => {
    let connects = 0;
    const counting: PoolLike = { connect: () => { connects += 1; return app.connect(); } };
    await expect(withTenant(counting, devIdentity([A]), B, async () => 1)).rejects.toThrow(TenantAccessDeniedError);
    expect(connects).toBe(0);
  });

  it("o contexto não vaza para a conexão reutilizada: sem withTenant, zero linhas e app.tenant_id vazio", async () => {
    await payloads(app, A);
    const client = await app.connect();
    try {
      const r = await client.query(`SELECT coalesce(current_setting('app.tenant_id', true), '') AS ctx, (SELECT count(*) FROM ${TABLE})::int AS n`);
      expect(r.rows[0].ctx).toBe("");
      expect(r.rows[0].n).toBe(0);
    } finally {
      client.release();
    }
  });

  it("erro dentro da função: desfaz, devolve a conexão e a mesma conexão continua isolada", async () => {
    await expect(
      withTenant(app, devIdentity([A, B]), A, async (db) => {
        await db.query(`INSERT INTO ${TABLE} (tenant_id, payload) VALUES ($1, 'sera-desfeita')`, [A]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await payloads(app, A)).toEqual(["A-1", "A-2"]);
    expect(app.totalCount).toBe(1);
    expect(app.idleCount).toBe(1);
  });

  it("conexão de superusuário é recusada antes de executar a função", async () => {
    let ran = false;
    await expect(
      withTenant(privileged, devIdentity([A]), A, async () => {
        ran = true;
      }),
    ).rejects.toThrow(UnsafeConnectionError);
    expect(ran).toBe(false);
  });

  it("duas requisições concorrentes de tenants diferentes enxergam cada uma só o que é seu", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => payloads(pair, i % 2 === 0 ? A : B)));
    results.forEach((rows, i) => expect(rows).toEqual(i % 2 === 0 ? ["A-1", "A-2"] : ["B-1", "B-2"]));
  });

  it("LIMITAÇÃO DOCUMENTADA (L1), não uma garantia: SQL arbitrário dentro da função ainda troca de tenant", async () => {
    const rows = await withTenant(app, devIdentity([A]), A, async (db) => {
      await db.query("SELECT set_config('app.tenant_id', $1, true)", [B]);
      const r = await db.query<{ payload: string }>(`SELECT payload FROM ${TABLE} ORDER BY payload`);
      return r.rows.map((x) => x.payload);
    });
    expect(rows).toEqual(["B-1", "B-2"]);
  });
});
