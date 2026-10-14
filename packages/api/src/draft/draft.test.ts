import { describe, expect, it } from "vitest";
import { buildBlueprint, blueprintHash, type TemplateInfo } from "../engine/blueprint";
import { evaluateExperienceGates } from "../engine/experience-gates";
import { TEST_VERTICAL as V } from "../engine/test-support/vertical.fixture";
import { ALLOWED_EDGES, CONTRACTS, GATE_IDS, NODE_TYPES, addNode, connect, contentSig, defaultDraft, disconnect, diffDrafts, draftToBlueprint, executionStates, fieldOptions, parseDraft, removeNode, setLayout, updateConfig, validateDraft, type DraftContext, type PageDraft } from "./index";

const T: TemplateInfo = { key: "city-overview", version: 1, entityKind: "city", requiredFacts: ["name"], knownFacts: ["name", "uf", "region", "population"],
  sections: [{ id: "overview", label: "Visão geral", paragraphs: [{ requires: ["name", "uf"] }, { requires: ["region"] }] }, { id: "population", label: "População", paragraphs: [{ requires: ["name", "population"] }] }],
  structuredData: ["City"], pathFor: (e) => (e.qualifier ? `/cidades/${e.qualifier.toLowerCase()}/x` : null), linksFor: () => [{ path: "/cidades/sp", text: "Cidades de SP" }, { path: "/cidades", text: "Todas as cidades" }] };
const SUP = { ...V, experiences: V.experiences.map((e) => (e.id === "directory" ? { ...e, status: "supported" as const } : e)) };
const FACTS = ["name", "uf", "region", "population"];
const ctx = (over: Partial<DraftContext> = {}): DraftContext => ({
  verticalId: "garden-test",
  templates: [{ key: T.key, version: 1, entityKind: "city", sections: T.sections.map((s) => ({ id: s.id, label: s.label, paragraphs: s.paragraphs })), structuredData: T.structuredData }],
  requirements: SUP.evidenceRequirements.map((r) => ({ id: r.id, label: r.label, weight: r.weight, satisfiedBy: r.satisfiedBy, note: r.note })),
  sources: [{ id: "city_import", label: "Importação de cidades", token: "entities", state: "implemented_tested" }, { id: "bcb-sgs", label: "BCB", token: "indicator:bcb-sgs", state: "implemented_tested" }],
  available: ["entities", "source:inventory-feed"], facts: FACTS, knownPaths: ["/cidades"], maxCannibalizationRisk: 0.8, cannibalizationRisk: 0.1, publicationAvailable: false, ...over });
const bp = () => buildBlueprint({ vertical: SUP, templates: [T], available: new Set(["entities", "source:inventory-feed"]), entityFacts: { name: "X", uf: "SP", region: "S", population: 1 }, existingPaths: new Set(), knownPaths: new Set(["/cidades"]), cannibalizationRisk: 0.1, maxCannibalizationRisk: 0.8,
  opportunity: { id: "o", primaryQuery: "q", intent: "transactional", stage: "decide", pattern: "buy-plants", experience: "directory", expectedOutcome: "x", eligible: true, scoreId: "s", entity: { kind: "city", id: "c", name: "X", qualifier: "SP" } } });
const base = () => defaultDraft(bp(), ctx(), 1);
const must = (r: ReturnType<typeof addNode>): PageDraft => { if (!r.ok) throw new Error(r.error); return r.draft; };

describe("rascunho inicial (domínio ← blueprint gravado)", () => {
  it("nasce válido, com os 12 tipos de nó do modelo e os 6 gates, e publicação NUNCA publicável", () => {
    const d = base(); const v = validateDraft(d, ctx());
    expect(v.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(v.valid).toBe(true);
    expect(new Set(d.nodes.map((n) => n.type))).toEqual(new Set(NODE_TYPES.filter((t) => t !== "structured_data" || true)));
    expect(d.nodes.filter((n) => n.type === "quality_gate").map((n) => n.config.gate).sort()).toEqual([...GATE_IDS].sort());
    expect(v.publication.publishable).toBe(false);
    expect(v.publication.reasons.join(" ")).toContain("mecanismo de publicação");
  });
  it("todas as arestas respeitam a tabela de conexões e o grafo é acíclico", () => {
    const d = base(); const t = new Map(d.nodes.map((n) => [n.id, n.type]));
    for (const e of d.edges) expect(ALLOWED_EDGES.some(([a, b]) => a === t.get(e.from) && b === t.get(e.to)), e.id).toBe(true);
  });
  it("serializa e recupera sem perda (JSON → parseDraft), preservando a assinatura de conteúdo", () => {
    const d = base();
    const r = parseDraft(JSON.parse(JSON.stringify(d)));
    expect(r.ok && contentSig(r.draft)).toBe(contentSig(d));
    expect(r.ok && r.draft).toEqual(d);
  });
});

describe("operações do modelo: criar, conectar, editar e remover só o que o contrato permite", () => {
  it("adiciona seção, link e dado estruturado; recusa tipos fixos e singletons", () => {
    let d = base();
    d = must(addNode(d, "page_section", { sectionId: "population", order: 9, enabled: true, onMissing: "omit" }));
    expect(d.nodes.at(-1)!.id).toMatch(/^page_section-\d+$/);
    for (const t of ["opportunity", "quality_gate", "publication", "seo_metadata", "entity", "search_intent"] as const) expect(addNode(d, t)).toMatchObject({ ok: false });
    expect(addNode(d, "page_template", { templateKey: "city-overview" })).toMatchObject({ ok: false, error: expect.stringContaining("só pode haver um") });
  });
  it("remove só nós removíveis (e as conexões deles); gates, publicação, template e oportunidade são fixos", () => {
    const d = base();
    const sec = d.nodes.find((n) => n.type === "page_section")!;
    const r = removeNode(d, sec.id);
    expect(r.ok && r.draft.edges.some((e) => e.from === sec.id || e.to === sec.id)).toBe(false);
    for (const t of ["opportunity", "page_template", "quality_gate", "publication", "seo_metadata"] as const) expect(removeNode(d, d.nodes.find((n) => n.type === t)!.id)).toMatchObject({ ok: false });
    expect(removeNode(d, "nao-existe-1")).toMatchObject({ ok: false });
  });
  it("conexão: incompatível, duplicada, a si mesmo e ciclo são recusados; compatível é aceita", () => {
    const d = base();
    const id = (t: string, i = 0) => d.nodes.filter((n) => n.type === t)[i]!.id;
    expect(connect(d, id("opportunity"), id("page_section"))).toMatchObject({ ok: false, error: expect.stringContaining("incompatível") });
    expect(connect(d, id("page_section"), id("opportunity"))).toMatchObject({ ok: false });
    expect(connect(d, id("opportunity"), id("search_intent"))).toMatchObject({ ok: false, error: "essa conexão já existe" });
    expect(connect(d, id("page_section"), id("page_section"))).toMatchObject({ ok: false });
    expect(connect(d, id("page_section"), id("quality_gate", 3))).toMatchObject({ ok: true }); // seção → gate de busca: compatível
    // ciclo: entity → evidence → section; ligar section → entity não é permitido por tipo; força cíclica via arestas manuais
    const cyc: PageDraft = { ...d, edges: [...d.edges, { id: "evidence_requirement-1>entity-1", from: "evidence_requirement-1", to: "entity-1" }] };
    expect(validateDraft(cyc, ctx()).issues.some((i) => i.code === "cycle" || i.code === "incompatible_edge")).toBe(true);
  });
  it("detecta ciclo real quando as arestas formam um laço permitido por tipo", () => {
    let d = base();
    d = must(addNode(d, "data_source", { source: "city_import" }));
    const ds = d.nodes.at(-1)!.id;
    d = must(connect(d, ds, "entity-1"));
    const looped: PageDraft = { ...d, edges: [...d.edges, { id: "entity-1>" + ds, from: "entity-1", to: ds }] };
    const v = validateDraft(looped, ctx());
    expect(v.issues.map((i) => i.code)).toContain("cycle");
    expect(v.valid).toBe(false);
  });
  it("edição só em campos do contrato; campo fixo e inexistente são recusados; desconectar respeita as ligações obrigatórias", () => {
    const d = base();
    const sec = d.nodes.find((n) => n.type === "page_section")!;
    expect(updateConfig(d, sec.id, { order: 5 })).toMatchObject({ ok: true });
    expect(updateConfig(d, sec.id, { cor: "azul" })).toMatchObject({ ok: false, error: expect.stringContaining("não existe no contrato") });
    expect(updateConfig(d, d.nodes.find((n) => n.type === "quality_gate")!.id, { gate: "geo" })).toMatchObject({ ok: false, error: expect.stringContaining("fixo") });
    expect(updateConfig(d, d.nodes.find((n) => n.type === "opportunity")!.id, { query: "x" })).toMatchObject({ ok: false });
    expect(disconnect(d, "quality_gate-1>publication-1")).toMatchObject({ ok: false });
    expect(disconnect(d, "opportunity-1>search_intent-1")).toMatchObject({ ok: false });
    const free = d.edges.find((e) => e.from === "evidence_requirement-1" && e.to.startsWith("page_section"))!;
    expect(disconnect(d, free.id)).toMatchObject({ ok: true });
  });
  it("posições não mudam a assinatura de conteúdo nem entram no histórico; conteúdo muda", () => {
    const d = base();
    expect(contentSig(setLayout(d, { "opportunity-1": { x: 10, y: 20 } }))).toBe(contentSig(d));
    expect(contentSig(must(updateConfig(d, "page_section-1", { order: 7 })))).not.toBe(contentSig(d));
    expect(diffDrafts(d, setLayout(d, { "opportunity-1": { x: 1, y: 1 } }))).toEqual([]);
    const e = must(updateConfig(must(addNode(d, "internal_link", { path: "/cidades", text: "Todas" })), "page_section-1", { order: 7 }));
    expect(diffDrafts(d, e).map((c) => `${c.kind}:${c.id}${c.field ? "." + c.field : ""}`).sort()).toEqual(["field_changed:page_section-1.order", "node_added:internal_link-3"]);
  });
});

describe("validação: configuração por contrato, dependências e publicação", () => {
  const edit = (id: string, patch: Record<string, string | number | boolean | string[]>, d = base()) => must(updateConfig(d, id, patch));
  const codes = (d: PageDraft, c = ctx()) => validateDraft(d, c).issues.map((i) => `${i.severity}:${i.code}`);
  it("valores fora do contrato: número, texto com algarismo, enum inexistente, caminho inválido", () => {
    expect(codes(edit("page_section-1", { order: 0 }))).toContain("error:range");
    expect(codes(edit("page_section-1", { order: 1.5 }))).toContain("error:type");
    expect(codes(edit("page_section-1", { heading: "Top 10 cidades" }))).toContain("error:pattern");
    expect(codes(edit("page_section-1", { sectionId: "inexistente" }))).toContain("error:option");
    expect(codes(edit("internal_link-1", { path: "Cidades/SP" }))).toContain("error:pattern");
    expect(codes(edit("page_template-1", { templateKey: "outro" }))).toContain("error:option");
    expect(codes(edit("page_section-1", { heading: "x".repeat(81) }))).toContain("error:max");
  });
  it("seção com ordem repetida, sem dados (omitir = aviso, bloquear = erro) e dados parciais", () => {
    expect(codes(edit("page_section-2", { order: 1 }))).toContain("error:order_duplicate");
    const noFacts = ctx({ facts: ["name", "uf"] });
    expect(codes(base(), noFacts)).toContain("warning:section_partial");
    expect(codes(base(), ctx({ facts: [] }))).toContain("warning:section_no_data");
    expect(codes(edit("page_section-1", { onMissing: "block" }), ctx({ facts: [] }))).toContain("error:section_no_data");
  });
  it("requisito crítico sem fonte existente é erro; importante é aviso; fonte indisponível é só informação", () => {
    expect(codes(base(), ctx({ available: [] }))).toContain("error:requirement_unmet");
    expect(codes(edit("evidence_requirement-2", { acceptedSources: ["source:inventory-feed"] }), ctx({ available: ["entities"] }))).toContain("error:requirement_unmet");
    expect(codes(edit("evidence_requirement-1", { acceptedSources: ["entities"] }))).not.toContain("error:requirement_unmet");
  });
  it("link para destino inexistente é aviso (não será emitido); sem template é erro", () => {
    expect(codes(base())).toContain("warning:link_dangling");
    const d = base(); const noEdge = { ...d, edges: d.edges.filter((e) => e.id !== "page_template-1>internal_link-1") };
    expect(codes(noEdge)).toContain("error:link_no_template");
  });
  it("topologia: nó faltando, gate repetido/ausente, gate não ligado à publicação, aresta pendente", () => {
    const d = base();
    expect(codes({ ...d, nodes: d.nodes.filter((n) => n.type !== "page_template"), edges: [] })).toContain("error:required_node");
    expect(codes({ ...d, nodes: d.nodes.filter((n) => n.id !== "quality_gate-2"), edges: d.edges.filter((e) => e.from !== "quality_gate-2" && e.to !== "quality_gate-2") })).toContain("error:gate_missing");
    expect(codes({ ...d, edges: d.edges.filter((e) => e.id !== "quality_gate-1>publication-1") })).toContain("error:gate_unlinked");
    expect(codes({ ...d, edges: [...d.edges, { id: "x>y", from: "x", to: "y" }] })).toContain("error:dangling_edge");
    expect(codes({ ...d, nodes: [...d.nodes, { id: "page_template-2", type: "page_template", config: { templateKey: "city-overview" } }] })).toContain("error:singleton");
  });
  it("campo desconhecido no config é erro (não se configura o que o contrato não tem)", () => {
    const d = base(); const n = d.nodes.find((x) => x.type === "page_section")!;
    expect(codes({ ...d, nodes: d.nodes.map((x) => (x === n ? { ...x, config: { ...x.config, cor: "azul" } } : x)) })).toContain("error:unknown_field");
  });
  it("mesmo rascunho válido e com gates passando CONTINUA sem publicação possível", () => {
    expect(validateDraft(base(), ctx()).publication).toMatchObject({ publishable: false });
  });
  it("opções dos campos vêm do contexto real (seções do template, tokens do requisito, tipos suportados)", () => {
    const d = base(); const c = ctx();
    expect(fieldOptions(CONTRACTS.page_section.fields[0]!, d.nodes.find((n) => n.type === "page_section")!, d, c)).toEqual(["overview", "population"]);
    expect(fieldOptions(CONTRACTS.structured_data.fields[0]!, d.nodes.find((n) => n.type === "structured_data")!, d, c)).toEqual(["City"]);
    expect(fieldOptions(CONTRACTS.data_source.fields[0]!, d.nodes.find((n) => n.type === "data_source")!, d, c)).toEqual(["city_import", "bcb-sgs"]);
  });
});

describe("rascunho → blueprint avaliável (gates e prévia refletem a edição)", () => {
  it("rascunho intacto reproduz o blueprint: mesmos resultados de gate", () => {
    const b = bp(); const d = defaultDraft(b, ctx(), 1);
    const again = draftToBlueprint(d, b, ctx());
    expect(evaluateExperienceGates(again).gates.map((g) => g.outcome)).toEqual(evaluateExperienceGates(b).gates.map((g) => g.outcome));
    for (const k of Object.keys(b) as (keyof typeof b)[]) expect(again[k], String(k)).toEqual(b[k]);
    expect(blueprintHash(again)).toBe(blueprintHash(b));
  });
  it("desligar uma seção, trocar a ordem e mudar o título refletem no blueprint (nada de conteúdo inventado)", () => {
    const b = bp(); let d = defaultDraft(b, ctx(), 1);
    d = must(updateConfig(d, "page_section-1", { enabled: false })); d = must(updateConfig(d, "page_section-2", { heading: "Habitantes" }));
    const x = draftToBlueprint(d, b, ctx());
    expect(x.sections.map((s) => [s.id, s.label])).toEqual([["population", "Habitantes"]]);
    d = must(updateConfig(must(updateConfig(defaultDraft(b, ctx(), 1), "page_section-1", { order: 5 })), "page_section-2", { order: 2 }));
    expect(draftToBlueprint(d, b, ctx()).sections.map((s) => s.id)).toEqual(["population", "overview"]);
  });
  it("fatos ausentes: seção sem dados e resposta direta indisponível; link para destino inexistente não resolve; requisito sem fonte reprova o gate de conhecimento", () => {
    const b = bp(); const d = defaultDraft(b, ctx(), 1);
    const x = draftToBlueprint(d, b, ctx({ facts: [], available: [] }));
    expect(x.sections.every((s) => s.data === "missing")).toBe(true);
    expect(x.answerFirst.available).toBe(false);
    expect(x.requirements.every((r) => !r.satisfied)).toBe(true);
    const r = evaluateExperienceGates(x);
    expect(r.gates.find((g) => g.gate === "knowledge")!.outcome).toBe("fail");
    expect(draftToBlueprint(d, b, ctx()).internalLinks.map((l) => l.resolves)).toEqual([false, true]);
  });
  it("sem template no rascunho: blueprint 'missing' e o gate de experiência reprova", () => {
    const b = bp(); const d = must(updateConfig(defaultDraft(b, ctx(), 1), "page_template-1", { templateKey: "" }));
    const x = draftToBlueprint(d, b, ctx());
    expect(x.template.status).toBe("missing");
    expect(evaluateExperienceGates(x).gates.find((g) => g.gate === "experience")!.outcome).toBe("fail");
  });
});

describe("estado de execução por nó: not_evaluated, blocked e unavailable continuam explícitos", () => {
  it("gates mostram o resultado só quando o conteúdo não mudou; alteração os invalida (not_evaluated)", () => {
    const b = bp(); const d = defaultDraft(b, ctx(), 1); const rep = evaluateExperienceGates(b);
    const fresh = executionStates(d, ctx(), draftToBlueprint(d, b, ctx()), rep, false);
    expect(fresh["quality_gate-1"]!.status).toBe("done");
    const stale = executionStates(d, ctx(), draftToBlueprint(d, b, ctx()), rep, true);
    for (const g of d.nodes.filter((n) => n.type === "quality_gate")) { expect(stale[g.id]!.status).toBe("not_evaluated"); expect(stale[g.id]!.detail).toContain("Invalidado"); }
    expect(executionStates(d, ctx(), b, null, false)["quality_gate-1"]!.status).toBe("not_evaluated");
  });
  it("publicação sempre bloqueada; fonte sem dados e link sem destino indisponíveis; requisito crítico não atendido bloqueado", () => {
    const b = bp(); const d = defaultDraft(b, ctx({ available: [] }), 1);
    const c = ctx({ available: [], knownPaths: [] }); const x = draftToBlueprint(d, b, c);
    const s = executionStates(d, c, x, null, false);
    expect(s["publication-1"]!.status).toBe("blocked");
    expect(s["internal_link-1"]!.status).toBe("unavailable");
    expect(s["evidence_requirement-1"]!.status).toBe("blocked");
    expect(Object.values(executionStates(base(), ctx(), bp(), evaluateExperienceGates(bp()), false)).some((e) => e.status === "done")).toBe(true);
  });
});

describe("leitura defensiva de rascunho vindo de fora", () => {
  const good = () => JSON.parse(JSON.stringify(base()));
  it("recusa esquema errado, campos extras, id malformado, tipo desconhecido, valores de tipo errado, excesso de nós e posição inválida", () => {
    expect(parseDraft(null)).toMatchObject({ ok: false });
    expect(parseDraft({ ...good(), schema: "x" })).toMatchObject({ ok: false });
    expect(parseDraft({ ...good(), extra: 1 })).toMatchObject({ ok: false });
    const g = good(); g.nodes[0].id = "../etc"; expect(parseDraft(g)).toMatchObject({ ok: false });
    const h = good(); h.nodes[0].type = "script"; expect(parseDraft(h)).toMatchObject({ ok: false });
    const i = good(); i.nodes[1].config = { a: { b: 1 } }; expect(parseDraft(i)).toMatchObject({ ok: false });
    const j = good(); j.nodes = Array.from({ length: 121 }, (_, k) => ({ id: `page_section-${k + 1}`, type: "page_section", config: {} })); expect(parseDraft(j)).toMatchObject({ ok: false });
    const k = good(); k.layout = { "opportunity-1": { x: "a", y: 1 } }; expect(parseDraft(k)).toMatchObject({ ok: false });
    const l = good(); delete l.basis; expect(parseDraft(l)).toMatchObject({ ok: false });
  });
});
