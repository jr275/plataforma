import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb, devIdentity, getImportRun, listCities, listImportRecords, listImportRuns, runCityImport, withTenant, countCities } from "../index";

// Importação de cidades contra o esquema REAL (0001 a 0004) num PostgreSQL 16 descartável (scripts/test-schema.sh) ou numa branch
// temporária do Neon (scripts/test-neon.sh), como menlo_app. Fixture: db/test-fixtures/ingest/cidades-amostra.csv (códigos
// reais do IBGE, sem números de população; linhas inválidas fabricadas). Origem das execuções: "test".
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/ingest/cidades-amostra.csv", import.meta.url));
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region" };

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`variável ${name} ausente: rode pelo script (pnpm test:schema)`);
  return value;
}
let pool: pg.Pool;
function poolConfig(): pg.PoolConfig {
  const url = process.env.PLATAFORMA_TEST_PG_URL;
  if (url) {
    const u = new URL(url);
    return { host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1), ssl: { rejectUnauthorized: true }, max: 2 };
  }
  return { host: env("PLATAFORMA_TEST_PG_SOCKET_DIR"), port: Number(env("PLATAFORMA_TEST_PG_PORT")), database: env("PLATAFORMA_TEST_PG_DATABASE"), user: "menlo_app", max: 2 };
}
beforeAll(() => { pool = new pg.Pool(poolConfig()); pool.on("error", () => undefined); });
afterAll(async () => { await pool.end(); });

const id = () => devIdentity([A, B]);
const as = <T>(tenant: string, fn: (db: TenantDb) => Promise<T>) => withTenant(pool, id(), tenant, fn);
const input = (over: Partial<Parameters<typeof runCityImport>[3]> = {}) => ({ content: FIXTURE, fileName: "cidades-amostra.csv", sourceName: "fixture", origin: "test" as const, mapping: MAPPING, ...over });

describe("importação de cidades contra o esquema real", () => {
  it("classifica 100% das linhas, grava o histórico por linha e só as aceitas viram cidade", async () => {
    const r = await runCityImport(pool, id(), A, input());
    expect(r).toMatchObject({ status: "partial", total: 11, accepted: 7, rejected: 3, duplicate: 1, warnings: 1 });
    expect(r.accepted + r.rejected + r.duplicate).toBe(r.total);

    const run = await as(A, (db) => getImportRun(db, r.runId));
    expect(run).toMatchObject({ status: "partial", totalRows: 11, acceptedRows: 7, rejectedRows: 3, duplicateRows: 1, origin: "test", createdBy: expect.any(String) });
    expect(run!.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(run!.finishedAt).toBeInstanceOf(Date);

    const records = await as(A, (db) => listImportRecords(db, r.runId));
    expect(records).toHaveLength(11);
    expect(records.map((x) => x.rowNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(records.filter((x) => x.outcome === "accepted").every((x) => x.entityId !== null)).toBe(true);
    expect(records.filter((x) => x.outcome !== "accepted").every((x) => x.entityId === null && x.issues.some((i) => i.severity === "error"))).toBe(true);
    const warned = records.find((x) => x.raw["ibge_code"] === "2201919")!;
    expect(warned.outcome).toBe("accepted");
    expect(warned.issues[0]).toMatchObject({ code: "ibge_check_digit_mismatch", severity: "warning" });

    const cities = await as(A, (db) => listCities(db));
    expect(cities).toHaveLength(7);
    expect(cities.every((c) => c.sourceRunId === r.runId)).toBe(true);
    expect(cities.find((c) => c.ibgeCode === "3550308")).toMatchObject({ name: "São Paulo", uf: "SP", region: "Sudeste", population: null });
  });

  it("reimportar o mesmo arquivo não duplica cidades: atualiza e aponta para a nova execução", async () => {
    const before = await as(A, (db) => countCities(db));
    const r = await runCityImport(pool, id(), A, input());
    expect(await as(A, (db) => countCities(db))).toBe(before);
    const cities = await as(A, (db) => listCities(db));
    expect(cities.every((c) => c.sourceRunId === r.runId)).toBe(true);
    const runs = await as(A, (db) => listImportRuns(db));
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs[0]!.id).toBe(r.runId);
  });

  it("o tenant B não vê nada de A, e importa o mesmo código sem conflito", async () => {
    const rB = await runCityImport(pool, id(), B, input({ fileName: "b.csv" }));
    expect(rB.status).toBe("partial");
    expect(await as(B, (db) => getImportRun(db, rB.runId))).toBeDefined();
    const runsA = await as(A, (db) => listImportRuns(db));
    expect(runsA.map((x) => x.id)).not.toContain(rB.runId);
    expect(await as(A, (db) => getImportRun(db, rB.runId))).toBeUndefined();
    expect(await as(A, (db) => listImportRecords(db, rB.runId))).toEqual([]);
    expect((await as(B, (db) => listCities(db))).every((c) => c.sourceRunId === rB.runId)).toBe(true);
  });

  it("filtra registros por desfecho", async () => {
    const [run] = await as(A, (db) => listImportRuns(db, { limit: 1 }));
    expect((await as(A, (db) => listImportRecords(db, run!.id, { outcome: "rejected" }))).map((x) => x.rowNumber)).toEqual([9, 10, 11]);
    expect((await as(A, (db) => listImportRecords(db, run!.id, { outcome: "duplicate" }))).map((x) => x.rowNumber)).toEqual([8]);
  });

  it("mapeamento inválido falha ANTES de processar: execução 'failed', zero registros, zero cidades novas", async () => {
    const before = await as(A, (db) => countCities(db));
    const r = await runCityImport(pool, id(), A, input({ mapping: { ibge_code: "codigo", name: "name", uf: "uf" } }));
    expect(r).toMatchObject({ status: "failed", total: 0 });
    expect(r.error).toMatch(/codigo/);
    expect(await as(A, (db) => listImportRecords(db, r.runId))).toEqual([]);
    expect(await as(A, (db) => countCities(db))).toBe(before);
    expect(await as(A, (db) => getImportRun(db, r.runId))).toMatchObject({ status: "failed", finishedAt: expect.any(Date) });
  });

  it("arquivo ilegível (aspas abertas, não-UTF-8, acima do limite) falha com erro registrado", async () => {
    const quotes = await runCityImport(pool, id(), A, input({ content: Buffer.from('ibge_code,name,uf\n1100015,"abc,RO\n') }));
    expect(quotes).toMatchObject({ status: "failed" });
    expect(quotes.error).toMatch(/aspas/);
    const latin1 = await runCityImport(pool, id(), A, input({ content: Buffer.from([0x69, 0x62, 0x67, 0x65, 0x0a, 0xe3, 0x0a]) }));
    expect(latin1.status).toBe("failed");
    const big = await runCityImport(pool, id(), A, input({ maxRows: 3 }));
    expect(big).toMatchObject({ status: "failed" });
    expect(big.error).toMatch(/mais de 3/);
  });

  it("arquivo só com linhas inválidas: grava o histórico e fecha 'failed' (nada aceito)", async () => {
    const r = await runCityImport(pool, id(), A, input({ content: Buffer.from("ibge_code,name,uf,region\n,x,SP,Sul\n12,y,SP,Sul\n") }));
    expect(r).toMatchObject({ status: "failed", total: 2, accepted: 0, rejected: 2, error: "nenhuma linha foi aceita" });
    expect(await as(A, (db) => listImportRecords(db, r.runId))).toHaveLength(2);
  });

  it("falha do banco na gravação (NUL no texto, que o jsonb recusa) desfaz tudo e marca a execução como 'failed'", async () => {
    const before = await as(A, (db) => countCities(db));
    const r = await runCityImport(pool, id(), A, input({ content: Buffer.from("ibge_code,name,uf\n1100031,Cidade\u0000Ruim,RO\n1100049,Cidade Boa,RO\n") }));
    expect(r.status).toBe("failed");
    expect(r.error).toBeTruthy();
    expect(await as(A, (db) => listImportRecords(db, r.runId))).toEqual([]);
    expect(await as(A, (db) => countCities(db))).toBe(before);
    expect(await as(A, (db) => getImportRun(db, r.runId))).toMatchObject({ status: "failed", totalRows: 0, finishedAt: expect.any(Date) });
  });

  // Opt-in: o arquivo real (scripts/fetch-ibge-cities.mjs) não vai ao Git. Rode: PLATAFORMA_TEST_IBGE_CSV=/caminho.csv pnpm test:schema
  it.skipIf(!process.env.PLATAFORMA_TEST_IBGE_CSV)("carga REAL do IBGE: 5.571 municípios, 100% classificados, só avisos, sem duplicatas", async () => {
    const content = readFileSync(process.env.PLATAFORMA_TEST_IBGE_CSV!);
    const mapping = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };
    const r = await runCityImport(pool, id(), A, { content, fileName: "ibge-municipios.csv", sourceName: "IBGE", origin: "real", mapping });
    expect(r).toMatchObject({ status: "succeeded", total: 5571, accepted: 5571, rejected: 0, duplicate: 0 });
    expect(r.warnings).toBe(9);
    expect(await as(A, (db) => countCities(db))).toBe(5571);
    const again = await runCityImport(pool, id(), A, { content, fileName: "ibge-municipios.csv", sourceName: "IBGE", origin: "real", mapping });
    expect(again.status).toBe("succeeded");
    expect(await as(A, (db) => countCities(db))).toBe(5571);
    expect(await as(B, (db) => countCities(db))).toBeLessThan(5571);
  });
});
