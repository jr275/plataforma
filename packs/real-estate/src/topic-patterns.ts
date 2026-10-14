import type { topics } from "@plataforma/api";

// Padrões de tópico do Domain Pack imobiliário (ADR-030). Só entram tópicos cujos atributos estão VALID/PARTIAL no catálogo: hoje, só o nível município tem dados reais.
// Padrões de bairro, anúncio e POI são declarados para o dia em que houver dados; até lá o gerador os ignora com o motivo (nada é inventado).
export const FAMILIES = ["01-imovel", "03-bairro", "04-cidade", "05-tipologia-lugar", "06-atributo-lugar", "07-mobilidade", "08-perto-de", "10-preco-mercado", "13-comparacao", "16-long-tail"] as const;

export const realEstateTopicPatterns: readonly topics.TopicPattern[] = [
  { id: "city-overview", queryPatternKey: "topic-city-overview", entityType: "city", requiredAttributes: ["city.population", "city.uf", "city.region"], optionalAttributes: ["city.population_census_2022", "city.density_census_2022"],
    baseDimensions: { topic: "visao_geral" }, geoGranularity: "city", intentType: "informational", family: "04-cidade", userNeed: "Entender o tamanho, a localização e os dados demográficos básicos do município",
    queryTemplate: "{name} ({qualifier}): população e dados do município", evidenceRequired: ["population", "uf", "region"], commercialPotential: "low", relationshipsUsed: ["located_in"], origin: "ATTRIBUTE" },
  { id: "neighborhood-price-m2", queryPatternKey: "topic-neighborhood", entityType: "neighborhood", requiredAttributes: ["neighborhood.price_per_m2", "neighborhood.active_listings"], optionalAttributes: [],
    baseDimensions: { topic: "preco_m2" }, geoGranularity: "neighborhood", intentType: "informational", family: "10-preco-mercado", userNeed: "Saber quanto custa o m² no bairro",
    queryTemplate: "preço do m² em {name}", evidenceRequired: ["median_price_per_m2", "active_listings"], commercialPotential: "high", relationshipsUsed: ["located_in"], origin: "ATTRIBUTE" },
  { id: "neighborhood-schools", queryPatternKey: "topic-neighborhood", entityType: "neighborhood", requiredAttributes: ["neighborhood.poi_count_school"], optionalAttributes: [],
    baseDimensions: { topic: "escolas_proximas" }, geoGranularity: "neighborhood", intentType: "local", family: "08-perto-de", userNeed: "Encontrar escolas perto de onde morar",
    queryTemplate: "escolas perto de {name}", evidenceRequired: ["poi_count_school"], commercialPotential: "medium", relationshipsUsed: ["near"], origin: "RELATIONSHIP" },
  { id: "neighborhood-transit", queryPatternKey: "topic-neighborhood", entityType: "neighborhood", requiredAttributes: ["neighborhood.poi_count_transit_stop"], optionalAttributes: ["neighborhood.travel_time_to_center"],
    baseDimensions: { topic: "mobilidade" }, geoGranularity: "neighborhood", intentType: "local", family: "07-mobilidade", userNeed: "Entender como chegar de transporte público a partir do bairro",
    queryTemplate: "transporte público em {name}", evidenceRequired: ["poi_count_transit_stop"], commercialPotential: "medium", relationshipsUsed: ["near", "connected_to"], origin: "RELATIONSHIP" },
];
