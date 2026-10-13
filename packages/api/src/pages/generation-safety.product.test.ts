import { readFileSync } from "node:fs";
import pg from "pg";
import { productPoolConfig } from "../testing/pool-config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb, devIdentity, listCities, listGenerationRuns, listPages, runCityImport, runGeneration, withTenant } from "../index";
import * as gen from "./generate";

// REGRESSÃO dos três defeitos da Etapa 4 (auditoria 2026-10-13), contra o esquema REAL num PostgreSQL descartável
// (scripts/test-schema.sh). Cada teste foi escrito ANTES da correção e reproduz o defeito; depois da correção passa.
// Tenants exclusivos E e F (db/test-fixtures/generation/10_tenants.sql). Dados: extrato real do IBGE (SP).
const E = "f1111111-1111-4111-8111-111111111111";
const F = "f2222222-2222-4222-8222-222222222222";
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv", import.meta.url));
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };
const SCOPE = { uf: "SP", limit: 5 } as const;

let pool: pg.Pool;
beforeAll(async () => {
  pool = new pg.Pool(productPoolConfig(10));
  pool.on("error", () => undefined);
  for (const t of [E, F]) await runCityImport(pool, id(), t, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: MAPPING });
});
afterAll(async () => { await pool.end(); });

const id = () => devIdentity([E, F]);
const as = <T>(t: string, fn: (db: TenantDb) => Promise<T>) => withTenant(pool, id(), t, fn);
const n = async (t: string, table: string) => Number((await as(t, (db) => db.query<{ n: string }>(`SELECT count(*)::text AS n FROM plataforma.${table}`))).rows[0]!.n);
const insertRunning = (t: string, minutesAgo: number) => as(t, async (db) => (await db.query<{ id: string }>(
  `INSERT INTO plataforma.generation_run (tenant_id, template_key, template_version, template_hash, scope, started_at, created_by) VALUES (plataforma.current_tenant_id(), 'city-overview', 1, $1, '{}'::jsonb, now() - make_interval(mins => $2), 'teste') RETURNING id`, ["a".repeat(64), minutesAgo])).rows[0]!.id);
const runStatus = (t: string, runId: string) => as(t, async (db) => (await listGenerationRuns(db, { limit: 200 })).find((r) => r.id === runId));
const closeAll = (t: string) => as(t, (db) => db.query("UPDATE plataforma.generation_run SET status = 'failed', error = 'limpeza de teste', finished_at = now() WHERE status = 'running'"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("defeito 1: ids inexistentes não podem sumir em silêncio", () => {
  it("o escopo por lista com um id inexistente é recusado ANTES de abrir a execução, listando o id", async () => {
    const real = (await as(E, (db) => listCities(db, { uf: "SP", limit: 3 })))[0]!;
    const ghost = "99999999-9999-4999-8999-999999999999";
    const runsBefore = await n(E, "generation_run");
    const err = await runGeneration(pool, id(), E, { scope: { cityIds: [real.id, ghost] } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf((gen as unknown as { GenerationScopeError: new (...a: never[]) => Error }).GenerationScopeError);
    expect((err as { missingIds: string[] }).missingIds).toEqual([ghost]);
    expect((err as Error).message).toContain(ghost);
    expect(await n(E, "generation_run")).toBe(runsBefore); // nenhuma execução foi aberta
    expect(await n(E, "page")).toBe(0); // e nada foi gerado
  });
  it("com todos os ids existentes a execução roda normalmente e processa TODOS os pedidos", async () => {
    const some = (await as(E, (db) => listCities(db, { uf: "SP", limit: 3 }))).map((c) => c.id);
    const r = await runGeneration(pool, id(), E, { scope: { cityIds: some } });
    expect(r).toMatchObject({ status: "succeeded", total: 3, generated: 3 });
    await as(E, (db) => db.query("SELECT 1")); // sem efeito: só garante a conexão
  });
});

describe("defeito 2: execução abandonada em `running`", () => {
  it("uma execução aberta há horas é recuperada (vira `failed` com motivo) e a nova execução prossegue", async () => {
    await closeAll(E);
    const stale = await insertRunning(E, 120);
    const r = await runGeneration(pool, id(), E, { scope: SCOPE });
    expect(r.status).toBe("succeeded");
    const old = (await runStatus(E, stale))!;
    expect(old.status).toBe("failed");
    expect(old.error).toMatch(/abandonada/);
    expect(old.finishedAt).toBeInstanceOf(Date);
  });
  it("uma execução RECENTE em andamento não é tocada e bloqueia uma nova, com erro claro (nada é gravado)", async () => {
    await closeAll(E);
    const fresh = await insertRunning(E, 1);
    const runsBefore = await n(E, "generation_run");
    const err = await runGeneration(pool, id(), E, { scope: SCOPE }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf((gen as unknown as { GenerationBusyError: new (...a: never[]) => Error }).GenerationBusyError);
    expect((err as { activeRunId: string }).activeRunId).toBe(fresh);
    expect((err as Error).message).not.toMatch(/duplicate key|violates|constraint/i); // nenhum erro cru de banco
    expect((await runStatus(E, fresh))!.status).toBe("running");
    expect(await n(E, "generation_run")).toBe(runsBefore);
    await closeAll(E);
  });
  it("o prazo é configurável e explícito (`staleAfterMinutes`)", async () => {
    await closeAll(E);
    const run = await insertRunning(E, 30);
    const busy = await runGeneration(pool, id(), E, { scope: SCOPE, staleAfterMinutes: 60 }).catch((e: unknown) => e);
    expect((busy as Error).name).toBe("GenerationBusyError"); // 30 min < 60: ainda não é abandono
    const ok = await runGeneration(pool, id(), E, { scope: SCOPE, staleAfterMinutes: 10 });
    expect(ok.status).toBe("succeeded"); // 30 min > 10: recupera e prossegue
    expect((await runStatus(E, run))!.status).toBe("failed");
  });
});

describe("defeito 3: execuções concorrentes", () => {
  it("a segunda execução é RECUSADA com erro claro enquanto a primeira está em andamento; a primeira conclui sem duplicar nada", async () => {
    await closeAll(E);
    const pagesBefore = await n(E, "page");
    let reached!: () => void;
    const inClose = new Promise<void>((r) => { reached = r; });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const timer = setTimeout(release, 4000); // rede de segurança: sem a correção a segunda execução ficaria presa
    const first = runGeneration(pool, id(), E, { scope: { uf: "SP", limit: 12 }, faults: { close: async () => { reached(); await gate; } } });
    await inClose; // a primeira está dentro da transação principal
    const second = await runGeneration(pool, id(), E, { scope: { uf: "SP", limit: 12 } }).catch((e: unknown) => e);
    release(); clearTimeout(timer);
    const r1 = await first;
    expect((second as Error).name).toBe("GenerationBusyError");
    expect((second as Error).message).not.toMatch(/duplicate key|violates|constraint/i);
    expect(r1.status).toBe("succeeded");
    expect(await n(E, "page")).toBeGreaterThanOrEqual(pagesBefore); // sem duplicar
    const paths = (await as(E, (db) => listPages(db))).map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(await n(E, "generation_run")).toBe((await as(E, (db) => listGenerationRuns(db, { limit: 200 }))).length);
  });
  it("depois que a primeira termina, uma nova execução do mesmo escopo funciona e é idempotente (`unchanged`)", async () => {
    const r = await runGeneration(pool, id(), E, { scope: { uf: "SP", limit: 12 } });
    expect(r).toMatchObject({ status: "succeeded", generated: 0, unchanged: 12, blocked: 0 });
  });
  it("uma execução abandonada que ainda termina DEPOIS de recuperada não grava nada e não corrompe a que a substituiu", async () => {
    await closeAll(E);
    const pagesBefore = await n(E, "page");
    const versionsBefore = await n(E, "page_version");
    // altera um dado real para que a execução tenha o que gravar
    const target = (await as(E, (db) => gen.selectCandidates(db, { uf: "SP", limit: 1 })))[0]!.city; // a MAIOR população, que está no escopo do lote
    await as(E, (db) => db.query("UPDATE plataforma.city SET population = population + 11 WHERE id = $1", [target.id]));
    let reached!: () => void;
    const inClose = new Promise<void>((r) => { reached = r; });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const timer = setTimeout(release, 6000);
    const a = runGeneration(pool, id(), E, { scope: { uf: "SP", limit: 12 }, staleAfterMinutes: 10, faults: { close: async () => { reached(); await gate; } } });
    await inClose;
    const aRunId = (await as(E, (db) => db.query<{ id: string }>("SELECT id FROM plataforma.generation_run WHERE status = 'running'"))).rows[0]!.id;
    await as(E, (db) => db.query("UPDATE plataforma.generation_run SET started_at = now() - interval '2 hours' WHERE id = $1", [aRunId])); // A "travou": passou do prazo
    const b = runGeneration(pool, id(), E, { scope: { uf: "SP", limit: 12 }, staleAfterMinutes: 10 }); // B recupera A e prossegue
    await sleep(600);
    release(); clearTimeout(timer); // A volta a andar e tenta fechar
    const [ra, rb] = await Promise.all([a, b]);
    expect(rb.status).toBe("succeeded");
    expect(ra.status).toBe("failed");
    expect(ra.error).toMatch(/abandonada|encerrada/);
    expect((await runStatus(E, aRunId))!.status).toBe("failed");
    expect(await n(E, "page")).toBe(pagesBefore); // nenhuma página duplicada
    expect(await n(E, "page_version")).toBe(versionsBefore + 1); // exatamente a versão da cidade alterada, uma vez só
    const items = await as(E, (db) => db.query<{ run_id: string }>("SELECT DISTINCT run_id FROM plataforma.generation_item WHERE run_id = $1", [aRunId]));
    expect(items.rows).toHaveLength(0); // a execução abandonada não deixou itens
  });
});

describe("isolamento entre tenants e histórico", () => {
  it("a execução em andamento de F não bloqueia E, e a recuperação em E não toca nas execuções de F", async () => {
    await closeAll(E); await closeAll(F);
    const fRun = await insertRunning(F, 120); // abandonada em F
    const r = await runGeneration(pool, id(), E, { scope: SCOPE }); // roda em E mesmo com F pendente
    expect(r.status).toBe("succeeded");
    expect((await runStatus(F, fRun))!.status).toBe("running"); // E não mexeu em F
    const rf = await runGeneration(pool, id(), F, { scope: SCOPE }); // F recupera a própria
    expect(rf.status).toBe("succeeded");
    expect((await runStatus(F, fRun))!.status).toBe("failed");
    expect(await as(E, (db) => listGenerationRuns(db, { limit: 200 })).then((rs) => rs.some((x) => x.id === fRun))).toBe(false);
  });
  it("o histórico de versões é preservado depois de recuperações e recusas (nenhuma versão some ou duplica)", async () => {
    const rows = await as(E, (db) => db.query<{ page_id: string; c: string; mx: string }>("SELECT page_id, count(*)::text AS c, max(version)::text AS mx FROM plataforma.page_version GROUP BY page_id"));
    for (const r of rows.rows) expect(r.c).toBe(r.mx); // versões 1..N sem lacunas nem repetição
  });
});

describe("critério de aceite do piloto (não uma proibição global)", () => {
  it("o mínimo de 10 registros é um CRITÉRIO DE ACEITE do lote piloto: reprocessar uma única página continua permitido", async () => {
    const one = (await as(E, (db) => listCities(db, { uf: "SP", limit: 1 })))[0]!;
    const single = await runGeneration(pool, id(), E, { scope: { cityIds: [one.id] } });
    expect(single.status).toBe("succeeded");
    const meets = (gen as unknown as { meetsPilotAcceptance: (r: unknown) => boolean }).meetsPilotAcceptance;
    expect(meets(single)).toBe(false); // 1 < 10: não satisfaz o critério do piloto, mas não é erro
    expect(meets(await runGeneration(pool, id(), E, { scope: { uf: "SP", limit: 20 } }))).toBe(true);
    expect((gen as unknown as { PILOT_MIN_VALID: number }).PILOT_MIN_VALID).toBe(10);
  });
});
