import { describe, expect, it } from "vitest";
import {
  InvalidTenantIdError,
  TenantAccessDeniedError,
  UnsafeConnectionError,
  devIdentity,
  parseTenantId,
  verifiedIdentity,
  withTenant,
  type ClientLike,
  type PoolLike,
} from "./index";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// Dublê SÓ para provar que a recusa acontece ANTES de qualquer conexão e para exercitar os ramos de erro. O
// comportamento real do PostgreSQL (RLS, transações, vazamento de contexto) é testado em tenant-context.db.test.ts.
function fakePool(script: (sql: string) => unknown = () => ({ rows: [{ privileged: false }], rowCount: 1 })) {
  const log: string[] = [];
  let connects = 0;
  let releasedWith: unknown[] = [];
  const client: ClientLike = {
    async query(text: string) {
      log.push(text.split(/\s+/)[0] ?? "");
      return script(text) as never;
    },
    release(error) {
      releasedWith.push(error);
    },
  };
  const pool: PoolLike = {
    async connect() {
      connects += 1;
      return client;
    },
  };
  return { pool, log, connects: () => connects, releasedWith: () => releasedWith };
}

describe("parseTenantId", () => {
  it("aceita um UUID e normaliza para minúsculas", () => {
    expect(parseTenantId(A.toUpperCase())).toBe(A);
  });
  it.each(["", "not-a-uuid", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa", `${A} `, `'${A}'`, "x'; DROP TABLE t; --"])(
    "rejeita %j",
    (value) => {
      expect(() => parseTenantId(value)).toThrow(InvalidTenantIdError);
    },
  );
  it("rejeita valores que não são texto", () => {
    expect(() => parseTenantId(undefined)).toThrow(InvalidTenantIdError);
    expect(() => parseTenantId(42)).toThrow(InvalidTenantIdError);
  });
});

describe("verifiedIdentity e devIdentity", () => {
  it("exige userId e tenants válidos", () => {
    expect(() => verifiedIdentity({ userId: "", tenantIds: [A] })).toThrow(TypeError);
    expect(() => verifiedIdentity({ userId: "u", tenantIds: ["nope"] })).toThrow(InvalidTenantIdError);
  });
  it("devIdentity recusa rodar em produção", () => {
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(() => devIdentity([A])).toThrow();
      process.env.NODE_ENV = "development";
      expect(devIdentity([A]).tenantIds).toEqual([A]);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe("withTenant: recusas antes de conectar", () => {
  it("tenant inválido: erro e nenhuma conexão aberta", async () => {
    const f = fakePool();
    await expect(withTenant(f.pool, devIdentity([A]), "nope", async () => 1)).rejects.toThrow(InvalidTenantIdError);
    expect(f.connects()).toBe(0);
  });
  it("tenant que a identidade não possui: erro e nenhuma conexão aberta", async () => {
    const f = fakePool();
    let ran = false;
    await expect(
      withTenant(f.pool, devIdentity([A]), B, async () => {
        ran = true;
      }),
    ).rejects.toThrow(TenantAccessDeniedError);
    expect(f.connects()).toBe(0);
    expect(ran).toBe(false);
  });
});

describe("withTenant: ramos de erro (com dublê)", () => {
  it("papel privilegiado ou não verificável: recusa, desfaz e não executa a função", async () => {
    for (const row of [{ privileged: true }, { privileged: null }, {}]) {
      const f = fakePool(() => ({ rows: [row], rowCount: 1 }));
      let ran = false;
      await expect(
        withTenant(f.pool, devIdentity([A]), A, async () => {
          ran = true;
        }),
      ).rejects.toThrow(UnsafeConnectionError);
      expect(ran).toBe(false);
      expect(f.log).toContain("ROLLBACK");
      expect(f.log).not.toContain("COMMIT");
    }
  });
  it("erro na função: desfaz, não confirma e devolve a conexão ao pool", async () => {
    const f = fakePool();
    await expect(
      withTenant(f.pool, devIdentity([A]), A, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(f.log).toEqual(["BEGIN", "SELECT", "ROLLBACK"]);
    expect(f.releasedWith()).toEqual([false]);
  });
  it("se o ROLLBACK também falhar, a conexão é descartada (release(true)) e o erro original sobe", async () => {
    const f = fakePool((sql) => {
      if (sql === "ROLLBACK") throw new Error("conexão perdida");
      return { rows: [{ privileged: false }], rowCount: 1 };
    });
    await expect(
      withTenant(f.pool, devIdentity([A]), A, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(f.releasedWith()).toEqual([true]);
  });
  it("caminho feliz: BEGIN, contexto, COMMIT, nessa ordem", async () => {
    const f = fakePool();
    await expect(withTenant(f.pool, devIdentity([A]), A, async () => "ok")).resolves.toBe("ok");
    expect(f.log).toEqual(["BEGIN", "SELECT", "COMMIT"]);
  });
});
