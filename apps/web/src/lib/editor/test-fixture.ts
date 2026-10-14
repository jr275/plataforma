import { buildBlueprint, type TemplateInfo } from "@plataforma/api/src/engine/blueprint";
import { defaultDraft, type DraftContext, type PageDraft } from "@plataforma/api/src/draft";

// Rascunho e contexto de TESTE (vertical fictícia): só exercita o comportamento do editor.
const T: TemplateInfo = { key: "city-overview", version: 1, entityKind: "city", requiredFacts: ["name"], knownFacts: ["name", "uf", "region", "population"],
  sections: [{ id: "overview", label: "Visão geral", paragraphs: [{ requires: ["name", "uf"] }, { requires: ["region"] }] }, { id: "population", label: "População", paragraphs: [{ requires: ["name", "population"] }] }],
  structuredData: ["City"], pathFor: () => "/cidades/sp/x", linksFor: () => [{ path: "/cidades/sp", text: "Cidades de SP" }, { path: "/cidades", text: "Todas as cidades" }] };
export const testCtx = (over: Partial<DraftContext> = {}): DraftContext => ({ verticalId: "t", templates: [{ key: T.key, version: 1, entityKind: "city", sections: T.sections.map((s) => ({ id: s.id, label: s.label, paragraphs: s.paragraphs })), structuredData: T.structuredData }],
  requirements: [{ id: "entities", label: "Cidades do tenant", weight: "critical", satisfiedBy: ["entities"], note: "cidades importadas" }, { id: "inventory", label: "Estoque", weight: "critical", satisfiedBy: ["source:inventory-feed"], note: "fonte inexistente" }],
  sources: [{ id: "city_import", label: "Importação de cidades", token: "entities", state: "implemented_tested" }, { id: "bcb-sgs", label: "BCB", token: "indicator:bcb-sgs", state: "implemented_tested" }],
  available: ["entities"], facts: ["name", "uf", "region", "population"], knownPaths: ["/cidades"], maxCannibalizationRisk: 0.8, cannibalizationRisk: 0.1, publicationAvailable: false, ...over });
export const fixtureBlueprint = () => buildBlueprint({ vertical: { id: "t", name: "t", language: "pt-BR", country: "BR", entityKinds: ["city"], intents: [{ id: "i", label: "I", commercialWeight: 1, conversionProximity: 1 }], stages: [{ id: "s", label: "S", order: 0, conversionProximity: 0 }],
  patterns: [{ key: "p", group: "g", intent: "i", stage: "s", entityKind: "city", templates: ["x em {entity}"], jtbd: "j", experience: "e", valueTier: "high", requiredEvidence: ["entities"], outcome: "o" }], signals: [], evidenceRequirements: [{ id: "entities", label: "Cidades do tenant", weight: "critical", satisfiedBy: ["entities"], note: "cidades importadas" }],
  experiences: [{ id: "e", label: "E", status: "supported", note: "", servedByTemplates: ["city-overview"] }], relevanceKeywords: [], sources: { bcbSeries: [], ibgeSearchTerms: [], rssFeeds: [] }, scoring: {} as never } as never,
  templates: [T], available: new Set(["entities"]), entityFacts: { name: "X", uf: "SP", region: "S", population: 1 }, existingPaths: new Set(), knownPaths: new Set(["/cidades"]), cannibalizationRisk: 0.1, maxCannibalizationRisk: 0.8,
  opportunity: { id: "o", primaryQuery: "q", intent: "i", stage: "s", pattern: "p", experience: "e", expectedOutcome: "x", eligible: true, scoreId: "s", entity: { kind: "city", id: "c", name: "X", qualifier: "SP" } } });
export const fixtureDraft = (): PageDraft => defaultDraft(fixtureBlueprint(), testCtx(), 1);
