import { recipe as R, type qa } from "@plataforma/api";

// Renderizadores de recipe e política de QA do Domain Pack imobiliário (ADR-030). Texto DETERMINÍSTICO a partir dos fatos: todo número vem de um fato e todo parágrafo factual leva a
// referência `fact_id` (Q1/Q2). Módulo sem dado é removido ou mostra a insuficiência (R9); nada de texto genérico para preencher espaço.
const fmtInt = (n: number) => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const fmt = (n: number) => (Number.isInteger(n) ? fmtInt(n) : n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, "."));
const year = (iso: string) => iso.slice(0, 4);
type Fact = R.RecipeFact;
const pick = (facts: readonly Fact[], key: string, field: string): Fact | undefined => facts.find((f) => f.entityKey === key && f.field === field);

const cityRenderer: R.FamilyRenderer = {
  family: "04-cidade",
  render: (i) => {
    const e = i.entities[0]; if (!e) return { error: "sem entidade primária" };
    const f = (field: string) => pick(i.facts, e.key, field);
    const uf = f("uf"); const region = f("region"); const pop = f("population"); const cpop = f("census_population"); const dens = f("census_density");
    const values: Record<string, string> = { city_name: e.name, ...(pop && typeof pop.value === "number" ? { population: fmtInt(pop.value) } : {}), ...(uf ? { uf: String(uf.value) } : {}) };
    let title: string, h1: string, meta: string;
    try { title = R.fillPattern(i.blueprint.title_pattern, values); h1 = R.fillPattern(i.blueprint.h1_pattern, values); meta = R.fillPattern(i.blueprint.meta_description_pattern, values); } catch (x) { return { error: (x as Error).message }; }
    const blocks: Omit<R.RecipeBlock, "source">[] = [];
    if (i.moduleStatus.get("identificacao") !== "DATA_PENDING") {
      blocks.push({ blockId: "identificacao:h", moduleId: "identificacao", kind: "heading", text: "Visão geral", refs: [] });
      if (uf) blocks.push({ blockId: "identificacao:uf", moduleId: "identificacao", kind: "paragraph", text: `${e.name} é um município de ${String(uf.value)}.`, refs: [uf.factId] });
      if (region) blocks.push({ blockId: "identificacao:regiao", moduleId: "identificacao", kind: "paragraph", text: `Está na região ${String(region.value)} do Brasil.`, refs: [region.factId] });
    }
    const demo = i.moduleStatus.get("demografia");
    if (demo === "DATA_PENDING") blocks.push({ blockId: "demografia:insuf", moduleId: "demografia", kind: "insufficiency", text: "Os dados de população ainda não estão disponíveis para este município.", refs: [] });
    else if (demo) {
      blocks.push({ blockId: "demografia:h", moduleId: "demografia", kind: "heading", text: "População", refs: [] });
      if (pop && typeof pop.value === "number") blocks.push({ blockId: "demografia:pop", moduleId: "demografia", kind: "paragraph", text: `A população estimada é de ${fmtInt(pop.value)} habitantes, com referência em ${year(pop.observedAt)}, segundo ${pop.sourceName.replace(/ \(arquivo .*\)$/, "")}.`, refs: [pop.factId] });
      if (cpop && typeof cpop.value === "number") blocks.push({ blockId: "demografia:censo", moduleId: "demografia", kind: "paragraph", text: `No Censo ${year(cpop.observedAt)}, o município tinha ${fmtInt(cpop.value)} habitantes.`, refs: [cpop.factId] });
      if (dens && typeof dens.value === "number") blocks.push({ blockId: "demografia:dens", moduleId: "demografia", kind: "paragraph", text: `A densidade demográfica no Censo ${year(dens.observedAt)} era de ${fmt(dens.value)} habitantes por km².`, refs: [dens.factId] });
    }
    const used = i.facts.filter((x) => x.entityKey === e.key);
    blocks.push({ blockId: "fontes", moduleId: "identificacao", kind: "sources", text: `Fontes: ${[...new Set(used.map((x) => `${x.sourceName.replace(/ \(arquivo .*\)$/, "")}, referência ${year(x.observedAt)}`))].join("; ")}.`, refs: used.map((x) => x.factId) });
    const ufv = uf ? String(uf.value) : "";
    const jsonLd: Record<string, unknown>[] = [{ "@context": "https://schema.org", "@type": "City", name: e.name, ...(ufv ? { containedInPlace: { "@type": "AdministrativeArea", name: ufv } } : {}) }, { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Cidades", item: "/cidades" }, ...(ufv ? [{ "@type": "ListItem", position: 2, name: ufv, item: `/cidades/${ufv.toLowerCase()}` }] : []), { "@type": "ListItem", position: 3, name: e.name }] }];
    const links = ufv ? [{ path: `/cidades/${ufv.toLowerCase()}`, text: `Cidades de ${ufv}` }, { path: "/cidades", text: "Todas as cidades" }] : [{ path: "/cidades", text: "Todas as cidades" }];
    return { title, h1, metaDescription: meta, blocks, jsonLd, links };
  },
};

const comparisonRenderer: R.FamilyRenderer = {
  family: "13-comparacao",
  render: (i) => {
    const [a, b] = i.entities; if (!a || !b) return { error: "a comparação exige duas entidades" };
    const values = { city_name: a.name, compare_name: b.name };
    let title: string, h1: string, meta: string;
    try { title = R.fillPattern(i.blueprint.title_pattern, values); h1 = R.fillPattern(i.blueprint.h1_pattern, values); meta = R.fillPattern(i.blueprint.meta_description_pattern, values); } catch (x) { return { error: (x as Error).message }; }
    const mod = "comparacao-demografica"; const blocks: Omit<R.RecipeBlock, "source">[] = [];
    if (i.moduleStatus.get(mod) === "DATA_PENDING") blocks.push({ blockId: `${mod}:insuf`, moduleId: mod, kind: "insufficiency", text: "Não há indicadores comparáveis com a mesma data-base para este par de cidades.", refs: [] });
    else {
      blocks.push({ blockId: `${mod}:h`, moduleId: mod, kind: "heading", text: "Comparação demográfica", refs: [] });
      for (const [field, label, unit] of [["population", "População estimada", "habitantes"], ["census_population", "População do Censo", "habitantes"], ["census_density", "Densidade demográfica do Censo", "habitantes por km²"]] as const) {
        const fa = pick(i.facts, a.key, field); const fb = pick(i.facts, b.key, field);
        if (fa && fb && typeof fa.value === "number" && typeof fb.value === "number" && year(fa.observedAt) === year(fb.observedAt)) blocks.push({ blockId: `${mod}:${field}`, moduleId: mod, kind: "paragraph", text: `${label} (${year(fa.observedAt)}): ${a.name}, ${fmt(fa.value)} ${unit}; ${b.name}, ${fmt(fb.value)} ${unit}.`, refs: [fa.factId, fb.factId] });
      }
    }
    const used = i.facts;
    blocks.push({ blockId: "fontes", moduleId: mod, kind: "sources", text: `Fontes: ${[...new Set(used.map((x) => `${x.sourceName.replace(/ \(arquivo .*\)$/, "")}, referência ${year(x.observedAt)}`))].join("; ")}.`, refs: used.map((x) => x.factId) });
    return { title, h1, metaDescription: meta, blocks, jsonLd: [{ "@context": "https://schema.org", "@type": "Dataset", name: `${a.name} e ${b.name}: comparação demográfica`, description: `Indicadores demográficos de ${a.name} e ${b.name} com a mesma data-base.` }], links: [{ path: "/cidades", text: "Todas as cidades" }] };
  },
};
export const RENDERERS: readonly R.FamilyRenderer[] = [cityRenderer, comparisonRenderer];

/** Política de QA inicial (spec 13): valores calibráveis, versionados por tenant. */
export const DEFAULT_QA_POLICY: qa.QaPolicy = {
  maxSiblingSimilarity: 0.8, minVariableShare: 0.4, minSiblingsForComparison: 2, shingleSize: 5,
  travelTimePatterns: ["\\d+\\s*(min|minutos?)(?!\\p{L})", "(?<!\\p{L})a pé(?!\\p{L})", "(?<!\\p{L})de carro(?!\\p{L})", "(?<!\\p{L})de ônibus(?!\\p{L})", "(?<!\\p{L})a poucos passos(?!\\p{L})", "(?<!\\p{L})rapidinho(?!\\p{L})", "(?<!\\p{L})pertinho(?!\\p{L})"],
  forbiddenClaims: [
    { id: "official-score", pattern: "índice oficial|score oficial|nota oficial", rule: "R4: score do tenant nunca é índice oficial" },
    { id: "social-attribution", pattern: "(?<!\\p{L})(seguro|perigoso|tolerante)(?!\\p{L}) para morar|segurança percebida|perfil dos moradores|moradores (educados|tolerantes|perigosos)", rule: "R5: característica social de lugar sem metodologia" },
    { id: "third-party", pattern: "segundo o (tripadvisor|google maps|zap im[oó]veis|viva ?real)|ranking d[oa] (tripadvisor|google)", rule: "R6: conteúdo de terceiros" },
  ],
  jsonLdRequired: { City: ["name"], BreadcrumbList: ["itemListElement"], Dataset: ["name", "description"] },
};
