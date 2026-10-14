import type { catalog } from "@plataforma/api";

// Domain Pack #001 (imobiliário): entidades e atributos DECLARADOS para o catálogo (ADR-029). Declarar um atributo NÃO cria dado: sem fatos ele fica DATA_PENDING.
// Qualidade da fonte, validade e famílias de página são os valores INICIAIS calibráveis da especificação; a política de cobertura vive na política versionada do tenant.
const FAM = { cidade: "04-cidade", bairroHub: "03-bairro", tipologiaLugar: "05-tipologia-lugar", atributoLugar: "06-atributo-lugar", mobilidade: "07-mobilidade", amenidades: "08-perto-de", mercado: "10-preco-mercado", longTail: "16-long-tail", imovel: "01-imovel" } as const;
const a = (x: Partial<catalog.AttributeDefinition> & Pick<catalog.AttributeDefinition, "attributeId" | "entityType" | "name" | "dataType" | "origin" | "semanticCategory" | "source">): catalog.AttributeDefinition =>
  ({ sourceQuality: null, maxAgeDays: null, derivationMethod: null, relatedEntities: [], supportedIntents: [], potentialPageFamilies: [], ...x });

export const realEstateCatalog: catalog.CatalogPack = {
  entityTypes: [{ entityType: "city", label: "Município" }, { entityType: "neighborhood", label: "Bairro" }, { entityType: "listing", label: "Anúncio de imóvel" }],
  attributes: [
    a({ attributeId: "city.population", entityType: "city", name: "População residente (estimativa da importação)", dataType: "numeric", origin: "OBSERVED", semanticCategory: "demografia", source: "IBGE (importação real)", sourceQuality: 0.95, maxAgeDays: 800, supportedIntents: ["informational", "comparative"], potentialPageFamilies: [FAM.cidade] }),
    a({ attributeId: "city.uf", entityType: "city", name: "Unidade da federação", dataType: "categorical", origin: "OBSERVED", semanticCategory: "geografia", source: "IBGE (importação real)", sourceQuality: 0.99, supportedIntents: ["local"], potentialPageFamilies: [FAM.cidade] }),
    a({ attributeId: "city.region", entityType: "city", name: "Região", dataType: "categorical", origin: "OBSERVED", semanticCategory: "geografia", source: "IBGE (importação real)", sourceQuality: 0.99, supportedIntents: ["local"], potentialPageFamilies: [FAM.cidade] }),
    a({ attributeId: "city.population_census_2022", entityType: "city", name: "População do Censo 2022", dataType: "numeric", origin: "OBSERVED", semanticCategory: "demografia", source: "IBGE SIDRA, tabela 4714", sourceQuality: 0.95, supportedIntents: ["informational", "comparative"], potentialPageFamilies: [FAM.cidade] }),
    a({ attributeId: "city.density_census_2022", entityType: "city", name: "Densidade demográfica do Censo 2022", dataType: "numeric", origin: "OBSERVED", semanticCategory: "demografia", source: "IBGE SIDRA, tabela 4714", sourceQuality: 0.95, supportedIntents: ["informational", "comparative"], potentialPageFamilies: [FAM.cidade] }),
    a({ attributeId: "neighborhood.price_per_m2", entityType: "neighborhood", name: "Preço mediano do m² (venda)", dataType: "commercial", origin: "DERIVED", semanticCategory: "mercado imobiliário", source: "anúncios ativos (fonte pendente)", sourceQuality: 0.8, maxAgeDays: 30, derivationMethod: "median_price_per_m2", relatedEntities: ["listing"], supportedIntents: ["informational", "commercial", "comparative"], potentialPageFamilies: [FAM.bairroHub, FAM.mercado, FAM.tipologiaLugar] }),
    a({ attributeId: "neighborhood.active_listings", entityType: "neighborhood", name: "Anúncios ativos", dataType: "numeric", origin: "OBSERVED", semanticCategory: "mercado imobiliário", source: "anúncios ativos (fonte pendente)", sourceQuality: 0.9, maxAgeDays: 7, relatedEntities: ["listing"], supportedIntents: ["transactional", "commercial"], potentialPageFamilies: [FAM.tipologiaLugar, FAM.longTail] }),
    a({ attributeId: "neighborhood.poi_count_school", entityType: "neighborhood", name: "Escolas no raio do bairro", dataType: "numeric", origin: "DERIVED", semanticCategory: "educação", source: "OpenStreetMap (Overpass)", sourceQuality: 0.7, maxAgeDays: 180, derivationMethod: "poi_count_radius", supportedIntents: ["local", "informational"], potentialPageFamilies: [FAM.atributoLugar, FAM.amenidades] }),
    a({ attributeId: "neighborhood.poi_count_transit_stop", entityType: "neighborhood", name: "Paradas e estações no raio do bairro", dataType: "numeric", origin: "DERIVED", semanticCategory: "mobilidade", source: "OpenStreetMap (Overpass)", sourceQuality: 0.7, maxAgeDays: 90, derivationMethod: "poi_count_radius", supportedIntents: ["local", "informational"], potentialPageFamilies: [FAM.atributoLugar, FAM.mobilidade, FAM.amenidades] }),
    a({ attributeId: "neighborhood.travel_time_to_center", entityType: "neighborhood", name: "Tempo de deslocamento até o centro", dataType: "numeric", origin: "DERIVED", semanticCategory: "mobilidade", source: "serviço de roteamento (inexistente)", sourceQuality: 0.8, maxAgeDays: 90, derivationMethod: "routing_travel_time", supportedIntents: ["local", "comparative"], potentialPageFamilies: [FAM.mobilidade] }),
    a({ attributeId: "listing.bedrooms", entityType: "listing", name: "Quartos", dataType: "numeric", origin: "OBSERVED", semanticCategory: "tipologia", source: "anúncios (fonte pendente)", sourceQuality: 0.9, maxAgeDays: 7, supportedIntents: ["transactional"], potentialPageFamilies: [FAM.imovel, FAM.longTail] }),
  ],
  // valores iniciais calibráveis; a política efetiva é a versão gravada por tenant (política versionada)
  defaultPolicy: { minCoverageValid: 0.8, minCoveragePartial: 0.05, minConfidence: 0.7 },
};

/** Confiança dos fatos = qualidade da fonte declarada para o atributo. */
export const realEstateFactConfidence: Readonly<Record<string, number>> = Object.fromEntries(realEstateCatalog.attributes.filter((x) => x.sourceQuality !== null).map((x) => [x.attributeId, x.sourceQuality!]));
