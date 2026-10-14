import { describe, expect, it } from "vitest";
import type { PageRecipe } from "../recipe/types";
import type { SpecBlueprint } from "../blueprint-spec/types";
import { DEFAULT_LINK_POLICY, analyzePageInModel, buildModel, type ArchitecturePack, type PageRow } from "./index";

// Montagem do modelo a partir de linhas de página SINTÉTICAS (formas válidas, nunca exibidas como dado real): integra adaptação do pack, grafo, intenção e gate sem banco.
const NOW = new Date("2026-10-14T12:00:00Z");
const bp = (over: Partial<SpecBlueprint> = {}) => ({ data_contract: [{ module_id: "identificacao", fields: ["x"], min_items: 1, status: "RICH", on_missing: "remove" }], indexability_policy: "index", ...over }) as unknown as SpecBlueprint;
const recipe = (id: string, links: string[], over: Partial<PageRecipe> = {}): PageRecipe => ({ pageId: id, topicId: "t".repeat(64), tenantId: "t1", family: "04-cidade", templateId: "city-overview", templateGap: false, specBlueprintId: "b", specBlueprintVersion: 1, url: `/p/${id}`, canonical: `/p/${id}`, robots: "index", title: `Cidade ${id}`, h1: `Cidade ${id}`, metaDescription: "m", entities: [{ key: `k-${id}`, name: `Cidade ${id}`, uf: "SP" }],
  modules: [{ moduleId: "identificacao", status: "RICH", minItems: 1, onMissing: "remove", render: "RENDERED" }], facts: [], blocks: [{ blockId: "a", moduleId: "identificacao", kind: "paragraph", text: `Texto único da cidade ${id} com descrição detalhada suficiente para sintetizar o lugar com mais de cem caracteres de conteúdo real.`, refs: [], source: "template" }],
  jsonLd: [{ "@context": "https://schema.org", "@type": "City", name: `Cidade ${id}` }] , links: links.map((l) => ({ path: l, text: `Ir para ${l}` })), travelTime: null, referenceTime: NOW.toISOString(), ...over });
const row = (id: string, links: string[], over: Partial<PageRow> = {}, rOver: Partial<PageRecipe> = {}): PageRow => ({ opportunity_id: id, family: "04-cidade", dimensions: { city: id }, primary_entity_id: `ent-${id}`, recipe_id: `rec-${id}`, recipe_version: 1, recipe: recipe(id, links, rOver), blueprint: bp(), bp_status: "COMPLETE", bp_template: "city-overview", bp_gap: false, qa_outcome: "QA_PASSED", qa_blocking: [], qa_results: {}, approval: "APPROVED", ...over });
const pack: ArchitecturePack = {
  domain: "test", locale: "pt-BR", market: "BR", archetypeOfFamily: (f) => (f === "04-cidade" ? "T03" : null),
  adapt: ({ recipe: r }) => ({ data: { identity: { name: r.h1, slug: r.url!.split("/").pop()! }, location: { adminHierarchy: [{ level: "city", name: r.h1 }], coordinates: { lat: 1, lng: 2 } }, overviewSynthesis: r.blocks.map((b) => b.text).join(" "), amenities: { education: [{ name: "a" }, { name: "b" }, { name: "c" }], health: [{ name: "d" }, { name: "e" }] }, mobility: { indices: [], stations: [{ name: "Estação", kind: "metro" }] }, faqs: [{ question: "Pergunta 1?", answer: "Resposta número 1." }, { question: "Pergunta 2?", answer: "Resposta número 2." }] }, provenance: [], primaryIntent: "guia da cidade", intentEvidence: ["teste"], hierarchy: [] }),
  clusterOf: () => ({ key: "T03|test|c1", name: "Cluster 1", scope: {} }),
};
const deps = { pack, templates: [{ key: "city-overview" }], now: () => NOW };
const IDS = ["a", "b", "c", "d"];
const ring = () => IDS.map((id) => row(id, IDS.filter((x) => x !== id).map((x) => `/p/${x}`)));
const gateOf = (m: ReturnType<typeof buildModel>, id: string) => analyzePageInModel(m, id, deps, NOW);

describe("modelo de arquitetura (sintético)", () => {
  const model = (rows: PageRow[], policy = DEFAULT_LINK_POLICY) => buildModel(rows, deps, policy, 1, {}, 1);
  it("4 páginas que linkam entre si dão 3 inlinks contextuais válidos cada: indexação liberada quando todo o resto está certo", () => {
    const m = model(ring()); expect(m.graph.stats).toMatchObject({ nodes: 4, edges: 12, valid: 12, invalid: 0 });
    const a = gateOf(m, "a"); expect(a.inlinks).toMatchObject({ valid: 3, required: 3, passed: true }); expect(a.gate.eligibility).toEqual({ approval: true, publication: true, indexing: true }); expect(a.gate.qualityScore).toBe(1); expect(a.generatedJsonLd.map((n) => n["@type"])).toEqual(["AdministrativeArea", "Place"]);
  });
  it("com mínimo 4 (política do tenant) as mesmas páginas ficam retidas por INSUFFICIENT_CONTEXTUAL_INLINKS e a causa vira ação recomendada", () => {
    const m = model(ring(), { ...DEFAULT_LINK_POLICY, minInlinks: 4, version: "2" }); const a = gateOf(m, "a"); expect(a.gate.eligibility).toEqual({ approval: true, publication: true, indexing: false }); expect(a.gate.blockedBy.indexing).toEqual(["INSUFFICIENT_CONTEXTUAL_INLINKS"]); expect(a.gate.linkProblems[0]).toMatchObject({ detail: { required: 4, valid: 3, missing: 1 } }); expect(a.gate.nextActions.join(" ")).toMatch(/links contextuais/);
  });
  it("páginas sem links entre si, com hub inexistente: arestas inválidas por destino ausente; a causa aparece no resultado", () => {
    const m = model(IDS.map((id) => row(id, ["/hub", "/hub/sp"]))); expect(m.graph.stats.byReason).toEqual({ DESTINATION_MISSING: 8 }); const a = gateOf(m, "a"); expect(a.inlinks).toMatchObject({ valid: 0, passed: false }); expect(a.outlinks.invalid).toHaveLength(2); expect(a.gate.eligibility.indexing).toBe(false);
  });
  it("mesma entidade e mesma intenção primária em duas páginas é conflito: bloqueia aprovação, publicação e indexação das duas, com a ação recomendada", () => {
    const m = model([row("a", ["/p/b"]), row("b", ["/p/a"], { primary_entity_id: "ent-a" })]); const c = m.conflicts.find((x) => x.kind === "DUPLICATE_PRIMARY_INTENT")!; expect(c).toMatchObject({ severity: "conflict", recommendedAction: "change_intent" });
    for (const id of ["a", "b"]) { const r = gateOf(m, id).gate; expect(r.eligibility).toEqual({ approval: false, publication: false, indexing: false }); expect(r.failedRules).toContain("intent.conflict"); expect(r.intentConflicts[0]!.id).toBe(c.id); }
  });
  it("URL duplicada e canonical conflitante aparecem como conflitos e bloqueiam", () => {
    const m = model([row("a", [], {}, { url: "/p/x", canonical: "/p/x" }), row("b", [], {}, { url: "/p/x", canonical: "/p/x" })]); expect(m.conflicts.map((c) => c.kind)).toContain("SAME_URL");
    const n = model([row("a", [], {}, { canonical: "/p/b" }), row("b", [])]); expect(gateOf(n, "a").gate.failedRules).toContain("canonical.valid");
  });
  it("famílias sem archetype e páginas sem blueprint ficam FORA do modelo, com o motivo (nada é inventado)", () => {
    const m = model([row("a", []), row("x", [], { family: "99-outra" }), row("y", [], { blueprint: null })]); expect([...m.pages.keys()]).toEqual(["a"]); expect(m.skipped.map((s) => s.reason)).toEqual([expect.stringContaining("não mapeia para um archetype"), "sem blueprint da especificação"]);
  });
  it("dado que não passa no schema do archetype bloqueia a aprovação; sem coordenadas só a indexação", () => {
    const bad = { ...pack, adapt: (i: Parameters<ArchitecturePack["adapt"]>[0]) => { const r = pack.adapt(i); return "error" in r ? r : { ...r, data: { ...r.data, overviewSynthesis: "curto" } }; } };
    const m = buildModel(ring(), { ...deps, pack: bad }, DEFAULT_LINK_POLICY, 1, {}, 1); expect(analyzePageInModel(m, "a", { ...deps, pack: bad }, NOW).gate.eligibility.approval).toBe(false);
    const noCoord = { ...pack, adapt: (i: Parameters<ArchitecturePack["adapt"]>[0]) => { const r = pack.adapt(i); return "error" in r ? r : { ...r, data: { ...r.data, location: { adminHierarchy: [{ level: "city", name: "x" }] } } }; } };
    const m2 = buildModel(ring(), { ...deps, pack: noCoord }, DEFAULT_LINK_POLICY, 1, {}, 1); expect(analyzePageInModel(m2, "a", { ...deps, pack: noCoord }, NOW).gate.eligibility).toEqual({ approval: true, publication: true, indexing: false });
  });
  it("módulo fora do contrato do blueprint, template em lacuna e política noindex aparecem como regras reprovadas", () => {
    const extra = row("a", ["/p/b"], {}, { modules: [{ moduleId: "identificacao", status: "RICH", minItems: 1, onMissing: "remove", render: "RENDERED" }, { moduleId: "inventado", status: "RICH", minItems: 1, onMissing: "remove", render: "RENDERED" }] });
    expect(gateOf(model([extra, row("b", ["/p/a"])]), "a").gate.failedRules).toContain("template.ready");
    expect(gateOf(model([row("a", [], { bp_gap: true })]), "a").gate.failedRules).toContain("template.ready");
    expect(gateOf(model([row("a", [], { blueprint: bp({ indexability_policy: "noindex" }) })]), "a").gate.blockedBy.indexing).toContain("policy.index");
  });
  it("a entrada do gate é determinística: o hash só muda quando algo relevante muda", () => {
    const h = (rows: PageRow[], pv = 1) => analyzePageInModel(buildModel(rows, deps, DEFAULT_LINK_POLICY, pv, {}, 1), "a", deps, NOW).gateInputHash;
    expect(h(ring())).toBe(h(ring())); expect(h(ring(), 2)).not.toBe(h(ring())); expect(h(ring().map((r) => (r.opportunity_id === "a" ? { ...r, approval: null } : r)))).not.toBe(h(ring()));
  });
});
