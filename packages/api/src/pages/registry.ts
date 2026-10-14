import type { TemplateInfo } from "../engine/blueprint";
import { CITY_OVERVIEW, FACT_KEYS, cityPath, type CityTemplate } from "./city-overview";

// Registro de templates: o que o sistema REALMENTE sabe gerar (ADR-024). Derivado dos templates implementados; nada é declarado aqui que não exista como código.
// Uma experiência da vertical só é atendida se algum template deste registro a servir; senão o blueprint diz "template inexistente". O contrato (TemplateInfo) é do motor.
export type { TemplateInfo, TemplateSectionInfo } from "../engine/blueprint";
function fromCityTemplate(t: CityTemplate): TemplateInfo {
  return {
    key: t.key, version: t.version, entityKind: "city", requiredFacts: t.required, knownFacts: FACT_KEYS,
    sections: t.sections.map((s) => ({ id: s.id, label: s.heading, paragraphs: s.paragraphs.map((p) => ({ requires: p.requires })) })),
    structuredData: ["City"],
    pathFor: (e) => (e.qualifier ? cityPath(e.qualifier, e.name) : null),
    linksFor: (e) => (e.qualifier ? [{ path: `/cidades/${e.qualifier.toLowerCase()}`, text: `Cidades de ${e.qualifier}` }, { path: "/cidades", text: "Todas as cidades" }] : []),
  };
}

export const TEMPLATE_REGISTRY: readonly TemplateInfo[] = [fromCityTemplate(CITY_OVERVIEW)];
