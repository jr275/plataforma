import { z } from "zod";
import { AMENITY_CATEGORIES, ISO, S, adminLevel, amenity, coords, faq, identity, image, location, metric, minCount, noInventedOffers, noTravelTimeWithoutRouting, notExpired, offer, present, related, signalChars, signalCount, signalObjectTotal, slug, sourcedMetrics, station } from "./data";
import type { ArchetypeContract, ArchetypeId } from "./types";

// Catálogo dos 12 archetypes (contratos genéricos). Os padrões de URL são EXEMPLOS configuráveis por tenant. Os pesos de densidade são o perfil INICIAL de cada archetype (versionado): só o T03 usa os pesos de referência
// do documento; os demais são pontos de partida a calibrar com desempenho, e NÃO são universais. Dados de mercado (imobiliário) não existem no núcleo: entram como `domainMetrics` por extensão do pack.
const base = { identity, summary: S.optional(), faqs: z.array(faq).default([]), related: z.array(related).default([]), image: image.optional(), domainMetrics: z.array(metric).default([]) };
const obj = <T extends z.ZodRawShape>(s: T) => z.object({ ...base, ...s }).strict() as unknown as z.ZodType<Record<string, unknown>>;
const AI_FORBID = ["fatos, números, distâncias, tempos, avaliações, preços ou rankings fora do grafo", "módulos fora do contrato do blueprint"] as const;
const DEFAULT_ALLOWED = ["narrativa dos slots do recipe, com referências de fatos do slot"] as const;
const mk = (c: Omit<ArchetypeContract, "version" | "aiPolicy" | "canonical" | "compatibleTemplates"> & Partial<Pick<ArchetypeContract, "canonical" | "compatibleTemplates" | "aiPolicy">>): ArchetypeContract => ({ version: "1.0.0", aiPolicy: { allowedSlots: DEFAULT_ALLOWED, factsFrom: "knowledge_graph_only", forbidden: AI_FORBID }, canonical: { rule: "self" }, compatibleTemplates: [], ...c });
const LINKS = (rel: ArchetypeContract["linkRules"]["allowedRelations"], min = 3) => ({ allowedRelations: rel, minInlinks: min });

// T03 — referência. Atenção à reconciliação: o SCHEMA exige ≥ 50 caracteres em overviewSynthesis (forma mínima aceitável); a DENSIDADE só pontua a síntese com ≥ 100 (o sinal vale para indexação).
// Uma síntese de 60 caracteres é válida estruturalmente, mas não atinge o sinal de densidade: são regras com finalidades distintas e aparecem separadas no resultado.
export const T03_SYNTHESIS_SCHEMA_MIN = 50; export const T03_SYNTHESIS_DENSITY_MIN = 100;
const t03Schema = obj({
  location, overviewSynthesis: S.min(T03_SYNTHESIS_SCHEMA_MIN),
  profile: z.object({ character: S.optional(), features: z.array(S).default([]), audiences: z.array(S).default([]) }).strict().optional(),
  mobility: z.object({ indices: z.array(metric).default([]), stations: z.array(station).default([]) }).strict().default({ indices: [], stations: [] }),
  amenities: z.object(Object.fromEntries(AMENITY_CATEGORIES.map((c) => [c, z.array(amenity).default([])])) as Record<(typeof AMENITY_CATEGORIES)[number], z.ZodDefault<z.ZodArray<typeof amenity>>>).strict().default({ education: [], mobility: [], health: [], gastronomy: [], retail_shopping: [], parks_recreation: [], safety: [] }),
});

const catalog: ArchetypeContract[] = [
  mk({ id: "T01", key: "destination_hub", name: "Destination Hub", primaryIntent: { primary: "Explore", secondary: "Plan" }, mainEntityKind: "place", urlPattern: "/destinations/{slug}", expectedDensity: "high",
    schemaTypes: { required: ["TouristDestination", "BreadcrumbList"], optional: ["ItemList"], conditional: [] },
    schema: obj({ location, overviewSynthesis: S.min(50), highlights: z.array(S).default([]), childPlaces: z.array(related).default([]) }),
    requirements: [present("T01.identity", "identity.name", "Nome do destino"), present("T01.location", "location.adminHierarchy", "Hierarquia administrativa"), present("T01.synthesis", "overviewSynthesis", "Síntese do destino"), minCount("T01.children", "childPlaces", 3, "Ao menos 3 lugares filhos para um hub")],
    density: { version: "1.0.0", indexingThreshold: 0.7, signals: [signalChars("synthesis_100", 0.3, "overviewSynthesis", 100, "Síntese ≥ 100 caracteres"), signalCount("children_3", 0.35, "childPlaces", 3, "≥ 3 lugares filhos"), signalCount("highlights_3", 0.2, "highlights", 3, "≥ 3 destaques"), signalCount("faqs_2", 0.15, "faqs", 2, "≥ 2 FAQs")] },
    linkRules: LINKS(["parent", "child", "region_to_city", "destination_to_poi", "cluster_to_page", "breadcrumb"]), modules: ["hero", "highlights", "places-list", "faq"], gateRules: ["hub_has_children"] }),
  mk({ id: "T02", key: "regional_guide", name: "Regional Guide", primaryIntent: { primary: "Explore", secondary: "Filter" }, mainEntityKind: "place", urlPattern: "/regions/{slug}", expectedDensity: "high",
    schemaTypes: { required: ["TouristDestination", "ItemList"], optional: ["BreadcrumbList"], conditional: [] },
    schema: obj({ location, overviewSynthesis: S.min(50), cities: z.array(related).default([]), filters: z.array(S).default([]) }),
    requirements: [present("T02.identity", "identity.name", "Nome da região"), present("T02.synthesis", "overviewSynthesis", "Síntese da região"), minCount("T02.cities", "cities", 2, "Ao menos 2 cidades na região")],
    density: { version: "1.0.0", indexingThreshold: 0.7, signals: [signalChars("synthesis_100", 0.3, "overviewSynthesis", 100, "Síntese ≥ 100 caracteres"), signalCount("cities_3", 0.45, "cities", 3, "≥ 3 cidades"), signalCount("filters_2", 0.1, "filters", 2, "≥ 2 filtros"), signalCount("faqs_2", 0.15, "faqs", 2, "≥ 2 FAQs")] },
    linkRules: LINKS(["parent", "child", "region_to_city", "cluster_to_page", "breadcrumb"]), modules: ["hero", "cities-list", "filters", "faq"], gateRules: ["region_lists_cities"] }),
  mk({ id: "T03", key: "city_neighborhood_guide", name: "City & Neighborhood Guide", primaryIntent: { primary: "Explore", secondary: "Plan" }, mainEntityKind: "place", urlPattern: "/bairros/{slug}", expectedDensity: "high",
    schemaTypes: { required: ["AdministrativeArea", "Place", "BreadcrumbList"], optional: [], conditional: ["AggregateOffer"] }, schema: t03Schema,
    requirements: [present("T03.identity", "identity.name", "Nome do lugar"), present("T03.location", "location.adminHierarchy", "Hierarquia administrativa"), present("T03.synthesis", "overviewSynthesis", "Síntese do lugar"), present("T03.coordinates", "location.coordinates", "Coordenadas geográficas", "block_indexing"),
      sourcedMetrics("T03.mobility_sourced", "mobility.indices"), sourcedMetrics("T03.domain_metrics_sourced", "domainMetrics"), notExpired("T03.metrics_fresh", "domainMetrics"), noTravelTimeWithoutRouting("T03.no_travel_time", "mobility.stations")],
    // Sinais de referência do documento: 5 amenidades (0,40), síntese ≥ 100 (0,30), ≥ 1 estação (0,15), ≥ 2 FAQs (0,15); elegível a partir de 0,75.
    density: { version: "1.0.0", indexingThreshold: 0.75, signals: [signalObjectTotal("amenities_5", 0.4, "amenities", 5, "≥ 5 amenidades mapeadas"), signalChars("synthesis_100", 0.3, "overviewSynthesis", T03_SYNTHESIS_DENSITY_MIN, "Síntese ≥ 100 caracteres"), signalCount("station_1", 0.15, "mobility.stations", 1, "≥ 1 estação próxima"), signalCount("faqs_2", 0.15, "faqs", 2, "≥ 2 FAQs estruturadas")] },
    linkRules: LINKS(["parent", "child", "region_to_city", "city_to_neighborhood", "destination_to_poi", "cluster_to_page", "sibling", "breadcrumb"]), compatibleTemplates: ["city-overview", "neighborhood-guide"], modules: ["identificacao", "demografia", "amenidades", "mobilidade", "faq"], gateRules: ["hierarchy_matches_breadcrumb"] }),
  mk({ id: "T04", key: "point_of_interest", name: "Point of Interest (POI)", primaryIntent: { primary: "Discover", secondary: "Details" }, mainEntityKind: "poi", urlPattern: "/places/{slug}", expectedDensity: "medium",
    schemaTypes: { required: ["TouristAttraction", "Place"], optional: ["BreadcrumbList"], conditional: [] },
    schema: obj({ poi: z.object({ category: S.min(1), subcategory: S.optional(), address: S.optional(), coordinates: coords.optional(), openingHours: S.optional() }).strict(), location, description: S.min(50), nearby: z.array(related).default([]) }),
    requirements: [present("T04.identity", "identity.name", "Nome do POI"), present("T04.category", "poi.category", "Categoria do POI"), present("T04.location", "location.adminHierarchy", "Localização administrativa"), present("T04.coordinates", "poi.coordinates", "Coordenadas do POI", "block_indexing"), present("T04.description", "description", "Descrição")],
    density: { version: "1.0.0", indexingThreshold: 0.6, signals: [signalChars("description_100", 0.4, "description", 100, "Descrição ≥ 100 caracteres"), signalCount("faqs_1", 0.2, "faqs", 1, "≥ 1 FAQ"), signalCount("nearby_2", 0.25, "nearby", 2, "≥ 2 lugares próximos"), signalChars("address", 0.15, "poi.address", 5, "Endereço informado")] },
    linkRules: LINKS(["parent", "destination_to_poi", "category_to_entity", "cluster_to_page", "breadcrumb"]), modules: ["identificacao", "localizacao", "proximidades", "faq"], gateRules: ["poi_has_verified_location"] }),
  mk({ id: "T05", key: "things_to_do", name: "Things to Do", primaryIntent: { primary: "Discover", secondary: "List" }, mainEntityKind: "place", urlPattern: "/destinations/{slug}/things-to-do", expectedDensity: "high",
    schemaTypes: { required: ["ItemList", "BreadcrumbList"], optional: [], conditional: [] },
    schema: obj({ location, items: z.array(z.object({ entityId: S.min(1), name: S.min(1), category: S.min(1), reason: S.min(10) }).strict()).default([]), selection: z.object({ inclusion: S.min(5), ordering: S.min(3) }).strict().optional() }),
    requirements: [present("T05.identity", "identity.name", "Nome do destino"), present("T05.selection", "selection.inclusion", "Critério de inclusão reprodutível"), present("T05.ordering", "selection.ordering", "Critério de ordenação reprodutível"), minCount("T05.items", "items", 5, "Ao menos 5 itens selecionados", "block_indexing")],
    density: { version: "1.0.0", indexingThreshold: 0.7, signals: [signalCount("items_8", 0.5, "items", 8, "≥ 8 itens"), signalChars("criteria", 0.2, "selection.inclusion", 20, "Critério de inclusão descrito"), signalCount("faqs_2", 0.15, "faqs", 2, "≥ 2 FAQs"), signalChars("synthesis_100", 0.15, "summary", 100, "Resumo ≥ 100 caracteres")] },
    linkRules: LINKS(["parent", "child", "destination_to_poi", "category_to_entity", "cluster_to_page", "breadcrumb"]), modules: ["selection-criteria", "items-list", "faq"], gateRules: ["collection_criteria_reproducible"] }),
  mk({ id: "T06", key: "experience_tour", name: "Experience / Tour", primaryIntent: { primary: "Book", secondary: "Evaluate" }, mainEntityKind: "experience", urlPattern: "/experiences/{slug}", expectedDensity: "medium",
    schemaTypes: { required: [], optional: ["BreadcrumbList"], conditional: ["Product", "Event", "Offer"] },
    schema: obj({ experience: z.object({ provider: S.min(1), durationMinutes: z.number().positive().optional(), description: S.min(50) }).strict(), location: location.optional(), offers: z.array(offer).default([]) }),
    requirements: [present("T06.identity", "identity.name", "Nome da experiência"), present("T06.provider", "experience.provider", "Operador/fornecedor"), present("T06.description", "experience.description", "Descrição"), noInventedOffers("T06.offers_real")],
    density: { version: "1.0.0", indexingThreshold: 0.6, signals: [signalChars("description_100", 0.4, "experience.description", 100, "Descrição ≥ 100 caracteres"), signalCount("offers_1", 0.3, "offers", 1, "≥ 1 oferta real"), signalCount("faqs_2", 0.15, "faqs", 2, "≥ 2 FAQs"), signalCount("related_1", 0.15, "related", 1, "Entidade relacionada")] },
    linkRules: LINKS(["parent", "entity_to_experience", "cluster_to_page", "breadcrumb"]), modules: ["descricao", "ofertas", "faq"], gateRules: ["offers_have_real_source"] }),
  mk({ id: "T07", key: "itinerary", name: "Itinerary", primaryIntent: { primary: "Plan", secondary: "Schedule" }, mainEntityKind: "itinerary", urlPattern: "/itineraries/{slug}", expectedDensity: "medium",
    schemaTypes: { required: ["HowTo"], optional: ["TouristTrip", "BreadcrumbList"], conditional: [] },
    schema: obj({ location, durationDays: z.number().int().positive(), days: z.array(z.object({ day: z.number().int().positive(), stops: z.array(z.object({ entityId: S.min(1), name: S.min(1), note: S.optional() }).strict()).min(1) }).strict()).default([]) }),
    requirements: [present("T07.identity", "identity.name", "Nome do roteiro"), minCount("T07.days", "days", 1, "Ao menos 1 dia com paradas", "block_generation"), minCount("T07.coverage", "days", 2, "Ao menos 2 dias para indexar", "block_indexing"), noTravelTimeWithoutRouting("T07.no_travel_time", "days")],
    density: { version: "1.0.0", indexingThreshold: 0.65, signals: [signalCount("days_2", 0.45, "days", 2, "≥ 2 dias"), signalChars("summary_100", 0.25, "summary", 100, "Resumo ≥ 100 caracteres"), signalCount("faqs_2", 0.15, "faqs", 2, "≥ 2 FAQs"), signalCount("related_2", 0.15, "related", 2, "≥ 2 entidades relacionadas")] },
    linkRules: LINKS(["parent", "destination_to_poi", "cluster_to_page", "complementary_intent", "breadcrumb"]), modules: ["days", "map", "faq"], gateRules: ["stops_are_known_entities"] }),
  mk({ id: "T08", key: "best_time_weather", name: "Best Time / Weather", primaryIntent: { primary: "Decide", secondary: "Research" }, mainEntityKind: "place", urlPattern: "/destinations/{slug}/best-time-to-visit", expectedDensity: "medium",
    schemaTypes: { required: ["Article"], optional: ["FAQPage"], conditional: [] },
    schema: obj({ location, months: z.array(z.object({ month: z.number().int().min(1).max(12), avgTempC: z.number().optional(), rainfallMm: z.number().nonnegative().optional(), source: S.optional(), verifiedAt: ISO.optional() }).strict()).default([]), recommendation: S.optional() }),
    requirements: [present("T08.identity", "identity.name", "Destino"), minCount("T08.months", "months", 12, "12 meses de clima", "block_indexing"), { id: "T08.months_sourced", layer: "provenance", severity: "block_indexing", path: "months", message: "Cada mês climático precisa de fonte e data", check: (d) => { const m = ((d.months as Record<string, unknown>[]) ?? []).filter((x) => !x.source || !x.verifiedAt).length; return { passed: m === 0, evidence: { withoutProvenance: m } }; } }],
    density: { version: "1.0.0", indexingThreshold: 0.7, signals: [signalCount("months_12", 0.55, "months", 12, "12 meses"), signalChars("recommendation", 0.25, "recommendation", 80, "Recomendação ≥ 80 caracteres"), signalCount("faqs_2", 0.2, "faqs", 2, "≥ 2 FAQs")] },
    linkRules: LINKS(["parent", "complementary_intent", "cluster_to_page", "breadcrumb"]), modules: ["clima", "recomendacao", "faq"], gateRules: ["claims_match_climate_data"] }),
  mk({ id: "T09", key: "entity_comparison", name: "Entity Comparison", primaryIntent: { primary: "Compare", secondary: "Decide" }, mainEntityKind: "comparison", urlPattern: "/compare/{slug-a}-vs-{slug-b}", expectedDensity: "high",
    schemaTypes: { required: ["Article"], optional: ["Dataset", "BreadcrumbList"], conditional: [] },
    schema: obj({ entities: z.array(z.object({ id: S.min(1), name: S.min(1) }).strict()).default([]), comparisons: z.array(z.object({ attributeId: S.min(1), label: S.min(1), values: z.array(z.object({ entityId: S.min(1), value: z.union([z.number(), S]), source: S.optional(), observedAt: ISO.optional() }).strict()) }).strict()).default([]) }),
    requirements: [minCount("T09.entities", "entities", 2, "Ao menos 2 entidades comparadas", "block_generation"), minCount("T09.comparisons", "comparisons", 3, "Ao menos 3 atributos comparáveis", "block_generation"),
      { id: "T09.same_basis", layer: "quality", severity: "block_indexing", path: "comparisons", message: "Os valores comparados precisam ter fonte e a MESMA data-base", check: (d) => { const bad = ((d.comparisons as { attributeId: string; values: { source?: string; observedAt?: string }[] }[]) ?? []).filter((c) => c.values.some((v) => !v.source || !v.observedAt) || new Set(c.values.map((v) => (v.observedAt ?? "").slice(0, 4))).size > 1).map((c) => c.attributeId); return { passed: bad.length === 0, evidence: { inconsistent: bad } }; } }],
    density: { version: "1.0.0", indexingThreshold: 0.7, signals: [signalCount("comparisons_5", 0.5, "comparisons", 5, "≥ 5 atributos comparados"), signalCount("entities_2", 0.2, "entities", 2, "≥ 2 entidades"), signalChars("summary_100", 0.2, "summary", 100, "Resumo ≥ 100 caracteres"), signalCount("faqs_1", 0.1, "faqs", 1, "≥ 1 FAQ")] },
    linkRules: LINKS(["comparison_to_entity", "parent", "cluster_to_page", "breadcrumb"]), modules: ["comparison-table", "sources"], gateRules: ["comparison_links_to_each_entity"] }),
  mk({ id: "T10", key: "curated_list", name: "Curated List (Best X)", primaryIntent: { primary: "Evaluate", secondary: "Select" }, mainEntityKind: "list", urlPattern: "/best/{category}-for-{intent}", expectedDensity: "high",
    schemaTypes: { required: ["ItemList"], optional: ["BreadcrumbList"], conditional: ["Review", "AggregateRating"] },
    schema: obj({ category: S.min(1), methodology: S.min(30).optional(), items: z.array(z.object({ entityId: S.min(1), name: S.min(1), rank: z.number().int().positive().optional(), rationale: S.min(10), evidence: z.array(S).default([]) }).strict()).default([]) }),
    requirements: [present("T10.methodology", "methodology", "Metodologia de seleção e ordenação reprodutível"), minCount("T10.items", "items", 3, "Ao menos 3 itens", "block_generation"),
      { id: "T10.rank_needs_evidence", layer: "provenance", severity: "block_indexing", path: "items", message: "Ranking só com evidência por item (nada de ranking inventado)", check: (d) => { const bad = ((d.items as { name: string; rank?: number; evidence: string[] }[]) ?? []).filter((i) => i.rank !== undefined && i.evidence.length === 0).map((i) => i.name); return { passed: bad.length === 0, evidence: { rankedWithoutEvidence: bad } }; } }],
    density: { version: "1.0.0", indexingThreshold: 0.7, signals: [signalCount("items_5", 0.45, "items", 5, "≥ 5 itens"), signalChars("methodology_60", 0.3, "methodology", 60, "Metodologia ≥ 60 caracteres"), signalCount("faqs_2", 0.15, "faqs", 2, "≥ 2 FAQs"), signalChars("summary_100", 0.1, "summary", 100, "Resumo ≥ 100 caracteres")] },
    linkRules: LINKS(["category_to_entity", "parent", "cluster_to_page", "complementary_intent", "breadcrumb"]), modules: ["methodology", "items-list", "faq"], gateRules: ["ranking_has_methodology"] }),
  mk({ id: "T11", key: "local_business_service", name: "Local Business / Service", primaryIntent: { primary: "Book", secondary: "Locate" }, mainEntityKind: "business", urlPattern: "/services/{slug}", expectedDensity: "medium",
    schemaTypes: { required: ["LocalBusiness", "PostalAddress"], optional: ["BreadcrumbList"], conditional: [] },
    schema: obj({ business: z.object({ category: S.min(1), phone: S.optional(), openingHours: S.optional() }).strict(), address: z.object({ street: S.min(3), locality: S.min(2), region: S.optional(), postalCode: S.optional(), country: S.regex(/^[A-Z]{2}$/) }).strict(), location, description: S.min(50) }),
    requirements: [present("T11.identity", "identity.name", "Nome do negócio"), present("T11.address", "address.street", "Endereço"), present("T11.category", "business.category", "Categoria"), present("T11.coordinates", "location.coordinates", "Coordenadas", "block_indexing"), present("T11.description", "description", "Descrição")],
    density: { version: "1.0.0", indexingThreshold: 0.6, signals: [signalChars("description_100", 0.4, "description", 100, "Descrição ≥ 100 caracteres"), signalChars("phone", 0.2, "business.phone", 6, "Telefone"), signalChars("hours", 0.2, "business.openingHours", 3, "Horário"), signalCount("faqs_1", 0.2, "faqs", 1, "≥ 1 FAQ")] },
    linkRules: LINKS(["parent", "category_to_entity", "cluster_to_page", "breadcrumb"]), modules: ["identificacao", "contato", "localizacao", "faq"], gateRules: ["address_matches_location"] }),
  mk({ id: "T12", key: "topic_category_hub", name: "Topic / Category Hub", primaryIntent: { primary: "Browse", secondary: "Learn" }, mainEntityKind: "topic", urlPattern: "/topics/{slug}", expectedDensity: "medium",
    schemaTypes: { required: ["CollectionPage", "BreadcrumbList"], optional: [], conditional: [] },
    schema: obj({ topic: z.object({ name: S.min(1), description: S.min(50) }).strict(), members: z.array(related).default([]) }),
    requirements: [present("T12.topic", "topic.name", "Tema"), present("T12.description", "topic.description", "Descrição do tema"), minCount("T12.members", "members", 3, "Ao menos 3 páginas membro", "block_indexing")],
    density: { version: "1.0.0", indexingThreshold: 0.65, signals: [signalCount("members_5", 0.5, "members", 5, "≥ 5 páginas membro"), signalChars("description_100", 0.3, "topic.description", 100, "Descrição ≥ 100 caracteres"), signalCount("faqs_1", 0.2, "faqs", 1, "≥ 1 FAQ")] },
    linkRules: LINKS(["parent", "child", "cluster_to_page", "category_to_entity", "breadcrumb"]), modules: ["intro", "members-list"], gateRules: ["hub_links_to_members"] }),
];
export const ARCHETYPE_CATALOG: readonly ArchetypeContract[] = catalog;
export const archetypeOf = (id: ArchetypeId | string): ArchetypeContract | undefined => catalog.find((c) => c.id === id);
export { slug as _slug, adminLevel as _adminLevel };

/** Coerência do próprio catálogo (usada em teste): ids únicos, pesos de densidade somando 1, limiares válidos, mínimo de inlinks ≥ 1. */
export function validateCatalog(cs: readonly ArchetypeContract[] = catalog): string[] {
  const e: string[] = []; const ids = new Set<string>();
  for (const c of cs) {
    if (ids.has(c.id)) e.push(`id repetido: ${c.id}`); ids.add(c.id);
    const w = c.density.signals.reduce((s, x) => s + x.weight, 0); if (Math.abs(w - 1) > 1e-9) e.push(`${c.id}: pesos de densidade somam ${w}, não 1`);
    if (!(c.density.indexingThreshold > 0 && c.density.indexingThreshold <= 1)) e.push(`${c.id}: limiar de densidade inválido`);
    if (c.linkRules.minInlinks < 1) e.push(`${c.id}: minInlinks < 1`);
    if (c.linkRules.allowedRelations.length === 0) e.push(`${c.id}: sem relações de link permitidas`);
    if (c.requirements.length === 0) e.push(`${c.id}: sem requisitos`);
    if (c.schemaTypes.required.length + c.schemaTypes.conditional.length === 0 && c.schemaTypes.optional.length === 0) e.push(`${c.id}: sem tipos Schema.org`);
  }
  return e;
}
