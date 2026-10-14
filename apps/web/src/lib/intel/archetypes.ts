// Arquétipos de página como CONTRATOS DE RENDERIZAÇÃO: cada um declara a intenção que atende, os dados exigidos, os
// módulos que sabe renderizar e o tipo de dado estruturado. A disponibilidade é checada contra o dataset ativo.
import type { Opportunity, WorkspaceData } from "@/data/demo/types";

export type Requirement =
  | "verified_fact" | "all_facts_verified" | "structured_dataset" | "place_entities" | "comparable_entities"
  | "product_entity" | "related_questions" | "serp_observed" | "time_series" | "offer_data" | "reviews" | "healthy_crawl";

export const requirementLabel: Record<Requirement, string> = {
  verified_fact: "Ao menos um fato verificado",
  all_facts_verified: "Todos os fatos citados verificados",
  structured_dataset: "Dataset estruturado versionado",
  place_entities: "Entidades de lugar",
  comparable_entities: "Duas ou mais entidades comparáveis",
  product_entity: "Entidade de produto ou serviço",
  related_questions: "Duas ou mais consultas relacionadas",
  serp_observed: "SERP observada",
  time_series: "Série histórica",
  offer_data: "Oferta, preço ou disponibilidade",
  reviews: "Avaliações com fonte",
  healthy_crawl: "Rastreamento do site saudável",
};

export type ModuleId =
  | "definition" | "summary" | "facts" | "steps" | "comparison" | "faq" | "map" | "filters" | "entityList"
  | "dataTable" | "timeSeries" | "ranking" | "offer" | "cta" | "related" | "sources" | "schema";

export const moduleLabel: Record<ModuleId, string> = {
  definition: "Definição", summary: "Resumo", facts: "Fatos com fonte", steps: "Passo a passo", comparison: "Tabela comparativa",
  faq: "Perguntas frequentes", map: "Mapa", filters: "Filtros", entityList: "Lista de entidades", dataTable: "Tabela de dados",
  timeSeries: "Série temporal", ranking: "Ranking", offer: "Oferta", cta: "Chamada para ação", related: "Links internos",
  sources: "Fontes", schema: "Dados estruturados",
};

export type Archetype = {
  id: string;
  name: string;
  description: string;
  intents: readonly Opportunity["intent"][];
  kinds: readonly Opportunity["kind"][];
  entityTypes: readonly string[];
  requires: readonly Requirement[];
  optional: readonly Requirement[];
  modules: readonly ModuleId[];
  schemaType: string;
  /** Template de renderização já existente no workspace, quando houver. */
  templateId?: string;
};

export const ARCHETYPES: readonly Archetype[] = [
  { id: "entity-detail", name: "Entity Detail", description: "Uma página por entidade com definição verificada e relações.", intents: ["informacional"], kinds: ["página"], entityTypes: ["Conceito", "Produto", "Organização"], requires: ["verified_fact"], optional: ["related_questions"], modules: ["definition", "facts", "faq", "related", "sources", "schema"], schemaType: "DefinedTerm", templateId: "t-glossario" },
  { id: "location-hub", name: "Location Hub", description: "Página-mãe de um território com filhos programáticos.", intents: ["informacional", "transacional"], kinds: ["cluster"], entityTypes: ["Lugar"], requires: ["place_entities", "structured_dataset"], optional: ["verified_fact"], modules: ["summary", "map", "entityList", "dataTable", "related", "sources", "schema"], schemaType: "Place", templateId: "t-municipio" },
  { id: "neighborhood-hub", name: "Neighborhood Hub", description: "Recorte local abaixo do município, com infraestrutura e oferta.", intents: ["informacional", "transacional"], kinds: ["cluster", "página"], entityTypes: ["Lugar"], requires: ["place_entities", "structured_dataset", "offer_data"], optional: ["time_series"], modules: ["summary", "map", "dataTable", "offer", "cta", "sources", "schema"], schemaType: "Place" },
  { id: "directory", name: "Directory", description: "Lista filtrável de entidades do mesmo tipo.", intents: ["informacional", "transacional"], kinds: ["cluster"], entityTypes: ["Lugar", "Organização", "Produto"], requires: ["structured_dataset"], optional: ["place_entities"], modules: ["filters", "entityList", "map", "related", "schema"], schemaType: "ItemList" },
  { id: "comparison", name: "Comparison", description: "Critérios explícitos entre duas ou mais opções.", intents: ["comparação"], kinds: ["comparativo"], entityTypes: ["Conceito", "Produto"], requires: ["comparable_entities", "verified_fact"], optional: ["serp_observed"], modules: ["summary", "comparison", "facts", "faq", "cta", "sources", "schema"], schemaType: "Article" },
  { id: "alternatives", name: "Alternatives", description: "Alternativas a uma opção conhecida, com critérios.", intents: ["comparação"], kinds: ["comparativo"], entityTypes: ["Produto", "Organização"], requires: ["comparable_entities", "product_entity", "serp_observed"], optional: ["reviews"], modules: ["summary", "comparison", "entityList", "cta", "sources", "schema"], schemaType: "ItemList" },
  { id: "ranking", name: "Ranking & Recommendation", description: "Ordenação justificada por critérios publicados.", intents: ["comparação", "transacional"], kinds: ["comparativo", "cluster"], entityTypes: ["Produto", "Organização", "Lugar"], requires: ["comparable_entities", "reviews"], optional: ["offer_data"], modules: ["summary", "ranking", "comparison", "cta", "sources", "schema"], schemaType: "ItemList" },
  { id: "guide", name: "Guide", description: "Passo a passo apoiado em fatos com fonte e validade.", intents: ["informacional"], kinds: ["página"], entityTypes: ["Conceito"], requires: ["verified_fact"], optional: ["related_questions"], modules: ["summary", "steps", "facts", "faq", "related", "sources", "schema"], schemaType: "HowTo", templateId: "t-guia" },
  { id: "facet", name: "Attribute / Facet", description: "Recorte por atributo (ex.: faixa, tipo, característica).", intents: ["informacional", "transacional"], kinds: ["cluster"], entityTypes: ["Lugar", "Produto"], requires: ["structured_dataset"], optional: ["offer_data"], modules: ["filters", "dataTable", "entityList", "schema"], schemaType: "ItemList" },
  { id: "use-case", name: "Use Case", description: "Problema concreto resolvido por produto ou serviço.", intents: ["informacional", "transacional"], kinds: ["página"], entityTypes: ["Produto", "Conceito"], requires: ["product_entity", "verified_fact"], optional: ["related_questions"], modules: ["summary", "steps", "facts", "cta", "related", "schema"], schemaType: "Article" },
  { id: "transactional", name: "Transactional", description: "Página de decisão com oferta, condições e próximo passo.", intents: ["transacional"], kinds: ["página"], entityTypes: ["Produto"], requires: ["product_entity", "offer_data"], optional: ["reviews"], modules: ["summary", "offer", "facts", "faq", "cta", "schema"], schemaType: "Product" },
  { id: "data-insights", name: "Data / Insights", description: "Leitura de um dataset com metodologia e ano de referência.", intents: ["informacional"], kinds: ["cluster", "página"], entityTypes: ["Lugar", "Conceito"], requires: ["structured_dataset", "time_series"], optional: ["verified_fact"], modules: ["summary", "timeSeries", "dataTable", "facts", "sources", "schema"], schemaType: "Dataset" },
  { id: "faq", name: "FAQ / Q&A", description: "Respostas curtas a perguntas reais, cada uma com fonte.", intents: ["informacional"], kinds: ["FAQ"], entityTypes: ["Conceito", "Produto"], requires: ["related_questions", "all_facts_verified"], optional: ["serp_observed"], modules: ["faq", "facts", "related", "sources", "schema"], schemaType: "FAQPage" },
  { id: "programmatic", name: "Programmatic Combination", description: "Combinação entidade × atributo gerada em lote.", intents: ["informacional", "transacional"], kinds: ["cluster"], entityTypes: ["Lugar", "Produto"], requires: ["structured_dataset", "place_entities"], optional: ["offer_data"], modules: ["summary", "dataTable", "map", "related", "schema"], schemaType: "WebPage", templateId: "t-municipio" },
  { id: "news-trend", name: "News / Trend Landing", description: "Página datada sobre um sinal de mercado com fontes primárias.", intents: ["informacional"], kinds: ["página", "cluster"], entityTypes: ["Conceito", "Lugar"], requires: ["time_series", "verified_fact"], optional: ["serp_observed"], modules: ["summary", "timeSeries", "facts", "related", "sources", "schema"], schemaType: "NewsArticle" },
];

export const archetypeById = (id: string) => ARCHETYPES.find((a) => a.id === id);

export function availability(d: WorkspaceData, o: Opportunity): Record<Requirement, boolean> {
  const knowledge = d.knowledge.filter((k) => o.knowledgeIds.includes(k.id));
  const entities = d.entities.filter((e) => o.entityIds.includes(e.id));
  const sources = d.sources.filter((s) => o.sourceIds.includes(s.id));
  const crawler = d.sources.find((s) => s.type === "Crawler");
  const types = new Map<string, number>();
  for (const e of entities) types.set(e.type, (types.get(e.type) ?? 0) + 1);
  return {
    verified_fact: knowledge.some((k) => k.status === "verified"),
    all_facts_verified: knowledge.length > 0 && knowledge.every((k) => k.status === "verified"),
    structured_dataset: sources.some((s) => s.type === "Arquivo versionado" && s.health === "ok" && s.records > 1),
    place_entities: entities.some((e) => e.type === "Lugar"),
    comparable_entities: [...types.values()].some((n) => n >= 2) && o.kind === "comparativo",
    product_entity: entities.some((e) => e.type === "Produto"),
    related_questions: d.queries.filter((q) => q.opportunityId === o.id).length >= 2,
    serp_observed: false,
    time_series: false,
    offer_data: false,
    reviews: false,
    healthy_crawl: crawler?.health === "ok",
  };
}

export type Recommendation = { archetype: Archetype; fit: number; reasons: readonly string[]; missing: readonly Requirement[] };

export function rankArchetypes(d: WorkspaceData, o: Opportunity): Recommendation[] {
  const avail = availability(d, o);
  const entityTypes = new Set(d.entities.filter((e) => o.entityIds.includes(e.id)).map((e) => e.type));
  return ARCHETYPES.map((a) => {
    const reasons: string[] = [];
    let fit = 0;
    if (a.intents.includes(o.intent)) { fit += 3; reasons.push(`Atende a intenção ${o.intent}.`); }
    if (a.kinds.includes(o.kind)) { fit += 2; reasons.push(`Formato compatível com "${o.kind}".`); }
    const typeMatch = a.entityTypes.filter((t) => entityTypes.has(t));
    if (typeMatch.length) { fit += 2; reasons.push(`Entidades do tipo ${typeMatch.join(", ")} disponíveis.`); }
    const missing = a.requires.filter((r) => !avail[r]);
    const met = a.requires.length - missing.length;
    fit += (met / a.requires.length) * 4;
    if (missing.length === 0) reasons.push("Todos os dados exigidos estão disponíveis.");
    if (a.templateId) { fit += 0.5; reasons.push("Já existe template de renderização no workspace."); }
    return { archetype: a, fit, reasons, missing };
  }).sort((x, y) => y.fit - x.fit);
}
