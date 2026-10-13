import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb, devIdentity, getOpportunity, listOpportunities, setOpportunityStatus, withTenant } from "./index";

// Funções de oportunidades contra o esquema REAL (migrations 0001/0002) num PostgreSQL 16 descartável (scripts/test-schema.sh),
// como menlo_app. Sempre por withTenant; nunca SQL direto. Sem a variável de ambiente o teste FALHA (nunca é pulado).
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const A1 = "a0000000-0000-4000-8000-000000000001";
const B1 = "b0000000-0000-4000-8000-000000000001";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`variável ${name} ausente: rode pelo script (pnpm test:schema), que prepara o PostgreSQL descartável`);
  return value;
}

let pool: pg.Pool;
/** Conexão de teste: um URI remoto com TLS (Neon, via scripts/test-neon.sh) ou o socket do cluster descartável (scripts/test-schema.sh). */
function poolConfig(): pg.PoolConfig {
  const url = process.env.PLATAFORMA_TEST_PG_URL;
  if (url) {
    const u = new URL(url);
    return { host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1), ssl: { rejectUnauthorized: true }, max: 2 };
  }
  return { host: env("PLATAFORMA_TEST_PG_SOCKET_DIR"), port: Number(env("PLATAFORMA_TEST_PG_PORT")), database: env("PLATAFORMA_TEST_PG_DATABASE"), user: "menlo_app", max: 2 };
}
beforeAll(() => {
  pool = new pg.Pool(poolConfig());
  pool.on("error", () => undefined);
});
afterAll(async () => {
  await pool.end();
});

const id = () => devIdentity([A, B]);
const as = <T>(tenant: string, fn: (db: TenantDb) => Promise<T>) => withTenant(pool, id(), tenant, fn);
const ROLLBACK = new Error("desfazer de propósito");
/** Roda fn e desfaz a transação: os testes de escrita não deixam rastro. */
async function rolledBack<T>(tenant: string, fn: (db: TenantDb) => Promise<T>): Promise<T> {
  let value!: T;
  await expect(as(tenant, async (db) => { value = await fn(db); throw ROLLBACK; })).rejects.toBe(ROLLBACK);
  return value;
}

describe("oportunidades contra o esquema real", () => {
  it("lista só as do tenant, na ordem editorial, sem as descartadas por padrão", async () => {
    const a = await as(A, (db) => listOpportunities(db));
    expect(a.map((o) => o.rank)).toEqual([1, 2]);
    expect(a.every((o) => o.tenantId === A)).toBe(true);
    expect(a.map((o) => o.status)).not.toContain("dismissed");
    const b = await as(B, (db) => listOpportunities(db));
    expect(b.map((o) => o.title)).toEqual(["B: documentação", "B: cluster"]);
    expect(b.every((o) => o.tenantId === B)).toBe(true);
  });

  it("as descartadas aparecem só quando pedidas", async () => {
    const dismissed = await as(A, (db) => listOpportunities(db, { statuses: ["dismissed"] }));
    expect(dismissed.map((o) => o.title)).toEqual(["A: FAQ descartada"]);
  });

  it("mapeia os fatores separados e não expõe nota alguma", async () => {
    const [first] = await as(A, (db) => listOpportunities(db));
    expect(first).toMatchObject({ id: A1, demand: "high", competition: "medium", evidence: "high", kind: "page", intent: "informational", status: "in_review", rank: 1, nextAction: "Revisar" });
    expect(first!.rationale).toEqual(["motivo 1", "motivo 2"]);
    expect(first!.gaps).toEqual(["lacuna 1"]);
    expect(first!.createdAt).toBeInstanceOf(Date);
    expect(Object.keys(first!).filter((k) => /score|rating|nota/i.test(k))).toEqual([]);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("obtém por id no próprio tenant e devolve undefined para o id de outro tenant (sem distinguir de inexistente)", async () => {
    expect((await as(A, (db) => getOpportunity(db, A1)))?.title).toBe("A: guia de compra");
    expect(await as(A, (db) => getOpportunity(db, B1))).toBeUndefined();
    expect(await as(B, (db) => getOpportunity(db, A1))).toBeUndefined();
    expect(await as(A, (db) => getOpportunity(db, "a0000000-0000-4000-8000-0000000000ff"))).toBeUndefined();
    expect(await as(A, (db) => getOpportunity(db, "não é uuid"))).toBeUndefined();
  });

  it("altera o estado no próprio tenant (e atualiza updated_at) e não consegue alterar o de outro tenant", async () => {
    const changed = await rolledBack(A, (db) => setOpportunityStatus(db, A1, "ready"));
    expect(changed?.status).toBe("ready");
    expect(changed!.updatedAt.getTime()).toBeGreaterThan(changed!.createdAt.getTime());
    expect(await rolledBack(A, (db) => setOpportunityStatus(db, B1, "dismissed"))).toBeUndefined();
  });

  it("a alteração confirmada persiste e a outra é invisível para o outro tenant", async () => {
    await as(A, (db) => setOpportunityStatus(db, A1, "blocked"));
    try {
      expect((await as(A, (db) => getOpportunity(db, A1)))?.status).toBe("blocked");
      expect((await as(B, (db) => listOpportunities(db))).map((o) => o.status)).toEqual(["ready", "blocked"]); // B continua igual
    } finally {
      await as(A, (db) => setOpportunityStatus(db, A1, "in_review")); // restaura o seed
    }
    expect((await as(A, (db) => getOpportunity(db, A1)))?.status).toBe("in_review");
  });

  it("recusa um status inválido antes de falar com o banco", async () => {
    await expect(as(A, (db) => setOpportunityStatus(db, A1, "lixo" as never))).rejects.toBeInstanceOf(TypeError);
    await expect(as(A, (db) => listOpportunities(db, { statuses: ["lixo" as never] }))).rejects.toBeInstanceOf(TypeError);
  });

  it("um tenant que a identidade não possui é recusado pelo withTenant antes de qualquer consulta", async () => {
    await expect(withTenant(pool, devIdentity([A]), B, (db) => listOpportunities(db))).rejects.toThrow();
  });
});
