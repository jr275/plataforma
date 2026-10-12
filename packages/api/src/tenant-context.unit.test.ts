import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionAcquireTimeoutError,
  ConnectionCleanupError,
  InvalidTenantIdError,
  NestedTenantContextError,
  TenantAccessDeniedError,
  TenantDbClosedError,
  TransactionNotCommittedError,
  UnsafeConnectionError,
  UnsettledTenantOperationError,
  devIdentity,
  parseTenantId,
  verifiedIdentity,
  withTenant,
  type ClientLike,
  type PoolLike,
  type TenantDb,
} from "./index";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// Dublê SÓ para provar que a recusa acontece ANTES de qualquer conexão e para exercitar os ramos de erro. O
// comportamento real do PostgreSQL (RLS, transações, vazamento de contexto) é testado em tenant-context.db.test.ts.
function fakePool(script: (sql: string) => unknown = () => ({ rows: [{ privileged: false }], rowCount: 1 })) {
  const log: string[] = [];
  const sqls: string[] = [];
  let connects = 0;
  let releasedWith: unknown[] = [];
  const client: ClientLike = {
    async query(text: string) {
      log.push(text.split(/\s+/)[0] ?? "");
      sqls.push(text);
      const result = (await script(text)) as Record<string, unknown>;
      // Como o driver real: o COMMIT confirmado responde com a tag "COMMIT". Um teste que queira outra resposta devolve a
      // propriedade `command` explicitamente (inclusive `command: undefined`).
      if (text === "COMMIT" && result && typeof result === "object" && !("command" in result)) {
        return { ...result, command: "COMMIT" } as never;
      }
      return result as never;
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
  return { pool, log, sqls, connects: () => connects, releasedWith: () => releasedWith };
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

// Ciclo de vida do `db` e aninhamento. Usam o DUBLÊ de pool: provam a lógica de invalidação e que nada é enviado ao
// cliente depois do encerramento. O comportamento com um PostgreSQL real está em tenant-context.db.test.ts.
describe("ciclo de vida do db (com dublê)", () => {
  const okScript = (sql: string) => (sql === "SLOW" ? new Promise((r) => setTimeout(() => r({ rows: [], rowCount: 0 }), 30)) : { rows: [{ privileged: false }], rowCount: 1 });

  it("durante a função, as consultas funcionam e passam pelo cliente", async () => {
    const f = fakePool(okScript);
    await withTenant(f.pool, devIdentity([A]), A, async (db) => {
      await db.query("SELECT 'dentro'");
    });
    expect(f.sqls).toContain("SELECT 'dentro'");
  });

  it("o db retido falha depois que withTenant resolve, sem tocar o cliente", async () => {
    const f = fakePool(okScript);
    let stale!: TenantDb;
    await withTenant(f.pool, devIdentity([A]), A, async (db) => {
      stale = db;
    });
    const before = f.sqls.length;
    await expect(stale.query("SELECT 'depois'")).rejects.toThrow(TenantDbClosedError);
    expect(f.sqls.length).toBe(before);
  });

  it("o método query guardado e chamado solto também falha, sem tocar o cliente", async () => {
    const f = fakePool(okScript);
    let detached!: TenantDb["query"];
    await withTenant(f.pool, devIdentity([A]), A, async (db) => {
      detached = db.query;
    });
    const before = f.sqls.length;
    await expect(detached("SELECT 'solto'")).rejects.toThrow(TenantDbClosedError);
    expect(f.sqls.length).toBe(before);
  });

  it("o db é encerrado quando a função lança (e a consulta tardia não chega ao cliente)", async () => {
    const f = fakePool(okScript);
    let stale!: TenantDb;
    await expect(
      withTenant(f.pool, devIdentity([A]), A, async (db) => {
        stale = db;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const before = f.sqls.length;
    await expect(stale.query("SELECT 'apos erro'")).rejects.toThrow(TenantDbClosedError);
    expect(f.sqls.length).toBe(before);
    expect(f.log).toEqual(["BEGIN", "SELECT", "ROLLBACK"]);
  });

  it("o db está encerrado quando a conexão é devolvida ao pool (release já o encontra inválido)", async () => {
    const sqlsAtRelease: number[] = [];
    let stale!: TenantDb;
    const f = fakePool(okScript);
    const originalConnect = f.pool.connect.bind(f.pool);
    f.pool.connect = async () => {
      const c = await originalConnect();
      const release = c.release.bind(c);
      c.release = (e) => {
        sqlsAtRelease.push(f.sqls.length);
        // no momento do release, uma consulta tardia já deve ser recusada
        void stale.query("SELECT 'no release'").catch(() => undefined);
        release(e);
      };
      return c;
    };
    await withTenant(f.pool, devIdentity([A]), A, async (db) => {
      stale = db;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(f.sqls.length).toBe(sqlsAtRelease[0]);
  });

  it("função que retorna com consulta não aguardada: transação desfeita, nunca confirmada", async () => {
    const f = fakePool(okScript);
    await expect(
      withTenant(f.pool, devIdentity([A]), A, async (db) => {
        void db.query("SLOW").catch(() => undefined);
        return "retornou";
      }),
    ).rejects.toThrow(UnsettledTenantOperationError);
    expect(f.log).toContain("ROLLBACK");
    expect(f.log).not.toContain("COMMIT");
  });

  it("consulta aguardada normalmente não conta como pendente", async () => {
    const f = fakePool(okScript);
    await expect(
      withTenant(f.pool, devIdentity([A]), A, async (db) => {
        await db.query("SLOW");
        return "ok";
      }),
    ).resolves.toBe("ok");
    expect(f.log).toContain("COMMIT");
  });

  it("o erro do db encerrado é distinguível de um erro de consulta do PostgreSQL", async () => {
    const f = fakePool(okScript);
    let stale!: TenantDb;
    await withTenant(f.pool, devIdentity([A]), A, async (db) => {
      stale = db;
    });
    const error = (await stale.query("SELECT 1").catch((e: unknown) => e)) as Error & { code?: string };
    expect(error).toBeInstanceOf(TenantDbClosedError);
    expect(error.code).toBe("TENANT_DB_CLOSED");
    expect(error.code).not.toMatch(/^[0-9A-Z]{5}$/); // um SQLSTATE do PostgreSQL tem cinco caracteres
  });
});

describe("withTenant aninhado (com dublê)", () => {
  it("é recusado de forma determinística, sem abrir uma segunda conexão", async () => {
    const f = fakePool();
    await expect(
      withTenant(f.pool, devIdentity([A]), A, async () => withTenant(f.pool, devIdentity([A]), A, async () => "interno")),
    ).rejects.toThrow(NestedTenantContextError);
    expect(f.connects()).toBe(1);
    expect(f.log).toContain("ROLLBACK");
  });

  it("se a função externa captura o erro, ela ainda confirma e só uma conexão foi usada", async () => {
    const f = fakePool();
    let nested: unknown;
    await withTenant(f.pool, devIdentity([A]), A, async () => {
      nested = await withTenant(f.pool, devIdentity([A]), A, async () => 1).catch((e: unknown) => e);
    });
    expect(nested).toBeInstanceOf(NestedTenantContextError);
    expect((nested as { code: string }).code).toBe("TENANT_NESTED_CONTEXT");
    expect(f.connects()).toBe(1);
    expect(f.log).toContain("COMMIT");
  });

  it("chamadas independentes e concorrentes não são tomadas por aninhadas", async () => {
    const f = fakePool();
    const results = await Promise.all([
      withTenant(f.pool, devIdentity([A]), A, async () => "a"),
      withTenant(f.pool, devIdentity([A]), A, async () => "b"),
    ]);
    expect(results).toEqual(["a", "b"]);
  });

  it("depois de uma chamada que terminou, uma nova chamada no mesmo fluxo é aceita", async () => {
    const f = fakePool();
    await withTenant(f.pool, devIdentity([A]), A, async () => 1);
    await expect(withTenant(f.pool, devIdentity([A]), A, async () => 2)).resolves.toBe(2);
  });
});

// SEC-20B-001: o COMMIT só vale se o servidor respondeu "COMMIT". Dublê de cliente: o comportamento real do servidor e do
// driver está em tenant-context.db.test.ts (que reproduz o defeito original contra o PostgreSQL).
describe("resultado do COMMIT (com dublê)", () => {
  const ok = { rows: [{ privileged: false }], rowCount: 1 };

  it("COMMIT respondido como ROLLBACK: rejeita, não devolve o valor da função e limpa", async () => {
    const f = fakePool((sql) => (sql === "COMMIT" ? { rows: [], rowCount: null, command: "ROLLBACK" } : ok));
    let stale!: TenantDb;
    const error = (await withTenant(f.pool, devIdentity([A]), A, async (db) => {
      stale = db;
      return "valor-do-callback";
    }).then(
      (v) => `RESOLVEU COM ${String(v)}`,
      (e: unknown) => e,
    )) as TransactionNotCommittedError;
    expect(error).toBeInstanceOf(TransactionNotCommittedError);
    expect(error.outcome).toBe("rolled_back");
    expect(error.code).toBe("TENANT_TRANSACTION_NOT_COMMITTED");
    expect(f.log).toEqual(["BEGIN", "SELECT", "COMMIT", "ROLLBACK"]);
    expect(f.releasedWith()).toEqual([false]);
    await expect(stale.query("SELECT 1")).rejects.toThrow(TenantDbClosedError);
  });

  it("COMMIT rejeitado: o resultado é 'unknown', o erro original vai em cause e o ROLLBACK de limpeza é tentado", async () => {
    const original = new Error("conexão perdida");
    const f = fakePool((sql) => {
      if (sql === "COMMIT") throw original;
      return ok;
    });
    const error = (await withTenant(f.pool, devIdentity([A]), A, async () => "v").then(
      () => "RESOLVEU",
      (e: unknown) => e,
    )) as TransactionNotCommittedError;
    expect(error).toBeInstanceOf(TransactionNotCommittedError);
    expect(error.outcome).toBe("unknown");
    expect(error.cause).toBe(original);
    expect(f.log).toEqual(["BEGIN", "SELECT", "COMMIT", "ROLLBACK"]);
    expect(f.releasedWith()).toEqual([false]);
  });

  it("COMMIT rejeitado e ROLLBACK também falha: a conexão é descartada (release(true)) e o erro é do COMMIT", async () => {
    const f = fakePool((sql) => {
      if (sql === "COMMIT") throw new Error("commit falhou");
      if (sql === "ROLLBACK") throw new Error("rollback falhou");
      return ok;
    });
    const error = (await withTenant(f.pool, devIdentity([A]), A, async () => "v").then(
      () => "RESOLVEU",
      (e: unknown) => e,
    )) as TransactionNotCommittedError;
    expect(error).toBeInstanceOf(TransactionNotCommittedError);
    expect(error.outcome).toBe("unknown");
    expect(f.releasedWith()).toEqual([true]);
  });

  it("resposta do COMMIT sem a tag ou com tag inesperada: falha fechada, resultado desconhecido", async () => {
    for (const reply of [{ rows: [], rowCount: null, command: undefined }, { rows: [], rowCount: null, command: "SELECT" }, null]) {
      const f = fakePool((sql) => (sql === "COMMIT" ? reply : ok));
      const error = (await withTenant(f.pool, devIdentity([A]), A, async () => "v").then(
        () => "RESOLVEU",
        (e: unknown) => e,
      )) as TransactionNotCommittedError;
      expect(error).toBeInstanceOf(TransactionNotCommittedError);
      expect(error.outcome).toBe("unknown");
    }
  });

  it("controle: COMMIT confirmado devolve o valor original da função", async () => {
    const f = fakePool();
    await expect(withTenant(f.pool, devIdentity([A]), A, async () => "valor")).resolves.toBe("valor");
    expect(f.log).toEqual(["BEGIN", "SELECT", "COMMIT"]);
  });

  it("o erro é distinguível dos demais erros de ciclo de vida e de um SQLSTATE", async () => {
    const e = new TransactionNotCommittedError("rolled_back") as Error & { code: string };
    expect(e).not.toBeInstanceOf(TenantDbClosedError);
    expect(e).not.toBeInstanceOf(UnsettledTenantOperationError);
    expect(e).not.toBeInstanceOf(NestedTenantContextError);
    expect(e.code).not.toMatch(/^[0-9A-Z]{5}$/);
    expect(e.message).not.toMatch(/SELECT|INSERT|tenant_id/i); // sem SQL nem dados na mensagem
  });
});

// Consultas concorrentes e superfície do db. Ordem dos eventos controlada por Promises adiadas (sem sleeps).
describe("consultas concorrentes e superfície do db (com dublê)", () => {
  function deferred() {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
  const ok = { rows: [{ privileged: false }], rowCount: 1 };

  it("duas consultas aguardadas juntas, resolvendo fora de ordem: o contador volta a zero e o COMMIT acontece", async () => {
    const q1 = deferred();
    const q2 = deferred();
    const f = fakePool((sql) => (sql === "Q1" ? q1.promise : sql === "Q2" ? q2.promise : ok));
    const run = withTenant(f.pool, devIdentity([A]), A, async (db) => {
      const all = Promise.all([db.query("Q1"), db.query("Q2")]);
      queueMicrotask(() => {
        q2.resolve({ rows: [], rowCount: 0 });
        queueMicrotask(() => q1.resolve({ rows: [], rowCount: 0 }));
      });
      await all;
      return "ok";
    });
    await expect(run).resolves.toBe("ok");
    expect(f.log).toEqual(["BEGIN", "SELECT", "Q1", "Q2", "COMMIT"]);
  });

  it("uma de duas pendentes ao retornar: não confirma; ao terminar a outra o ROLLBACK já foi emitido e o db está fechado", async () => {
    const q1 = deferred();
    const q2 = deferred();
    const f = fakePool((sql) => (sql === "Q1" ? q1.promise : sql === "Q2" ? q2.promise : ok));
    let stale!: TenantDb;
    const run = withTenant(f.pool, devIdentity([A]), A, async (db) => {
      stale = db;
      const p1 = db.query("Q1").catch(() => undefined);
      const p2 = db.query("Q2");
      void p1;
      queueMicrotask(() => q2.resolve({ rows: [], rowCount: 0 }));
      await p2; // só a Q2 é aguardada; a Q1 continua pendente
      return "retornou";
    });
    await expect(run).rejects.toThrow(UnsettledTenantOperationError);
    expect(f.log).toContain("ROLLBACK");
    expect(f.log).not.toContain("COMMIT");
    q1.resolve({ rows: [], rowCount: 0 }); // a consulta antiga termina depois; nada novo é enviado
    await Promise.resolve();
    await expect(stale.query("Q3")).rejects.toThrow(TenantDbClosedError);
    expect(f.sqls).not.toContain("Q3");
  });

  it("consulta aguardada que falha e foi capturada pelo callback: ainda é o COMMIT que decide (resposta do servidor)", async () => {
    const f = fakePool((sql) => {
      if (sql === "FALHA") throw Object.assign(new Error("erro sql"), { code: "22012" });
      if (sql === "COMMIT") return { rows: [], rowCount: null, command: "ROLLBACK" };
      return ok;
    });
    await expect(
      withTenant(f.pool, devIdentity([A]), A, async (db) => {
        await db.query("FALHA").catch(() => undefined);
        return "retorno-normal";
      }),
    ).rejects.toBeInstanceOf(TransactionNotCommittedError);
  });

  it("pendente que falha depois do retorno: sem rejeição não tratada criada pela implementação (o chamador tratou a sua Promise)", async () => {
    const q = deferred();
    const f = fakePool((sql) => (sql === "PEND" ? q.promise : ok));
    await expect(
      withTenant(f.pool, devIdentity([A]), A, async (db) => {
        db.query("PEND").catch(() => undefined);
        return "r";
      }),
    ).rejects.toThrow(UnsettledTenantOperationError);
    q.reject(new Error("falha tardia"));
    await new Promise((r) => setTimeout(r, 5)); // o vitest acusa qualquer rejeição não tratada como erro da execução
  });

  it("nenhuma função alcançável a partir do db retido executa SQL depois do encerramento", async () => {
    const f = fakePool();
    let stale!: TenantDb;
    await withTenant(f.pool, devIdentity([A]), A, async (db) => {
      stale = db;
    });
    const before = f.sqls.length;
    const seen = new Set<unknown>();
    const fns: Array<[string, (...a: unknown[]) => unknown]> = [];
    const walk = (value: unknown, path: string) => {
      if (value === null || (typeof value !== "object" && typeof value !== "function") || seen.has(value)) return;
      seen.add(value);
      for (const key of Reflect.ownKeys(value as object)) {
        const desc = Object.getOwnPropertyDescriptor(value, key);
        const child = desc && ("value" in desc ? desc.value : undefined);
        if (typeof child === "function") fns.push([`${path}.${String(key)}`, child as never]);
        walk(child, `${path}.${String(key)}`);
      }
      // Os protótipos intrínsecos (Object, Function e AsyncFunction) ficam de fora: o `constructor` deles cria funções novas
      // a partir de texto, no escopo global, e não enxerga as variáveis da closure (a conexão).
      const proto = Object.getPrototypeOf(value);
      const intrinsic = [Object.prototype, Function.prototype, Object.getPrototypeOf(async function () {})];
      if (proto && !intrinsic.includes(proto)) walk(proto, `${path}.__proto__`);
    };
    walk(stale, "db");
    fns.push(["db.query.call", (...a) => stale.query.call(undefined as never, ...(a as [string]))]);
    fns.push(["db.query.apply", (...a) => stale.query.apply(undefined as never, [a[0] as string])]);
    fns.push(["db.query.bind", (...a) => stale.query.bind(null)(a[0] as string)]);
    expect(fns.length).toBeGreaterThan(0);
    for (const [name, fn] of fns) {
      const outcome = await Promise.resolve()
        .then(() => fn("SELECT 'bypass'"))
        .then(() => "executou", (e: unknown) => (e instanceof TenantDbClosedError ? "recusou" : `outro erro: ${String(e)}`));
      expect([name, outcome]).toEqual([name, "recusou"]);
    }
    expect(f.sqls.length).toBe(before);
  });
});

// Perda de contexto do AsyncLocalStorage: SÓ DOCUMENTA O LIMITE (não é uma garantia). Um listener de evento disparado de
// fora do contexto não herda a marca "dentro de withTenant", então a chamada aninhada dele NÃO é detectada.
describe("LIMITAÇÃO DOCUMENTADA: aninhamento via evento disparado de fora do contexto (com dublê)", () => {
  it("o withTenant chamado de um listener emitido fora do contexto não é reconhecido como aninhado", async () => {
    const { EventEmitter } = await import("node:events");
    const emitter = new EventEmitter();
    const f = fakePool();
    let inner: unknown = "nao-rodou";
    setTimeout(() => emitter.emit("go"), 5); // agendado FORA do callback: o emit roda sem a marca
    await withTenant(f.pool, devIdentity([A]), A, async () => {
      await new Promise<void>((resolve) =>
        emitter.once("go", () => {
          inner = withTenant(f.pool, devIdentity([A]), A, async () => "interno").then(
            (v) => v,
            (e: unknown) => e,
          );
          resolve();
        }),
      );
    });
    expect(await inner).toBe("interno"); // não foi recusado como NestedTenantContextError
    expect(f.connects()).toBe(2); // adquiriu uma segunda conexão (num pool de tamanho 1 isso esperaria a primeira)
  });
});

// Fase 20E-1: o marcador de aninhamento carrega o ESCOPO e só recusa enquanto ele está ATIVO. Uma continuação criada dentro
// do callback herda o marcador mesmo depois do fim; ela não é "aninhada". Ordem dos eventos controlada por portões
// (Promises adiadas), sem sleeps. Dublê de pool: o comportamento com o PostgreSQL real está em tenant-context.db.test.ts.
describe("ciclo de vida do escopo: continuações herdadas (com dublê)", () => {
  function gate() {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => (open = resolve));
    return { promise, open };
  }
  const ok = { rows: [{ privileged: false }], rowCount: 1 };
  // Cada saída do escopo original. Só o PRIMEIRO COMMIT é alterado: a chamada independente da continuação commita normalmente.
  const exits: Array<[string, boolean, () => (sql: string) => unknown]> = [
    ["sucesso do callback", false, () => () => ok],
    ["exceção do callback", true, () => () => ok],
    ["COMMIT rejeitado", false, () => {
      let n = 0;
      return (sql) => {
        if (sql === "COMMIT" && ++n === 1) throw new Error("commit falhou");
        return ok;
      };
    }],
    ["COMMIT respondido como ROLLBACK", false, () => {
      let n = 0;
      return (sql) => (sql === "COMMIT" && ++n === 1 ? { rows: [], rowCount: null, command: "ROLLBACK" } : ok);
    }],
    ["COMMIT com resposta desconhecida", false, () => {
      let n = 0;
      return (sql) => (sql === "COMMIT" && ++n === 1 ? { rows: [], rowCount: null, command: undefined } : ok);
    }],
  ];

  it.each(exits)(
    "depois de %s: a continuação herdada é aceita como chamada independente e o db antigo continua fechado",
    async (_name, throws, makeScript) => {
      const f = fakePool(makeScript());
      const g = gate();
      let stale!: TenantDb;
      let continuation!: Promise<unknown>;
      await withTenant(f.pool, devIdentity([A]), A, async (db) => {
        stale = db;
        // criada DENTRO do escopo: herda o marcador; só roda quando o portão abrir
        continuation = g.promise.then(() =>
          withTenant(f.pool, devIdentity([A]), A, async () => "interno").then(
            (v) => v,
            (e: unknown) => e,
          ),
        );
        if (throws) throw new Error("boom");
        return "externo";
      }).then(
        () => undefined,
        () => undefined, // o escopo original terminou, de qualquer forma
      );
      const connectsAfterOuter = f.connects();
      g.open();
      expect(await continuation).toBe("interno"); // não foi recusada como aninhada
      expect(f.connects()).toBe(connectsAfterOuter + 1); // abriu a sua própria conexão
      const before = f.sqls.length;
      await expect(stale.query("SELECT 'velho'")).rejects.toThrow(TenantDbClosedError); // a capacidade antiga segue fechada
      expect(f.sqls.length).toBe(before); // sem executar SQL
    },
  );

  it("continuação herdada que roda ENQUANTO o escopo ainda está ativo continua sendo recusada", async () => {
    const f = fakePool();
    const g = gate();
    let inner: unknown;
    await withTenant(f.pool, devIdentity([A]), A, async () => {
      const continuation = g.promise.then(() =>
        withTenant(f.pool, devIdentity([A]), A, async () => "interno").then(
          (v) => v,
          (e: unknown) => e,
        ),
      );
      g.open();
      inner = await continuation; // ainda dentro do callback
    });
    expect(inner).toBeInstanceOf(NestedTenantContextError);
    expect(f.connects()).toBe(1);
  });

  it("escopos independentes não compartilham o marcador: o fim de um não encerra o outro, e um não é aninhado do outro", async () => {
    const f = fakePool();
    const aReady = gate();
    const releaseA = gate();
    let nestedInA: unknown;
    const a = withTenant(f.pool, devIdentity([A]), A, async () => {
      aReady.open();
      await releaseA.promise;
      // o B já terminou; o escopo do A segue ativo, então a chamada aninhada DO A continua recusada
      nestedInA = await withTenant(f.pool, devIdentity([A]), A, async () => 1).then(
        () => "procedeu",
        (e: unknown) => e,
      );
    });
    await aReady.promise;
    // nasce de fora do contexto do A, com o A ativo: é uma chamada independente
    await expect(withTenant(f.pool, devIdentity([A]), A, async () => "b-ok")).resolves.toBe("b-ok");
    releaseA.open();
    await a;
    expect(nestedInA).toBeInstanceOf(NestedTenantContextError);
    expect(f.connects()).toBe(2);
  });
});

// Fase 20E-2: aquisição de conexão com limite OPCIONAL (`acquireTimeoutMs`). Dublê de pool controlado por Promises e por
// timers falsos do vitest (sem sleeps): cada teste decide a ordem exata entre a chegada da conexão e o timer. O pool real
// (pg-pool) está em tenant-context.db.test.ts.
describe("aquisição limitada de conexão (com dublê, timers falsos)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function controlled() {
    const sqls: string[] = [];
    const clients: Array<{ released: unknown[]; client: ClientLike }> = [];
    const pending: Array<{ resolve: (c: ClientLike) => void; reject: (e: unknown) => void; entry: (typeof clients)[number] }> = [];
    let connects = 0;
    const makeClient = () => {
      const released: unknown[] = [];
      const client: ClientLike = {
        async query(text: string) {
          sqls.push(text);
          if (text === "SLOW") return new Promise<never>(() => undefined); // nunca termina: fica pendente
          if (text === "COMMIT") return { rows: [], rowCount: null, command: "COMMIT" } as never;
          return { rows: [{ privileged: false }], rowCount: 1 } as never;
        },
        release(e) {
          released.push(e);
        },
      };
      const entry = { released, client };
      clients.push(entry);
      return entry;
    };
    const pool: PoolLike = {
      connect() {
        connects += 1;
        const entry = makeClient();
        return new Promise<ClientLike>((resolve, reject) => pending.push({ resolve, reject, entry }));
      },
    };
    return { pool, sqls, pending, clients, connects: () => connects };
  }
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const identity = () => devIdentity([A]);

  it("U1: a conexão chega antes do limite: fluxo normal, liberada uma vez, sem timer sobrando", async () => {
    vi.useFakeTimers();
    const c = controlled();
    const run = withTenant(c.pool, identity(), A, async () => "valor", { acquireTimeoutMs: 1000 });
    expect(vi.getTimerCount()).toBe(1);
    c.pending[0]!.resolve(c.pending[0]!.entry.client);
    await expect(run).resolves.toBe("valor");
    expect(c.sqls).toEqual(["BEGIN", expect.stringContaining("set_config"), "COMMIT"]);
    expect(c.pending[0]!.entry.released).toEqual([false]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("U2: o limite expira antes da aquisição: erro tipado, sem BEGIN nem SQL, sem timer sobrando", async () => {
    vi.useFakeTimers();
    const c = controlled();
    const run = withTenant(c.pool, identity(), A, async () => "valor", { acquireTimeoutMs: 1000 });
    const settled = run.then(() => "RESOLVEU", (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const error = (await settled) as ConnectionAcquireTimeoutError;
    expect(error).toBeInstanceOf(ConnectionAcquireTimeoutError);
    expect(error.code).toBe("TENANT_CONNECTION_ACQUIRE_TIMEOUT");
    expect(error.code).not.toMatch(/^[0-9A-Z]{5}$/);
    expect(error.acquireTimeoutMs).toBe(1000);
    expect(error.message).toMatch(/nenhuma transação foi iniciada/);
    expect(c.sqls).toEqual([]);
    expect(c.connects()).toBe(1); // sem nova tentativa
    expect(vi.getTimerCount()).toBe(0);
  });

  it("U3: a conexão que chega DEPOIS do timeout é liberada exatamente uma vez e não executa SQL", async () => {
    vi.useFakeTimers();
    const c = controlled();
    const settled = withTenant(c.pool, identity(), A, async () => "valor", { acquireTimeoutMs: 1000 }).then(() => "RESOLVEU", (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await settled).toBeInstanceOf(ConnectionAcquireTimeoutError);
    c.pending[0]!.resolve(c.pending[0]!.entry.client); // chega tarde
    await flush();
    expect(c.pending[0]!.entry.released).toHaveLength(1);
    expect(c.sqls).toEqual([]);
  });

  it("U4: a aquisição rejeita antes do limite: o erro original é propagado", async () => {
    vi.useFakeTimers();
    const c = controlled();
    const original = new Error("pool esgotado");
    const settled = withTenant(c.pool, identity(), A, async () => "valor", { acquireTimeoutMs: 1000 }).then(() => "RESOLVEU", (e: unknown) => e);
    c.pending[0]!.reject(original);
    expect(await settled).toBe(original);
    expect(vi.getTimerCount()).toBe(0);
    expect(c.sqls).toEqual([]);
  });

  it("U5a: corrida em que o TIMER vence (a conexão já estava resolvida, mas a reação ainda não rodou): uma só dona", async () => {
    vi.useFakeTimers();
    const c = controlled();
    const settled = withTenant(c.pool, identity(), A, async () => "valor", { acquireTimeoutMs: 1000 }).then(() => "RESOLVEU", (e: unknown) => e);
    c.pending[0]!.resolve(c.pending[0]!.entry.client); // a reação (microtask) ainda não rodou...
    vi.advanceTimersByTime(1000); // ...e o timer dispara primeiro
    await flush();
    expect(await settled).toBeInstanceOf(ConnectionAcquireTimeoutError);
    expect(c.pending[0]!.entry.released).toHaveLength(1); // devolvida uma vez, pela via da chegada tardia
    expect(c.sqls).toEqual([]);
  });

  it("U5b: corrida em que a CONEXÃO vence: o timer é desligado, a chamada segue e a conexão é liberada uma vez", async () => {
    vi.useFakeTimers();
    const c = controlled();
    const run = withTenant(c.pool, identity(), A, async () => "valor", { acquireTimeoutMs: 1000 });
    c.pending[0]!.resolve(c.pending[0]!.entry.client);
    await flush(); // a reação rodou antes do timer
    vi.advanceTimersByTime(1000);
    await expect(run).resolves.toBe("valor");
    expect(c.pending[0]!.entry.released).toEqual([false]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("U6: rejeição tardia da aquisição, depois do timeout, não vira rejeição não tratada", async () => {
    vi.useFakeTimers();
    const c = controlled();
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      const settled = withTenant(c.pool, identity(), A, async () => "valor", { acquireTimeoutMs: 1000 }).then(() => "RESOLVEU", (e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await settled).toBeInstanceOf(ConnectionAcquireTimeoutError);
      vi.useRealTimers();
      c.pending[0]!.reject(new Error("rejeição tardia"));
      await new Promise((resolve) => setImmediate(resolve)); // deixa o Node emitir 'unhandledRejection', se houver
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });

  it("U7: várias aquisições expiradas não acumulam timers; cada conexão tardia é liberada uma vez", async () => {
    vi.useFakeTimers();
    const c = controlled();
    const runs = Array.from({ length: 5 }, () =>
      withTenant(c.pool, identity(), A, async () => "valor", { acquireTimeoutMs: 1000 }).then(() => "RESOLVEU", (e: unknown) => e),
    );
    expect(vi.getTimerCount()).toBe(5);
    await vi.advanceTimersByTimeAsync(1000);
    for (const outcome of await Promise.all(runs)) expect(outcome).toBeInstanceOf(ConnectionAcquireTimeoutError);
    expect(vi.getTimerCount()).toBe(0);
    expect(c.connects()).toBe(5);
    expect(c.clients.every((x) => x.released.length === 0)).toBe(true); // nada liberado enquanto não chega
    for (const p of c.pending) p.resolve(p.entry.client);
    await flush();
    expect(c.clients.map((x) => x.released.length)).toEqual([1, 1, 1, 1, 1]);
    expect(c.sqls).toEqual([]);
  });

  it("U8: a autorização continua antes da aquisição: negada, não chama connect e não liga timer", async () => {
    vi.useFakeTimers();
    const c = controlled();
    await expect(withTenant(c.pool, devIdentity([B]), A, async () => "x", { acquireTimeoutMs: 1000 })).rejects.toThrow(TenantAccessDeniedError);
    await expect(withTenant(c.pool, identity(), "invalido", async () => "x", { acquireTimeoutMs: 1000 })).rejects.toThrow(InvalidTenantIdError);
    expect(c.connects()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("U9: com o limite configurado, os fluxos de erro continuam iguais (exceção, COMMIT que não confirma, pendente, db fechado)", async () => {
    vi.useFakeTimers();
    // exceção do callback: ROLLBACK e liberação uma vez
    const a = controlled();
    const ra = withTenant(a.pool, identity(), A, async () => { throw new Error("boom"); }, { acquireTimeoutMs: 1000 }).then(() => "RESOLVEU", (e: unknown) => e);
    a.pending[0]!.resolve(a.pending[0]!.entry.client);
    expect(((await ra) as Error).message).toBe("boom");
    expect(a.sqls).toContain("ROLLBACK");
    expect(a.pending[0]!.entry.released).toEqual([false]);
    // consulta pendente no retorno: desfaz
    const b = controlled();
    const rb = withTenant(b.pool, identity(), A, async (db) => { void db.query("SLOW").catch(() => undefined); return "r"; }, { acquireTimeoutMs: 1000 }).then(() => "RESOLVEU", (e: unknown) => e);
    b.pending[0]!.resolve(b.pending[0]!.entry.client);
    expect(await rb).toBeInstanceOf(UnsettledTenantOperationError);
    // db retido fechado
    const d = controlled();
    let stale!: TenantDb;
    const rd = withTenant(d.pool, identity(), A, async (db) => { stale = db; }, { acquireTimeoutMs: 1000 });
    d.pending[0]!.resolve(d.pending[0]!.entry.client);
    await rd;
    await expect(stale.query("SELECT 1")).rejects.toThrow(TenantDbClosedError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5, "100", null, 2_147_483_648, {}, true])(
    "U10: o limite inválido %j lança TypeError antes de qualquer conexão e nunca desliga a proteção em silêncio",
    async (value) => {
      vi.useFakeTimers();
      const c = controlled();
      await expect(withTenant(c.pool, identity(), A, async () => "x", { acquireTimeoutMs: value as never })).rejects.toThrow(TypeError);
      expect(c.connects()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("U10b: os extremos válidos (1 e 2147483647) são aceitos; sem a opção não há timer (espera ilimitada, documentado)", async () => {
    vi.useFakeTimers();
    for (const limit of [1, 2_147_483_647]) {
      const c = controlled();
      const run = withTenant(c.pool, identity(), A, async () => "ok", { acquireTimeoutMs: limit });
      expect(vi.getTimerCount()).toBe(1);
      c.pending[0]!.resolve(c.pending[0]!.entry.client);
      await expect(run).resolves.toBe("ok");
    }
    const c = controlled();
    void withTenant(c.pool, identity(), A, async () => "x", {}).catch(() => undefined);
    void withTenant(c.pool, identity(), A, async () => "x").catch(() => undefined);
    expect(vi.getTimerCount()).toBe(0); // sem limite: a espera é a do pool
  });
});

// Fase 20E-3: limites de execução do PostgreSQL aplicados por transação (statement_timeout, lock_timeout,
// idle_in_transaction_session_timeout). Dublê de cliente (EventEmitter, como o `pg`): prova a validação, a ORDEM das chamadas,
// que os valores vão como parâmetros e o tratamento de erros. NÃO prova que o servidor cancela nada: isso está em
// tenant-context.db.test.ts, contra o PostgreSQL real.
describe("limites de execução por transação (com dublê)", () => {
  type Call = { text: string; values?: unknown[] };
  function recording(script?: (call: Call) => unknown) {
    const calls: Call[] = [];
    const released: unknown[] = [];
    const clients: FakeClient[] = [];
    let connects = 0;
    class FakeClient extends EventEmitter {
      dead = false;
      async query(text: string, values?: unknown[]) {
        const call = { text, values };
        calls.push(call);
        if (this.dead) throw new Error("Client has encountered a connection error and is not queryable");
        const custom = script ? await script(call) : undefined;
        if (custom !== undefined) return custom as never;
        if (text === "COMMIT") return { rows: [], rowCount: null, command: "COMMIT" } as never;
        return { rows: [{ privileged: false }], rowCount: 1 } as never;
      }
      release(error?: Error | boolean) {
        released.push(error);
      }
    }
    const pool: PoolLike = {
      async connect() {
        connects += 1;
        const client = new FakeClient();
        clients.push(client);
        return client as unknown as ClientLike;
      },
    };
    const texts = () => calls.map((c) => c.text.split(/\s+/).slice(0, 2).join(" "));
    return { pool, calls, released, clients, connects: () => connects, texts };
  }
  const id = () => devIdentity([A]);
  const ALL = { statementTimeoutMs: 300, lockTimeoutMs: 400, idleInTransactionTimeoutMs: 500 };
  const isLimits = (c: Call) => /set_config\('(statement_timeout|lock_timeout|idle_in_transaction_session_timeout)'/.test(c.text);

  it.each(["statementTimeoutMs", "lockTimeoutMs", "idleInTransactionTimeoutMs"] as const)(
    "U1: %s inválido (0, negativo, NaN, infinitos, não inteiro, texto, booleano, null, objeto, acima do teto) lança TypeError antes de qualquer conexão",
    async (name) => {
      for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5, "100", true, null, {}, 2_147_483_648]) {
        const r = recording();
        const error = await withTenant(r.pool, id(), A, async () => "x", { [name]: bad as never }).then(() => "RESOLVEU", (e: unknown) => e);
        expect(error).toBeInstanceOf(TypeError);
        expect((error as Error).message).toContain(name);
        expect(r.connects()).toBe(0);
      }
    },
  );

  it("U1b: os extremos válidos (1 e 2147483647) são aceitos e vão como texto inteiro, sem truncar", async () => {
    const r = recording();
    await withTenant(r.pool, id(), A, async () => "x", { statementTimeoutMs: 1, lockTimeoutMs: 2_147_483_647, idleInTransactionTimeoutMs: 1000 });
    expect(r.calls.find(isLimits)?.values).toEqual(["1", "2147483647", "1000"]);
  });

  it("U2: os limites são aplicados DEPOIS da autorização e do contexto e ANTES da função, com nomes constantes e valores como parâmetros", async () => {
    const r = recording();
    await withTenant(r.pool, id(), A, async (db) => { await db.query("SELECT 'da função'"); return "ok"; }, ALL);
    expect(r.texts()).toEqual(["BEGIN", "SELECT set_config('app.tenant_id',", "SELECT set_config('statement_timeout',", "SELECT 'da", "COMMIT"]);
    const limits = r.calls.find(isLimits)!;
    expect(limits.text).toBe(
      "SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true), set_config('idle_in_transaction_session_timeout', $3, true)",
    );
    expect(limits.values).toEqual(["300", "400", "500"]);
    expect(limits.text).not.toMatch(/300|400|500/); // nenhum valor interpolado no SQL
  });

  it("U2b: se a configuração dos limites falhar, a função NÃO roda e o erro original sobe (sem embrulho)", async () => {
    const original = new Error("config falhou");
    const r = recording((c) => { if (isLimits(c)) throw original; return undefined; });
    let ran = false;
    const error = await withTenant(r.pool, id(), A, async () => { ran = true; }, ALL).then(() => "RESOLVEU", (e: unknown) => e);
    expect(error).toBe(original);
    expect(ran).toBe(false);
    expect(r.texts()).toEqual(["BEGIN", "SELECT set_config('app.tenant_id',", "SELECT set_config('statement_timeout',", "ROLLBACK"]);
    expect(r.released).toEqual([false]);
  });

  it("U2c: a falha de configuração e a do ROLLBACK de limpeza descartam a conexão (release(true))", async () => {
    const r = recording((c) => {
      if (isLimits(c)) throw new Error("config falhou");
      if (c.text === "ROLLBACK") throw new Error("rollback falhou");
      return undefined;
    });
    await expect(withTenant(r.pool, id(), A, async () => "x", ALL)).rejects.toThrow("config falhou");
    expect(r.released).toEqual([true]);
  });

  it("U3: parâmetros omitidos: só os configurados entram e, sem nenhum, não há SQL extra (comportamento anterior)", async () => {
    const some = recording();
    await withTenant(some.pool, id(), A, async () => "x", { lockTimeoutMs: 400 });
    const call = some.calls.find(isLimits)!;
    expect(call.text).toBe("SELECT set_config('lock_timeout', $1, true)");
    expect(call.values).toEqual(["400"]);
    for (const options of [undefined, {}, { acquireTimeoutMs: 1000 }]) {
      const none = recording();
      await withTenant(none.pool, id(), A, async () => "x", options);
      expect(none.texts()).toEqual(["BEGIN", "SELECT set_config('app.tenant_id',", "COMMIT"]);
    }
  });

  it("U5: o erro SQL de timeout (SQLSTATE 57014 e 55P03) sobe como está: não vira erro de aquisição nem é embrulhado", async () => {
    for (const code of ["57014", "55P03"]) {
      const r = recording();
      const sqlError = Object.assign(new Error("timeout do servidor"), { code });
      const error = await withTenant(r.pool, id(), A, async (db) => { void db; throw sqlError; }, ALL).then(() => "RESOLVEU", (e: unknown) => e);
      expect(error).toBe(sqlError);
      expect(error).not.toBeInstanceOf(ConnectionAcquireTimeoutError);
      expect((error as { code: string }).code).toBe(code);
      expect(r.texts()).toContain("ROLLBACK");
      expect(r.released).toEqual([false]);
    }
  });

  it("U6: o callback captura o erro de timeout e retorna: o COMMIT respondido como ROLLBACK continua sendo detectado", async () => {
    const r = recording((c) => {
      if (c.text === "SELECT pg_sleep(9)") throw Object.assign(new Error("cancelado"), { code: "57014" });
      if (c.text === "COMMIT") return { rows: [], rowCount: null, command: "ROLLBACK" };
      return undefined;
    });
    const error = (await withTenant(r.pool, id(), A, async (db) => {
      await db.query("SELECT pg_sleep(9)").catch(() => undefined);
      return "retorno-normal";
    }, ALL).then(() => "RESOLVEU", (e: unknown) => e)) as TransactionNotCommittedError;
    expect(error).toBeInstanceOf(TransactionNotCommittedError);
    expect(error.outcome).toBe("rolled_back");
  });

  it("U7: compatível com a aquisição limitada, capacidade fechada e consulta pendente", async () => {
    const r = recording((c) => (c.text === "SLOW" ? new Promise(() => undefined) : undefined));
    let stale!: TenantDb;
    await expect(withTenant(r.pool, id(), A, async (db) => { stale = db; return "ok"; }, { acquireTimeoutMs: 1000, ...ALL })).resolves.toBe("ok");
    await expect(stale.query("SELECT 1")).rejects.toThrow(TenantDbClosedError);
    const p = recording((c) => (c.text === "SLOW" ? new Promise(() => undefined) : undefined));
    await expect(withTenant(p.pool, id(), A, async (db) => { void db.query("SLOW").catch(() => undefined); return "r"; }, ALL)).rejects.toThrow(UnsettledTenantOperationError);
    expect(p.texts()).not.toContain("COMMIT");
  });

  it("U8: duas chamadas concorrentes com limites diferentes não compartilham configuração nem alteram as opções recebidas", async () => {
    const r = recording();
    const optsA = Object.freeze({ statementTimeoutMs: 111 });
    const optsB = Object.freeze({ statementTimeoutMs: 222, lockTimeoutMs: 333 });
    await Promise.all([withTenant(r.pool, id(), A, async () => "a", optsA), withTenant(r.pool, id(), A, async () => "b", optsB)]);
    expect(optsA).toEqual({ statementTimeoutMs: 111 });
    expect(optsB).toEqual({ statementTimeoutMs: 222, lockTimeoutMs: 333 });
    const used = r.calls.filter(isLimits).map((c) => c.values).sort((x, y) => String(x).localeCompare(String(y)));
    expect(used).toEqual([["111"], ["222", "333"]]);
  });

  it("sessão encerrada pelo servidor: o 'error' do cliente tem ouvinte durante o uso, é removido ao fim, e a conexão é descartada", async () => {
    const r = recording();
    let during = -1;
    const error = (await withTenant(r.pool, id(), A, async () => {
      const client = r.clients[0]!;
      during = client.listenerCount("error");
      client.dead = true; // o servidor encerrou a sessão
      expect(() => client.emit("error", new Error("terminating connection due to idle-in-transaction timeout"))).not.toThrow();
      return "retornou";
    }, ALL).then(() => "RESOLVEU", (e: unknown) => e)) as TransactionNotCommittedError;
    expect(during).toBe(1);
    expect(r.clients[0]!.listenerCount("error")).toBe(0);
    expect(error).toBeInstanceOf(TransactionNotCommittedError);
    expect(error.outcome).toBe("unknown");
    expect(r.released).toEqual([true]); // o ROLLBACK também falhou: descartada, nunca devolvida como saudável
  });

  it("o ouvinte de 'error' também é removido quando a função lança e quando tudo corre bem", async () => {
    for (const throws of [false, true]) {
      const r = recording();
      await withTenant(r.pool, id(), A, async () => { if (throws) throw new Error("boom"); return 1; }).catch(() => undefined);
      expect(r.clients[0]!.listenerCount("error")).toBe(0);
    }
  });
});

// Fase 20E-5: posse da conexão quando o registro/remoção do ouvinte falha, e preservação do primeiro erro de conexão. Dublê
// de cliente (EventEmitter): prova a lógica de posse e causalidade; o comportamento do servidor e do driver real está em
// tenant-context.db.test.ts. A garantia de tipos (U4) é verificada pelo `tsc` (`pnpm typecheck`), não pelo vitest.
describe("posse da conexão e erros do cliente (com dublê)", () => {
  function make(over: { on?: () => unknown; removeListener?: () => unknown; release?: () => void; script?: (text: string) => unknown } = {}) {
    const calls: string[] = [];
    const released: unknown[] = [];
    let connects = 0;
    const client = Object.assign(new EventEmitter(), {
      dead: false,
      async query(text: string) {
        calls.push(text.split(/\s+/)[0] ?? "");
        if (client.dead) throw new Error("Client has encountered a connection error and is not queryable");
        const custom = over.script ? await over.script(text) : undefined;
        if (custom !== undefined) return custom as never;
        if (text === "COMMIT") return { rows: [], rowCount: null, command: "COMMIT" } as never;
        return { rows: [{ privileged: false }], rowCount: 1 } as never;
      },
      release(error?: unknown) {
        released.push(error);
        over.release?.();
      },
    });
    if (over.on) (client as unknown as { on: unknown }).on = over.on;
    if (over.removeListener) (client as unknown as { removeListener: unknown }).removeListener = over.removeListener;
    const pool: PoolLike = {
      async connect() {
        connects += 1;
        return client as unknown as ClientLike;
      },
    };
    return { pool, client, calls, released, connects: () => connects };
  }
  const id = () => devIdentity([A]);

  it("U1: `on` lança: nenhum SQL, a função não roda, o erro de registro é preservado e a conexão é descartada uma vez", async () => {
    const registro = new Error("on falhou");
    const m = make({ on: () => { throw registro; } });
    let ran = false;
    const error = await withTenant(m.pool, id(), A, async () => { ran = true; }).then(() => "RESOLVEU", (e: unknown) => e);
    expect(error).toBe(registro);
    expect(ran).toBe(false);
    expect(m.calls).toEqual([]); // nem BEGIN nem ROLLBACK
    expect(m.released).toEqual([true]);
    expect(m.connects()).toBe(1);
  });

  it("U1b: cliente incoerente em tempo de execução (só `on`): TypeError antes de qualquer SQL e conexão descartada", async () => {
    const m = make();
    delete (m.client as unknown as { removeListener?: unknown }).removeListener; // sem removeListener no objeto nem no protótipo
    Object.setPrototypeOf(m.client, null);
    (m.client as unknown as { on: unknown }).on = () => undefined;
    const error = await withTenant(m.pool, id(), A, async () => "x").then(() => "RESOLVEU", (e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect(m.calls).toEqual([]);
    expect(m.released).toEqual([true]);
  });

  it("U2: `removeListener` lança depois do sucesso: a transação já foi confirmada, a conexão é descartada e o erro é explícito", async () => {
    const remocao = new Error("remove falhou");
    const m = make({ removeListener: () => { throw remocao; } });
    const error = (await withTenant(m.pool, id(), A, async () => "valor").then(() => "RESOLVEU", (e: unknown) => e)) as ConnectionCleanupError;
    expect(error).toBeInstanceOf(ConnectionCleanupError);
    expect(error.cause).toBe(remocao);
    expect(error.committed).toBe(true);
    expect(error.code).toBe("TENANT_CONNECTION_CLEANUP");
    expect(error.code).not.toMatch(/^[0-9A-Z]{5}$/);
    expect(m.calls).toEqual(["BEGIN", "SELECT", "COMMIT"]); // foi confirmada
    expect(m.released).toEqual([true]); // não devolvida como saudável; exatamente um release
  });

  it("U2b: o `release` lança depois do sucesso: erro explícito de limpeza, sem segundo release", async () => {
    const m = make({ release: () => { throw new Error("release falhou"); } });
    const error = await withTenant(m.pool, id(), A, async () => "valor").then(() => "RESOLVEU", (e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectionCleanupError);
    expect(m.released).toHaveLength(1);
  });

  it("U3: a função lança e a remoção do ouvinte também: o erro primário prevalece, a falha de limpeza fica acessível, conexão descartada", async () => {
    const primario = new Error("boom-primario");
    const remocao = new Error("remove falhou");
    const m = make({ removeListener: () => { throw remocao; } });
    const error = await withTenant(m.pool, id(), A, async () => { throw primario; }).then(() => "RESOLVEU", (e: unknown) => e);
    expect(error).toBe(primario); // a mesma identidade
    expect((error as { cleanupError?: unknown }).cleanupError).toBe(remocao);
    expect(Object.keys(error as object)).not.toContain("cleanupError"); // não enumerável
    expect(m.calls).toContain("ROLLBACK");
    expect(m.released).toEqual([true]);
  });

  it("U3b: primário congelado ou que não é objeto: continua sendo o erro lançado e a conexão é descartada", async () => {
    for (const primario of [Object.freeze(new Error("congelado")), "texto", 42, null]) {
      const m = make({ removeListener: () => { throw new Error("remove falhou"); } });
      const error = await withTenant(m.pool, id(), A, async () => { throw primario; }).then(() => "RESOLVEU", (e: unknown) => e);
      expect(error).toBe(primario);
      expect(m.released).toEqual([true]);
    }
  });

  it("U3c: a função lança e o release também: o erro primário prevalece, com a falha em cleanupError", async () => {
    const primario = new Error("boom");
    const m = make({ release: () => { throw new Error("release falhou"); } });
    const error = await withTenant(m.pool, id(), A, async () => { throw primario; }).then(() => "RESOLVEU", (e: unknown) => e);
    expect(error).toBe(primario);
    expect((error as { cleanupError?: Error }).cleanupError?.message).toBe("release falhou");
    expect(m.released).toHaveLength(1);
  });

  it("U4: o contrato de tipos: `on` e `removeListener` juntos ou nenhum (verificado pelo tsc, não só em execução)", () => {
    const base = { async query() { return { rows: [], rowCount: 0 }; }, release() {} };
    const nenhum: ClientLike = { ...base };
    const ambos: ClientLike = { ...base, on() { return undefined; }, removeListener() { return undefined; } };
    // @ts-expect-error só `on`: registraria um ouvinte sem como removê-lo
    const sóOn: ClientLike = { ...base, on() { return undefined; } };
    // @ts-expect-error só `removeListener`: sem como registrar
    const sóRemove: ClientLike = { ...base, removeListener() { return undefined; } };
    expect([nenhum, ambos, sóOn, sóRemove]).toHaveLength(4);
  });

  it("U5: o PRIMEIRO erro de conexão vira a causa do COMMIT que falha; o resultado segue 'unknown'", async () => {
    const m = make();
    const primeiro = new Error("terminating connection due to administrator command");
    const segundo = new Error("Connection terminated unexpectedly");
    const error = (await withTenant(m.pool, id(), A, async () => {
      m.client.dead = true;
      m.client.emit("error", primeiro);
      m.client.emit("error", segundo);
      return "retornou";
    }).then(() => "RESOLVEU", (e: unknown) => e)) as TransactionNotCommittedError;
    expect(error).toBeInstanceOf(TransactionNotCommittedError);
    expect(error.outcome).toBe("unknown"); // o evento não prova commit nem rollback
    expect(error.cause).toBe(primeiro); // o primeiro, não o segundo nem a rejeição genérica
    expect(m.released).toEqual([true]);
  });

  it("U5b: um erro de conexão observado NÃO altera o resultado de um COMMIT que o servidor confirmou", async () => {
    const m = make();
    const valor = await withTenant(m.pool, id(), A, async () => {
      m.client.emit("error", new Error("erro observado, mas o cliente continua consultável"));
      return "valor";
    });
    expect(valor).toBe("valor");
    expect(m.calls).toEqual(["BEGIN", "SELECT", "COMMIT"]);
    expect(m.released).toEqual([true]); // AUD-001: confirmado, mas a conexão com erro observado é descartada (não reclassifica o resultado)
  });

  it("T1: erro observado e ROLLBACK de limpeza bem-sucedido: o erro primário prevalece e a conexão é descartada uma vez, sem depender do pool", async () => {
    const m = make();
    const primario = new Error("falha-primaria");
    const error = await withTenant(m.pool, id(), A, async () => {
      m.client.emit("error", new Error("erro de conexão observado")); // o cliente continua consultável: o ROLLBACK responde
      throw primario;
    }).then(() => "RESOLVEU", (e: unknown) => e);
    expect(error).toBe(primario);
    expect(m.calls).toEqual(["BEGIN", "SELECT", "ROLLBACK"]); // o ROLLBACK foi aceito; o evento sozinho não prova rollback
    expect(m.released).toEqual([true]);
  });

  it("T3: erro observado antes de uma falha de consulta: erro primário preservado, release(true) exatamente uma vez", async () => {
    const m = make({ script: (t) => { if (t.startsWith("SELECT 1")) throw new Error("consulta falhou"); return undefined; } });
    const error = (await withTenant(m.pool, id(), A, async (db) => {
      m.client.emit("error", new Error("evento"));
      await db.query("SELECT 1");
    }).then(() => "RESOLVEU", (e: unknown) => e)) as Error;
    expect(error.message).toBe("consulta falhou");
    expect(m.released).toEqual([true]);
  });

  it("T4a: erro observado, COMMIT confirmado e removeListener lança: ConnectionCleanupError (committed), um release(true)", async () => {
    const remocao = new Error("remove falhou");
    const m = make({ removeListener: () => { throw remocao; } });
    const error = (await withTenant(m.pool, id(), A, async () => {
      m.client.emit("error", new Error("evento"));
      return "v";
    }).then(() => "RESOLVEU", (e: unknown) => e)) as ConnectionCleanupError;
    expect(error).toBeInstanceOf(ConnectionCleanupError);
    expect(error.committed).toBe(true);
    expect(error.cause).toBe(remocao);
    expect(m.calls).toEqual(["BEGIN", "SELECT", "COMMIT"]);
    expect(m.released).toEqual([true]);
  });

  it("T4b: erro observado, falha primária e release lança: primário preservado com cleanupError, um único release(true)", async () => {
    const primario = new Error("primario");
    const falhaRelease = new Error("release falhou");
    const m = make({ release: () => { throw falhaRelease; } });
    const error = await withTenant(m.pool, id(), A, async () => {
      m.client.emit("error", new Error("evento"));
      throw primario;
    }).then(() => "RESOLVEU", (e: unknown) => e);
    expect(error).toBe(primario);
    expect((error as { cleanupError?: unknown }).cleanupError).toBe(falhaRelease);
    expect(m.released).toEqual([true]);
  });

  it("T4c: erro emitido DEPOIS do COMMIT e antes da limpeza (ainda sob controle do wrapper): valor devolvido e release(true)", async () => {
    const m = make({ script: (t) => { if (t === "COMMIT") { m.client.emit("error", new Error("evento pós-COMMIT")); } return undefined; } });
    const valor = await withTenant(m.pool, id(), A, async () => "v");
    expect(valor).toBe("v");
    expect(m.released).toEqual([true]);
  });

  it("U5c: sem evento, a causa do COMMIT rejeitado continua sendo a própria rejeição", async () => {
    const rejeicao = new Error("commit rejeitado");
    const m = make({ script: (t) => { if (t === "COMMIT") throw rejeicao; return undefined; } });
    const error = (await withTenant(m.pool, id(), A, async () => "v").then(() => "RESOLVEU", (e: unknown) => e)) as TransactionNotCommittedError;
    expect(error.cause).toBe(rejeicao);
  });

  it("U6: depois da liberação o ouvinte temporário já saiu: um erro posterior pertence ao ouvinte do POOL, não ao withTenant", async () => {
    const m = make();
    await withTenant(m.pool, id(), A, async () => "x");
    expect(m.client.listenerCount("error")).toBe(0);
    // sem ouvinte, o EventEmitter lança: o withTenant não engole o que vem depois de devolver a conexão
    expect(() => m.client.emit("error", new Error("cliente ocioso morreu"))).toThrow("cliente ocioso morreu");
    const doPool: Error[] = [];
    m.client.on("error", (e: Error) => doPool.push(e)); // o que o pool faz ao receber a conexão de volta
    m.client.emit("error", new Error("de novo"));
    expect(doPool).toHaveLength(1);
  });
});
