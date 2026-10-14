import { describe, expect, it } from "vitest";
import { topicId } from "../topics/generate";
import { expandCombinations, type ExpandInput } from "./engine";
import type { CombinationFamily, CombinationPolicy, CompatibilityRule, DemandInfo, Dims, Space } from "./types";

// Pack FICTÍCIO ("restaurantes"): o motor é genérico. Dados em memória, só para os testes.
interface R { cuisine: string; price: string; nearPark: boolean; nearStation: boolean; opened: number }
const DATA: Record<string, R[]> = {
  d1: [
    ...Array.from({ length: 9 }, (_, i): R => ({ cuisine: "italian", price: i < 5 ? "mid" : "low", nearPark: i < 4, nearStation: i % 2 === 0, opened: 2020 })),
    { cuisine: "japanese", price: "high", nearPark: true, nearStation: false, opened: 2021 }, { cuisine: "japanese", price: "high", nearPark: false, nearStation: true, opened: 2021 },
    { cuisine: "vegan", price: "mid", nearPark: true, nearStation: false, opened: 2022 }, { cuisine: "vegan", price: "mid", nearPark: true, nearStation: false, opened: 2022 }, { cuisine: "vegan", price: "low", nearPark: false, nearStation: false, opened: 2022 },
    { cuisine: "drive_in", price: "low", nearPark: false, nearStation: false, opened: 2019 },
  ],
};
const filt = (d: Dims): R[] => (DATA[d.district!] ?? []).filter((r) => (!d.cuisine || r.cuisine === d.cuisine) && (!d.price_band || r.price === d.price_band) && (d.near !== "park" || r.nearPark) && (d.near !== "station" || r.nearStation));
const VALUES: Record<string, string[]> = { cuisine: ["italian", "japanese", "vegan", "drive_in"], price_band: ["low", "mid", "high"], near: ["park", "station"] };
const demandFor = (d: Dims): DemandInfo | null => (d.cuisine === "vegan" && !d.price_band && !d.near ? { value: 320, source: "fonte de teste", period: "12m", method: "estimativa", uncertainty: "±30%" } : null);
const space = (over: Partial<Space> = {}): Space => ({
  values: async (dim) => VALUES[dim] ?? [],
  entityOk: async (d) => (DATA[d.district!] ? null : `o distrito ${d.district} não existe`),
  count: async (d) => filt(d).length,
  // um bloco exclusivo por dimensão que o pai não tinha, exceto "price_band=low" que não traz nada novo para o usuário
  exclusiveBlocks: async (c, p) => Object.keys(c).filter((k) => !(k in p) && !(k === "price_band" && c[k] === "low")).length,
  demand: async (d) => demandFor(d),
  intentKey: (d) => `${d.district}|${d.cuisine ?? ""}|${d.near ?? ""}`, // a faixa de preço não muda a intenção
  describe: (d) => `restaurantes ${Object.entries(d).filter(([k]) => k !== "topic" && k !== "district").map(([, v]) => v).join(" ")} em ${d.district}`,
  ...over,
});
const FAMILY: CombinationFamily = { id: "rest-listing", pageFamily: "F-LIST", rootPatternKeys: ["root"], expandable: ["cuisine", "price_band", "near"], longTail: false, minItemsKey: "rest", child: { queryPatternKey: "q", intentType: "commercial", geoGranularity: "neighborhood", userNeed: "x", evidenceRequired: [], commercialPotential: "medium", attributesUsed: [], relationshipsUsed: [] } };
const POLICY: CombinationPolicy = { maxDimensions: 4, longTailMaxDimensions: 5, redundancyRatio: 0.8, minExclusiveBlocks: 1, minItems: { rest: 2 }, maxCandidatesPerRun: 1000 };
const RULES: CompatibilityRule[] = [{ id: "no-vegan-station", description: "vegano não combina com estação (matriz do pack)", check: (d) => (d.cuisine === "vegan" && d.near === "station" ? "vegano × perto de estação não é permitido pela matriz de compatibilidade" : null) }];
const T = "t1";
const ROOT = { district: "d1", topic: "restaurantes" };
const input = (o: Partial<ExpandInput> = {}): ExpandInput => ({ tenantId: T, family: FAMILY, roots: [{ topicId: topicId(T, ROOT), dimensions: ROOT }], rules: RULES, space: space(), policy: POLICY, existingIntents: new Map(), ...o });
type Res = Awaited<ReturnType<typeof expandCombinations>>;
const entry = (r: Res, d: Dims, root: Dims = ROOT) => r.log.find((l) => l.topicId === topicId(T, { ...root, ...d }))!;

describe("cada filtro, na ordem, com o motivo registrado", () => {
  let r: Res;
  it("executa a expansão e mantém só o que sobrevive a todos os filtros", async () => {
    r = await expandCombinations(input());
    const keptDims = r.kept.map((k) => Object.entries(k.dimensions).filter(([x]) => x !== "district" && x !== "topic").map(([a, b]) => `${a}=${b}`).sort().join(",")).sort();
    expect(keptDims).toEqual(["cuisine=italian", "cuisine=italian,near=park", "cuisine=italian,near=station", "cuisine=italian,price_band=mid", "cuisine=japanese", "cuisine=vegan", "cuisine=vegan,near=park", "cuisine=vegan,price_band=mid", "near=park", "near=station", "near=station,price_band=mid", "price_band=mid"].sort());
  });
  it("F4: poucos itens (drive-in tem 1 < 2) é podado com a contagem", () => { expect(entry(r, { cuisine: "drive_in" })).toMatchObject({ outcome: "pruned", filter: "F4_data_sufficiency", details: { count: 1, min: 2 } }); });
  it("F5 (razão): o filho com quase os mesmos itens do pai vira seção do pai (japonês × alta: 2 de 2)", () => {
    expect(entry(r, { cuisine: "japanese", price_band: "high" })).toMatchObject({ outcome: "pruned", filter: "F5_parent_redundancy", details: { count: 2, parentCount: 2 } });
    expect(entry(r, { price_band: "mid", near: "park" })).toMatchObject({ outcome: "pruned", filter: "F5_parent_redundancy" }); // 6 de 7 > 80%
  });
  it("F5 (bloco exclusivo): filtra, mas não traz nenhum bloco de dados novo: podado", () => { expect(entry(r, { price_band: "low" })).toMatchObject({ outcome: "pruned", filter: "F5_parent_redundancy", details: { exclusiveBlocks: 0 } }); expect(entry(r, { price_band: "low" }).reason).toMatch(/bloco de dados exclusivo/); });
  it("F1 vence F4 (ordem): vegano × estação teria 0 itens, mas a matriz de compatibilidade barra antes", () => { expect(entry(r, { cuisine: "vegan", near: "station" })).toMatchObject({ outcome: "pruned", filter: "F1_semantic", details: { rule: "no-vegan-station" } }); });
  it("F3: acima do máximo de dimensões (5 > 4) é podado", () => { expect(entry(r, { cuisine: "italian", price_band: "mid", near: "park" })).toMatchObject({ outcome: "pruned", filter: "F3_depth", details: { max: 4 } }); });
  it("F7: disputa de intenção dentro do grupo: o de mais itens vence, o outro vira seção/canônico", () => {
    expect(entry(r, { price_band: "mid" })).toMatchObject({ outcome: "kept" });
    expect(entry(r, { price_band: "high" })).toMatchObject({ outcome: "pruned", filter: "F7_cannibalization", details: { winner: topicId(T, { ...ROOT, price_band: "mid" }) } });
  });
  it("F6: demanda observada é marcada; sem sinal segue como HYPOTHESIS (nunca zero)", () => {
    expect(r.kept.find((k) => k.dimensions.cuisine === "vegan" && !k.dimensions.near && !k.dimensions.price_band)).toMatchObject({ demandStatus: "OBSERVED", demand: { value: 320 } });
    expect(r.kept.filter((k) => k.demandStatus === "HYPOTHESIS").length).toBe(r.kept.length - 1);
    expect(entry(r, { cuisine: "italian" }).reason).toMatch(/sem sinal de demanda/);
  });
  it("a árvore é inspecionável: todo mantido tem pai (raiz ou outro mantido) e todo candidato tem uma linha de log", () => {
    const ids = new Set([topicId(T, ROOT), ...r.kept.map((k) => k.topicId)]);
    for (const k of r.kept) expect(ids.has(k.parentTopicId), k.topicId).toBe(true);
    expect(r.log.length).toBe(r.evaluated);
    for (const l of r.log) { expect(l.reason.length).toBeGreaterThan(5); expect(l.outcome === "kept" || l.outcome === "duplicate" ? l.filter === null : l.filter !== null).toBe(true); }
    expect(r.capped).toBe(false);
  });
  it("sem permutações repetidas: cada conjunto de dimensões é avaliado uma vez", () => { const ids = r.log.map((l) => l.topicId); expect(new Set(ids).size).toBe(ids.length); });
});

describe("famílias em que o filho NÃO é um recorte do pai (ex.: comparação)", () => {
  it("parentRedundancy=false dispensa a razão |filho| ≤ 80% |pai|, mas o bloco exclusivo continua exigido", async () => {
    const sp = space({ count: async () => 5, exclusiveBlocks: async (c) => (c.cuisine === "vegan" ? 0 : 1) });
    const strict = await expandCombinations(input({ space: sp, family: { ...FAMILY, expandable: ["cuisine"] } }));
    expect(strict.kept).toEqual([]); // 5 de 5: redundante
    const relaxed = await expandCombinations(input({ space: sp, family: { ...FAMILY, expandable: ["cuisine"], parentRedundancy: false } }));
    expect(relaxed.kept.map((k) => k.dimensions.cuisine).sort()).toEqual(["drive_in", "italian", "japanese"]);
    expect(entry(relaxed, { cuisine: "vegan" })).toMatchObject({ outcome: "pruned", filter: "F5_parent_redundancy", details: { exclusiveBlocks: 0 } });
  });
});

describe("casos de borda", () => {
  it("F2: entidade inexistente é podada antes de olhar os dados", async () => {
    const r = await expandCombinations(input({ roots: [{ topicId: topicId(T, { district: "dx", topic: "restaurantes" }), dimensions: { district: "dx", topic: "restaurantes" } }] }));
    expect(r.kept).toEqual([]);
    expect(r.log.every((l) => l.outcome === "pruned" && l.filter === "F2_entity_geo" && /não existe/.test(l.reason))).toBe(true);
  });
  it("F4: contagem desconhecida (null) é 'dado desconhecido', nunca zero nem aprovada", async () => {
    const r = await expandCombinations(input({ space: space({ count: async (d) => (d.cuisine === "japanese" ? null : filt(d).length) }) }));
    expect(entry(r, { cuisine: "japanese" })).toMatchObject({ outcome: "pruned", filter: "F4_data_sufficiency", details: { count: null } });
    expect(entry(r, { cuisine: "japanese" }).reason).toMatch(/ausência não é zero/);
  });
  it("teto por execução: interrompe e REGISTRA (capped), sem truncar em silêncio", async () => {
    const r = await expandCombinations(input({ policy: { ...POLICY, maxCandidatesPerRun: 3 } }));
    expect(r.capped).toBe(true);
    expect(r.evaluated).toBe(3);
    const c = r.log.find((l) => l.outcome === "capped")!;
    expect(c).toMatchObject({ outcome: "capped", filter: "cap", details: { evaluated: 3 } });
    expect(c.reason).toMatch(/teto de 3 candidatos/);
    expect(r.log.filter((l) => l.outcome !== "capped")).toHaveLength(3); // só os 3 avaliados têm resultado
  });
  it("duplicata: dois caminhos para o mesmo conjunto de dimensões geram UMA avaliação e uma linha 'duplicate'", async () => {
    const b = { ...ROOT, cuisine: "italian" };
    const r = await expandCombinations(input({ roots: [{ topicId: topicId(T, ROOT), dimensions: ROOT }, { topicId: topicId(T, b), dimensions: b }] }));
    expect(r.log.filter((l) => l.outcome === "duplicate").length).toBeGreaterThanOrEqual(1);
    expect(r.log.find((l) => l.outcome === "duplicate")!.reason).toMatch(/já foi avaliado/);
  });
  it("tópico existente com a mesma intenção vence a disputa (o candidato vira canônico dele)", async () => {
    const r = await expandCombinations(input({ existingIntents: new Map([["d1|vegan|park", "e".repeat(64)]]) }));
    expect(entry(r, { cuisine: "vegan", near: "park" })).toMatchObject({ outcome: "pruned", filter: "F7_cannibalization", details: { winner: "e".repeat(64) } });
  });
  it("cauda longa usa o máximo maior (5): o nível 3 deixa de ser podado por profundidade", async () => {
    const r = await expandCombinations(input({ family: { ...FAMILY, longTail: true } }));
    expect(entry(r, { cuisine: "italian", price_band: "mid", near: "park" })).toMatchObject({ outcome: "kept" });
  });
  it("política sem o mínimo da família lança (nunca assume um padrão)", async () => { await expect(expandCombinations(input({ policy: { ...POLICY, minItems: {} } }))).rejects.toThrow(RangeError); });
  it("DETERMINISMO: a ordem das raízes e dos valores não muda o resultado nem o log", async () => {
    const a = await expandCombinations(input());
    const b = await expandCombinations(input({ space: space({ values: async (dim) => [...(VALUES[dim] ?? [])].reverse() }) }));
    expect(JSON.stringify(b.log)).toBe(JSON.stringify(a.log));
    expect(JSON.stringify(b.kept)).toBe(JSON.stringify(a.kept));
  });
});
