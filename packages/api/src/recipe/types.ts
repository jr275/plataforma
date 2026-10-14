import type { SpecBlueprint } from "../blueprint-spec/types";

// Recipe compilado (spec seção 11): configuração CONCRETA de uma página = blueprint + template + módulos + dados com referência + narrativa. Núcleo genérico: a renderização de cada
// família vem do pack (`FamilyRenderer`). Todo texto factual leva as referências de fato (`refs`); módulo sem dado é removido ou mostra a insuficiência (R9), nunca texto genérico.
export interface RecipeFact { readonly factId: string; readonly entityKey: string; readonly attributeId: string; readonly field: string; readonly value: string | number | boolean | null; readonly unit: string | null; readonly observedAt: string; readonly sourceName: string; readonly confidence: number; readonly maxAgeDays: number | null }
export interface RecipeBlock { readonly blockId: string; readonly moduleId: string; readonly kind: "heading" | "paragraph" | "insufficiency" | "sources"; readonly text: string; readonly refs: readonly string[]; readonly source: "template" | "agent7" }
export interface RecipeModule { readonly moduleId: string; readonly status: "RICH" | "PARTIAL" | "DATA_PENDING"; readonly minItems: number; readonly onMissing: "remove" | "show_insufficiency"; readonly render: "RENDERED" | "REMOVED" | "INSUFFICIENCY_SHOWN" }
export interface RecipeEntity { readonly key: string; readonly name: string; readonly uf: string | null }
export interface PageRecipe {
  readonly pageId: string; readonly topicId: string; readonly tenantId: string; readonly family: string; readonly templateId: string; readonly templateGap: boolean;
  readonly specBlueprintId: string; readonly specBlueprintVersion: number; readonly url: string | null; readonly canonical: string | null; readonly robots: "index" | "noindex";
  readonly title: string; readonly h1: string; readonly metaDescription: string;
  readonly entities: readonly RecipeEntity[]; readonly modules: readonly RecipeModule[]; readonly facts: readonly RecipeFact[]; readonly blocks: readonly RecipeBlock[];
  readonly jsonLd: readonly Record<string, unknown>[]; readonly links: readonly { readonly path: string; readonly text: string }[];
  /** Tempo de deslocamento só existe com fonte de roteamento (R3). */ readonly travelTime: { readonly source: string } | null;
  readonly referenceTime: string;
}
export interface RenderInput { readonly blueprint: SpecBlueprint; readonly entities: readonly RecipeEntity[]; readonly facts: readonly RecipeFact[]; readonly moduleStatus: ReadonlyMap<string, "RICH" | "PARTIAL" | "DATA_PENDING">; readonly knownPaths: ReadonlySet<string> }
export interface RenderOutput { readonly title: string; readonly h1: string; readonly metaDescription: string; readonly blocks: readonly Omit<RecipeBlock, "source">[]; readonly jsonLd: readonly Record<string, unknown>[]; readonly links: readonly { readonly path: string; readonly text: string }[] }
export interface FamilyRenderer { readonly family: string; render(i: RenderInput): RenderOutput | { readonly error: string } }

/** Substitui {campo}; campo sem valor lança (nunca se emite título/meta com buraco). */
export function fillPattern(pattern: string, values: Readonly<Record<string, string>>): string {
  return pattern.replace(/\{([a-z0-9_]+)\}/g, (_, k: string) => { const v = values[k]; if (v === undefined) throw new Error(`campo sem valor no padrão: {${k}}`); return v; });
}
