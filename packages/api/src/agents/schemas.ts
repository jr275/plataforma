import { z } from "zod";

// Contratos de saída dos 8 agentes de runtime (arquivo de prompts 02_prompts_agentes_runtime.md). Esquemas ESTRITOS: chave extra ou valor fora da lista é saída inválida (nova tentativa, depois falha explícita).
const S = z.string().trim();
export const FAMILY_STATUS = ["RICH", "PARTIAL", "DATA_PENDING"] as const;
export const INTENT_TYPES = ["transactional", "commercial", "informational", "local", "comparative", "seasonal", "question"] as const;

export const agent1Schema = z.object({ scope: S, entities: z.array(z.object({ entity_id: S, name: S, families: z.record(S, z.enum(FAMILY_STATUS)) }).strict()), top_gaps: z.array(z.object({ attribute_id: S, family: S, topics_unblocked: z.number().int().min(0), collection_cost: z.enum(["low", "medium", "high"]), suggested_source_class: S, rationale: S }).strict()).max(10) }).strict();
export const agent2Schema = z.object({ proposals: z.array(z.object({ dimensions: z.record(S, S), attributes_used: z.array(S), relationships_used: z.array(S), candidate_page_family: S, user_need: S, query_hypothesis: S, why_not_covered: S, evidence_required: z.array(S) }).strict()) }).strict();
export const agent3Schema = z.object({ intents: z.array(z.object({ topic_id: S, what: S, where: S, why: S, when: S, for_whom: S, intent_type: z.enum(INTENT_TYPES), primary_keyword: S.nullable(), variants: z.array(S), query_hypothesis: S, demand_status: z.enum(["OBSERVED", "HYPOTHESIS"]), demand_signal: z.object({ value: z.number().nullable(), source: S, period: S, uncertainty: S }).strict(), unmet_need: z.boolean() }).strict()) }).strict();
export const agent4Schema = z.object({ reviews: z.array(z.object({ topic_id: S, differs_from_parent: z.boolean(), parent_reason: S, redundant_with_siblings: z.array(S), recommendation: z.enum(["KEEP_AS_PAGE", "MERGE_INTO_PARENT_AS_SECTION", "MERGE_WITH_SIBLING", "FILTER_ONLY"]), rationale: S }).strict()) }).strict();
export const agent5Schema = z.object({ topic_id: S, explanation: S.min(1).max(1500), next_best_action: S.min(1).max(600) }).strict();
export const agent6Schema = z.object({ page_id: S, fields: z.record(S, z.unknown()), notes: z.string() }).strict();
export const agent7Schema = z.object({ page_id: S, slots: z.array(z.object({ slot_id: S, status: z.enum(["OK", "INSUFFICIENT"]), text: z.string(), evidence_refs: z.array(S) }).strict()) }).strict();
const check = z.object({ result: z.enum(["PASS", "FAIL"]), issues: z.array(z.object({ excerpt: z.string(), expected: z.string(), found: z.string() }).strict()) }).strict();
export const agent8Schema = z.object({ page_id: S, checks: z.object({ Q1: check, Q2: check, Q8: check, Q13: check, Q14: check.extend({ exclusive_value: z.array(S) }).strict() }).strict(), summary: z.string() }).strict();

export type Agent1Out = z.infer<typeof agent1Schema>; export type Agent2Out = z.infer<typeof agent2Schema>; export type Agent3Out = z.infer<typeof agent3Schema>; export type Agent4Out = z.infer<typeof agent4Schema>;
export type Agent5Out = z.infer<typeof agent5Schema>; export type Agent6Out = z.infer<typeof agent6Schema>; export type Agent7Out = z.infer<typeof agent7Schema>; export type Agent8Out = z.infer<typeof agent8Schema>;
