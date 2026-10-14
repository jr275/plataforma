import { cityPath, type blueprintSpec } from "@plataforma/api";

// Receitas de blueprint do Domain Pack imobiliário (ADR-030): por família de página, o que a página É (tipo, arquétipo), que módulos de dados ela exige e o que fazer na ausência.
// Só a família 04 (cidade) tem template real (`city-overview`); as demais declaram o template que SERIA necessário e o blueprint registra `template_gap` (nunca um template improvisado).
const city = { field: "city_name", attribute: null } as const;
export const RECIPES: readonly blueprintSpec.FamilyRecipe[] = [
  { family: "04-cidade", pageType: "visão geral de cidade", archetype: "hub", templateId: "city-overview",
    urlFor: (e) => (e.qualifier ? cityPath(e.qualifier, e.name) : null),
    modules: [
      { moduleId: "identificacao", fields: [city, { field: "uf", attribute: "city.uf" }, { field: "region", attribute: "city.region" }], minItems: 3, onMissing: "remove" },
      { moduleId: "demografia", fields: [{ field: "population", attribute: "city.population" }, { field: "census_population", attribute: "city.population_census_2022" }, { field: "census_density", attribute: "city.density_census_2022" }], minItems: 1, onMissing: "show_insufficiency" },
    ],
    schemaTypes: ["City", "BreadcrumbList"], derivedMetrics: [],
    claims: [{ claimType: "população", sourceClass: "IBGE", attribute: "city.population" }, { claimType: "população do Censo", sourceClass: "IBGE SIDRA", attribute: "city.population_census_2022" }],
    defaultPatterns: { title: "{city_name}: população e dados do município", h1: "{city_name}", meta: "Dados verificáveis de {city_name}: população, localização e indicadores do Censo, com fonte e data." },
    moduleRequirements: ["hero", "data-table", "sources"], kpis: ["impressions", "clicks", "ctr", "position"], refreshTrigger: "novo ano de referência da população ou nova importação do IBGE", maxAgeDays: 800 },
  { family: "13-comparacao", pageType: "comparação entre cidades", archetype: "comparison", templateId: "city-comparison",
    urlFor: () => null,
    modules: [{ moduleId: "comparacao-demografica", fields: [{ field: "population", attribute: "city.population" }, { field: "census_population", attribute: "city.population_census_2022" }, { field: "census_density", attribute: "city.density_census_2022" }], minItems: 2, onMissing: "remove" }],
    schemaTypes: ["Dataset"], derivedMetrics: [],
    claims: [{ claimType: "população", sourceClass: "IBGE", attribute: "city.population" }],
    defaultPatterns: { title: "{population}: comparação de cidades", h1: "Comparação entre cidades", meta: "Comparação de indicadores demográficos de duas cidades do mesmo estado, com a mesma data-base." },
    moduleRequirements: ["comparison-table", "sources"], kpis: ["impressions", "clicks", "ctr", "position"], refreshTrigger: "novo ano de referência dos indicadores", maxAgeDays: 800 },
];
