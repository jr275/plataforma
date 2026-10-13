import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GATES, TenantDb, devIdentity, listCities, listGenerationItems, listGenerationRuns, listPageVersions, listPages, runCityImport, runGeneration, selectCandidates, withTenant } from "../index";

// JORNADA DA ETAPA 4 (geração em draft), contra o esquema REAL (migrations 0001 a 0006) num PostgreSQL 16 descartável
// (scripts/test-schema.sh), como menlo_app. Dados: extrato REAL do IBGE (645 municípios de SP), importado como origem `real`.
// NÃO é a jornada completa do MVP: ela ainda depende de publicação (etapa 5), medição (etapa 6) e Search Console.
// Tenants exclusivos deste teste (C e D, de db/test-fixtures/generation/10_tenants.sql).
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv", import.meta.url));
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`variável ${name} ausente: rode pelo script (pnpm test:schema)`);
  return v;
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

const id = () => devIdentity([C, D]);
const as = <T>(tenant: string, fn: (db: TenantDb) => Promise<T>) => withTenant(pool, id(), tenant, fn);
const importSp = (tenant: string) => runCityImport(pool, id(), tenant, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: MAPPING });
const PILOT = { uf: "SP", limit: 20 } as const;
const countVersions = (tenant: string) => as(tenant, async (db) => Number((await db.query<{ n: string }>("SELECT count(*)::text AS n FROM plataforma.page_version")).rows[0]!.n));
const cityByCode = async (tenant: string, code: string) => (await as(tenant, (db) => listCities(db, { uf: "SP", limit: 1000 }))).find((c) => c.ibgeCode === code)!;

const summary: Record<string, unknown> = {};

describe("Etapa 4: geração em draft, ponta a ponta (dado real do IBGE, banco descartável)", () => {
  let top20: string[] = [];

  it("1-2. importa o extrato real de SP e seleciona as 20 maiores populações, de forma determinística", async () => {
    const imp = await importSp(C);
    expect(imp).toMatchObject({ status: "succeeded", total: 645, accepted: 645, rejected: 0, duplicate: 0 });
    const a = await as(C, (db) => selectCandidates(db, PILOT));
    const b = await as(C, (db) => selectCandidates(db, PILOT));
    expect(a).toHaveLength(20);
    expect(a.map((x) => x.city.ibgeCode)).toEqual(b.map((x) => x.city.ibgeCode));
    expect(a.slice(0, 2).map((x) => x.city.name)).toEqual(["São Paulo", "Guarulhos"]);
    const pops = a.map((x) => x.city.population!);
    expect(pops).toEqual([...pops].sort((x, y) => y - x)); // ordem decrescente de população oficial
    expect(a.every((x) => x.run.origin === "real" && x.run.sourceName === "IBGE")).toBe(true); // todas de origem real
    top20 = a.map((x) => x.city.id);
  });

  it("3-5. valida, renderiza, passa pelos 6 gates e persiste 20 drafts distintos; a execução fica auditável", async () => {
    const r = await runGeneration(pool, id(), C, { scope: PILOT });
    expect(r).toMatchObject({ status: "succeeded", total: 20, generated: 20, unchanged: 0, blocked: 0 });
    const pages = await as(C, (db) => listPages(db));
    expect(pages).toHaveLength(20);
    expect(pages.every((p) => p.status === "draft" && p.latestVersion === 1)).toBe(true); // nada é publicado
    expect(new Set(pages.map((p) => p.path)).size).toBe(20); // 20 URLs distintas
    expect(pages.map((p) => p.path)).toContain("/cidades/sp/sao-paulo");

    const runs = await as(C, (db) => listGenerationRuns(db));
    expect(runs[0]).toMatchObject({ id: r.runId, status: "succeeded", totalItems: 20, generatedItems: 20, blockedItems: 0, templateKey: "city-overview", templateVersion: 1 });
    expect(runs[0]!.finishedAt).toBeInstanceOf(Date);

    const items = await as(C, (db) => listGenerationItems(db, r.runId));
    expect(items).toHaveLength(20);
    for (const it of items) {
      expect(it.gates.map((g) => g.gate)).toEqual([...GATES]);
      expect(it.gates.every((g) => g.outcome === "pass" && g.detail.length > 0)).toBe(true);
      expect(it.outcome).toBe("generated");
      expect(it.pageVersionId).not.toBeNull();
    }
    const sp = pages.find((p) => p.path === "/cidades/sp/sao-paulo")!;
    const [v1] = await as(C, (db) => listPageVersions(db, sp.id));
    expect(v1!.content.title).toBe("São Paulo (SP): população e localização");
    expect(v1!.content.sections.map((s) => s.heading)).toEqual(["Visão geral", "População", "Localização", "Fonte dos dados"]);
    expect(v1!.content.factsUsed.every((f) => f.source.name === "IBGE" && f.confidence === "high")).toBe(true);
    // conteúdo distinto entre as 20 páginas
    const hashes = new Set<string>();
    for (const p of pages) hashes.add((await as(C, (db) => listPageVersions(db, p.id)))[0]!.contentHash);
    expect(hashes.size).toBe(20);
    Object.assign(summary, { cidadesSelecionadas: 20, draftsGerados: 20, bloqueadosNaPrimeiraExecucao: 0, urlsDistintas: 20, hashesDistintos: hashes.size });
  });

  it("6. reexecutar sem mudança NÃO duplica: 20 `unchanged`, nenhuma versão nova, nenhuma página nova", async () => {
    const versionsBefore = await countVersions(C);
    const r = await runGeneration(pool, id(), C, { scope: PILOT });
    expect(r).toMatchObject({ status: "succeeded", total: 20, generated: 0, unchanged: 20, blocked: 0 });
    expect(await countVersions(C)).toBe(versionsBefore);
    expect((await as(C, (db) => listPages(db)))).toHaveLength(20);
    expect((await as(C, (db) => listGenerationRuns(db))).length).toBe(2); // a execução fica registrada mesmo sem mudança
    // reimportar o MESMO arquivo (nova execução de importação, outro horário) também não gera versão (o hash ignora datas e execução)
    await importSp(C);
    const r2 = await runGeneration(pool, id(), C, { scope: PILOT });
    expect(r2).toMatchObject({ generated: 0, unchanged: 20, blocked: 0 });
    expect(await countVersions(C)).toBe(versionsBefore);
    summary.reexecucao = { unchanged: 20, versoesNovas: 0, aposReimportarOMesmoArquivo: { unchanged: 20, versoesNovas: 0 } };
  });

  it("7-8. alterar UM dado cria UMA versão nova, com a mesma URL, e o histórico é preservado", async () => {
    const sp = await cityByCode(C, "3550308");
    await as(C, (db) => db.query("UPDATE plataforma.city SET population = $2 WHERE id = $1", [sp.id, sp.population! + 1000]));
    const r = await runGeneration(pool, id(), C, { scope: PILOT });
    expect(r).toMatchObject({ generated: 1, unchanged: 19, blocked: 0 });
    const pages = await as(C, (db) => listPages(db));
    expect(pages).toHaveLength(20); // nenhuma URL nova
    const page = pages.find((p) => p.path === "/cidades/sp/sao-paulo")!;
    expect(page.latestVersion).toBe(2);
    const versions = await as(C, (db) => listPageVersions(db, page.id));
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0]!.contentHash).not.toBe(versions[1]!.contentHash);
    expect(versions[0]!.content.metaDescription).toContain("11.912.337");
    expect(versions[1]!.content.metaDescription).toContain("11.911.337"); // a versão antiga continua íntegra
    expect(versions[0]!.content.path).toBe(versions[1]!.content.path);
    summary.alteracao = { versoesNovas: 1, urlsNovas: 0, versoesDaPagina: versions.length };
  });

  it("9-10. registros inválidos são bloqueados isoladamente e os válidos continuam; nada inválido vira página", async () => {
    // (a) origem não real: uma cidade de teste, em execução de origem `test`, é classificada e bloqueada.
    await runCityImport(pool, id(), C, { content: Buffer.from("ibge_code,name,uf,region,population,population_year\n3599998,Cidade de Teste,SP,Sudeste,1,2026\n"), fileName: "teste.csv", sourceName: "teste", origin: "test", mapping: MAPPING });
    const teste = await cityByCode(C, "3599998");
    const pagesBefore = (await as(C, (db) => listPages(db))).length;
    const guarulhos = await cityByCode(C, "3518800");
    const campinas = await cityByCode(C, "3509502");
    const r = await runGeneration(pool, id(), C, { scope: { cityIds: [teste.id, guarulhos.id, campinas.id] } });
    expect(r).toMatchObject({ status: "partial", total: 3, generated: 0, unchanged: 2, blocked: 1 });
    const blocked = r.items.find((i) => i.cityId === teste.id)!;
    expect(blocked).toMatchObject({ outcome: "blocked", failedGates: ["required_fields"] });
    expect(r.items.filter((i) => i.outcome === "unchanged").map((i) => i.cityId).sort()).toEqual([guarulhos.id, campinas.id].sort());
    expect((await as(C, (db) => listPages(db))).length).toBe(pagesBefore); // a cidade de teste não ganhou página
    const detail = (await as(C, (db) => listGenerationItems(db, r.runId))).find((i) => i.entityId === teste.id)!;
    expect(detail.gates[0]).toMatchObject({ gate: "required_fields", outcome: "fail" });
    expect(detail.gates.slice(1).every((g) => g.outcome === "skipped")).toBe(true);

    // (b) URL duplicada + URL instável, com dado real: renomear Guarulhos para o nome de São Paulo no ambiente de teste.
    await as(C, (db) => db.query("UPDATE plataforma.city SET name = 'São Paulo' WHERE id = $1", [guarulhos.id]));
    const r2 = await runGeneration(pool, id(), C, { scope: PILOT });
    expect(r2).toMatchObject({ status: "partial", total: 20, blocked: 1 });
    const bad = r2.items.find((i) => i.cityId === guarulhos.id)!;
    expect(bad.outcome).toBe("blocked");
    expect(bad.failedGates).toEqual(["url_unique", "url_stable"]);
    expect(r2.items.filter((i) => i.outcome === "unchanged")).toHaveLength(19); // os outros 19 seguem normalmente
    const gPage = (await as(C, (db) => listPages(db))).find((p) => p.entityId === guarulhos.id)!;
    expect(gPage).toMatchObject({ status: "blocked", path: "/cidades/sp/guarulhos", latestVersion: 1 }); // a URL antiga e o histórico ficam
    expect(await as(C, (db) => listPageVersions(db, gPage.id))).toHaveLength(1);
    expect((await as(C, (db) => listPages(db))).length).toBe(pagesBefore); // e nenhuma URL duplicada nasceu
    // corrigido o dado, a página volta a draft sem versão nova
    await as(C, (db) => db.query("UPDATE plataforma.city SET name = 'Guarulhos' WHERE id = $1", [guarulhos.id]));
    const r3 = await runGeneration(pool, id(), C, { scope: PILOT });
    expect(r3).toMatchObject({ status: "succeeded", unchanged: 20, blocked: 0 });
    expect((await as(C, (db) => listPages(db))).find((p) => p.entityId === guarulhos.id)!.status).toBe("draft");
    summary.bloqueios = { origemNaoReal: 1, urlDuplicadaEInstavel: 1, demaisSeguiramNormalmente: true };
  });

  it("11. falha de UM item não corrompe o lote; falha da execução inteira desfaz tudo e o reprocessamento conclui", async () => {
    const campinas = await cityByCode(C, "3509502");
    const santos = (await as(C, (db) => selectCandidates(db, PILOT))).find((x) => x.city.ibgeCode === "3548500")?.city;
    const alvo = campinas.id;
    // (a) falha injetada em um item: só ele é bloqueado, com o erro registrado; os outros persistem.
    await as(C, (db) => db.query("UPDATE plataforma.city SET population = population + 7 WHERE id = ANY($1::uuid[])", [[alvo, ...(santos ? [santos.id] : [])]]));
    const rItem = await runGeneration(pool, id(), C, { scope: PILOT, faults: { item: (cityId) => { if (cityId === alvo) throw new Error("falha injetada no item"); } } });
    expect(rItem.status).toBe("partial");
    expect(rItem.blocked).toBe(1);
    expect(rItem.items.find((i) => i.cityId === alvo)).toMatchObject({ outcome: "blocked", error: "falha injetada no item" });
    if (santos) expect(rItem.items.find((i) => i.cityId === santos.id)!.outcome).toBe("generated"); // o outro item alterado foi gravado
    const campinasPage = (await as(C, (db) => listPages(db))).find((p) => p.entityId === alvo)!;
    expect(campinasPage.latestVersion).toBe(1); // a falha foi desfeita (savepoint): sem versão parcial
    // (b) falha da execução inteira (no fechamento): tudo desfeito, execução `failed` com o erro.
    const versionsBefore = await countVersions(C);
    const rRun = await runGeneration(pool, id(), C, { scope: PILOT, faults: { close: () => { throw new Error("falha injetada no fechamento"); } } });
    expect(rRun).toMatchObject({ status: "failed", error: "falha injetada no fechamento", total: 0 });
    expect(await countVersions(C)).toBe(versionsBefore); // nenhuma versão gravada pela execução que falhou
    const failedRun = (await as(C, (db) => listGenerationRuns(db))).find((r) => r.id === rRun.runId)!;
    expect(failedRun).toMatchObject({ status: "failed", error: "falha injetada no fechamento" });
    expect(await as(C, (db) => listGenerationItems(db, rRun.runId))).toEqual([]);
    // (c) reprocessar conclui e a cidade que falhou finalmente recebe a versão nova, sem duplicar nada.
    const rAgain = await runGeneration(pool, id(), C, { scope: PILOT });
    expect(rAgain.status).toBe("succeeded");
    expect(rAgain.items.find((i) => i.cityId === alvo)!.outcome).toBe("generated");
    expect((await as(C, (db) => listPages(db))).length).toBe(20 + 0);
    const rIdem = await runGeneration(pool, id(), C, { scope: PILOT });
    expect(rIdem).toMatchObject({ generated: 0, unchanged: 20, blocked: 0 });
    summary.falhas = { itemIsolado: true, execucaoInteiraDesfeita: true, reprocessamentoConcluiu: true };
  });

  it("12. isolamento multi-tenant: D tem as próprias páginas; C não enxerga as de D nem consegue gravar nelas", async () => {
    await importSp(D);
    const rD = await runGeneration(pool, id(), D, { scope: PILOT });
    expect(rD).toMatchObject({ status: "succeeded", generated: 20, blocked: 0 });
    const pagesC = await as(C, (db) => listPages(db));
    const pagesD = await as(D, (db) => listPages(db));
    expect(pagesD).toHaveLength(20);
    const idsC = new Set(pagesC.map((p) => p.id));
    expect(pagesD.every((p) => !idsC.has(p.id))).toBe(true);
    // a mesma cidade tem URL igual nos dois tenants (único POR tenant) sem conflito
    expect(pagesD.map((p) => p.path)).toContain("/cidades/sp/sao-paulo");
    // C não lê versões, execuções nem itens de D
    expect(await as(C, (db) => listPageVersions(db, pagesD[0]!.id))).toEqual([]);
    const runsC = await as(C, (db) => listGenerationRuns(db));
    expect(runsC.some((r) => r.id === rD.runId)).toBe(false);
    expect(await as(C, (db) => listGenerationItems(db, rD.runId))).toEqual([]);
    // negativas de ESCRITA: RLS recusa tenant_id alheio e as FKs compostas recusam referências cruzadas
    const cityD = await cityByCode(D, "3550308");
    await expect(as(C, (db) => db.query("INSERT INTO plataforma.page (tenant_id, entity_kind, entity_id, path, latest_version, status) VALUES ($1, 'city', $2, '/cidades/sp/x', 1, 'draft')", [D, cityD.id]))).rejects.toThrow(/row-level security/);
    await expect(as(C, (db) => db.query("INSERT INTO plataforma.page_version (tenant_id, page_id, version, run_id, content, content_hash, template_key, template_version, template_hash) VALUES (plataforma.current_tenant_id(), $1, 9, $2, '{}'::jsonb, $3, 'x', 1, $3)", [pagesD[0]!.id, rD.runId, "a".repeat(64)]))).rejects.toThrow(/foreign key/);
    await expect(as(C, (db) => db.query("UPDATE plataforma.page SET status = 'blocked' WHERE id = $1", [pagesD[0]!.id]))).resolves.toMatchObject({ rowCount: 0 }); // UPDATE alheio não acha linha
    expect((await as(D, (db) => listPages(db))).every((p) => p.status === "draft")).toBe(true); // e as páginas de D continuam intactas
    summary.isolamento = { tenantC: pagesC.length, tenantD: pagesD.length, vazamentos: 0, escritasCruzadasRecusadas: 3 };
  });

  it("imutabilidade e limites: versões e itens não podem ser alterados nem apagados pela aplicação; o teto de 500 e a validação do escopo valem", async () => {
    const [page] = await as(C, (db) => listPages(db));
    await expect(as(C, (db) => db.query("UPDATE plataforma.page_version SET content_hash = $2 WHERE page_id = $1", [page!.id, "b".repeat(64)]))).rejects.toThrow(/permission denied/);
    await expect(as(C, (db) => db.query("DELETE FROM plataforma.page_version"))).rejects.toThrow(/permission denied/);
    await expect(as(C, (db) => db.query("UPDATE plataforma.generation_item SET outcome = 'generated'"))).rejects.toThrow(/permission denied/);
    await expect(as(C, (db) => db.query("DELETE FROM plataforma.page"))).rejects.toThrow(/permission denied/);
    await expect(runGeneration(pool, id(), C, { scope: { uf: "SP", limit: 501 } })).rejects.toThrow(/limit/);
    await expect(runGeneration(pool, id(), C, { scope: { uf: "XX", limit: 5 } })).rejects.toThrow(/UF/);
    await expect(runGeneration(pool, id(), C, { scope: { cityIds: [] } })).rejects.toThrow(/cityIds/);
    expect(top20).toHaveLength(20);
  });

  it("resumo da jornada (impresso para o relatório)", () => {
    console.log(`ETAPA4_SUMMARY ${JSON.stringify(summary)}`);
    expect(Object.keys(summary).length).toBeGreaterThanOrEqual(7);
  });
});
