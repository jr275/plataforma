import type { eligibility } from "@plataforma/api";

// Política de elegibilidade inicial do Domain Pack imobiliário (spec 8 e 15): pesos, pisos e limiares são VALORES INICIAIS CALIBRÁVEIS; a política efetiva é a versão gravada por tenant.
// Os parâmetros por família (mínimo de blocos, custo de manutenção) são julgamentos do pack, não medidas; `geoScore: null` = a descoberta por IA da família ainda não é medida.
export const DEFAULT_ELIGIBILITY_POLICY: eligibility.EligibilityPolicy = {
  minResolutionConfidence: 0.8, minEvidenceConfidence: 0.7, minUniqueBlocks: 3, uniquenessTarget: 5, demandSaturation: 10_000, similarityThreshold: 0.6,
  weights: { search_demand: 20, user_utility: 15, data_availability: 10, evidence_quality: 10, uniqueness: 10, business_relevance: 10, conversion_potential: 5, serp_opportunity: 5, graph_connectivity: 5, production_cost: 5, freshness: 3, geo_ai_discoverability: 2 },
  floors: { user_utility: 50, evidence_quality: 60, uniqueness: 50 },
  readyMin: 75, dataRequiredMin: 60, minWeightCoverage: 0.8,
  businessRelevance: { high: 100, medium: 65, low: 35, none: 0 },
  conversion: { transactional: 100, commercial: 80, comparative: 60, local: 50, informational: 30, question: 25, seasonal: 40 },
  families: {
    "04-cidade": { minBlocks: 3, idealBlocks: 5, maintenanceCost: 20, geoScore: null },
    "13-comparacao": { minBlocks: 2, idealBlocks: 4, maintenanceCost: 40, geoScore: null },
    "03-bairro": { minBlocks: 4, idealBlocks: 8, maintenanceCost: 35, geoScore: null },
    "05-tipologia-lugar": { minBlocks: 3, idealBlocks: 6, maintenanceCost: 45, geoScore: null },
    "06-atributo-lugar": { minBlocks: 3, idealBlocks: 6, maintenanceCost: 40, geoScore: null },
    "07-mobilidade": { minBlocks: 3, idealBlocks: 6, maintenanceCost: 40, geoScore: null },
    "08-perto-de": { minBlocks: 3, idealBlocks: 6, maintenanceCost: 40, geoScore: null },
    "10-preco-mercado": { minBlocks: 3, idealBlocks: 6, maintenanceCost: 50, geoScore: null },
    "16-long-tail": { minBlocks: 3, idealBlocks: 6, maintenanceCost: 55, geoScore: null },
  },
  connectivity: { parent: 30, siblings: 50, children: 20, siblingCap: 5, childCap: 3 },
  forbiddenCategories: ["segurança percebida", "tolerância", "perfil de moradores", "social"],
};

/** G6: conflitos geográficos/semânticos que dependem dos fatos das entidades (ex.: comparação exige o mesmo estado). */
export const coherence: NonNullable<Parameters<typeof import("@plataforma/api").eligibility.runEvaluation>[3]["coherence"]> = (t, factsOf) => {
  if (t.family !== "13-comparacao") return [];
  const a = factsOf(t.dimensions.city ?? "", "city.uf"); const b = factsOf(t.dimensions.compare_with ?? "", "city.uf");
  if (a === undefined || b === undefined) return ["UF de uma das cidades desconhecida: não dá para garantir o mesmo estado"];
  return a === b ? [] : [`cidades de estados diferentes (${String(a)} × ${String(b)})`];
};
