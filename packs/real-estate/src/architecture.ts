import { architecture as A, type recipe as R } from "@plataforma/api";

// Adaptação do Domain Pack imobiliário ao contrato dos archetypes (o núcleo não conhece imóveis). Hoje as famílias existentes mapeiam para T03 (visão geral de cidade → City & Neighborhood Guide) e T09 (comparação
// entre cidades → Entity Comparison). Só usa dados REAIS do recipe: fatos com fonte e data. Nada de amenidades, estações, FAQs ou métricas de mercado é inventado: sem POIs/listagens, esses campos ficam VAZIOS e a
// densidade do T03 diz isso (a página é aprovável para preview, mas não elegível a indexação).
const FAMILY: Record<string, A.ArchetypeId> = { "04-cidade": "T03", "13-comparacao": "T09" };
const slugify = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const day = (iso: string) => iso.slice(0, 10);
const lastSeg = (url: string | null, fallback: string) => (url ? url.split("/").filter(Boolean).pop() ?? fallback : fallback);
const prov = (f: R.RecipeFact): A.Provenance => ({ path: `facts.${f.attributeId}`, source: f.sourceName, verifiedAt: day(f.observedAt) });

function adaptCity(recipe: R.PageRecipe): A.AdaptedPage | { error: string } {
  const e = recipe.entities[0]; if (!e) return { error: "sem entidade principal" };
  const own = recipe.facts.filter((f) => f.entityKey === e.key);
  const paragraphs = recipe.blocks.filter((b) => b.kind === "paragraph").map((b) => b.text).join(" ");
  const metrics = own.filter((f) => typeof f.value === "number").map((f) => ({ id: f.attributeId, value: f.value as number, ...(f.unit ? { unit: f.unit } : {}), source: f.sourceName, verifiedAt: day(f.observedAt) }));
  const uf = e.uf;
  const data: Record<string, unknown> = { identity: { name: e.name, slug: slugify(lastSeg(recipe.url, e.name)) }, location: { adminHierarchy: [...(uf ? [{ level: "state", name: uf }] : []), { level: "city", name: e.name }] }, overviewSynthesis: paragraphs, domainMetrics: metrics };
  const hierarchy = recipe.links.filter((l) => recipe.url && l.path !== recipe.url && recipe.url.startsWith(l.path)).sort((a, b) => a.path.length - b.path.length).map((l) => ({ name: l.text, url: l.path }));
  return { data, provenance: own.map(prov), primaryIntent: "informational visão geral do município", intentEvidence: [`família ${recipe.family}`], hierarchy };
}
function adaptComparison(recipe: R.PageRecipe): A.AdaptedPage | { error: string } {
  if (recipe.entities.length < 2) return { error: "a comparação exige duas entidades" };
  const ents = recipe.entities.slice(0, 2); const attrs = [...new Set(recipe.facts.map((f) => f.attributeId))].sort();
  const comparisons = attrs.flatMap((a) => { const vs = ents.map((e) => recipe.facts.find((f) => f.entityKey === e.key && f.attributeId === a)); if (vs.some((v) => !v)) return []; return [{ attributeId: a, label: a, values: ents.map((e, i) => ({ entityId: e.key, value: vs[i]!.value as string | number, source: vs[i]!.sourceName, observedAt: day(vs[i]!.observedAt) })) }]; });
  const data: Record<string, unknown> = { identity: { name: recipe.h1, slug: slugify(ents.map((e) => e.name).join("-vs-")) }, entities: ents.map((e) => ({ id: e.key, name: e.name })), comparisons, summary: recipe.blocks.filter((b) => b.kind === "paragraph").map((b) => b.text).join(" ") };
  return { data, provenance: recipe.facts.map(prov), primaryIntent: "comparative comparação entre cidades", intentEvidence: [`família ${recipe.family}`], hierarchy: [] };
}
export const realEstateArchitecture: A.ArchitecturePack = {
  domain: "real-estate", locale: "pt-BR", market: "BR",
  archetypeOfFamily: (f) => FAMILY[f] ?? null,
  adapt: ({ recipe }) => (recipe.family === "13-comparacao" ? adaptComparison(recipe) : adaptCity(recipe)),
  clusterOf: ({ recipe, archetype }): { key: string; name: string; scope: Record<string, string> } => { const uf = recipe.entities[0]?.uf ?? "-"; return archetype.id === "T09" ? { key: "T09|real-estate|city-pairs", name: "Comparações entre cidades", scope: { kind: "city_pair" } } : { key: `T03|real-estate|uf:${uf}`, name: uf === "-" ? "Cidades (UF desconhecida)" : `Cidades de ${uf}`, scope: { uf } }; },
};
