import { z } from "zod";

// Blueprint da especificação (seção 11): independente da apresentação visual (trocar o template não altera o blueprint). Núcleo genérico: a RECEITA da família vem do pack.
export const QA_GATES = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13", "Q14"] as const;
export const MODULE_STATUS = ["RICH", "PARTIAL", "DATA_PENDING"] as const;
export const FILL = "__FILL__" as const;
/** Campos semânticos (preenchidos por regras do pack/dados ou refinados pelo Agente 6). */
export const SEMANTIC_FIELDS = ["topic_definition", "title_pattern", "h1_pattern", "meta_description_pattern", "target_query_cluster.secondary", "differentiation_strategy", "internal_link_plan.anchor_texts"] as const;

export interface RecipeField { readonly field: string; /** `null` = vem da entidade (ex.: nome), não de um atributo. */ readonly attribute: string | null }
export interface RecipeModule { readonly moduleId: string; readonly fields: readonly RecipeField[]; readonly minItems: number; readonly onMissing: "remove" | "show_insufficiency" }
export interface FamilyRecipe {
  readonly family: string; readonly pageType: string; readonly archetype: string; readonly templateId: string;
  /** Caminho da página para a entidade; `null` quando a família ainda não tem URL definida. */ readonly urlFor: (e: { name: string; qualifier: string | null; sourceKey: string }) => string | null;
  readonly modules: readonly RecipeModule[]; readonly schemaTypes: readonly string[]; readonly derivedMetrics: readonly string[];
  readonly claims: readonly { readonly claimType: string; readonly sourceClass: string; readonly attribute: string }[];
  readonly defaultPatterns: { readonly title: string; readonly h1: string; readonly meta: string };
  readonly moduleRequirements: readonly string[]; readonly kpis: readonly string[];
  readonly refreshTrigger: string; readonly maxAgeDays: number;
}

const S = z.string().trim();
export const specBlueprintSchema = z.object({
  page_id: S.min(1), tenant_id: S.min(1), topic_id: S.regex(/^[0-9a-f]{64}$/),
  page_family: S, page_type: S, page_archetype: S, primary_entity: S, secondary_entities: z.array(S),
  search_intent: z.object({ intent_type: S, query_hypothesis: S, demand_signal: z.object({ value: z.number().nullable(), source: S.nullable() }).strict(), user_need: S }).strict(),
  topic_definition: S, target_query_cluster: z.object({ primary: S, secondary: z.array(S) }).strict(),
  url: S.nullable(), title_pattern: S, h1_pattern: S, meta_description_pattern: S,
  required_attributes: z.array(S), required_relationships: z.array(S),
  data_contract: z.array(z.object({ module_id: S, fields: z.array(S).min(1), min_items: z.number().int().min(0), status: z.enum(MODULE_STATUS), on_missing: z.enum(["remove", "show_insufficiency"]) }).strict()).min(1),
  unique_fields_per_instance: z.array(S), derived_metrics: z.array(S),
  evidence_requirements: z.array(z.object({ claim_type: S, source_class: S, max_age_days: z.number().int().min(1).nullable() }).strict()),
  differentiation_strategy: S, template_id: S, module_requirements: z.array(S),
  internal_link_plan: z.object({ parents: z.array(S), siblings: z.array(S), children: z.array(S), listings: S, anchor_texts: z.array(S) }).strict(),
  schema_requirements: z.array(S), canonical_policy: S, indexability_policy: z.enum(["index", "noindex"]),
  freshness_policy: z.object({ refresh_trigger: S, max_age_days: z.number().int().min(1) }).strict(),
  quality_gates: z.array(z.enum(QA_GATES)).length(14), kpis: z.array(S), version: z.string().regex(/^\d+\.\d+\.\d+$/),
}).strict();
export type SpecBlueprint = z.infer<typeof specBlueprintSchema>;
export type BlueprintStatus = "COMPLETE" | "SEMANTIC_INSUFFICIENT";
