import { EventEmitter } from "node:events";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ConnectionAcquireTimeoutError,
  NestedTenantContextError,
  TenantAccessDeniedError,
  TenantDbClosedError,
  TransactionNotCommittedError,
  UnsafeConnectionError,
  UnsettledTenantOperationError,
  devIdentity,
  withTenant,
  type PoolLike,
  type TenantDb,
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

// Ciclo de vida do `db` contra PostgreSQL REAL, com pool de tamanho 1 para FORÇAR a reutilização da mesma conexão entre
// tenants. Não validam o Neon nem um pooler externo (PgBouncer): só o comportamento do driver `pg` e do servidor.
describe("ciclo de vida do db e aninhamento contra PostgreSQL real", () => {
  it("o db retido do tenant A é rejeitado dentro da transação do tenant B, sem executar SQL nela", async () => {
    let stale!: TenantDb;
    let pidA = -1;
    await withTenant(app, devIdentity([A, B]), A, async (db) => {
      pidA = (await db.query<{ p: number }>("SELECT pg_backend_pid() AS p")).rows[0]!.p;
      stale = db;
    });
    const seen = await withTenant(app, devIdentity([A, B]), B, async (dbB) => {
      // a sessão PostgreSQL (pg_backend_pid) é a MESMA: a capacidade antiga aponta para a conexão que o B está usando
      const pidB = (await dbB.query<{ p: number }>("SELECT pg_backend_pid() AS p")).rows[0]!.p;
      expect(pidB).toBe(pidA);
      // se esta consulta chegasse ao servidor, trocaria o contexto do B para o A (ou leria as linhas do B como o A)
      const attempt = await stale
        .query("SELECT set_config('app.tenant_id', $1, true)", [A])
        .then(() => "executou", (e: unknown) => e);
      const ctx = await dbB.query<{ ctx: string }>("SELECT current_setting('app.tenant_id', true) AS ctx");
      const rows = await dbB.query<{ payload: string }>(`SELECT payload FROM ${TABLE} ORDER BY payload`);
      return { attempt, ctx: ctx.rows[0]?.ctx, payloads: rows.rows.map((x) => x.payload) };
    });
    expect(seen.attempt).toBeInstanceOf(TenantDbClosedError);
    expect(seen.ctx).toBe(B);
    expect(seen.payloads).toEqual(["B-1", "B-2"]);
  });

  it("a rejeição é local: a conexão continua saudável e isolada para o próximo uso", async () => {
    expect(await payloads(app, A)).toEqual(["A-1", "A-2"]);
    expect(await payloads(app, B)).toEqual(["B-1", "B-2"]);
    expect(app.totalCount).toBe(1);
    expect(app.idleCount).toBe(1);
  });

  it("o db retido de uma chamada que lançou também é rejeitado depois do ROLLBACK", async () => {
    let stale!: TenantDb;
    await expect(
      withTenant(app, devIdentity([A, B]), A, async (db) => {
        stale = db;
        await db.query(`INSERT INTO ${TABLE} (tenant_id, payload) VALUES ($1, 'sera-desfeita')`, [A]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(stale.query("SELECT 1")).rejects.toThrow(TenantDbClosedError);
    expect(await payloads(app, A)).toEqual(["A-1", "A-2"]);
  });

  it("consulta não aguardada ao retornar: a transação é desfeita e a escrita não é confirmada", async () => {
    await expect(
      withTenant(app, devIdentity([A, B]), A, async (db) => {
        void db.query(`INSERT INTO ${TABLE} (tenant_id, payload) VALUES ($1, 'nao-aguardada')`, [A]);
        return "retornou";
      }),
    ).rejects.toThrow(UnsettledTenantOperationError);
    expect(await payloads(app, A)).toEqual(["A-1", "A-2"]);
    expect(app.idleCount).toBe(1);
  });

  it("withTenant aninhado num pool de tamanho 1 é recusado sem travar (prazo de 5 s só como rede de segurança)", async () => {
    const one = new pg.Pool({ ...base(), user: "menlo_app", max: 1 });
    try {
      const outcome = await Promise.race([
        withTenant(one, devIdentity([A]), A, async () => withTenant(one, devIdentity([A]), A, async () => "interno")).then(
          () => "resolveu",
          (e: unknown) => e,
        ),
        new Promise<string>((resolve) => setTimeout(() => resolve("TRAVOU"), 5000)),
      ]);
      expect(outcome).toBeInstanceOf(NestedTenantContextError);
      expect(await payloads(one, A)).toEqual(["A-1", "A-2"]); // o pool continua utilizável
    } finally {
      await one.end();
    }
  });
});

// SEC-20B-001 contra PostgreSQL REAL: o COMMIT de uma transação abortada vira ROLLBACK no servidor e o `pg` resolve
// normalmente; withTenant não pode relatar sucesso. A persistência é conferida pelo superusuário descartável (ignora o RLS,
// só neste teste), não pela própria API.
describe("integridade do COMMIT contra PostgreSQL real", () => {
  const MARK = "sec-20b-001-marcador";
  const countMarked = async (payload: string) =>
    Number((await privileged.query(`SELECT count(*) AS n FROM ${TABLE} WHERE payload = $1`, [payload])).rows[0].n);

  it("callback captura o erro de uma consulta e retorna: withTenant rejeita (rolled_back) e a escrita NÃO persiste", async () => {
    let pidFailed = -1;
    const outcome = await withTenant(app, devIdentity([A, B]), A, async (db) => {
      pidFailed = (await db.query<{ p: number }>("SELECT pg_backend_pid() AS p")).rows[0]!.p;
      await db.query(`INSERT INTO ${TABLE} (tenant_id, payload) VALUES ($1, $2)`, [A, MARK]);
      await db.query("SELECT 1/0").catch(() => undefined); // aborta a transação; o erro é capturado de propósito
      return "valor-do-callback";
    }).then(
      (v) => `RESOLVEU COM ${String(v)}`, // o falso sucesso original
      (e: unknown) => e,
    );
    expect(outcome).toBeInstanceOf(TransactionNotCommittedError);
    expect((outcome as TransactionNotCommittedError).outcome).toBe("rolled_back");
    expect(await countMarked(MARK)).toBe(0); // estado persistido, visto sem RLS

    // a conexão não ficou em estado que contamine o próximo tenant
    const next = await withTenant(app, devIdentity([A, B]), B, async (dbB) => {
      const pid = (await dbB.query<{ p: number }>("SELECT pg_backend_pid() AS p")).rows[0]!.p;
      const ctx = (await dbB.query<{ c: string }>("SELECT current_setting('app.tenant_id', true) AS c")).rows[0]!.c;
      const rows = (await dbB.query<{ payload: string }>(`SELECT payload FROM ${TABLE} ORDER BY payload`)).rows;
      return { pid, ctx, payloads: rows.map((r) => r.payload) };
    });
    expect(next.pid).toBe(pidFailed); // mesma conexão física, reutilizada
    expect(next.ctx).toBe(B);
    expect(next.payloads).toEqual(["B-1", "B-2"]);
    expect(app.totalCount).toBe(1);
    expect(app.idleCount).toBe(1);
  });

  it("controle: um COMMIT real persiste a escrita e devolve o valor do callback", async () => {
    const payload = "sec-20b-001-controle";
    try {
      const value = await withTenant(app, devIdentity([A, B]), A, async (db) => {
        await db.query(`INSERT INTO ${TABLE} (tenant_id, payload) VALUES ($1, $2)`, [A, payload]);
        return "confirmado";
      });
      expect(value).toBe("confirmado");
      expect(await countMarked(payload)).toBe(1);
      expect(await payloads(app, B)).toEqual(["B-1", "B-2"]); // o outro tenant não vê
    } finally {
      await privileged.query(`DELETE FROM ${TABLE} WHERE payload = $1`, [payload]);
    }
    expect(await countMarked(payload)).toBe(0);
  });

  it("duas consultas aguardadas juntas na mesma conexão: o COMMIT acontece e o resultado está correto", async () => {
    const [slow, rows] = await withTenant(app, devIdentity([A, B]), A, (db) =>
      Promise.all([db.query("SELECT pg_sleep(0.05), 1 AS v"), db.query<{ payload: string }>(`SELECT payload FROM ${TABLE} ORDER BY payload`)]),
    );
    expect(slow.rows).toHaveLength(1);
    expect(rows.rows.map((r) => r.payload)).toEqual(["A-1", "A-2"]);
  });

  it("duas consultas não aguardadas ao retornar: não confirma, nada persiste e a capacidade antiga continua recusada", async () => {
    let stale!: TenantDb;
    await expect(
      withTenant(app, devIdentity([A, B]), A, async (db) => {
        stale = db;
        void db.query(`INSERT INTO ${TABLE} (tenant_id, payload) VALUES ($1, 'sec-20b-pendente')`, [A]);
        void db.query("SELECT pg_sleep(0.05)");
        return "retornou";
      }),
    ).rejects.toThrow(UnsettledTenantOperationError);
    expect(await countMarked("sec-20b-pendente")).toBe(0);
    // a conexão já foi reutilizada pelo B quando a capacidade antiga tenta executar: é recusada sem executar SQL
    const attempt = await withTenant(app, devIdentity([A, B]), B, async () =>
      stale.query("SELECT 1").then(() => "executou", (e: unknown) => e),
    );
    expect(attempt).toBeInstanceOf(TenantDbClosedError);
    expect(app.idleCount).toBe(1);
  });
});

// Fase 20E-1 contra PostgreSQL REAL: uma continuação herdada, executada depois do fim do escopo, é uma chamada independente
// (não é recusada como aninhada); reutiliza a conexão física e a capacidade antiga continua sem executar SQL. Isto NÃO
// trata o listener emitido de fora do contexto assíncrono (risco aberto, Fase 20E-2).
describe("continuação herdada depois do fim do escopo, contra PostgreSQL real", () => {
  it("é aceita como independente, na mesma sessão PostgreSQL, com o contexto do próprio tenant, e o db antigo é recusado", async () => {
    let release!: () => void;
    const portao = new Promise<void>((resolve) => (release = resolve));
    let stale!: TenantDb;
    let pidA = -1;
    let continuation!: Promise<{ pid: number; ctx: string; payloads: string[]; attempt: unknown }>;
    await withTenant(app, devIdentity([A, B]), A, async (db) => {
      pidA = (await db.query<{ p: number }>("SELECT pg_backend_pid() AS p")).rows[0]!.p;
      stale = db;
      continuation = portao.then(() =>
        withTenant(app, devIdentity([A, B]), B, async (dbB) => {
          const attempt = await stale
            .query("SELECT set_config('app.tenant_id', $1, true)", [A])
            .then(() => "executou", (e: unknown) => e);
          const pid = (await dbB.query<{ p: number }>("SELECT pg_backend_pid() AS p")).rows[0]!.p;
          const ctx = (await dbB.query<{ c: string }>("SELECT current_setting('app.tenant_id', true) AS c")).rows[0]!.c;
          const rows = (await dbB.query<{ payload: string }>(`SELECT payload FROM ${TABLE} ORDER BY payload`)).rows;
          return { pid, ctx, payloads: rows.map((r) => r.payload), attempt };
        }),
      );
    });
    release();
    const seen = await continuation; // se fosse recusada como aninhada, rejeitaria aqui
    expect(seen.pid).toBe(pidA); // a mesma sessão PostgreSQL foi reutilizada
    expect(seen.ctx).toBe(B);
    expect(seen.payloads).toEqual(["B-1", "B-2"]);
    expect(seen.attempt).toBeInstanceOf(TenantDbClosedError);
    expect(app.idleCount).toBe(1);
  });
});

// Fase 20E-2 contra o pool REAL (pg-pool): aquisição com limite. O cenário reproduz o deadlock da Fase 20D (listener
// emitido de fora do contexto assíncrono, pool de tamanho 1). O watchdog de 10 s é SÓ do teste (impede que ele fique preso);
// não é o mecanismo da aplicação, que é o acquireTimeoutMs.
describe("aquisição limitada contra o pool real", () => {
  const watchdog = <T>(p: Promise<T>) =>
    Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("TRAVOU: o watchdog do teste disparou")), 10_000))]);

  it("DB1 e DB2: listener emitido de fora, pool de tamanho 1: a chamada rejeita com o limite e o pool se recupera sem vazar", async () => {
    const one = new pg.Pool({ ...base(), user: "menlo_app", max: 1 });
    const emitter = new EventEmitter();
    setTimeout(() => emitter.emit("go"), 20); // criado FORA do callback: o emit não herda o contexto do escopo
    const t0 = Date.now();
    try {
      const inner = await watchdog(
        withTenant(one, devIdentity([A]), A, async () =>
          new Promise<unknown>((resolve) =>
            emitter.once("go", () => {
              withTenant(one, devIdentity([A]), A, async () => "interno", { acquireTimeoutMs: 400 }).then(
                () => resolve("procedeu"),
                (e: unknown) => resolve(e),
              );
            }),
          ),
        ),
      );
      const elapsed = Date.now() - t0;
      expect(inner).toBeInstanceOf(ConnectionAcquireTimeoutError); // não foi recusada como aninhada (contexto perdido)
      expect(elapsed).toBeGreaterThanOrEqual(350);
      expect(elapsed).toBeLessThan(5000);
      // DB2: com a transação externa encerrada, o pedido abandonado recebe a conexão e a devolve; o pool volta ao normal
      const after = await watchdog(
        withTenant(one, devIdentity([A]), A, async (db) => (await db.query<{ payload: string }>(`SELECT payload FROM ${TABLE} ORDER BY payload`)).rows.map((r) => r.payload), { acquireTimeoutMs: 3000 }),
      );
      expect(after).toEqual(["A-1", "A-2"]);
      expect(one.waitingCount).toBe(0);
      expect(one.totalCount).toBe(1); // nenhuma conexão extra vazada
      expect(one.idleCount).toBe(1);
    } finally {
      await one.end();
    }
  });

  it("DB3: com duas conexões, duas chamadas independentes progridem ao mesmo tempo, em sessões distintas e com o contexto certo", async () => {
    const gate = () => {
      let open!: () => void;
      const promise = new Promise<void>((resolve) => (open = resolve));
      return { promise, open };
    };
    const inA = gate();
    const inB = gate();
    const run = (tenant: string, mine: ReturnType<typeof gate>, other: ReturnType<typeof gate>) =>
      withTenant(
        pair,
        devIdentity([A, B]),
        tenant,
        async (db) => {
          mine.open();
          await other.promise; // só avança quando a OUTRA também está dentro: se fossem serializadas, travaria
          const pid = (await db.query<{ p: number }>("SELECT pg_backend_pid() AS p")).rows[0]!.p;
          const ctx = (await db.query<{ c: string }>("SELECT current_setting('app.tenant_id', true) AS c")).rows[0]!.c;
          const rows = (await db.query<{ payload: string }>(`SELECT payload FROM ${TABLE} ORDER BY payload`)).rows.map((r) => r.payload);
          return { pid, ctx, rows };
        },
        { acquireTimeoutMs: 5000 },
      );
    const [ra, rb] = await watchdog(Promise.all([run(A, inA, inB), run(B, inB, inA)]));
    expect(ra.pid).not.toBe(rb.pid);
    expect(ra.ctx).toBe(A);
    expect(rb.ctx).toBe(B);
    expect(ra.rows).toEqual(["A-1", "A-2"]);
    expect(rb.rows).toEqual(["B-1", "B-2"]);
  });

  it("o limite não atrapalha a chamada que consegue a conexão (pool livre) e o db antigo continua fechado", async () => {
    let stale!: TenantDb;
    const value = await withTenant(app, devIdentity([A, B]), A, async (db) => {
      stale = db;
      return (await db.query<{ payload: string }>(`SELECT payload FROM ${TABLE} ORDER BY payload`)).rows.map((r) => r.payload);
    }, { acquireTimeoutMs: 3000 });
    expect(value).toEqual(["A-1", "A-2"]);
    await expect(stale.query("SELECT 1")).rejects.toThrow(TenantDbClosedError);
  });
});

// Fase 20E-3 contra o PostgreSQL REAL: limites de execução locais à transação. Cada teste observa o que o SERVIDOR faz
// (SQLSTATE recebido, estado da transação, sessão encerrada, valores depois da transação). Os limites de tempo dos
// testes (300 ms) toleram variação do ambiente; as asserções de lógica não dependem de sleeps. O superusuário
// descartável só prepara locks e observa pg_stat_activity.
describe("limites de execução locais à transação, contra PostgreSQL real", () => {
  const MARK = "sec-20e3-marcador";
  const countMarked = async (payload: string) =>
    Number((await privileged.query(`SELECT count(*) AS n FROM ${TABLE} WHERE payload = $1`, [payload])).rows[0].n);
  const settings = async (db: TenantDb) =>
    (
      await db.query<{ s: string; l: string; i: string; t: string; p: number }>(
        "SELECT current_setting('statement_timeout') AS s, current_setting('lock_timeout') AS l, " +
          "current_setting('idle_in_transaction_session_timeout') AS i, coalesce(current_setting('app.tenant_id', true), '') AS t, pg_backend_pid() AS p",
      )
    ).rows[0]!;
  const waitUntil = async (condition: () => Promise<boolean>, ms = 10_000) => {
    const deadline = Date.now() + ms;
    while (!(await condition())) {
      if (Date.now() > deadline) throw new Error("condição não atingida no prazo do teste");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  it("DB1: statement_timeout cancela no servidor (57014), a chamada rejeita com o SQLSTATE real e a conexão se recupera", async () => {
    let pid = -1;
    const t0 = Date.now();
    const error = await withTenant(app, devIdentity([A, B]), A, async (db) => {
      pid = (await settings(db)).p;
      return db.query("SELECT pg_sleep(3)");
    }, { statementTimeoutMs: 300 }).then(() => "RESOLVEU", (e: unknown) => e);
    expect((error as { code?: string }).code).toBe("57014"); // o SQLSTATE do servidor, sem embrulho
    expect(error).not.toBeInstanceOf(ConnectionAcquireTimeoutError);
    expect(Date.now() - t0).toBeLessThan(2500); // não esperou os 3 s
    const next = await withTenant(app, devIdentity([A, B]), A, (db) => settings(db)); // sem limites
    expect(next.p).toBe(pid); // a mesma sessão voltou ao pool, saudável
    expect(next.s).toBe("0"); // o limite local não vazou
  });

  it("DB2: callback captura o timeout e retorna: withTenant rejeita (rolled_back) e a escrita anterior não persiste", async () => {
    const error = await withTenant(app, devIdentity([A, B]), A, async (db) => {
      await db.query(`INSERT INTO ${TABLE} (tenant_id, payload) VALUES ($1, $2)`, [A, MARK]);
      await db.query("SELECT pg_sleep(3)").catch(() => undefined); // estoura o limite; o erro é capturado de propósito
      return "valor-do-callback";
    }, { statementTimeoutMs: 300 }).then((v) => `RESOLVEU COM ${String(v)}`, (e: unknown) => e);
    expect(error).toBeInstanceOf(TransactionNotCommittedError);
    expect((error as TransactionNotCommittedError).outcome).toBe("rolled_back");
    expect(await countMarked(MARK)).toBe(0);
  });

  it("DB3: lock_timeout encerra a espera por um lock real (55P03); a limpeza do lock é garantida e a conexão se recupera", async () => {
    const holder = await privileged.connect();
    let pid = -1;
    let error: unknown;
    const t0 = Date.now();
    try {
      await holder.query("BEGIN");
      await holder.query(`LOCK TABLE ${TABLE} IN ACCESS EXCLUSIVE MODE`);
      error = await withTenant(app, devIdentity([A, B]), A, async (db) => {
        pid = (await settings(db)).p;
        return db.query(`SELECT count(*) FROM ${TABLE}`); // bloqueada pelo lock do outro
      }, { lockTimeoutMs: 300 }).then(() => "RESOLVEU", (e: unknown) => e);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
    }
    expect((error as { code?: string }).code).toBe("55P03");
    expect(Date.now() - t0).toBeLessThan(3000);
    const next = await withTenant(app, devIdentity([A, B]), A, (db) => settings(db));
    expect(next.p).toBe(pid);
    expect(next.l).toBe("0");
  });

  it("DB4: idle_in_transaction_session_timeout encerra a SESSÃO; a conexão é descartada e a chamada seguinte conclui numa sessão nova", async () => {
    const idle = new pg.Pool({ ...base(), user: "menlo_app", max: 1 });
    try {
      let pidBefore = -1;
      const outcome = await withTenant(idle, devIdentity([A, B]), A, async (db) => {
        const cfg = await settings(db);
        pidBefore = cfg.p;
        expect(cfg.i).not.toBe("0"); // o parâmetro foi aplicado ANTES da função
        // sem consulta pendente: espera, por CONDIÇÃO, o servidor encerrar a sessão ociosa
        await waitUntil(async () => (await privileged.query("SELECT 1 FROM pg_stat_activity WHERE pid = $1", [pidBefore])).rowCount === 0);
        return "retornou";
      }, { idleInTransactionTimeoutMs: 300 }).then((v) => `RESOLVEU COM ${String(v)}`, (e: unknown) => e);
      expect(outcome).toBeInstanceOf(TransactionNotCommittedError);
      expect((outcome as TransactionNotCommittedError).outcome).toBe("unknown"); // não se afirma commit nem rollback
      expect(idle.totalCount).toBe(0); // a conexão encerrada NÃO voltou ao pool
      const next = await withTenant(idle, devIdentity([A, B]), B, async (db) => ({
        cfg: await settings(db),
        rows: (await db.query<{ payload: string }>(`SELECT payload FROM ${TABLE} ORDER BY payload`)).rows.map((r) => r.payload),
      }));
      expect(next.cfg.p).not.toBe(pidBefore); // sessão nova
      expect(next.cfg.t).toBe(B); // o contexto é o da chamada nova, não o anterior
      expect(next.cfg.i).toBe("0"); // sem a configuração anterior
      expect(next.rows).toEqual(["B-1", "B-2"]);
      expect(idle.totalCount).toBe(1);
    } finally {
      await idle.end();
    }
  });

  it("DB5: na MESMA sessão física, os limites de uma transação não persistem na seguinte; o contexto do tenant também não", async () => {
    const withLimits = await withTenant(app, devIdentity([A, B]), A, (db) => settings(db), { statementTimeoutMs: 60_000, lockTimeoutMs: 61_000, idleInTransactionTimeoutMs: 62_000 });
    expect(withLimits.s).not.toBe("0");
    expect(withLimits.l).not.toBe("0");
    expect(withLimits.i).not.toBe("0");
    expect(withLimits.t).toBe(A);
    const without = await withTenant(app, devIdentity([A, B]), B, (db) => settings(db));
    expect(without.p).toBe(withLimits.p); // mesma sessão PostgreSQL
    expect([without.s, without.l, without.i]).toEqual(["0", "0", "0"]);
    expect(without.t).toBe(B);
    const outside = await app.query("SELECT coalesce(current_setting('app.tenant_id', true), '') AS t, current_setting('statement_timeout') AS s");
    expect(outside.rows[0]).toEqual({ t: "", s: "0" });
  });

  it("um limite omitido não redefine o que a sessão já tinha (só o configurado muda dentro da transação)", async () => {
    await app.query("SET lock_timeout = '12345ms'"); // valor de SESSÃO preexistente, só neste teste
    try {
      const inside = await withTenant(app, devIdentity([A, B]), A, (db) => settings(db), { statementTimeoutMs: 60_000 });
      expect(inside.l).toBe("12345ms"); // não foi tocado
      expect(inside.s).not.toBe("0");
    } finally {
      await app.query("RESET lock_timeout");
    }
    expect((await app.query("SELECT current_setting('lock_timeout') AS l")).rows[0].l).toBe("0");
  });
});

// Fase 20E-5 contra o PostgreSQL REAL e o cliente `pg` real: a causa original de uma sessão encerrada, a posse da conexão
// (decisão própria do wrapper, SEM depender do descarte automático do pg-pool) e o contrato do ouvinte do pool depois da
// liberação. Encerrar a sessão é feito pelo superusuário descartável (pg_terminate_backend), só nestes testes.
describe("erros de conexão e posse da conexão contra PostgreSQL real", () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const gone = async (pid: number) => (await privileged.query("SELECT 1 FROM pg_stat_activity WHERE pid = $1", [pid])).rowCount === 0;
  const waitGone = async (pid: number) => {
    const deadline = Date.now() + 10_000;
    while (!(await gone(pid))) {
      if (Date.now() > deadline) throw new Error("a sessão não terminou no prazo do teste");
      await sleep(25);
    }
  };
  const killSession = async (pid: number) => {
    await privileged.query("SELECT pg_terminate_backend($1)", [pid]);
    await waitGone(pid);
  };
  const uncaught: unknown[] = [];
  const onUncaught = (e: unknown) => uncaught.push(e);

  it("U5: a sessão é encerrada durante a transação: a falha de finalização mantém a causa ORIGINAL (a mesma identidade do evento) e a conexão é descartada", async () => {
    uncaught.length = 0;
    process.on("uncaughtException", onUncaught);
    const pool = new pg.Pool({ ...base(), user: "menlo_app", max: 1 });
    const eventos: Error[] = [];
    pool.on("connect", (c: pg.PoolClient) => c.on("error", (e: Error) => eventos.push(e))); // só observa; o withTenant tem o seu
    try {
      const error = await withTenant(pool, devIdentity([A, B]), A, async (db) => {
        const pid = (await db.query<{ p: number }>("SELECT pg_backend_pid() AS p")).rows[0]!.p;
        await killSession(pid);
        return "retornou";
      }).then((v) => `RESOLVEU COM ${String(v)}`, (e: unknown) => e);
      await sleep(100);
      expect(error).toBeInstanceOf(TransactionNotCommittedError);
      expect((error as TransactionNotCommittedError).outcome).toBe("unknown"); // nunca committed nem rolled_back sem evidência
      expect(eventos.length).toBeGreaterThan(0); // o cliente emitiu o erro de conexão
      expect((error as TransactionNotCommittedError).cause).toBe(eventos[0]); // a causa é o erro ORIGINAL, não a rejeição genérica
      expect(pool.totalCount).toBe(0); // conexão descartada
      expect(uncaught).toEqual([]); // nenhuma exceção não tratada
    } finally {
      process.off("uncaughtException", onUncaught);
      await pool.end().catch(() => undefined);
    }
  });

  it("U6: um erro DEPOIS da liberação pertence ao ouvinte do pool: ele é chamado e o processo não cai", async () => {
    uncaught.length = 0;
    process.on("uncaughtException", onUncaught);
    const pool = new pg.Pool({ ...base(), user: "menlo_app", max: 1 });
    const doPool: Error[] = [];
    pool.on("error", (e: Error) => doPool.push(e)); // o requisito documentado: o pool PRECISA ter este ouvinte
    try {
      let pid = -1;
      await withTenant(pool, devIdentity([A, B]), A, async (db) => {
        pid = (await db.query<{ p: number }>("SELECT pg_backend_pid() AS p")).rows[0]!.p;
      });
      await killSession(pid); // a sessão ociosa, já devolvida ao pool, é encerrada
      const deadline = Date.now() + 5000;
      while (doPool.length === 0 && Date.now() < deadline) await sleep(25);
      expect(doPool.length).toBeGreaterThan(0);
      expect(uncaught).toEqual([]);
      expect(pool.totalCount).toBe(0);
    } finally {
      process.off("uncaughtException", onUncaught);
      await pool.end().catch(() => undefined);
    }
  });

  it("contrato próprio do wrapper (sem pg-pool): cliente pg real e release de teste: conexão encerrada ⇒ release(true); saudável ⇒ release(false)", async () => {
    const registro: unknown[] = [];
    const clientes: pg.Client[] = [];
    const adaptador: PoolLike = {
      async connect() {
        const c = new pg.Client({ ...base(), user: "menlo_app" });
        await c.connect();
        clientes.push(c);
        return Object.assign(c, {
          release: (erro?: Error | boolean) => {
            registro.push(erro);
            void c.end().catch(() => undefined);
          },
        }) as never;
      },
    };
    try {
      const falha = await withTenant(adaptador, devIdentity([A, B]), A, async (db) => {
        const pid = (await db.query<{ p: number }>("SELECT pg_backend_pid() AS p")).rows[0]!.p;
        await killSession(pid);
        return "x";
      }).then((v) => `RESOLVEU COM ${String(v)}`, (e: unknown) => e);
      expect(falha).toBeInstanceOf(TransactionNotCommittedError);
      expect(registro).toEqual([true]); // decisão do wrapper: descarte
      registro.length = 0;
      const ok = await withTenant(adaptador, devIdentity([A, B]), A, async () => "ok");
      expect(ok).toBe("ok");
      expect(registro).toEqual([false]); // conexão saudável: devolvida
    } finally {
      await Promise.all(clientes.map((c) => c.end().catch(() => undefined)));
    }
  });

  it("AUD-001: erro emitido por um cliente pg real que continua consultável: COMMIT confirmado pelo servidor, valor devolvido e release(true) decidido pelo wrapper", async () => {
    const registro: unknown[] = [];
    const clientes: pg.Client[] = [];
    const adaptador: PoolLike = {
      async connect() {
        const c = new pg.Client({ ...base(), user: "menlo_app" });
        await c.connect();
        clientes.push(c);
        return Object.assign(c, {
          release: (erro?: Error | boolean) => {
            registro.push(erro);
            void c.end().catch(() => undefined);
          },
        }) as never;
      },
    };
    try {
      const valor = await withTenant(adaptador, devIdentity([A, B]), A, async (db) => {
        await db.query("SELECT 1");
        clientes[0]!.emit("error", new Error("erro observado, sessão ainda saudável")); // o servidor ainda responde
        return "confirmado";
      });
      expect(valor).toBe("confirmado"); // o COMMIT respondeu COMMIT: o evento não reclassifica o resultado
      expect(registro).toEqual([true]); // mas a conexão não volta como saudável
    } finally {
      await Promise.all(clientes.map((c) => c.end().catch(() => undefined)));
    }
  });
});
