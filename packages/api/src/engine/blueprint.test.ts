import { describe, expect, it } from "vitest";
import { blueprintHash, buildBlueprint, type BlueprintInput, type TemplateInfo } from "./blueprint";
import { GATE_IDS, evaluateExperienceGates, gateOutcome, type GateId } from "./experience-gates";
import { TEST_VERTICAL as V } from "./test-support/vertical.fixture";

// Template e entidade FICTÍCIOS de teste (a vertical de teste é uma loja de plantas); o comportamento do motor é o que se prova aqui.
const TEMPLATE: TemplateInfo = {
  key: "city-overview", version: 1, entityKind: "city", requiredFacts: ["name"], knownFacts: ["name", "uf", "region", "population"],
  sections: [
    { id: "overview", label: "Visão geral", paragraphs: [{ requires: ["name", "uf"] }, { requires: ["region"] }] },
    { id: "population", label: "População", paragraphs: [{ requires: ["name", "population"] }] },
  ],
  structuredData: ["City"],
  linksFor: (e) => (e.qualifier ? [{ path: `/cidades/${e.qualifier.toLowerCase()}`, text: `Cidades de ${e.qualifier}` }, { path: "/cidades", text: "Todas as cidades" }] : []),
  pathFor: (e) => (e.qualifier ? `/cidades/${e.qualifier.toLowerCase()}/${e.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : null),
};
// Na vertical de teste "directory" é planejada; aqui a tratamos como suportada para provar o caminho completo (o caso planejado tem teste próprio).
const SUPPORTED = { ...V, experiences: V.experiences.map((e) => (e.id === "directory" ? { ...e, status: "supported" as const } : e)) };
const ENTITY = { kind: "city", id: "c1", name: "Campinas", qualifier: "SP" };
const FACTS = { name: "Campinas", uf: "SP", region: "Sudeste", population: 1139047 };
const input = (over: Partial<BlueprintInput> = {}, opp: Partial<BlueprintInput["opportunity"]> = {}): BlueprintInput => ({
  vertical: SUPPORTED,
  opportunity: { id: "o1", primaryQuery: "loja de plantas em Campinas", intent: "transactional", stage: "decide", pattern: "buy-plants", experience: "directory", expectedOutcome: "visitas à loja", eligible: true, scoreId: "s1", entity: ENTITY, ...opp },
  templates: [TEMPLATE], available: new Set(["entities", "source:inventory-feed"]), entityFacts: FACTS, existingPaths: new Set(), knownPaths: new Set(), cannibalizationRisk: 0.1, maxCannibalizationRisk: 0.8, ...over,
});
const outcomes = (i: BlueprintInput) => Object.fromEntries(evaluateExperienceGates(buildBlueprint(i)).gates.map((g) => [g.gate, g.outcome])) as Record<GateId, string>;

describe("blueprint: o plano nasce só de dados persistidos e é determinístico", () => {
  it("com template, dados e requisitos: seção a seção, caminho proposto, dados estruturados e política de indexação", () => {
    const b = buildBlueprint(input());
    expect(b.template).toMatchObject({ status: "selected", key: "city-overview", version: 1 });
    expect(b.sections.map((s) => [s.id, s.data])).toEqual([["overview", "available"], ["population", "available"]]);
    expect(b.requirements.map((r) => [r.id, r.satisfied])).toEqual([["entities", true], ["inventory", true]]);
    expect(b.path).toEqual({ proposed: "/cidades/sp/campinas", conflict: false });
    expect(b.structuredData).toEqual(["City"]);
    expect(b.indexing).toBe("noindex_until_published");
    expect(b.answerFirst).toMatchObject({ available: true, sectionId: "overview" });
    expect(b.limitations.join(" ")).toContain("SERP não foi analisada");
  });
  it("fato ausente: a seção fica parcial ou sem dados, listando exatamente o que falta (nunca preenche)", () => {
    const b = buildBlueprint(input({ entityFacts: { name: "Campinas", uf: "SP", region: null, population: null } }));
    expect(b.sections.map((s) => [s.id, s.data, s.missingFacts])).toEqual([["overview", "partial", ["region"]], ["population", "missing", ["population"]]]);
  });
  it("experiência sem template no registro: 'missing', com o motivo; nenhuma seção inventada", () => {
    const b = buildBlueprint(input({}, { pattern: "compare-stores", experience: "ranking" }));
    expect(b.template).toMatchObject({ status: "missing", key: null });
    expect(b.template.reason).toContain("não tem template no registro");
    expect(b.sections).toEqual([]);
    expect(b.path.proposed).toBeNull();
    expect(b.answerFirst.available).toBe(false);
  });
  it("template existe mas a oportunidade não tem entidade do tipo exigido: 'entity_mismatch'", () => {
    const b = buildBlueprint(input({ entityFacts: null }, { entity: null }));
    expect(b.template).toMatchObject({ status: "entity_mismatch", key: null });
    expect(b.template.reason).toContain("não tem entidade");
  });
  it("mesmo insumo, mesmo hash; qualquer mudança relevante muda o hash; a ordem das chaves não importa", () => {
    const h = blueprintHash(buildBlueprint(input()));
    expect(blueprintHash(buildBlueprint(input()))).toBe(h);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    for (const other of [input({}, { eligible: false }), input({}, { scoreId: "s2" }), input({ entityFacts: { ...FACTS, region: null } }), input({ existingPaths: new Set(["/cidades/sp/campinas"]) }), input({ cannibalizationRisk: 0.9 })]) expect(blueprintHash(buildBlueprint(other))).not.toBe(h);
    const b = buildBlueprint(input());
    expect(blueprintHash(JSON.parse(JSON.stringify(b)) as typeof b)).toBe(h);
    expect(JSON.stringify(b)).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // nenhum horário no conteúdo
  });
  it("padrão ou experiência desconhecidos na vertical: erro (nunca um blueprint vazio)", () => {
    expect(() => buildBlueprint(input({}, { pattern: "nao-existe" }))).toThrow(/desconhecidos/);
    expect(() => buildBlueprint(input({}, { experience: "nao-existe" }))).toThrow(/desconhecidos/);
  });
});

describe("gates de experiência: seis, independentes, sem nota composta", () => {
  it("cenário completo: os seis gates existem; nada reprova; o que não tem fonte aparece como 'não avaliado'", () => {
    const r = evaluateExperienceGates(buildBlueprint(input()));
    expect(r.gates.map((g) => g.gate)).toEqual([...GATE_IDS]);
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
    const all = r.gates.flatMap((g) => g.checks);
    for (const code of ["serp_analysis", "search_demand", "ai_citation_monitoring", "indexability", "intent_format"]) expect(all.find((c) => c.code === code)!.outcome, code).toBe("not_evaluated");
    expect(JSON.stringify(r)).not.toMatch(/"(score|total|overall)"/); // sem nota composta
  });
  const cases: [string, BlueprintInput, GateId, string | null][] = [
    ["oportunidade não elegível", input({}, { eligible: false }), "business", "not_eligible"],
    ["sem score", input({}, { eligible: null }), "business", "not_eligible"],
    ["requisito crítico ausente", input({ available: new Set(["entities"]) }), "knowledge", "evidence:inventory"],
    ["sem template", input({}, { pattern: "compare-stores", experience: "ranking" }), "experience", "template:ranking"],
    ["canibalização acima do máximo", input({ cannibalizationRisk: 0.85 }), "search", "cannibalization"],
    ["resposta direta sem fatos", input({ entityFacts: { name: "Campinas", uf: null, region: null, population: null } }), "geo", "facts:city"],
    ["caminho já usado por outra entidade", input({ existingPaths: new Set(["/cidades/sp/campinas"]) }), "technical", "path_conflict"],
  ];
  for (const [nome, i, gate, blocker] of cases) {
    it(`${nome}: reprova o gate '${gate}' com o bloqueio '${blocker}' e não impede a leitura dos demais`, () => {
      const r = evaluateExperienceGates(buildBlueprint(i));
      expect(r.gates.find((g) => g.gate === gate)!.outcome).toBe("fail");
      expect(r.blockers.map((b) => b.key)).toContain(blocker);
      expect(r.ready).toBe(false);
      expect(r.gates).toHaveLength(6);
    });
  }
  it("independência: corrigir só um problema muda só o gate dele", () => {
    const base = outcomes(input());
    const broken = outcomes(input({ cannibalizationRisk: 0.9 }));
    for (const g of GATE_IDS) expect(broken[g], g).toBe(g === "search" ? "fail" : base[g]);
  });
  it("experiência planejada reprova o negócio mesmo com template: não se promete o que a plataforma não entrega", () => {
    const r = evaluateExperienceGates(buildBlueprint(input({ vertical: V })));
    expect(r.blockers.map((b) => b.key)).toContain("experience:directory");
  });
  it("risco não medido é aviso (não aprova nem reprova); requisito importante ausente é aviso", () => {
    const r = evaluateExperienceGates(buildBlueprint(input({ cannibalizationRisk: null })));
    expect(r.gates.find((g) => g.gate === "search")!.checks.find((c) => c.code === "cannibalization")!.outcome).toBe("warning");
    expect(r.ready).toBe(true);
  });
  it("seção parcial é aviso; sem nenhuma seção com dados é reprovação", () => {
    expect(outcomes(input({ entityFacts: { name: "Campinas", uf: "SP", region: null, population: null } })).knowledge).toBe("warning");
    expect(outcomes(input({ entityFacts: { name: null, uf: null, region: null, population: null } })).knowledge).toBe("fail");
  });
  it("gateOutcome: o pior vence; só 'não avaliado' se nada foi avaliado", () => {
    const c = (outcome: "pass" | "fail" | "warning" | "not_evaluated") => ({ code: "x", outcome, detail: "" });
    expect(gateOutcome([c("pass"), c("warning"), c("fail")])).toBe("fail");
    expect(gateOutcome([c("pass"), c("warning"), c("not_evaluated")])).toBe("warning");
    expect(gateOutcome([c("pass"), c("not_evaluated")])).toBe("pass");
    expect(gateOutcome([c("not_evaluated"), c("not_evaluated")])).toBe("not_evaluated");
    expect(gateOutcome([])).toBe("not_evaluated");
  });
});

describe("links internos e exceção de SERP", () => {
  it("o blueprint propõe os links do template e diz quais destinos EXISTEM; sem destino existente o gate técnico avisa (não reprova)", () => {
    const none = buildBlueprint(input());
    expect(none.internalLinks).toEqual([{ path: "/cidades/sp", text: "Cidades de SP", resolves: false }, { path: "/cidades", text: "Todas as cidades", resolves: false }]);
    const c = evaluateExperienceGates(none).gates.find((g) => g.gate === "technical")!.checks.find((x) => x.code === "internal_links")!;
    expect(c.outcome).toBe("warning");
    const some = buildBlueprint(input({ knownPaths: new Set(["/cidades"]) }));
    expect(some.internalLinks.map((l) => l.resolves)).toEqual([false, true]);
    expect(evaluateExperienceGates(some).gates.find((g) => g.gate === "technical")!.checks.find((x) => x.code === "internal_links")!.outcome).toBe("pass");
    expect(evaluateExperienceGates(buildBlueprint(input({}, { pattern: "compare-stores", experience: "ranking" }))).gates.find((g) => g.gate === "technical")!.checks.find((x) => x.code === "internal_links")!.outcome).toBe("not_evaluated");
  });
});

describe("findSerpWaiver (histórico → exceção vigente)", () => {
  const ev = (over: object) => ({ type: "transition", from: "eligible", to: "blueprinted", actor: "u1", at: new Date("2026-10-14T10:00:00Z"), reason: "EXCEÇÃO de SERP: sem provedor", data: { serpWaived: true, blueprintVersion: 2, waiverReason: "sem provedor contratado" }, ...over });
  it("sem exceção no histórico: nulo; com exceção: motivo, autor, horário e versão; pendente até passar por 'SERP analisada'", async () => {
    const { findSerpWaiver } = await import("./blueprint-store");
    expect(findSerpWaiver([])).toBeNull();
    expect(findSerpWaiver([ev({ data: { serpWaived: false } })])).toBeNull();
    expect(findSerpWaiver([ev({})])).toMatchObject({ reason: "sem provedor contratado", actor: "u1", blueprintVersion: 2, reviewed: false });
    expect(findSerpWaiver([ev({}), ev({ from: "blueprinted", to: "serp_analyzed", data: {} })])).toMatchObject({ reviewed: true });
    expect(findSerpWaiver([ev({ from: "blueprinted", to: "serp_analyzed", data: {} }), ev({})])).toMatchObject({ reviewed: false }); // a revisão anterior não vale para uma exceção nova
  });
});
