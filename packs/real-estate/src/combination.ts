import { catalog, combination, type TenantDb } from "@plataforma/api";

// Combination Engine do Domain Pack imobiliário (ADR-030): dimensões, matriz de compatibilidade (spec 15.6), famílias e o espaço de dados. Hoje só o nível município tem dados reais:
// a família de comparação entre municípios lê fatos reais; a de tipologia × lugar não tem entidades (bairro, anúncio) e a expansão registra isso em vez de inventar contagens.
export const DIMENSIONS = ["city", "neighborhood", "compare_with", "property_type", "transaction", "bedrooms", "suites", "parking", "price_band", "near", "lifestyle_profile", "period"] as const;
const TYPOLOGY = ["property_type", "transaction", "bedrooms", "price_band", "suites", "parking"] as const;
const BUILT = new Set(["apartment", "house", "studio"]);

/** Matriz de compatibilidade (excerto da seção 15.6). */
export const COMPATIBILITY_RULES: readonly combination.CompatibilityRule[] = [
  { id: "bedrooms-need-built", description: "quartos, suítes e vagas não combinam com terreno ou lote comercial", check: (d) => (["bedrooms", "suites", "parking"].some((k) => k in d) && d.property_type !== undefined && !BUILT.has(d.property_type) && ["land", "commercial_lot"].includes(d.property_type) ? `${["bedrooms", "suites", "parking"].find((k) => k in d)} não combina com property_type=${d.property_type}` : null) },
  { id: "near-airport-granularity", description: "near=airport só vale para granularidade a partir de bairro", check: (d) => (d.near === "airport" && d.geo_granularity !== undefined && ["property", "street"].includes(d.geo_granularity) ? "near=airport exige granularidade ≥ bairro" : null) },
  { id: "lifestyle-not-property", description: "perfil de estilo de vida é atributo de lugar, não de imóvel", check: (d) => ("lifestyle_profile" in d && "property_id" in d ? "lifestyle_profile não combina com property_id" : null) },
  { id: "longtail-typology-limit", description: "cauda longa: no máximo 3 dimensões de tipologia (e 1 dimensão near)", check: (d) => (TYPOLOGY.filter((k) => k in d).length > 3 ? "mais de 3 dimensões de tipologia" : null) },
  { id: "comparison-distinct-entities", description: "comparação exige entidades distintas", check: (d) => (d.compare_with !== undefined && d.compare_with === d.city ? "comparar uma cidade com ela mesma" : null) },
];

// Política inicial (spec 15.5, porte GRANDE); a política efetiva é a versão gravada por tenant. Valores por porte de cidade ficam para quando houver dados de porte.
export const DEFAULT_COMBINATION_POLICY: combination.CombinationPolicy = { maxDimensions: 4, longTailMaxDimensions: 5, redundancyRatio: 0.8, minExclusiveBlocks: 1, maxCandidatesPerRun: 5000, minItems: { typology_place: 8, city_comparison: 3 } };

export const FAMILIES: readonly combination.CombinationFamily[] = [
  { id: "city-comparison", pageFamily: "13-comparacao", rootPatternKeys: ["topic-city-overview"], expandable: ["compare_with"], longTail: false, minItemsKey: "city_comparison", parentRedundancy: false,
    child: { queryPatternKey: "topic-city-comparison", intentType: "comparative", geoGranularity: "city", userNeed: "Comparar dois municípios do mesmo estado com dados da mesma data-base", evidenceRequired: ["population", "common_attributes"], commercialPotential: "medium", attributesUsed: ["city.population", "city.population_census_2022", "city.density_census_2022"], relationshipsUsed: ["compared_with"] } },
  { id: "neighborhood-typology", pageFamily: "05-tipologia-lugar", rootPatternKeys: ["topic-neighborhood"], expandable: ["property_type", "transaction", "bedrooms"], longTail: false, minItemsKey: "typology_place",
    child: { queryPatternKey: "topic-neighborhood", intentType: "transactional", geoGranularity: "neighborhood", userNeed: "Encontrar imóveis de um tipo no bairro", evidenceRequired: ["active_listings"], commercialPotential: "high", attributesUsed: ["neighborhood.active_listings"], relationshipsUsed: ["located_in", "available_for"] } },
];

interface CityRow { key: string; name: string; uf: string | null; facts: Map<string, { value: number; year: number }> }
const COMPARABLE = ["city.population", "city.population_census_2022", "city.density_census_2022"] as const;

/** Espaço de dados REAL para a comparação entre municípios: lê as entidades e os fatos correntes do tenant. */
async function citySpace(db: TenantDb): Promise<combination.Space & { rank: (d: combination.Dims) => number }> {
  const ents = (await db.query<{ id: string; source_key: string; name: string }>(`SELECT id, source_key, name FROM plataforma.entity WHERE entity_type = 'city' AND status = 'ACTIVE'`)).rows;
  const facts = await catalog.currentFacts(db, [...COMPARABLE, "city.uf"]);
  const byId = new Map<string, CityRow>(ents.map((e) => [e.id, { key: e.source_key, name: e.name, uf: null, facts: new Map() }]));
  const obs = (await db.query<{ entity_id: string; attribute_id: string; observed_at: Date }>(`SELECT entity_id, attribute_id, observed_at FROM plataforma.fact WHERE superseded_at IS NULL AND attribute_id = ANY($1::text[])`, [[...COMPARABLE]])).rows;
  const year = new Map(obs.map((o) => [`${o.entity_id}|${o.attribute_id}`, o.observed_at.getUTCFullYear()]));
  for (const f of facts) { const c = byId.get(f.entityId); if (!c) continue; if (f.attributeId === "city.uf") c.uf = String(f.value); else if (typeof f.value === "number") c.facts.set(f.attributeId, { value: f.value, year: year.get(`${f.entityId}|${f.attributeId}`) ?? 0 }); }
  const cities = new Map([...byId.values()].map((c) => [c.key, c]));
  const common = (a: CityRow, b: CityRow) => COMPARABLE.filter((k) => a.facts.has(k) && b.facts.has(k) && a.facts.get(k)!.year === b.facts.get(k)!.year);
  return {
    rank: (d) => cities.get(d.city ?? "")?.facts.get("city.population")?.value ?? 0,
    // pares ordenados (chave menor primeiro) evitam A×B e B×A; só o mesmo estado, só os mais populosos (limite de custo da expansão)
    values: async (dim, parent) => { if (dim !== "compare_with") return []; const me = cities.get(parent.city ?? ""); if (!me?.uf) return []; return [...cities.values()].filter((c) => c.uf === me.uf && c.key > me.key).sort((a, b) => (b.facts.get("city.population")?.value ?? 0) - (a.facts.get("city.population")?.value ?? 0)).slice(0, 30).map((c) => c.key); },
    entityOk: async (d) => { const a = cities.get(d.city ?? ""); const b = cities.get(d.compare_with ?? ""); if (!a || !b) return "uma das cidades não existe como entidade"; if (!a.uf || !b.uf) return "UF desconhecida: não dá para garantir o mesmo estado"; if (a.uf !== b.uf) return "comparação exige o mesmo estado"; return null; },
    count: async (d) => { const a = cities.get(d.city ?? ""); const b = cities.get(d.compare_with ?? ""); if (!a || !b) return null; return common(a, b).length; },
    exclusiveBlocks: async (c) => { const a = cities.get(c.city ?? ""); const b = cities.get(c.compare_with ?? ""); return a && b ? common(a, b).length : 0; },
    demand: async () => null,
    intentKey: (d) => `cmp|${[d.city, d.compare_with].sort().join("|")}`,
    describe: (d) => `${cities.get(d.city ?? "")?.name ?? d.city} vs ${cities.get(d.compare_with ?? "")?.name ?? d.compare_with}: comparação`,
  };
}
/** Espaço de tipologia × lugar: SEM entidades de bairro nem anúncio não há o que contar; a contagem é desconhecida (null), nunca 0 inventado. */
async function typologySpace(): Promise<combination.Space> {
  const VALUES: Record<string, string[]> = { property_type: ["apartment", "house"], transaction: ["sale", "rent"], bedrooms: ["1", "2", "3"] };
  return { values: async (d) => VALUES[d] ?? [], entityOk: async () => null, count: async () => null, exclusiveBlocks: async () => 0, demand: async () => null, intentKey: (d) => JSON.stringify(d), describe: (d) => Object.values(d).join(" ") };
}
export const buildSpace = async (db: TenantDb, family: combination.CombinationFamily): Promise<combination.Space> => (family.id === "city-comparison" ? citySpace(db) : typologySpace());
