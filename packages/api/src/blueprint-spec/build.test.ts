import { describe, expect, it } from "vitest";
import { applySemanticFields, buildSpecBlueprint, contentHash, structuralHash, type BuildInput } from "./build";
import { QA_GATES, specBlueprintSchema, type FamilyRecipe } from "./types";

// Receita FICTÍCIA ("restaurantes"): o construtor é genérico.
const RECIPE: FamilyRecipe = {
  family: "F-REST", pageType: "visão geral do restaurante", archetype: "hub", templateId: "tpl-a", urlFor: (e) => `/restaurantes/${e.name.toLowerCase().replace(/\s+/g, "-")}`,
  modules: [{ moduleId: "ficha", fields: [{ field: "name", attribute: null }, { field: "cuisine", attribute: "r.cuisine" }], minItems: 1, onMissing: "remove" }, { moduleId: "avaliacao", fields: [{ field: "rating", attribute: "r.rating" }, { field: "price", attribute: "r.price" }], minItems: 1, onMissing: "show_insufficiency" }],
  schemaTypes: ["Restaurant"], derivedMetrics: ["m1"], claims: [{ claimType: "nota", sourceClass: "pesquisa", attribute: "r.rating" }],
  defaultPatterns: { title: "{name}: ficha", h1: "{name}", meta: "Ficha de {name}." }, moduleRequirements: ["hero"], kpis: ["clicks"], refreshTrigger: "nova pesquisa", maxAgeDays: 90,
};
const INPUT: BuildInput = {
  tenantId: "t1", version: "1.0.0", now: new Date("2026-10-14T12:00:00Z"),
  topic: { topicId: "a".repeat(64), family: "F-REST", intentType: "informational", queryHypothesis: "casa azul: ficha", userNeed: "conhecer o restaurante", demand: { value: null, source: null }, attributesUsed: ["r.cuisine", "r.rating", "r.price"], relationshipsUsed: ["located_in"], dimensions: { restaurant: "k:a" }, intentVariants: [] },
  entity: { name: "Casa Azul", qualifier: "Centro", sourceKey: "k:a" }, availableAttributes: new Set(["r.cuisine", "r.rating", "r.price"]), varyingAttributes: ["r.rating", "r.price", "r.cuisine"], attributeMaxAge: new Map([["r.rating", 90]]),
  graph: { parents: [], siblings: ["b".repeat(64)], children: [] }, recipe: RECIPE, templates: new Set(["tpl-a"]),
};
const build = (o: Partial<BuildInput> = {}) => buildSpecBlueprint({ ...INPUT, ...o });

describe("montagem estrutural do blueprint", () => {
  const r = build();
  it("produz um blueprint válido no esquema da especificação, com os 14 gates de QA, noindex e sem problemas", () => {
    expect(r.problems).toEqual([]);
    expect(specBlueprintSchema.safeParse(r.blueprint).success).toBe(true);
    expect(r.blueprint.quality_gates).toEqual([...QA_GATES]);
    expect(r.blueprint).toMatchObject({ indexability_policy: "noindex", canonical_policy: "self", page_family: "F-REST", url: "/restaurantes/casa-azul", primary_entity: "k:a", version: "1.0.0" });
    expect(r.templateGap).toBe(false);
  });
  it("módulos: RICH quando todos os campos têm dado, PARTIAL quando falta parte, DATA_PENDING quando falta tudo; a regra de ausência vem da receita (R9)", () => {
    expect(r.blueprint.data_contract.map((m) => [m.module_id, m.status, m.on_missing])).toEqual([["ficha", "RICH", "remove"], ["avaliacao", "RICH", "show_insufficiency"]]);
    expect(build({ availableAttributes: new Set(["r.cuisine", "r.rating"]) }).blueprint.data_contract[1]).toMatchObject({ status: "PARTIAL", on_missing: "show_insufficiency" });
    expect(build({ availableAttributes: new Set(["r.cuisine"]) }).blueprint.data_contract[1]).toMatchObject({ status: "DATA_PENDING" });
  });
  it("todos os módulos sem dado: o blueprint não pode existir (R9) — nada é preenchido com texto genérico", () => {
    const x = build({ availableAttributes: new Set<string>(), recipe: { ...RECIPE, modules: [{ ...RECIPE.modules[1]! }] } });
    expect(x.problems.join()).toMatch(/todos os módulos estão sem dado/);
  });
  it("campos únicos por instância vêm dos blocos que variam; sem nenhum, a diferenciação é INSUFFICIENT (não inventada)", () => {
    expect(r.blueprint.unique_fields_per_instance).toEqual(["cuisine", "rating", "price"]); // ordem da receita, não do snapshot
    expect(r.blueprint.differentiation_strategy).toContain("cuisine, rating, price");
    expect(build({ varyingAttributes: [] }).blueprint.differentiation_strategy).toBe("INSUFFICIENT");
  });
  it("evidência exigida: tipo de afirmação, classe de fonte e validade do atributo (null se não expira)", () => { expect(r.blueprint.evidence_requirements).toEqual([{ claim_type: "nota", source_class: "pesquisa", max_age_days: 90 }]); expect(build({ attributeMaxAge: new Map() }).blueprint.evidence_requirements[0]!.max_age_days).toBeNull(); });
  it("template inexistente no registro marca template_gap (sem improvisar)", () => { expect(build({ templates: new Set() }).templateGap).toBe(true); });
  it("módulo que usa atributo fora do tópico é recusado", () => { expect(build({ topic: { ...INPUT.topic, attributesUsed: ["r.rating"] } }).problems.join()).toMatch(/não está nos atributos do tópico/); });
  it("é determinístico", () => { expect(contentHash(build().blueprint)).toBe(contentHash(build().blueprint)); });
});

describe("independência do template: trocar o template NÃO altera o blueprint", () => {
  it("o hash estrutural ignora template_id e module_requirements; o hash completo muda", () => {
    const a = build().blueprint; const b = build({ recipe: { ...RECIPE, templateId: "tpl-b", moduleRequirements: ["outro"] } }).blueprint;
    expect(structuralHash(a)).toBe(structuralHash(b));
    expect(contentHash(a)).not.toBe(contentHash(b));
    expect(structuralHash(build({ varyingAttributes: ["r.rating"] }).blueprint)).not.toBe(structuralHash(a));
  });
});

describe("campos semânticos refinados (Agente 6): só os pedidos entram", () => {
  it("funde título, h1, meta, definição, consultas secundárias e âncoras; ignora o resto", () => {
    const a = applySemanticFields(build().blueprint, { title_pattern: "{name} — ficha completa", "target_query_cluster.secondary": ["x", "y"], "internal_link_plan.anchor_texts": ["ver ficha"], url: "/hack", template_id: "hack" });
    expect(a).toMatchObject({ title_pattern: "{name} — ficha completa", url: "/restaurantes/casa-azul", template_id: "tpl-a" });
    expect(a.target_query_cluster.secondary).toEqual(["x", "y"]);
    expect(a.internal_link_plan.anchor_texts).toEqual(["ver ficha"]);
    expect(specBlueprintSchema.safeParse(a).success).toBe(true);
  });
  it("INSUFFICIENT na diferenciação é preservado", () => { expect(applySemanticFields(build().blueprint, { differentiation_strategy: "INSUFFICIENT" }).differentiation_strategy).toBe("INSUFFICIENT"); });
});
