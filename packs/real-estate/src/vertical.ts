import type { engine } from "@plataforma/api";

// Vertical IMOBILIÁRIA BRASILEIRA (ADR-023, seção 8). É a primeira vertical de validação: tudo que é de imóvel, RE/MAX ou corretor vive aqui (regra 10).
// O núcleo só executa esta definição. Os pesos e valores abaixo são JULGAMENTOS DA VERTICAL (configuráveis por tenant), não medidas.
export const VERTICAL_ID = "real-estate-br" as const;

const intents: engine.VerticalDefinition["intents"] = [
  { id: "buy", label: "Compra", commercialWeight: 1, conversionProximity: 0.9 },
  { id: "rent", label: "Locação", commercialWeight: 0.8, conversionProximity: 0.85 },
  { id: "financing", label: "Financiamento", commercialWeight: 0.7, conversionProximity: 0.6 },
  { id: "market_research", label: "Pesquisa de mercado", commercialWeight: 0.5, conversionProximity: 0.35 },
  { id: "recommendation", label: "Recomendação e comparação", commercialWeight: 0.6, conversionProximity: 0.5 },
  { id: "brand_local", label: "Marca e escritório local", commercialWeight: 0.6, conversionProximity: 0.7 },
  { id: "informational", label: "Informacional", commercialWeight: 0.3, conversionProximity: 0.15 },
];
const stages: engine.VerticalDefinition["stages"] = [
  { id: "awareness", label: "Descoberta", order: 0, conversionProximity: 0.1 },
  { id: "consideration", label: "Consideração", order: 1, conversionProximity: 0.4 },
  { id: "decision", label: "Decisão", order: 2, conversionProximity: 0.8 },
];

const P = (p: engine.QueryPattern): engine.QueryPattern => p;
const patterns: engine.QueryPattern[] = [
  P({ key: "buy-apartments", group: "buy", intent: "buy", stage: "decision", entityKind: "city", templates: ["apartamentos à venda em {entity}", "comprar apartamento em {entity}", "apartamento à venda {entity}"], jtbd: "Encontrar um apartamento para comprar na cidade", experience: "listing_directory", valueTier: "high", requiredEvidence: ["geo_entities", "listing_inventory"], outcome: "leads de compra" }),
  P({ key: "buy-houses", group: "buy", intent: "buy", stage: "decision", entityKind: "city", templates: ["casas à venda em {entity}", "comprar casa em {entity}", "casa à venda {entity}"], jtbd: "Encontrar uma casa para comprar na cidade", experience: "listing_directory", valueTier: "high", requiredEvidence: ["geo_entities", "listing_inventory"], outcome: "leads de compra" }),
  P({ key: "rent-apartments", group: "rent", intent: "rent", stage: "decision", entityKind: "city", templates: ["apartamentos para alugar em {entity}", "alugar apartamento em {entity}", "apartamento para alugar {entity}"], jtbd: "Encontrar um apartamento para alugar na cidade", experience: "listing_directory", valueTier: "high", requiredEvidence: ["geo_entities", "listing_inventory"], outcome: "leads de locação" }),
  P({ key: "rent-houses", group: "rent", intent: "rent", stage: "decision", entityKind: "city", templates: ["casas para alugar em {entity}", "alugar casa em {entity}", "casa para alugar {entity}"], jtbd: "Encontrar uma casa para alugar na cidade", experience: "listing_directory", valueTier: "medium", requiredEvidence: ["geo_entities", "listing_inventory"], outcome: "leads de locação" }),
  P({ key: "price-per-sqm", group: "market", intent: "market_research", stage: "consideration", entityKind: "city", templates: ["preço do metro quadrado em {entity}", "valor do metro quadrado em {entity}"], jtbd: "Saber quanto custa o metro quadrado na cidade", experience: "data_insights", valueTier: "high", requiredEvidence: ["geo_entities", "price_data"], outcome: "tráfego qualificado de compradores" }),
  P({ key: "cost-of-living", group: "market", intent: "market_research", stage: "consideration", entityKind: "city", templates: ["quanto custa morar em {entity}", "custo de vida em {entity}"], jtbd: "Avaliar o custo de morar na cidade", experience: "data_insights", valueTier: "medium", requiredEvidence: ["geo_entities", "price_data", "inflation_context"], outcome: "tráfego qualificado de compradores e locatários" }),
  P({ key: "best-neighborhoods", group: "market", intent: "recommendation", stage: "consideration", entityKind: "city", templates: ["melhores bairros de {entity}", "melhores bairros para morar em {entity}"], jtbd: "Escolher um bairro para morar na cidade", experience: "ranking_recommendation", valueTier: "high", requiredEvidence: ["geo_entities", "neighborhood_data", "price_data"], outcome: "leads de compra e locação" }),
  P({ key: "mortgage-city", group: "finance", intent: "financing", stage: "consideration", entityKind: "city", templates: ["financiamento imobiliário em {entity}", "como financiar imóvel em {entity}"], jtbd: "Entender como financiar um imóvel na cidade", experience: "guide", valueTier: "medium", requiredEvidence: ["geo_entities", "credit_rates"], outcome: "leads de financiamento" }),
  P({ key: "city-overview", group: "local", intent: "informational", stage: "awareness", entityKind: "city", templates: ["morar em {entity}", "como é morar em {entity}", "o que saber antes de se mudar para {entity}"], jtbd: "Conhecer a cidade antes de decidir", experience: "location_overview", valueTier: "medium", requiredEvidence: ["geo_entities"], outcome: "tráfego de descoberta" }),
  P({ key: "brand-offices", group: "brand", intent: "brand_local", stage: "decision", entityKind: "city", templates: ["remax {entity}", "remax em {entity}", "escritório remax {entity}"], jtbd: "Encontrar o escritório da marca na cidade", experience: "office_directory_page", valueTier: "high", requiredEvidence: ["geo_entities", "office_directory"], outcome: "contato com o escritório" }),
  P({ key: "mortgage-rates", group: "finance", intent: "financing", stage: "consideration", entityKind: null, templates: ["taxa de juros do financiamento imobiliário", "juros do financiamento imobiliário hoje"], jtbd: "Saber quanto custa financiar um imóvel agora", experience: "data_insights", valueTier: "high", requiredEvidence: ["credit_rates"], outcome: "leads de financiamento" }),
  P({ key: "selic-mortgage", group: "finance", intent: "informational", stage: "awareness", entityKind: null, templates: ["selic e financiamento imobiliário", "como a selic afeta o financiamento imobiliário"], jtbd: "Entender o efeito da Selic no financiamento", experience: "guide", valueTier: "medium", requiredEvidence: ["credit_rates"], outcome: "tráfego informativo" }),
  P({ key: "rent-adjustment", group: "rent", intent: "informational", stage: "consideration", entityKind: null, templates: ["reajuste do aluguel igp-m", "igp-m aluguel"], jtbd: "Calcular o reajuste do aluguel", experience: "data_insights", valueTier: "medium", requiredEvidence: ["rent_indices"], outcome: "tráfego de locatários e proprietários" }),
  P({ key: "mortgage-howto", group: "finance", intent: "informational", stage: "awareness", entityKind: null, templates: ["como financiar um imóvel", "como funciona o financiamento imobiliário"], jtbd: "Aprender a financiar um imóvel", experience: "guide", valueTier: "medium", requiredEvidence: ["editorial"], outcome: "tráfego informativo" }),
  // Padrões que SÓ o motor de tópicos usa (ADR-030): dão ao tópico o contrato de blueprint e de geração; a descoberta por padrão × entidade os ignora.
  P({ key: "topic-city-overview", group: "geo_info", intent: "informational", stage: "awareness", entityKind: "city", topicOnly: true, templates: ["{entity}: população e dados do município"], jtbd: "Entender o tamanho e as características básicas do município", experience: "location_overview", valueTier: "low", requiredEvidence: ["geo_entities"], outcome: "tráfego informativo qualificado" }),
];

const signals: engine.SignalRule[] = [
  { topic: "credit_rates", label: "Juros e crédito", keywords: ["selic", "juros", "financiamento", "credito", "copom", "hipoteca"], indicators: ["bcb-sgs:432"], groups: ["finance", "buy"], explain: "Juros e crédito afetam a demanda por financiamento e compra de imóveis" },
  { topic: "inflation_rent", label: "Inflação e reajuste de aluguel", keywords: ["aluguel", "igp-m", "igpm", "ipca", "inflacao", "reajuste"], indicators: ["bcb-sgs:189", "bcb-sgs:13522"], groups: ["rent", "market"], explain: "Índices de preços afetam o reajuste de aluguéis e o custo de morar" },
  { topic: "housing_market", label: "Mercado imobiliário", keywords: ["imobil", "imovel", "imoveis", "habitacao", "moradia", "construcao civil", "lancamento", "metro quadrado", "casa propria", "minha casa minha vida"], indicators: [], groups: ["buy", "rent", "market", "local"], explain: "Notícias do mercado imobiliário e da habitação" },
  { topic: "urban_development", label: "Desenvolvimento urbano", keywords: ["infraestrutura", "urbanizacao", "metro", "transporte", "bairro", "obra"], indicators: [], groups: ["local", "market"], explain: "Mudanças urbanas que alteram a procura por regiões e bairros" },
  { topic: "population_data", label: "População e domicílios", keywords: ["populacao", "censo", "domicilio", "demografic"], indicators: [], groups: ["local", "market"], explain: "Dados demográficos que contextualizam a demanda por moradia" },
];

const requirements: engine.EvidenceRequirement[] = [
  { id: "geo_entities", label: "Cidades do tenant", weight: "critical", satisfiedBy: ["entities"], note: "municípios do IBGE já importados para o tenant" },
  { id: "listing_inventory", label: "Inventário de imóveis", weight: "critical", satisfiedBy: ["source:property-feed"], note: "fonte real e autorizada de imóveis (ainda inexistente)" },
  { id: "price_data", label: "Preços de mercado", weight: "critical", satisfiedBy: ["source:price-series"], note: "série de preços com fonte e data (ainda inexistente)" },
  { id: "neighborhood_data", label: "Dados de bairros", weight: "critical", satisfiedBy: ["source:neighborhood-dataset"], note: "bairros, escolas, transporte (ainda inexistente)" },
  { id: "office_directory", label: "Escritórios da marca", weight: "critical", satisfiedBy: ["source:office-directory"], note: "lista de escritórios com endereço e contato (ainda inexistente)" },
  { id: "credit_rates", label: "Taxa de juros (Selic)", weight: "important", satisfiedBy: ["indicator:bcb-sgs:432"], note: "indicador do Banco Central" },
  { id: "rent_indices", label: "Índice de reajuste (IGP-M)", weight: "important", satisfiedBy: ["indicator:bcb-sgs:189"], note: "indicador do Banco Central" },
  { id: "inflation_context", label: "Inflação (IPCA)", weight: "optional", satisfiedBy: ["indicator:bcb-sgs:13522"], note: "indicador do Banco Central" },
  { id: "editorial", label: "Conteúdo editorial revisado", weight: "important", satisfiedBy: ["source:editorial-content"], note: "texto autoral com revisão (a plataforma não gera fatos)" },
];

const experiences: engine.ExperienceDef[] = [
  { id: "location_overview", label: "Visão geral da cidade", status: "supported", note: "template city-overview", servedByTemplates: ["city-overview"] },
  { id: "listing_directory", label: "Diretório de imóveis", status: "planned", note: "depende de inventário real" },
  { id: "data_insights", label: "Dados e indicadores", status: "planned", note: "depende de fonte de dados com data" },
  { id: "ranking_recommendation", label: "Ranking e recomendação", status: "planned", note: "depende de critérios com fonte e cobertura" },
  { id: "guide", label: "Guia", status: "planned", note: "depende de conteúdo editorial revisado" },
  { id: "office_directory_page", label: "Página de escritório", status: "planned", note: "depende de lista de escritórios" },
];

export const REAL_ESTATE_SCORE_CONFIG: engine.ScoreConfig = {
  schema: "opportunity-score/v2",
  objectives: {
    commercial_value: { weight: 0.45, minCoverage: 0.5, dimensions: { demand: 3, intent: 3, buyer_stage: 1, business_value: 3, conversion_proximity: 2, pipeline_potential: 2 } },
    execution_feasibility: { weight: 0.35, minCoverage: 0.5, dimensions: { solution_fit: 3, evidence_availability: 3, evidence_risk: 2, cannibalization_risk: 2 } },
    discovery_opportunity: { weight: 0.2, minCoverage: 0.5, dimensions: { serp_opportunity: 2, authority_gap: 2, competition: 2, citation_potential: 1, information_gain: 2 } },
  },
  riskPenalties: { evidence_risk: { threshold: 0.7, multiplier: 0.6 }, cannibalization_risk: { threshold: 0.8, multiplier: 0.5 } },
  uncertaintyFactor: 0.5,
  categories: { valueTier: { high: 1, medium: 0.6, low: 0.3 }, experienceStatus: { supported: 1, planned: 0.5, unsupported: 0.1 }, requirementRisk: { critical: 0.9, important: 0.5, optional: 0.2 }, cannibalization: { overlap: 0.85, none: 0.1 } },
  priority: { partialMinObjectives: 2 },
  eligibility: { minCommercialValue: 40, minExecutionFeasibility: 35, maxEvidenceRisk: 0.7, maxCannibalizationRisk: 0.8, requireStrategicOrDemand: true },
};

export const realEstateVertical: engine.VerticalDefinition = {
  id: VERTICAL_ID, name: "Mercado imobiliário (Brasil)", language: "pt-BR", country: "BR", entityKinds: ["city"],
  intents, stages, patterns, signals, evidenceRequirements: requirements, experiences,
  relevanceKeywords: ["imobil", "imovel", "imoveis", "habitacao", "moradia", "aluguel", "financiamento", "juros", "selic", "credito", "construcao civil", "casa propria", "ipca", "inflacao", "igp", "populacao", "censo", "domicilio"],
  sources: {
    bcbSeries: [
      { id: 432, label: "Meta Selic (Copom)", unit: "% a.a.", frequency: "daily", topic: "credit_rates" },
      { id: 13522, label: "IPCA acumulado em 12 meses", unit: "%", frequency: "monthly", topic: "inflation_rent" },
      { id: 189, label: "IGP-M (variação mensal)", unit: "%", frequency: "monthly", topic: "inflation_rent" },
    ],
    ibgeSearchTerms: ["habitação", "imóveis", "aluguel", "construção civil", "domicílios", "população"],
    rssFeeds: [{ id: "agencia-brasil-economia", label: "Agência Brasil: economia", url: "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml" }],
  },
  // Pilotos por cidade (códigos IBGE de município). São Paulo é o primeiro; Rio de Janeiro e Belo Horizonte ficam configurados para a expansão.
  // Um escopo só recorta o que o tenant já importou: se o município não foi importado, o relatório da pesquisa o lista como ausente.
  scopes: [
    { id: "pilot-sao-paulo", label: "Piloto: São Paulo (SP)", entityKind: "city", entityCodes: ["3550308"] },
    { id: "pilot-rio-de-janeiro", label: "Expansão: Rio de Janeiro (RJ)", entityKind: "city", entityCodes: ["3304557"] },
    { id: "pilot-belo-horizonte", label: "Expansão: Belo Horizonte (MG)", entityKind: "city", entityCodes: ["3106200"] },
    { id: "pilot-three-capitals", label: "Piloto ampliado: São Paulo, Rio de Janeiro e Belo Horizonte", entityKind: "city", entityCodes: ["3550308", "3304557", "3106200"] },
  ],
  synonyms: { apto: "apartamento", ap: "apartamento", imobiliaria: "imobiliaria" },
  scoring: REAL_ESTATE_SCORE_CONFIG,
};
