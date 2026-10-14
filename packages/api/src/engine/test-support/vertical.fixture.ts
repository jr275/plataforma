import type { VerticalDefinition } from "../vertical";
import { TEST_CONFIG } from "./score-fixtures";

// Vertical GENÉRICA DE TESTE (uma loja de plantas fictícia): prova que o núcleo não conhece nenhum domínio. Nada daqui é dado real.
export const TEST_VERTICAL: VerticalDefinition = {
  id: "garden-test", name: "Loja de plantas (teste)", language: "pt-BR", country: "BR", entityKinds: ["city"],
  intents: [
    { id: "transactional", label: "Transacional", commercialWeight: 1, conversionProximity: 0.9 },
    { id: "informational", label: "Informacional", commercialWeight: 0.3, conversionProximity: 0.2 },
    { id: "comparison", label: "Comparação", commercialWeight: 0.7, conversionProximity: 0.6 },
  ],
  stages: [{ id: "aware", label: "Descoberta", order: 0, conversionProximity: 0.1 }, { id: "consider", label: "Consideração", order: 1, conversionProximity: 0.5 }, { id: "decide", label: "Decisão", order: 2, conversionProximity: 0.9 }],
  patterns: [
    { key: "buy-plants", group: "buy", intent: "transactional", stage: "decide", entityKind: "city", templates: ["comprar plantas em {entity}", "plantas à venda em {entity}", "loja de plantas em {entity}"], jtbd: "Encontrar onde comprar plantas", experience: "directory", valueTier: "high", requiredEvidence: ["entities", "inventory"], outcome: "visitas à loja" },
    { key: "buy-pots", group: "buy", intent: "transactional", stage: "decide", entityKind: "city", templates: ["comprar vasos em {entity}", "vasos à venda em {entity}"], jtbd: "Encontrar vasos", experience: "directory", valueTier: "medium", requiredEvidence: ["entities", "inventory"], outcome: "visitas à loja" },
    { key: "compare-stores", group: "compare", intent: "comparison", stage: "consider", entityKind: "city", templates: ["melhor loja de plantas em {entity}", "melhores lojas de plantas em {entity}"], jtbd: "Escolher a melhor loja", experience: "ranking", valueTier: "medium", requiredEvidence: ["entities", "reviews"], outcome: "visitas à loja" },
    { key: "fern-care", group: "learn", intent: "informational", stage: "aware", entityKind: null, templates: ["como cuidar de samambaia", "cuidados com samambaia"], jtbd: "Aprender a cuidar", experience: "guide", valueTier: "low", requiredEvidence: ["editorial"], outcome: "tráfego informativo" },
  ],
  signals: [{ topic: "plant_trends", label: "Tendência de plantas", keywords: ["planta", "jardim", "samambaia"], indicators: [], groups: ["buy", "learn"], explain: "Notícia sobre plantas e jardinagem" }],
  evidenceRequirements: [
    { id: "entities", label: "Entidades do tenant", weight: "critical", satisfiedBy: ["entities"], note: "cidades importadas" },
    { id: "inventory", label: "Estoque da loja", weight: "critical", satisfiedBy: ["source:inventory-feed"], note: "fonte inexistente" },
    { id: "reviews", label: "Avaliações", weight: "important", satisfiedBy: ["source:reviews-feed"], note: "fonte inexistente" },
    { id: "editorial", label: "Conteúdo editorial", weight: "optional", satisfiedBy: ["entities"], note: "texto do tenant" },
  ],
  experiences: [{ id: "directory", label: "Diretório", status: "planned", note: "", servedByTemplates: ["city-overview"] }, { id: "ranking", label: "Ranking", status: "planned", note: "" }, { id: "guide", label: "Guia", status: "unsupported", note: "" }],
  relevanceKeywords: ["planta", "jardim", "vaso"],
  sources: { bcbSeries: [{ id: 432, label: "Meta Selic", unit: "% a.a.", frequency: "daily", topic: "plant_trends" }], ibgeSearchTerms: ["habitação"], rssFeeds: [{ id: "agencia-brasil-economia", label: "Agência Brasil: economia", url: "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml" }] },
  scoring: TEST_CONFIG,
};
