import { createHash } from "node:crypto";
import type { SpecBlueprint } from "../blueprint-spec/types";
import type { FamilyRenderer, PageRecipe, RecipeEntity, RecipeFact, RecipeModule } from "./types";

// Compilação do recipe (função PURA): do blueprint, dos fatos com referência e do renderizador da família do pack para a página concreta. Nunca publica; robots vem do blueprint (noindex).
const canon = (v: unknown): string => (v === null || typeof v !== "object" ? JSON.stringify(v) ?? "null" : Array.isArray(v) ? `[${v.map(canon).join(",")}]` : `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`);
export const recipeHash = (r: PageRecipe): string => createHash("sha256").update(canon(r)).digest("hex");
export interface CompileInput { readonly tenantId: string; readonly blueprint: SpecBlueprint; readonly specBlueprintId: string; readonly specBlueprintVersion: number; readonly templateGap: boolean; readonly entities: readonly RecipeEntity[]; readonly facts: readonly RecipeFact[]; readonly knownPaths: ReadonlySet<string>; readonly renderer: FamilyRenderer | undefined; readonly referenceTime: string }

export function compileRecipe(i: CompileInput): { recipe: PageRecipe | null; problems: string[] } {
  const bp = i.blueprint; const problems: string[] = [];
  if (!i.renderer) return { recipe: null, problems: [`não há renderizador do pack para a família ${bp.page_family}`] };
  const status = new Map(bp.data_contract.map((m) => [m.module_id, m.status] as const));
  const out = i.renderer.render({ blueprint: bp, entities: i.entities, facts: i.facts, moduleStatus: status, knownPaths: i.knownPaths });
  if ("error" in out) return { recipe: null, problems: [out.error] };
  const factIds = new Set(i.facts.map((f) => f.factId));
  const blocks = out.blocks.map((b) => ({ ...b, source: "template" as const }));
  for (const b of blocks) for (const r of b.refs) if (!factIds.has(r)) problems.push(`o bloco ${b.blockId} cita uma referência inexistente: ${r}`);
  const modules: RecipeModule[] = bp.data_contract.map((m) => {
    const own = blocks.filter((b) => b.moduleId === m.module_id);
    const hasData = own.some((b) => b.kind !== "insufficiency" && b.kind !== "heading");
    const insuff = own.some((b) => b.kind === "insufficiency");
    if (m.status === "DATA_PENDING" && hasData) problems.push(`R9: o módulo ${m.module_id} está sem dado, mas o renderizador produziu conteúdo`);
    if (m.status === "DATA_PENDING" && m.on_missing === "show_insufficiency" && !insuff) problems.push(`o módulo ${m.module_id} sem dado deveria mostrar a insuficiência`);
    return { moduleId: m.module_id, status: m.status, minItems: m.min_items, onMissing: m.on_missing, render: hasData ? "RENDERED" as const : insuff ? "INSUFFICIENCY_SHOWN" as const : "REMOVED" as const };
  });
  const travel = i.facts.find((f) => f.attributeId.endsWith(".travel_time_to_center") && f.sourceName.trim() !== "");
  const recipe: PageRecipe = {
    pageId: bp.page_id, topicId: bp.topic_id, tenantId: i.tenantId, family: bp.page_family, templateId: bp.template_id, templateGap: i.templateGap, specBlueprintId: i.specBlueprintId, specBlueprintVersion: i.specBlueprintVersion,
    url: bp.url, canonical: bp.url, robots: bp.indexability_policy, title: out.title, h1: out.h1, metaDescription: out.metaDescription, entities: i.entities, modules, facts: i.facts, blocks, jsonLd: out.jsonLd,
    links: out.links.filter((l) => i.knownPaths.has(l.path)), travelTime: travel ? { source: travel.sourceName } : null, referenceTime: i.referenceTime,
  };
  return { recipe: problems.length > 0 ? null : recipe, problems };
}
