import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEMPLATE_REGISTRY, TenantDb, devIdentity, previewDraftPage, runCityImport, withTenant } from "../index";
import { productPoolConfig } from "../testing/pool-config";
import { realEstateVertical } from "../../../../packs/real-estate/src/vertical";
import * as draftLib from "../draft";
import { fakeFetch, fixture, type Route } from "./test-support/fake-fetch";
import { DraftConflictError, DraftInvalidError, NoBlueprintError, OpportunityNotFoundError, bcbSgsAdapter, createBlueprint, evaluatePageDraft, ibgeNewsAdapter, loadPageDraft, rssNewsAdapter, runResearch, savePageDraft, searchOpportunities } from "./index";

// Rascunho do editor visual contra o esquema REAL (migrations 1 a 10) num PostgreSQL descartável: persistência em versões imutáveis, recuperação, concorrência,
// isolamento entre tenants, idempotência e reflexo das edições na validação, nos gates e na prévia. Tenants exclusivos S e T.
const S = "fb444444-4444-4444-8444-444444444444";
const T = "fb555555-5555-4555-8555-555555555555";
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv", import.meta.url));
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };
const NOW = new Date("2026-10-13T15:00:00Z");
const FEED = "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml";
const OK: Record<string, Route> = {
  "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/": { body: fixture("bcb-432.json") }, "https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/": { body: fixture("bcb-13522.json") }, "https://api.bcb.gov.br/dados/serie/bcdata.sgs.189/": { body: fixture("bcb-189.json") },
  "https://servicodados.ibge.gov.br/api/v3/noticias/": { body: fixture("ibge-news.json") }, "https://agenciabrasil.ebc.com.br/robots.txt": { body: fixture("agenciabrasil-robots.txt") }, [FEED]: { body: fixture("agenciabrasil-economia.xml") },
};
const V = { ...realEstateVertical, scoring: { ...realEstateVertical.scoring, eligibility: { ...realEstateVertical.scoring.eligibility, minCommercialValue: 30 } }, patterns: realEstateVertical.patterns.map((p) => (p.key === "city-overview" ? { ...p, valueTier: "high" as const } : p)) };
const deps = { vertical: V, templates: TEMPLATE_REGISTRY, now: () => NOW };

let pool: pg.Pool;
let opp = ""; let cityId = ""; let noBp = "";
const id = () => devIdentity([S, T]);
const as = <X>(t: string, fn: (db: TenantDb) => Promise<X>) => withTenant(pool, id(), t, fn);
const count = (t: string, table: string) => as(t, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.${table}`)).rows[0]!.n));
const load = () => as(S, (db) => loadPageDraft(db, opp, deps));
const edit = (d: draftLib.PageDraft, nodeId: string, patch: draftLib.Config): draftLib.PageDraft => { const r = draftLib.updateConfig(d, nodeId, patch); if (!r.ok) throw new Error(r.error); return r.draft; };

beforeAll(async () => {
  pool = new pg.Pool(productPoolConfig(4));
  pool.on("error", () => undefined);
  for (const t of [S, T]) await runCityImport(pool, id(), t, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: MAPPING });
  const r = await runResearch(pool, id(), S, { vertical: V, adapters: [bcbSgsAdapter, ibgeNewsAdapter, rssNewsAdapter], fetch: fakeFetch(OK), now: () => NOW, sleep: async () => undefined }, { entityLimit: 5 });
  expect(r.status).toBe("succeeded");
  const el = await as(S, (db) => searchOpportunities(db, { status: "eligible", limit: 100 }));
  const ov = el.rows.find((x) => x.experience === "location_overview")!;
  opp = ov.id; cityId = ov.entityId!;
  await createBlueprint(pool, id(), S, deps, { opportunityId: opp });
  noBp = (await as(S, (db) => searchOpportunities(db, { status: "scored", limit: 1 }))).rows[0]!.id;
});
afterAll(async () => { await pool.end(); });

describe("carregar: sem versão salva, o rascunho inicial nasce do blueprint real e já é válido", () => {
  it("rascunho derivado, contexto do servidor, publicação nunca publicável", async () => {
    const s = await load();
    expect(s.saved).toBeNull();
    expect(s.versions).toEqual([]);
    expect(s.draft.nodes.filter((n) => n.type === "quality_gate")).toHaveLength(6);
    expect(s.evaluation.validation.errors).toBe(0);
    expect(s.evaluation.validation.publication.publishable).toBe(false);
    expect(s.ctx.publicationAvailable).toBe(false);
    expect(s.ctx.templates.map((t) => t.key)).toEqual(["city-overview"]);
    expect(s.ctx.sources.every((x) => x.state === "implemented_tested")).toBe(true);
    expect(s.ctx.facts).toEqual(expect.arrayContaining(["name", "uf", "population"]));
    expect(s.evaluation.gates.gates.some((g) => g.outcome === "fail")).toBe(false);
  });
  it("oportunidade sem blueprint, malformada, inexistente e de outro tenant: recusadas", async () => {
    await expect(as(S, (db) => loadPageDraft(db, noBp, deps))).rejects.toBeInstanceOf(NoBlueprintError);
    await expect(as(S, (db) => loadPageDraft(db, "x", deps))).rejects.toBeInstanceOf(OpportunityNotFoundError);
    await expect(as(T, (db) => loadPageDraft(db, opp, deps))).rejects.toBeInstanceOf(OpportunityNotFoundError);
  });
});

describe("salvar: versões imutáveis, recuperação, idempotência e concorrência", () => {
  it("v1 grava, recarregar recupera EXATAMENTE o que foi salvo (nós, conexões, posições) e a validação avaliada no servidor", async () => {
    const s0 = await load();
    const d = draftLib.setLayout(edit(s0.draft, "page_section-2", { heading: "Habitantes" }), { "opportunity-1": { x: 12, y: 34 } });
    const r = await savePageDraft(pool, id(), S, deps, { opportunityId: opp, draft: d, baseVersion: 0, note: "primeira edição" });
    expect(r).toMatchObject({ version: 1, created: true });
    expect(r.changes.map((c) => `${c.kind}:${c.id}.${c.field}`)).toContain("field_changed:page_section-2.heading");
    const s1 = await load();
    expect(s1.saved).toMatchObject({ version: 1 });
    expect(s1.draft).toEqual(d);
    expect(s1.draft.layout["opportunity-1"]).toEqual({ x: 12, y: 34 });
    expect(s1.versions[0]).toMatchObject({ version: 1, valid: true, errors: 0, note: "primeira edição" });
    expect(await count(S, "page_draft")).toBe(1);
  });
  it("salvar o mesmo conteúdo é idempotente (nenhuma versão nova); só mudar posição cria versão SEM mudanças relevantes", async () => {
    const s = await load();
    expect(await savePageDraft(pool, id(), S, deps, { opportunityId: opp, draft: s.draft, baseVersion: 1 })).toMatchObject({ version: 1, created: false });
    expect(await count(S, "page_draft")).toBe(1);
    const moved = draftLib.setLayout(s.draft, { ...s.draft.layout, "entity-1": { x: 5, y: 5 } });
    const r = await savePageDraft(pool, id(), S, deps, { opportunityId: opp, draft: moved, baseVersion: 1 });
    expect(r).toMatchObject({ version: 2, created: true, changes: [] });
  });
  it("concorrência: salvar sobre uma versão desatualizada é recusado e nada é gravado", async () => {
    const s = await load();
    const n = await count(S, "page_draft");
    await expect(savePageDraft(pool, id(), S, deps, { opportunityId: opp, draft: edit(s.draft, "page_section-1", { order: 3 }), baseVersion: 1 })).rejects.toBeInstanceOf(DraftConflictError);
    await expect(savePageDraft(pool, id(), S, deps, { opportunityId: opp, draft: s.draft, baseVersion: 0 })).rejects.toBeInstanceOf(DraftConflictError);
    expect(await count(S, "page_draft")).toBe(n);
  });
  it("rascunho com configuração inválida É salvo como rascunho (valid=false, com os erros) e continua recuperável; o servidor não aceita lixo estrutural", async () => {
    const s = await load();
    const bad = edit(s.draft, "page_section-1", { order: 0 });
    const r = await savePageDraft(pool, id(), S, deps, { opportunityId: opp, draft: bad, baseVersion: 2 });
    expect(r.evaluation.validation.valid).toBe(false);
    const back = await load();
    expect(back.saved!.version).toBe(3);
    expect(back.evaluation.validation.errors).toBeGreaterThan(0);
    expect(back.versions[0]).toMatchObject({ valid: false });
    const n = await count(S, "page_draft");
    for (const garbage of [null, { schema: "x" }, { ...bad, nodes: [{ id: "../x", type: "script", config: {} }] }, { ...bad, extra: 1 }]) await expect(savePageDraft(pool, id(), S, deps, { opportunityId: opp, draft: garbage, baseVersion: 3 })).rejects.toBeInstanceOf(DraftInvalidError);
    await expect(savePageDraft(pool, id(), S, deps, { opportunityId: opp, draft: bad, baseVersion: -1 })).rejects.toBeInstanceOf(DraftInvalidError);
    expect(await count(S, "page_draft")).toBe(n);
  });
  it("histórico: versões em ordem, com autor, horário e o resumo das mudanças relevantes", async () => {
    const s = await load();
    expect(s.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(s.versions[2]!.createdBy).toMatch(/\S/);
    expect(s.versions[0]!.changes.map((c) => `${c.id}.${c.field}`)).toContain("page_section-1.order");
    expect(s.versions[1]!.changes).toEqual([]);
  });
});

describe("isolamento, imutabilidade e avaliação no servidor", () => {
  it("outro tenant não lê, não avalia e não grava o rascunho; RLS não devolve linhas", async () => {
    const s = await load();
    await expect(savePageDraft(pool, id(), T, deps, { opportunityId: opp, draft: s.draft, baseVersion: 3 })).rejects.toBeInstanceOf(OpportunityNotFoundError);
    await expect(evaluatePageDraft(pool, id(), T, deps, { opportunityId: opp, draft: s.draft })).rejects.toBeInstanceOf(OpportunityNotFoundError);
    expect(await count(T, "page_draft")).toBe(0);
    expect(await as(T, async (db) => (await db.query(`SELECT 1 FROM plataforma.page_draft WHERE opportunity_id = $1`, [opp])).rows)).toEqual([]);
  });
  it("o histórico é imutável (sem UPDATE nem DELETE para a aplicação) e o banco recusa conteúdo fora do esquema", async () => {
    await expect(as(S, (db) => db.query(`UPDATE plataforma.page_draft SET valid = true`))).rejects.toThrow();
    await expect(as(S, (db) => db.query(`DELETE FROM plataforma.page_draft`))).rejects.toThrow();
    await expect(as(S, (db) => db.query(`INSERT INTO plataforma.page_draft (tenant_id, opportunity_id, version, base_blueprint_version, content, content_sha, content_sig, validation, gates, valid, errors, warnings, created_by) VALUES (plataforma.current_tenant_id(), $1, 99, 1, '{"schema":"outro"}', repeat('a', 64), 'x', '{}', '[1,2,3,4,5,6]', true, 0, 0, 't')`, [opp]))).rejects.toThrow(/check/i);
    await expect(as(S, (db) => db.query(`INSERT INTO plataforma.page_draft (tenant_id, opportunity_id, version, base_blueprint_version, content, content_sha, content_sig, validation, gates, valid, errors, warnings, created_by) VALUES (plataforma.current_tenant_id(), $1, 98, 1, '{"schema":"page-draft/v1"}', repeat('b', 64), 'x', '{}', '[1,2,3,4,5,6]', true, 3, 0, 't')`, [opp]))).rejects.toThrow(/check/i); // valid = (errors = 0)
  });
  it("avaliar (sem salvar) reflete a edição nos gates: sem template o gate de experiência reprova; nada é gravado", async () => {
    const s = await load();
    const n = await count(S, "page_draft");
    const ok = await evaluatePageDraft(pool, id(), S, deps, { opportunityId: opp, draft: s.draft });
    expect(ok.gates.gates.find((g) => g.gate === "experience")!.outcome).not.toBe("fail");
    const noTemplate = await evaluatePageDraft(pool, id(), S, deps, { opportunityId: opp, draft: edit(s.draft, "page_template-1", { templateKey: "" }) });
    expect(noTemplate.gates.gates.find((g) => g.gate === "experience")!.outcome).toBe("fail");
    expect(noTemplate.validation.valid).toBe(false);
    expect(noTemplate.validation.publication.publishable).toBe(false);
    expect(await count(S, "page_draft")).toBe(n);
  });
});

describe("prévia sincronizada com o rascunho (motor real de páginas, fatos reais)", () => {
  it("seções, ordem, título e links configurados mudam a página; seção desligada some; link sem destino não é emitido; nada é inventado", async () => {
    const s = await load();
    let d = s.draft;
    const full = await as(S, (db) => previewDraftPage(db, cityId, d));
    expect(full!.status).toBe("rendered");
    expect(full!.page!.sections.map((x) => x.id)).toEqual(["overview", "population", "location", "sources"]);
    d = edit(edit(edit(d, "page_section-1", { order: 3 }), "page_section-3", { order: 1, heading: "Onde fica" }), "page_section-2", { enabled: false });
    const edited = await as(S, (db) => previewDraftPage(db, cityId, d));
    expect(edited!.page!.sections.map((x) => x.id)).toEqual(["location", "overview", "sources"]);
    expect(edited!.page!.sections[0]!.heading).toBe("Onde fica");
    expect(edited!.page!.sections.every((x) => !/Habitantes|população/i.test(x.heading) || x.id === "sources")).toBe(true);
    expect(edited!.note).toContain("não indexável");
    expect(edited!.seo).toMatchObject({ robots: "noindex" });
    expect(edited!.structuredData[0]!.provenance).toEqual(expect.arrayContaining(["name", "uf"]));
    expect(edited!.links.configured).toBe(2);
    expect(edited!.links.emitted).toBe(0); // /cidades/sp e /cidades não existem no site deste tenant
    expect([...edited!.links.missing].sort()).toEqual(["/cidades", "/cidades/sp"]);
  });
  it("sem template no rascunho: 'no_template', nada renderizado", async () => {
    const s = await load();
    const r = await as(S, (db) => previewDraftPage(db, cityId, edit(s.draft, "page_template-1", { templateKey: "" })));
    expect(r).toMatchObject({ status: "no_template", page: null });
    expect(await as(T, (db) => previewDraftPage(db, "00000000-0000-4000-8000-000000000000", s.draft))).toBeNull();
  });
});
