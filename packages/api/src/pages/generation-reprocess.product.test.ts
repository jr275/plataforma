import { readFileSync } from "node:fs";
import pg from "pg";
import * as api from "../index";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb, devIdentity, getPageDetail, listCities, listGenerationRuns, listPageVersions, listPages, runCityImport, runGeneration, searchPages, withTenant } from "../index";
import { productPoolConfig } from "../testing/pool-config";

// REPROCESSAMENTO DE UMA PÁGINA (escopo por lista com a cidade da página) contra o esquema real (PostgreSQL descartável).
// Tenants I e J. Dados: extrato real do IBGE (SP). Cobre: escopo autorizado, histórico, idempotência, falha explícita, sem publicação.
const I = "f5555555-5555-4555-8555-555555555555";
const J = "f6666666-6666-4666-8666-666666666666";
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv", import.meta.url));
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };

let pool: pg.Pool;
const id = () => devIdentity([I, J]);
const as = <T>(t: string, fn: (db: TenantDb) => Promise<T>) => withTenant(pool, id(), t, fn);
const rows = (t: string) => as(t, async (db) => (await searchPages(db, { limit: 100, sort: "population", dir: "desc" })).rows);
const reprocess = (t: string, entityId: string, extra: Partial<Parameters<typeof runGeneration>[3]> = {}) => runGeneration(pool, id(), t, { scope: { cityIds: [entityId] }, ...extra });
const versions = (t: string, pageId: string) => as(t, (db) => listPageVersions(db, pageId));

beforeAll(async () => {
  pool = new pg.Pool(productPoolConfig(6));
  pool.on("error", () => undefined);
  for (const t of [I, J]) {
    await runCityImport(pool, id(), t, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: MAPPING });
    expect((await runGeneration(pool, id(), t, { scope: { uf: "SP", limit: 5 } })).generated).toBe(5);
  }
});
afterAll(async () => { await pool.end(); });

describe("reprocessar uma página", () => {
  it("conteúdo igual: `unchanged`, nenhuma versão nova, a execução fica registrada", async () => {
    const [sp] = await rows(I);
    const vBefore = await versions(I, sp!.id);
    const runsBefore = (await as(I, (db) => listGenerationRuns(db, { limit: 200 }))).length;
    const r = await reprocess(I, sp!.entityId);
    expect(r).toMatchObject({ status: "succeeded", total: 1, generated: 0, unchanged: 1, blocked: 0 });
    expect(await versions(I, sp!.id)).toEqual(vBefore); // idêntico, inclusive o conteúdo e o hash
    expect((await as(I, (db) => listGenerationRuns(db, { limit: 200 }))).length).toBe(runsBefore + 1);
  });

  it("dado alterado: nova versão, MESMA URL, histórico preservado, e só a página reprocessada muda", async () => {
    const before = await rows(I);
    const target = before[0]!; // maior população
    const vBefore = await versions(I, target.id);
    const othersBefore = new Map(before.slice(1).map((p) => [p.id, p.latestVersion]));
    await as(I, (db) => db.query("UPDATE plataforma.city SET population = population + 5 WHERE id = $1", [target.entityId]));
    const r = await reprocess(I, target.entityId);
    expect(r).toMatchObject({ status: "succeeded", total: 1, generated: 1, unchanged: 0, blocked: 0 });
    const vAfter = await versions(I, target.id);
    expect(vAfter.map((v) => v.version)).toEqual([2, 1]);
    expect(vAfter[1]).toEqual(vBefore[0]); // a v1 continua exatamente como era
    expect(vAfter[0]!.contentHash).not.toBe(vAfter[1]!.contentHash);
    expect(vAfter[0]!.content.path).toBe(vAfter[1]!.content.path);
    const after = await rows(I);
    expect(after).toHaveLength(before.length); // nenhuma página nova
    for (const p of after.slice(1)) expect(p.latestVersion).toBe(othersBefore.get(p.id)); // as outras não foram tocadas
    expect(after[0]!.status).toBe("draft");
  });

  it("escopo autorizado: a cidade de OUTRO tenant é recusada, antes de abrir execução, e nada de J muda", async () => {
    const jPages = await rows(J);
    const jVersions = await versions(J, jPages[0]!.id);
    const runsI = (await as(I, (db) => listGenerationRuns(db, { limit: 200 }))).length;
    const err = await reprocess(I, jPages[0]!.entityId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(api.GenerationScopeError);
    expect((err as { missingIds: string[] }).missingIds).toEqual([jPages[0]!.entityId]);
    expect((await as(I, (db) => listGenerationRuns(db, { limit: 200 }))).length).toBe(runsI);
    expect(await versions(J, jPages[0]!.id)).toEqual(jVersions);
    // e a página de J não é legível por I (a ação do web depende disto para recusar a página alheia)
    expect(await as(I, (db) => getPageDetail(db, jPages[0]!.id))).toBeUndefined();
  });

  it("falha de gate é EXPLÍCITA: bloqueia, registra os gates, mantém URL e histórico e marca a página como bloqueada", async () => {
    const [a, b] = await rows(I); // a = maior população, b = a segunda
    const vA = await versions(I, a!.id);
    const nameA = (await as(I, (db) => listCities(db, { uf: "SP", limit: 1000 }))).find((c) => c.id === a!.entityId)!.name;
    await as(I, (db) => db.query("UPDATE plataforma.city SET name = $2 WHERE id = $1", [a!.entityId, b!.cityName])); // colide com a URL e com o título da segunda
    try {
      const r = await reprocess(I, a!.entityId);
      expect(r.status).toBe("failed"); // nada foi gerado nem confirmado
      expect(r.error).toMatch(/nenhum item/);
      expect(r.items[0]).toMatchObject({ outcome: "blocked" });
      expect(r.items[0]!.failedGates).toEqual(["url_unique", "url_stable", "metadata_valid"]); // URL repetida, URL que mudaria e título repetido
      const detail = (await as(I, (db) => getPageDetail(db, a!.id)))!;
      expect(detail.page).toMatchObject({ status: "blocked", path: a!.path, latestVersion: a!.latestVersion }); // URL e versão antigas ficam
      expect(detail.latestAttempt?.gates.filter((g) => g.outcome === "fail").map((g) => g.gate)).toEqual(["url_unique", "url_stable", "metadata_valid"]);
      expect(await versions(I, a!.id)).toEqual(vA); // histórico intacto
    } finally {
      await as(I, (db) => db.query("UPDATE plataforma.city SET name = $2 WHERE id = $1", [a!.entityId, nameA])); // sempre devolve o dado, para não contaminar os outros testes
    }
    // corrigido o dado, reprocessar devolve a página a rascunho SEM versão nova
    const ok = await reprocess(I, a!.entityId);
    expect(ok).toMatchObject({ status: "succeeded", unchanged: 1 });
    expect((await as(I, (db) => getPageDetail(db, a!.id)))!.page.status).toBe("draft");
    expect(await versions(I, a!.id)).toEqual(vA);
  });

  it("falha no item (injetada) aparece com o erro, sem versão parcial", async () => {
    const [sp] = await rows(I);
    await as(I, (db) => db.query("UPDATE plataforma.city SET population = population + 3 WHERE id = $1", [sp!.entityId]));
    const vBefore = await versions(I, sp!.id);
    const r = await reprocess(I, sp!.entityId, { faults: { item: () => { throw new Error("falha injetada no reprocessamento"); } } });
    expect(r.status).toBe("failed");
    expect(r.items[0]).toMatchObject({ outcome: "blocked", error: "falha injetada no reprocessamento" });
    expect(await versions(I, sp!.id)).toEqual(vBefore);
    const again = await reprocess(I, sp!.entityId); // e reprocessar de novo conclui
    expect(again).toMatchObject({ status: "succeeded", generated: 1 });
    expect((await versions(I, sp!.id)).map((v) => v.version)).toEqual([(vBefore[0]!.version) + 1, ...vBefore.map((v) => v.version)]);
  });
});

describe("nenhum caminho implícito de publicação", () => {
  it("depois de gerar e reprocessar, todo status é rascunho ou bloqueada; 'published' é recusado pelo banco", async () => {
    const all = await rows(I);
    expect(all.every((p) => p.status === "draft" || p.status === "blocked")).toBe(true);
    await expect(as(I, (db) => db.query("UPDATE plataforma.page SET status = 'published' WHERE id = $1", [all[0]!.id]))).rejects.toThrow(/violates check constraint/);
    await expect(as(I, (db) => db.query("INSERT INTO plataforma.page (tenant_id, entity_kind, entity_id, path, latest_version, status) VALUES (plataforma.current_tenant_id(), 'city', $1, '/x', 1, 'published')", [all[0]!.entityId]))).rejects.toThrow(/violates check constraint/);
  });
  it("a API pública não tem nenhuma função de publicação ou aprovação", () => {
    expect(Object.keys(api).filter((k) => /publi[cs]h|aprov|approve/i.test(k))).toEqual([]);
  });
});
