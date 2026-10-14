import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEMPLATE_REGISTRY, TenantDb, devIdentity, runCityImport, withTenant } from "../index";
import { productPoolConfig } from "../testing/pool-config";
import { cityPath } from "../pages/city-overview";
import { realEstateVertical } from "../../../../packs/real-estate/src/vertical";
import * as draftLib from "../draft";
import { fakeFetch, fixture, type Route } from "./test-support/fake-fetch";
import { GenerationPreconditionError, OpportunityNotFoundError, PublicationBlockedError, applySerpWaiver, bcbSgsAdapter, createBlueprint, generateFromBlueprint, ibgeNewsAdapter, listOpportunityPages, loadPageDraft, rssNewsAdapter, runResearch, savePageDraft, searchOpportunities, transitionOpportunity } from "./index";

// Geração a partir do blueprint contra o esquema REAL (migrations 1 a 12): o pipeline EXISTENTE produz a página, o ciclo de vida avança até QA e a publicação continua bloqueada. Tenants W e X.
const W = "fb888888-8888-4888-8888-888888888888";
const X = "fb999999-9999-4999-8999-999999999999";
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv", import.meta.url));
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };
const NOW = new Date("2026-10-13T15:00:00Z");
const FEED = "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml";
const OK: Record<string, Route> = {
  "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/": { body: fixture("bcb-432.json") }, "https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/": { body: fixture("bcb-13522.json") }, "https://api.bcb.gov.br/dados/serie/bcdata.sgs.189/": { body: fixture("bcb-189.json") },
  "https://servicodados.ibge.gov.br/api/v3/noticias/": { body: fixture("bcb-432.json") === "" ? "" : fixture("ibge-news.json") }, "https://agenciabrasil.ebc.com.br/robots.txt": { body: fixture("agenciabrasil-robots.txt") }, [FEED]: { body: fixture("agenciabrasil-economia.xml") },
};
const V = { ...realEstateVertical, scoring: { ...realEstateVertical.scoring, eligibility: { ...realEstateVertical.scoring.eligibility, minCommercialValue: 30 } }, patterns: realEstateVertical.patterns.map((p) => (p.key === "city-overview" ? { ...p, valueTier: "high" as const } : p)) };
const deps = { vertical: V, templates: TEMPLATE_REGISTRY, now: () => NOW };
const WAIVER = "Exceção de SERP aprovada no teste: não há provedor de SERP operacional nesta fase.";

let pool: pg.Pool;
let a = ""; let b = ""; let cityA = ""; let cityB = "";
const id = () => devIdentity([W, X]);
const as = <T>(t: string, fn: (db: TenantDb) => Promise<T>) => withTenant(pool, id(), t, fn);
const status = (o: string) => as(W, async (db) => (await db.query<{ status: string }>(`SELECT status FROM plataforma.growth_opportunity WHERE id = $1`, [o])).rows[0]!.status);
const count = (t: string, table: string, where = "true") => as(t, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.${table} WHERE ${where}`)).rows[0]!.n));
const events = (o: string) => as(W, async (db) => (await db.query<{ event_type: string; from_status: string | null; to_status: string | null; data: Record<string, unknown> }>(`SELECT event_type, from_status, to_status, data FROM plataforma.opportunity_event WHERE opportunity_id = $1 ORDER BY seq`, [o])).rows);

beforeAll(async () => {
  pool = new pg.Pool(productPoolConfig(4)); pool.on("error", () => undefined);
  for (const t of [W, X]) await runCityImport(pool, id(), t, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: MAPPING });
  const r = await runResearch(pool, id(), W, { vertical: V, adapters: [bcbSgsAdapter, ibgeNewsAdapter, rssNewsAdapter], fetch: fakeFetch(OK), now: () => NOW, sleep: async () => undefined }, { entityLimit: 5 });
  expect(r.status).toBe("succeeded");
  const el = (await as(W, (db) => searchOpportunities(db, { status: "eligible", limit: 100 }))).rows.filter((x) => x.experience === "location_overview");
  expect(el.length).toBeGreaterThanOrEqual(2);
  [a, b] = [el[0]!.id, el[1]!.id]; [cityA, cityB] = [el[0]!.entityId!, el[1]!.entityId!];
  for (const o of [a, b]) await createBlueprint(pool, id(), W, deps, { opportunityId: o });
});
afterAll(async () => { await pool.end(); });

describe("pré-condições (nada é gravado quando faltam)", () => {
  it("sem a exceção de SERP a oportunidade ainda está 'elegível': não gera, e diz por quê", async () => {
    const before = await count(W, "generation_run");
    const e = await generateFromBlueprint(pool, id(), W, deps, { opportunityId: a }).catch((x) => x);
    expect(e).toBeInstanceOf(GenerationPreconditionError);
    expect(e.reasons.join(" ")).toMatch(/blueprinted/);
    expect(await count(W, "generation_run")).toBe(before);
    expect(await count(W, "opportunity_page")).toBe(0);
    expect(await status(a)).toBe("eligible");
  });
  it("id malformado ou de outro tenant: não encontrada", async () => {
    await expect(generateFromBlueprint(pool, id(), W, deps, { opportunityId: "x" })).rejects.toBeInstanceOf(OpportunityNotFoundError);
    await expect(generateFromBlueprint(pool, id(), X, deps, { opportunityId: a })).rejects.toBeInstanceOf(OpportunityNotFoundError);
  });
});

describe("geração pelo pipeline existente, até QA", () => {
  let first: Awaited<ReturnType<typeof generateFromBlueprint>>;
  it("gera a página em rascunho, registra a ligação e avança blueprinted → … → qa com um evento por passo", async () => {
    await applySerpWaiver(pool, id(), W, { opportunityId: a, reason: WAIVER });
    first = await generateFromBlueprint(pool, id(), W, deps, { opportunityId: a });
    expect(first.generation).toMatchObject({ status: "succeeded", generated: 1, blocked: 0 });
    expect(first.record).toMatchObject({ outcome: "generated", qaPassed: true });
    expect(first.record.gates).toHaveLength(6);
    expect(first.record.gates.every((g) => g.outcome === "pass")).toBe(true);
    expect(first.record.path).toMatch(/^\/cidades\//);
    expect(first.from).toBe("blueprinted"); expect(first.to).toBe("qa");
    expect(first.steps.map((s) => `${s.from}>${s.to}`)).toEqual(["blueprinted>data_assembled", "data_assembled>evidence_validated", "evidence_validated>experience_built", "experience_built>qa"]);
    expect(await status(a)).toBe("qa");
    const ev = (await events(a)).filter((e) => e.event_type === "transition").map((e) => `${e.from_status}>${e.to_status}`);
    expect(ev.slice(-5)).toEqual(["eligible>blueprinted", "blueprinted>data_assembled", "data_assembled>evidence_validated", "evidence_validated>experience_built", "experience_built>qa"]);
    expect((await events(a)).filter((e) => e.event_type === "transition").slice(-4).every((e) => e.data.authorizesPublication === false)).toBe(true);
  });
  it("a página fica em rascunho (nunca publicada) e é a MESMA do pipeline: página, versão e item de geração existem", async () => {
    expect(await count(W, "page", `entity_id = '${cityA}' AND status = 'draft'`)).toBe(1);
    expect(await count(W, "page_version", `id = '${first.record.pageVersionId}'`)).toBe(1);
    expect(await count(W, "generation_item", `run_id = '${first.record.runId}' AND outcome = 'generated'`)).toBe(1);
    const content = await as(W, async (db) => (await db.query<{ c: Record<string, unknown> }>(`SELECT content AS c FROM plataforma.page_version WHERE id = $1`, [first.record.pageVersionId])).rows[0]!.c);
    expect(JSON.stringify(content)).not.toMatch(/"robots":\s*"index/);
    expect(await count(W, "page", `status <> 'draft'`)).toBe(0);
  });
  it("regenerar o mesmo conteúdo é idempotente: 'unchanged', sem página nem versão novas e sem transição nova", async () => {
    const pagesBefore = await count(W, "page"); const versionsBefore = await count(W, "page_version"); const transBefore = (await events(a)).filter((e) => e.event_type === "transition").length;
    const again = await generateFromBlueprint(pool, id(), W, deps, { opportunityId: a });
    expect(again.record.outcome).toBe("unchanged");
    expect(again.steps).toEqual([]);
    expect(again.to).toBe("qa");
    expect(await count(W, "page")).toBe(pagesBefore); expect(await count(W, "page_version")).toBe(versionsBefore);
    expect((await events(a)).filter((e) => e.event_type === "transition").length).toBe(transBefore);
    expect((await as(W, (db) => listOpportunityPages(db, a))).map((r) => r.outcome)).toEqual(["unchanged", "generated"]);
  });
  it("o rascunho salvo no editor governa a geração (título de seção editado vira a nova versão da página)", async () => {
    const st = await as(W, (db) => loadPageDraft(db, a, deps));
    const section = st.draft.nodes.find((n) => n.type === "page_section")!;
    const upd = draftLib.updateConfig(st.draft, section.id, { heading: "Quem vive aqui" });
    if (!upd.ok) throw new Error(upd.error);
    await savePageDraft(pool, id(), W, deps, { opportunityId: a, draft: upd.draft, baseVersion: 0 });
    const r = await generateFromBlueprint(pool, id(), W, deps, { opportunityId: a });
    expect(r.usedDraftVersion).toBe(1);
    expect(r.record.outcome).toBe("generated");
    expect(r.record.version).toBe(2);
    expect(r.record.draftId).not.toBeNull();
    const c = await as(W, async (db) => (await db.query<{ c: string }>(`SELECT content::text AS c FROM plataforma.page_version WHERE id = $1`, [r.record.pageVersionId])).rows[0]!.c);
    expect(c).toContain("Quem vive aqui");
  });
});

describe("gate reprovado: vai a QA com os motivos e nunca avança", () => {
  it("o conflito de caminho (outra entidade já dona da URL) reprova o gate técnico: sem versão, QA reprovado, evento de bloqueio", async () => {
    await applySerpWaiver(pool, id(), W, { opportunityId: b, reason: WAIVER });
    const target = await as(W, async (db) => (await db.query<{ name: string; uf: string }>(`SELECT name, uf FROM plataforma.city WHERE id = $1`, [cityB])).rows[0]!);
    const other = await as(W, async (db) => (await db.query<{ id: string }>(`SELECT id FROM plataforma.city WHERE id NOT IN ($1, $2) ORDER BY name LIMIT 1`, [cityA, cityB])).rows[0]!.id);
    // depois do blueprint (que estava sem conflito), outra entidade passa a ocupar a URL desta cidade
    await as(W, (db) => db.query(`INSERT INTO plataforma.page (tenant_id, entity_kind, entity_id, path, latest_version, status) VALUES (plataforma.current_tenant_id(), 'city', $1, $2, 1, 'draft')`, [other, cityPath(target.uf, target.name)]));
    const r = await generateFromBlueprint(pool, id(), W, deps, { opportunityId: b });
    expect(r.to).toBe("qa");
    expect(r.record).toMatchObject({ outcome: "blocked", qaPassed: false, pageVersionId: null });
    expect(r.record.gates.some((g) => g.outcome === "fail")).toBe(true);
    expect(await count(W, "page_version", `page_id IN (SELECT id FROM plataforma.page WHERE entity_id = '${cityB}')`)).toBe(0);
    expect((await events(b)).at(-1)).toMatchObject({ event_type: "blocker" });
    expect(await status(b)).toBe("qa");
    await expect(transitionOpportunity(pool, id(), W, { opportunityId: b, from: "qa", to: "published", reason: "tentativa de publicar" })).rejects.toBeInstanceOf(PublicationBlockedError);
  });
});

describe("publicação bloqueada (modelo, servidor e banco)", () => {
  it("qa → published é recusado pela função de transição, mesmo sendo uma aresta do modelo", async () => {
    await expect(transitionOpportunity(pool, id(), W, { opportunityId: a, from: "qa", to: "published", reason: "tentativa de publicar" })).rejects.toBeInstanceOf(PublicationBlockedError);
    expect(await status(a)).toBe("qa");
  });
  it("e pelo banco: UPDATE direto de status para qualquer etapa pós-QA falha e não grava nada", async () => {
    for (const to of ["published", "indexed", "monitored", "converted", "measured", "learned", "refreshed"]) {
      await expect(as(W, (db) => db.query(`UPDATE plataforma.growth_opportunity SET status = $2 WHERE id = $1`, [a, to]))).rejects.toThrow(/transição (bloqueada|de ciclo de vida inválida)/);
    }
    expect(await status(a)).toBe("qa");
    expect((await events(a)).some((e) => e.to_status === "published")).toBe(false);
  });
  it("qa → published por SQL direto é recusado especificamente pelo bloqueio de publicação", async () => {
    await expect(as(W, (db) => db.query(`UPDATE plataforma.growth_opportunity SET status = 'published' WHERE id = $1`, [a]))).rejects.toThrow(/publicação e etapas seguintes não estão habilitadas/);
  });
});

describe("isolamento", () => {
  it("o outro tenant não enxerga as ligações nem as páginas desta geração", async () => {
    expect(await count(X, "opportunity_page")).toBe(0);
    expect(await as(X, (db) => listOpportunityPages(db, a))).toEqual([]);
  });
});
