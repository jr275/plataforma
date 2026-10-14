import { createHash } from "node:crypto";
import { specBlueprintSchema, QA_GATES, type FamilyRecipe, type SpecBlueprint } from "./types";

// Montagem ESTRUTURAL do blueprint (função pura): tudo vem do tópico, dos fatos, da decisão e da receita da família (pack). Nenhum campo é preenchido com texto genérico (R9): módulo sem dado
// fica DATA_PENDING e a receita diz se ele é removido ou mostra a insuficiência. Os campos semânticos saem de regras do pack e dos dados; o Agente 6 pode refiná-los.
export interface BuildInput {
  readonly tenantId: string; readonly version: string; readonly now: Date;
  readonly topic: { readonly topicId: string; readonly family: string; readonly intentType: string; readonly queryHypothesis: string; readonly userNeed: string; readonly demand: { value: number | null; source: string | null }; readonly attributesUsed: readonly string[]; readonly relationshipsUsed: readonly string[]; readonly dimensions: Readonly<Record<string, string>>; readonly intentVariants: readonly string[] };
  readonly entity: { readonly name: string; readonly qualifier: string | null; readonly sourceKey: string };
  /** Atributos com fato para TODAS as entidades do tópico. */ readonly availableAttributes: ReadonlySet<string>;
  /** Blocos que variam entre as instâncias da família (da decisão). */ readonly varyingAttributes: readonly string[];
  readonly attributeMaxAge: ReadonlyMap<string, number | null>;
  readonly graph: { readonly parents: readonly string[]; readonly siblings: readonly string[]; readonly children: readonly string[] };
  readonly recipe: FamilyRecipe; readonly templates: ReadonlySet<string>;
}
const canon = (v: unknown): string => (v === null || typeof v !== "object" ? JSON.stringify(v) ?? "null" : Array.isArray(v) ? `[${v.map(canon).join(",")}]` : `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const contentHash = (b: SpecBlueprint): string => sha(canon(b));
/** Hash do blueprint SEM template e requisitos de módulo: trocar o template não o altera. */
export const structuralHash = (b: SpecBlueprint): string => { const { template_id: _t, module_requirements: _m, ...rest } = b; void _t; void _m; return sha(canon(rest)); };

export function buildSpecBlueprint(i: BuildInput): { blueprint: SpecBlueprint; templateGap: boolean; problems: string[] } {
  const r = i.recipe; const t = i.topic;
  const modules = r.modules.map((m) => {
    const attrs = m.fields.filter((f) => f.attribute !== null).map((f) => f.attribute!);
    const have = attrs.filter((a) => i.availableAttributes.has(a));
    const status = attrs.length === 0 || have.length === attrs.length ? "RICH" as const : have.length === 0 ? "DATA_PENDING" as const : "PARTIAL" as const;
    return { module_id: m.moduleId, fields: m.fields.map((f) => f.field), min_items: m.minItems, status, on_missing: m.onMissing };
  });
  // na ordem da receita (determinístico, independente da ordem do snapshot)
  const unique = r.modules.flatMap((m) => m.fields).filter((f) => f.attribute !== null && i.varyingAttributes.includes(f.attribute)).map((f) => f.attribute!);
  const fieldsOf = (a: string) => r.modules.flatMap((m) => m.fields).find((f) => f.attribute === a)?.field ?? a;
  const bp: SpecBlueprint = {
    page_id: t.topicId, tenant_id: i.tenantId, topic_id: t.topicId, page_family: r.family, page_type: r.pageType, page_archetype: r.archetype,
    primary_entity: i.entity.sourceKey, secondary_entities: Object.values(t.dimensions).filter((v) => v !== i.entity.sourceKey && /^[a-z]+:/.test(v)),
    search_intent: { intent_type: t.intentType, query_hypothesis: t.queryHypothesis, demand_signal: { value: t.demand.value, source: t.demand.source }, user_need: t.userNeed },
    topic_definition: t.userNeed, target_query_cluster: { primary: t.queryHypothesis, secondary: [...t.intentVariants] },
    url: r.urlFor(i.entity), title_pattern: r.defaultPatterns.title, h1_pattern: r.defaultPatterns.h1, meta_description_pattern: r.defaultPatterns.meta,
    required_attributes: [...t.attributesUsed], required_relationships: [...t.relationshipsUsed], data_contract: modules,
    unique_fields_per_instance: unique.map(fieldsOf), derived_metrics: [...r.derivedMetrics],
    evidence_requirements: r.claims.map((c) => ({ claim_type: c.claimType, source_class: c.sourceClass, max_age_days: i.attributeMaxAge.get(c.attribute) ?? null })),
    differentiation_strategy: unique.length > 0 ? `Blocos de dados que variam entre as páginas da família e que esta página mostra: ${unique.map(fieldsOf).join(", ")}.` : "INSUFFICIENT",
    template_id: r.templateId, module_requirements: [...r.moduleRequirements],
    internal_link_plan: { parents: [...i.graph.parents], siblings: [...i.graph.siblings], children: [...i.graph.children], listings: "sem inventário de imóveis: nenhum link para listagem", anchor_texts: [] },
    schema_requirements: [...r.schemaTypes], canonical_policy: "self", indexability_policy: "noindex",
    freshness_policy: { refresh_trigger: r.refreshTrigger, max_age_days: r.maxAgeDays }, quality_gates: [...QA_GATES], kpis: [...r.kpis], version: i.version,
  };
  const problems: string[] = [];
  const parsed = specBlueprintSchema.safeParse(bp);
  if (!parsed.success) problems.push(...parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`));
  // coerência com o tópico e R9
  const reqs = new Set(t.attributesUsed);
  for (const m of r.modules) for (const f of m.fields) if (f.attribute !== null && !reqs.has(f.attribute)) problems.push(`o módulo ${m.moduleId} usa ${f.attribute}, que não está nos atributos do tópico`);
  if (modules.every((m) => m.status === "DATA_PENDING")) problems.push("todos os módulos estão sem dado: o blueprint não pode existir (R9)");
  for (const m of modules) if (m.status === "DATA_PENDING" && !["remove", "show_insufficiency"].includes(m.on_missing)) problems.push(`módulo ${m.module_id} sem dado e sem regra de ausência`);
  return { blueprint: bp, templateGap: !i.templates.has(r.templateId), problems };
}

/** Funde os campos validados do Agente 6 (somente os pedidos) num blueprint novo; `differentiation_strategy: INSUFFICIENT` é preservado. */
export function applySemanticFields(bp: SpecBlueprint, fields: Readonly<Record<string, unknown>>): SpecBlueprint {
  const next: SpecBlueprint = { ...bp, target_query_cluster: { ...bp.target_query_cluster }, internal_link_plan: { ...bp.internal_link_plan } };
  const str = (k: string) => (typeof fields[k] === "string" ? (fields[k] as string).trim() : null);
  const set = <K extends "topic_definition" | "title_pattern" | "h1_pattern" | "meta_description_pattern" | "differentiation_strategy">(k: K) => { const v = str(k); if (v) next[k] = v; };
  set("topic_definition"); set("title_pattern"); set("h1_pattern"); set("meta_description_pattern"); set("differentiation_strategy");
  const sec = fields["target_query_cluster.secondary"]; if (Array.isArray(sec)) next.target_query_cluster = { ...next.target_query_cluster, secondary: sec.map(String) };
  const anchors = fields["internal_link_plan.anchor_texts"]; if (Array.isArray(anchors)) next.internal_link_plan = { ...next.internal_link_plan, anchor_texts: anchors.map(String) };
  return next;
}
