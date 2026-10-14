import { describe, expect, it } from "vitest";
import type { SpecBlueprint } from "../blueprint-spec/types";
import type { PageRecipe, RecipeBlock, RecipeFact } from "../recipe/types";
import { mergeVerifier, numbersIn, outcomeOf, q1, q10, q11, q12, q13, q14, q2, q3, q4, q5, q6, q7, q8, q9, runCodeChecks, variableShare } from "./checks";
import { BLOCKING, QA_IDS, type QaBundle, type QaPolicy } from "./types";

// Página FICTÍCIA ("restaurantes"): as checagens são genéricas. Tempo controlado (referenceTime).
const POLICY: QaPolicy = { maxSiblingSimilarity: 0.8, minVariableShare: 0.4, minSiblingsForComparison: 2, shingleSize: 3,
  travelTimePatterns: ["\\d+\\s*(min|minutos?)(?!\\p{L})", "(?<!\\p{L})a pé(?!\\p{L})", "(?<!\\p{L})rapidinho(?!\\p{L})"],
  forbiddenClaims: [{ id: "official", pattern: "índice oficial", rule: "R4" }, { id: "social", pattern: "perfil dos moradores|segurança percebida", rule: "R5" }, { id: "third", pattern: "segundo o tripadvisor", rule: "R6" }], jsonLdRequired: { Restaurant: ["name"], BreadcrumbList: ["itemListElement"] } };
const REF = "2026-10-14T12:00:00.000Z";
const fact = (id: string, field: string, value: string | number, over: Partial<RecipeFact> = {}): RecipeFact => ({ factId: id, entityKey: "k:a", attributeId: `r.${field}`, field, value, unit: null, observedAt: "2026-09-01T00:00:00.000Z", sourceName: "pesquisa de campo", confidence: 0.9, maxAgeDays: 90, ...over });
const FACTS = [fact("f1", "rating", 4.5), fact("f2", "seats", 120), fact("f3", "cuisine", "italiana")];
const blk = (id: string, text: string, refs: string[], kind: RecipeBlock["kind"] = "paragraph", moduleId = "ficha"): RecipeBlock => ({ blockId: id, moduleId, kind, text, refs, source: "template" });
const RECIPE: PageRecipe = {
  pageId: "p1", topicId: "a".repeat(64), tenantId: "t", family: "F", templateId: "tpl", templateGap: false, specBlueprintId: "b", specBlueprintVersion: 1, url: "/restaurantes/casa-azul", canonical: "/restaurantes/casa-azul", robots: "noindex",
  title: "Casa Azul: ficha", h1: "Casa Azul", metaDescription: "Dados verificáveis da Casa Azul.", entities: [{ key: "k:a", name: "Casa Azul", uf: "SP" }],
  modules: [{ moduleId: "ficha", status: "RICH", minItems: 1, onMissing: "remove", render: "RENDERED" }, { moduleId: "extra", status: "DATA_PENDING", minItems: 1, onMissing: "show_insufficiency", render: "INSUFFICIENCY_SHOWN" }],
  facts: FACTS, blocks: [blk("h", "Ficha", [], "heading"), blk("b1", "A Casa Azul serve cozinha italiana e tem nota 4,5 em 2026.", ["f1", "f3"]), blk("b2", "O salão comporta 120 lugares.", ["f2"]), blk("x", "Dados adicionais ainda não estão disponíveis.", [], "insufficiency", "extra")],
  jsonLd: [{ "@context": "https://schema.org", "@type": "Restaurant", name: "Casa Azul" }, { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Restaurantes" }] }],
  links: [{ path: "/restaurantes", text: "Todos" }], travelTime: null, referenceTime: REF,
};
const BP = { indexability_policy: "noindex", canonical_policy: "self", schema_requirements: ["Restaurant", "BreadcrumbList"], evidence_requirements: [] } as unknown as SpecBlueprint;
const bundle = (r: Partial<PageRecipe> = {}, o: Partial<QaBundle> = {}): QaBundle => ({ recipe: { ...RECIPE, ...r }, blueprint: BP, referenceTime: REF, siblings: [], competing: [], knownPaths: new Set(["/restaurantes"]), policy: POLICY, ...o });
const withBlocks = (...b: RecipeBlock[]) => bundle({ blocks: [blk("h", "Ficha", [], "heading"), ...b] });

describe("números do texto (pt-BR)", () => {
  it("lê milhar, decimal e inteiros", () => { expect(numbersIn("1.234 e 7.528,26 e 12 e 3,5")).toEqual([1234, 7528.26, 12, 3.5]); });
});
describe("Q1 fact checking: todo número existe nos fatos", () => {
  it("passa com os números dos fatos (e os anos observados)", () => { expect(q1(bundle()).status).toBe("PASS"); });
  it("reprova número inventado, no corpo e nos metadados", () => {
    const r = q1(withBlocks(blk("b", "O salão comporta 130 lugares.", ["f2"])));
    expect(r.status).toBe("FAIL"); expect(r.issues[0]).toMatch(/número 130/); expect(r.blocking).toBe(true);
    expect(q1(bundle({ metaDescription: "A Casa Azul tem 999 lugares." })).issues.join()).toMatch(/metadados/);
  });
});
describe("Q2 proveniência", () => {
  it("número sem referência, referência inexistente e [ref] inexistente no texto reprovam; insuficiência dispensa", () => {
    expect(q2(withBlocks(blk("b", "A nota é 4,5.", []))).issues.join()).toMatch(/sem referência/);
    expect(q2(withBlocks(blk("b", "A nota é 4,5.", ["zz"]))).issues.join()).toMatch(/referência inexistente zz/);
    expect(q2(withBlocks(blk("b", "A nota é 4,5 [qq].", ["f1"]))).issues.join()).toMatch(/\[qq\]/);
    expect(q2(bundle()).status).toBe("PASS");
  });
});
describe("Q3 completude (R9)", () => {
  it("RICH precisa estar renderizado; DATA_PENDING com 'mostrar insuficiência' precisa mostrá-la; renderizar módulo sem dado reprova", () => {
    expect(q3(bundle()).status).toBe("PASS");
    expect(q3(bundle({ modules: [{ ...RECIPE.modules[0]!, render: "REMOVED" }, RECIPE.modules[1]!] })).issues.join()).toMatch(/RICH mas não foi renderizado/);
    expect(q3(bundle({ modules: [RECIPE.modules[0]!, { ...RECIPE.modules[1]!, render: "REMOVED" }] })).issues.join()).toMatch(/insuficiência/);
    expect(q3(bundle({ modules: [RECIPE.modules[0]!, { ...RECIPE.modules[1]!, render: "RENDERED" }] })).issues.join()).toMatch(/R9/);
  });
});
describe("Q4 duplicação semântica e Q5 conteúdo fino", () => {
  const sib = (name: string, text: string) => ({ pageId: `${name}-id`, text, entityNames: [name], values: ["4.5", "120", "italiana"] });
  const full = (n: string, body: string) => `${n}: ficha\n${n}\nDados verificáveis da ${n}.\nFicha\n${body}`; // mesmo formato do texto do recipe (título, h1, meta, blocos)
  const same = (n: string) => `${n} serve cozinha italiana e tem boa avaliação no bairro. O salão é amplo e recebe grupos grandes todos os dias da semana.`;
  it("sem irmãs suficientes: NOT_RUN (nunca aprovado por padrão)", () => { expect(q4(bundle()).status).toBe("NOT_RUN"); });
  it("cópia com outro nome de lugar é duplicação (reprova); texto diferente passa", () => {
    const mine = bundle({ blocks: [blk("b", same("Casa Azul"), [])], entities: [{ key: "k:a", name: "Casa Azul", uf: "SP" }] }, { siblings: [sib("Bistrô Verde", full("Bistrô Verde", same("Bistrô Verde"))), sib("Forno Velho", full("Forno Velho", same("Forno Velho")))] });
    expect(q4(mine).status).toBe("FAIL");
    const diff = bundle({ blocks: [blk("b", same("Casa Azul"), [])] }, { siblings: [sib("X", "Texto completamente diferente sobre outro assunto sem relação alguma com a ficha."), sib("Y", "Mais um texto totalmente distinto da primeira página em todas as palavras usadas aqui.")] });
    expect(q4(diff).status).toBe("PASS");
  });
  it("Q5: a parcela variável é nome do lugar e valores dos fatos; abaixo do mínimo reprova", () => {
    const thin = bundle({ blocks: [blk("b", "Este lugar é muito bom para uma visita em qualquer dia da semana com a família toda.", [])] });
    expect(variableShare(thin)).toBe(0); expect(q5(thin).status).toBe("FAIL");
    const rich = bundle({ blocks: [blk("b", "Casa Azul tem nota 4,5 e 120 lugares.", ["f1", "f2"])] });
    expect(variableShare(rich)).toBeGreaterThan(0.4); expect(q5(rich).status).toBe("PASS");
  });
});
describe("Q6, Q7, Q9, Q11, Q12", () => {
  it("Q6: página indexável concorrente reprova", () => { expect(q6(bundle()).status).toBe("PASS"); expect(q6(bundle({}, { competing: [{ url: "/x", topicId: "t" }] })).status).toBe("FAIL"); });
  it("Q7: UF desconhecida ou estados diferentes reprovam (comparação)", () => {
    const two = (u1: string | null, u2: string | null) => bundle({ entities: [{ key: "a", name: "A", uf: u1 }, { key: "b", name: "B", uf: u2 }] });
    expect(q7(two("SP", "SP")).status).toBe("PASS"); expect(q7(two("SP", "RJ")).issues.join()).toMatch(/estados diferentes/); expect(q7(two("SP", null)).issues.join()).toMatch(/UF desconhecida/);
  });
  it("Q9: link quebrado e auto-link reprovam", () => { expect(q9(bundle({ links: [{ path: "/nao-existe", text: "x" }] })).status).toBe("FAIL"); expect(q9(bundle({ links: [{ path: "/restaurantes/casa-azul", text: "eu" }] }), ).issues.join()).toMatch(/aponta para si mesma/); expect(q9(bundle()).status).toBe("PASS"); });
  it("Q11: robots e canonical coerentes com o blueprint; index nesta fase reprova", () => {
    expect(q11(bundle()).status).toBe("PASS");
    expect(q11(bundle({ canonical: "/outra" })).issues.join()).toMatch(/canonical/);
    expect(q11(bundle({ robots: "index" })).issues.join()).toMatch(/noindex/);
  });
  it("Q12: fato acima da validade reprova (tempo controlado)", () => { expect(q12(bundle()).status).toBe("PASS"); expect(q12({ ...bundle(), referenceTime: "2027-06-01T00:00:00.000Z" }).issues.join()).toMatch(/dias > 90/); });
});
describe("Q8 distância ≠ tempo (R3)", () => {
  it("expressões de tempo sem fonte de roteamento reprovam; distância com unidade passa; com fonte de roteamento passa", () => {
    for (const t of ["Fica a 5 min do centro.", "É perto, dá para ir a pé.", "Chega rapidinho."]) expect(q8(withBlocks(blk("b", t, []))).status, t).toBe("FAIL");
    expect(q8(withBlocks(blk("b", "Fica a 1,2 km em linha reta do centro.", []))).status).toBe("PASS");
    expect(q8({ ...withBlocks(blk("b", "Fica a 5 min do centro.", [])), recipe: { ...withBlocks(blk("b", "Fica a 5 min do centro.", [])).recipe, travelTime: { source: "serviço de roteamento" } } }).status).toBe("PASS");
  });
  it("também olha título e meta", () => { expect(q8(bundle({ title: "Casa Azul a 10 minutos" })).status).toBe("FAIL"); });
});
describe("Q10 dados estruturados", () => {
  it("válido passa; tipo declarado ausente, propriedade obrigatória vazia, @context errado e nome fora do texto reprovam", () => {
    expect(q10(bundle()).status).toBe("PASS");
    expect(q10(bundle({ jsonLd: [RECIPE.jsonLd[0]!] })).issues.join()).toMatch(/BreadcrumbList/);
    expect(q10(bundle({ jsonLd: [{ ...RECIPE.jsonLd[0]!, name: "" }, RECIPE.jsonLd[1]!] })).issues.join()).toMatch(/obrigatória ausente: name/);
    expect(q10(bundle({ jsonLd: [{ ...RECIPE.jsonLd[0]!, "@context": "http://x" }, RECIPE.jsonLd[1]!] })).issues.join()).toMatch(/@context/);
    expect(q10(bundle({ jsonLd: [{ "@context": "https://schema.org", "@type": "City", name: "Outra Cidade" }, RECIPE.jsonLd[1]!] }, {})).issues.join()).toMatch(/sem regra|não aparece/);
  });
});
describe("Q13 política editorial", () => {
  it("score oficial, atribuição social, terceiros e história sem fonte reprovam", () => {
    for (const t of ["Segundo o índice oficial, é ótimo.", "Conhecemos o perfil dos moradores.", "Segundo o TripAdvisor, é o melhor."]) expect(q13(withBlocks(blk("b", t, []))).status, t).toBe("FAIL");
    expect(q13(withBlocks(blk("b", "O local foi fundado no século XIX.", []))).issues.join()).toMatch(/R10/);
    expect(q13(withBlocks(blk("b", "O local foi fundado no século XIX.", ["f1"]))).status).toBe("PASS");
  });
});
describe("Q14 e o desfecho: nada é aprovado por padrão", () => {
  it("Q14 sem o verificador é NOT_RUN; o desfecho sem falhas é QA_INCOMPLETE (nunca PASSED)", () => {
    expect(q14().status).toBe("NOT_RUN");
    const r = runCodeChecks(bundle({ blocks: [blk("b", "Casa Azul tem nota 4,5 e 120 lugares.", ["f1", "f2"]), blk("x", "Dados adicionais ainda não estão disponíveis.", [], "insufficiency", "extra")] }, { siblings: [{ pageId: "s", text: "Outro texto bem diferente sobre outra coisa.", entityNames: ["Z"] }, { pageId: "s2", text: "Mais um texto totalmente diferente do anterior.", entityNames: ["W"] }] }));
    expect(outcomeOf(r)).toEqual({ outcome: "QA_INCOMPLETE", blocking: [] });
    expect(Object.keys(r)).toEqual([...QA_IDS]);
  });
  it("falha bloqueante (Q1, Q2, Q8, Q13) é listada; falha não bloqueante também reprova o QA", () => {
    expect(BLOCKING).toEqual(new Set(["Q1", "Q2", "Q8", "Q13"]));
    const r = runCodeChecks(withBlocks(blk("b", "O salão comporta 130 lugares a 5 min do centro.", [])));
    expect(outcomeOf(r).outcome).toBe("QA_FAILED");
    expect(outcomeOf(r).blocking).toEqual(expect.arrayContaining(["Q1", "Q2", "Q8"]));
  });
  it("o verificador é conservador: o FAIL dele vale mesmo com o código em PASS; Q14 só passa com o verificador", () => {
    const code = runCodeChecks(bundle());
    const m = mergeVerifier(code, { Q2: { result: "FAIL", issues: ["frase sem referência"] }, Q14: { result: "PASS", issues: [] }, Q1: { result: "PASS", issues: [] } });
    expect(m.Q2).toMatchObject({ status: "FAIL", by: "both" });
    expect(m.Q14).toMatchObject({ status: "PASS", by: "llm" });
    expect(m.Q1.status).toBe("PASS");
    expect(mergeVerifier(code, null)).toBe(code);
    expect(mergeVerifier(code, { Q14: { result: "FAIL", issues: ["nada exclusivo"] } }).Q14.status).toBe("FAIL");
  });
  it("o verificador não aprova o que o código reprovou", () => {
    const code = runCodeChecks(withBlocks(blk("b", "O salão comporta 130 lugares.", ["f2"])));
    expect(mergeVerifier(code, { Q1: { result: "PASS", issues: [] } }).Q1.status).toBe("FAIL");
  });
});
