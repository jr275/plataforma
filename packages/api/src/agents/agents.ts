import type { TenantDb } from "../tenant-context";
import { validateProposal, type Proposal, type ProposalContext } from "../topics/generate";
import { runAgent, type AgentBase, type AgentCtx, type AgentResult, type AgentSpec } from "./runner";
import { agent1Schema, agent2Schema, agent3Schema, agent4Schema, agent5Schema, agent6Schema, agent7Schema, agent8Schema, type Agent1Out, type Agent2Out, type Agent3Out, type Agent4Out, type Agent5Out, type Agent6Out } from "./schemas";

// Os agentes PROPÕEM, DESCREVEM e REDIGEM; o CÓDIGO valida e decide (R7). Cada função: monta a entrada (só o recorte de dados), valida a saída com regras do código e, quando cabe, aplica o resultado.
const sentences = (t: string): number => t.split(/(?<=[.!?])\s+/).filter((x) => x.trim() !== "").length;

// --- Agente 1: resumo de inventário -----------------------------------------------------------------------------
export interface InventoryInput { readonly scope: string; readonly richMin: number; readonly entities: readonly { readonly entity_id: string; readonly name: string }[]; readonly attributes: readonly { readonly attribute_id: string; readonly entity_type: string; readonly family: string; readonly status: string; readonly coverage: number | null; readonly freshness_days: number | null; readonly confidence: number | null; readonly topics_unblocked: number }[] }
export const inventorySpec = (input: InventoryInput): AgentSpec<Agent1Out> => ({
  agent: 1, inputVar: "ATTRIBUTE_CATALOG_JSON", schema: agent1Schema, extraVars: { SCOPE: input.scope, RICH_MIN: String(input.richMin) },
  validate: (o) => {
    const e: string[] = []; const attrs = new Map(input.attributes.map((a) => [a.attribute_id, a])); const ents = new Map(input.entities.map((x) => [x.entity_id, x.name]));
    for (const g of o.top_gaps) { const a = attrs.get(g.attribute_id); if (!a) e.push(`lacuna sobre atributo que não está no INPUT: ${g.attribute_id}`); else if (a.topics_unblocked !== g.topics_unblocked) e.push(`topics_unblocked de ${g.attribute_id} foi alterado (${g.topics_unblocked} ≠ ${a.topics_unblocked}): números do INPUT não podem mudar`); }
    for (let i = 1; i < o.top_gaps.length; i++) if (o.top_gaps[i]!.topics_unblocked > o.top_gaps[i - 1]!.topics_unblocked) e.push("as lacunas não estão ordenadas por topics_unblocked (decrescente)");
    for (const x of o.entities) if (ents.get(x.entity_id) !== x.name) e.push(`entidade inexistente ou renomeada: ${x.entity_id}`);
    return e;
  },
});
export const summarizeInventory = (ctx: AgentCtx, base: AgentBase, input: InventoryInput) => runAgent(ctx, base, inventorySpec(input), input, { kind: "scope", ref: input.scope });

// --- Agente 2: propostas de tópicos (cada proposta é validada individualmente pelo código) ---------------------------------
export interface ProposerInput { readonly entity: { readonly entity_id: string; readonly name: string }; readonly attributes: readonly { readonly attribute_id: string; readonly status: string }[]; readonly relationships: readonly string[]; readonly existing_topics: readonly string[]; readonly compatibility: readonly string[] }
export const proposerSpec = (): AgentSpec<Agent2Out> => ({ agent: 2, inputVar: "ENTITY_CONTEXT_JSON", schema: agent2Schema, extraVars: { MAX_PROPOSALS: "5" } });
export async function proposeTopics(ctx: AgentCtx, base: AgentBase, input: ProposerInput, vctx: ProposalContext, maxProposals = 5): Promise<AgentResult<Agent2Out> & { accepted?: { proposal: Proposal; topicId: string }[]; discarded?: { proposal: Proposal; reasons: string[] }[] }> {
  const r = await runAgent(ctx, base, { ...proposerSpec(), extraVars: { MAX_PROPOSALS: String(maxProposals) } }, input, { kind: "entity", ref: input.entity.entity_id });
  if (r.state !== "ok") return r;
  const accepted: { proposal: Proposal; topicId: string }[] = []; const discarded: { proposal: Proposal; reasons: string[] }[] = []; const seen = new Set(vctx.existingTopicIds);
  for (const p of r.data.proposals.slice(0, maxProposals)) {
    const v = validateProposal(p, { ...vctx, existingTopicIds: seen });
    if (v.ok) { accepted.push({ proposal: p, topicId: v.topicId }); seen.add(v.topicId); } else discarded.push({ proposal: p, reasons: v.reasons });
  }
  for (const p of r.data.proposals.slice(maxProposals)) discarded.push({ proposal: p, reasons: [`acima do máximo de ${maxProposals} propostas`] });
  return { ...r, accepted, discarded };
}

// --- Agente 3: modelagem de intenção (a demanda vem SEMPRE do INPUT, nunca do agente) --------------------------------------
export interface DemandDatum { readonly query: string; readonly value: number | null; readonly impressions: number | null; readonly source: string; readonly period: string; readonly method: string }
export interface IntentInput { readonly topics: readonly { readonly topic_id: string; readonly dimensions: Readonly<Record<string, string>>; readonly query_hypothesis: string; readonly user_need: string }[]; readonly demand_data: readonly DemandDatum[]; readonly existing_pages: readonly { readonly url: string; readonly queries: readonly string[] }[] }
export const intentSpec = (input: IntentInput): AgentSpec<Agent3Out> => ({
  agent: 3, inputVar: "TOPICS_AND_DEMAND_JSON", schema: agent3Schema,
  validate: (o) => {
    const e: string[] = []; const ids = new Set(input.topics.map((t) => t.topic_id)); const q = new Set(input.demand_data.map((d) => d.query.toLowerCase()));
    const seen = new Set<string>();
    for (const i of o.intents) {
      if (!ids.has(i.topic_id)) e.push(`topic_id fora do INPUT: ${i.topic_id}`); if (seen.has(i.topic_id)) e.push(`topic_id repetido: ${i.topic_id}`); seen.add(i.topic_id);
      if (i.primary_keyword !== null && !q.has(i.primary_keyword.toLowerCase())) e.push(`primary_keyword não está em INPUT.demand_data: “${i.primary_keyword}” (use null e HYPOTHESIS)`);
      for (const v of i.variants) if (!q.has(v.toLowerCase())) e.push(`variante fora de INPUT.demand_data: “${v}”`);
      if (i.demand_status === "OBSERVED" && i.primary_keyword === null) e.push(`demand_status OBSERVED sem primary_keyword (${i.topic_id})`);
    }
    for (const t of input.topics) if (!seen.has(t.topic_id)) e.push(`tópico sem modelagem: ${t.topic_id}`);
    return e;
  },
});
export interface NormalizedIntent { readonly topicId: string; readonly what: string; readonly where: string; readonly why: string; readonly when: string; readonly forWhom: string; readonly intentType: string; readonly primaryKeyword: string | null; readonly variants: readonly string[]; readonly queryHypothesis: string; readonly demandStatus: "OBSERVED" | "HYPOTHESIS"; readonly demandSignal: { readonly value: number | null; readonly source: string | null; readonly period: string | null; readonly method: string | null; readonly uncertainty: string | null }; readonly unmetNeed: boolean; readonly discrepancies: readonly string[] }
/** Autoridade do código: o sinal de demanda e a necessidade não atendida são RECALCULADOS do INPUT; divergência do agente é registrada, nunca aceita. */
export function normalizeIntents(out: Agent3Out, input: IntentInput): NormalizedIntent[] {
  return out.intents.map((i) => {
    const hit = i.primary_keyword === null ? undefined : input.demand_data.find((d) => d.query.toLowerCase() === i.primary_keyword!.toLowerCase());
    const value = hit ? hit.value ?? hit.impressions : null;
    const observed = hit !== undefined && value !== null;
    const unmet = input.demand_data.some((d) => (d.impressions ?? 0) > 0 && [i.primary_keyword, ...i.variants].some((x) => x?.toLowerCase() === d.query.toLowerCase()) && !input.existing_pages.some((p) => p.queries.some((qq) => qq.toLowerCase() === d.query.toLowerCase())));
    const discrepancies: string[] = [];
    if ((i.demand_status === "OBSERVED") !== observed) discrepancies.push(`demand_status do agente (${i.demand_status}) diverge do INPUT (${observed ? "OBSERVED" : "HYPOTHESIS"})`);
    if (i.demand_signal.value !== value) discrepancies.push(`valor de demanda do agente (${i.demand_signal.value}) diverge do INPUT (${value})`);
    if (i.unmet_need !== unmet) discrepancies.push(`unmet_need do agente (${i.unmet_need}) diverge do cálculo do código (${unmet})`);
    return { topicId: i.topic_id, what: i.what, where: i.where, why: i.why, when: i.when, forWhom: i.for_whom, intentType: i.intent_type, primaryKeyword: observed ? i.primary_keyword : null, variants: i.variants, queryHypothesis: i.query_hypothesis, demandStatus: observed ? "OBSERVED" : "HYPOTHESIS",
      demandSignal: observed ? { value, source: hit!.source, period: hit!.period, method: hit!.method, uncertainty: "volume de busca é estimativa (R11)" } : { value: null, source: null, period: null, method: null, uncertainty: "sem sinal de demanda no INPUT" }, unmetNeed: unmet, discrepancies };
  });
}
export async function modelIntents(ctx: AgentCtx, base: AgentBase, input: IntentInput): Promise<AgentResult<Agent3Out> & { intents?: NormalizedIntent[] }> {
  const r = await runAgent(ctx, base, intentSpec(input), input, { kind: "topics", ref: input.topics.map((t) => t.topic_id.slice(0, 8)).join(",").slice(0, 190) });
  if (r.state !== "ok") return r;
  const intents = normalizeIntents(r.data, input);
  for (const i of intents) await base.db.query(`UPDATE plataforma.growth_opportunity SET intent_model = $2::jsonb WHERE topic_id = $1`, [i.topicId, JSON.stringify({ ...i, agentRunId: r.agentRunId })]);
  return { ...r, intents };
}

// --- Agente 4: revisão de redundância semântica (o código aplica) --------------------------------------------------------
export interface CombinationGroupsInput { readonly groups: readonly { readonly parent: { readonly topic_id: string; readonly dimensions: Readonly<Record<string, string>> }; readonly children: readonly { readonly topic_id: string; readonly dimensions: Readonly<Record<string, string>>; readonly count: number; readonly exclusive_blocks: number }[] }[] }
export const combinationReviewSpec = (input: CombinationGroupsInput): AgentSpec<Agent4Out> => ({
  agent: 4, inputVar: "COMBINATION_GROUPS_JSON", schema: agent4Schema,
  validate: (o) => { const ids = new Set(input.groups.flatMap((g) => g.children.map((c) => c.topic_id))); const e: string[] = []; const seen = new Set<string>(); for (const r of o.reviews) { if (!ids.has(r.topic_id)) e.push(`topic_id fora do INPUT: ${r.topic_id}`); if (seen.has(r.topic_id)) e.push(`revisão repetida: ${r.topic_id}`); seen.add(r.topic_id); for (const s of r.redundant_with_siblings) if (!ids.has(s)) e.push(`irmão fora do INPUT: ${s}`); } for (const i of ids) if (!seen.has(i)) e.push(`filho sem revisão: ${i}`); return e; },
});
export const reviewCombinations = (ctx: AgentCtx, base: AgentBase, input: CombinationGroupsInput) => runAgent(ctx, base, combinationReviewSpec(input), input, { kind: "combinations", ref: input.groups.map((g) => g.parent.topic_id.slice(0, 8)).join(",").slice(0, 190) });

// --- Agente 5: explicação da decisão (NÃO pode alterá-la) -------------------------------------------------------------------
export interface DecisionInput { readonly topic_id: string; readonly decision: string; readonly eligible: boolean; readonly gate_results: Readonly<Record<string, string>>; readonly gate_details: Readonly<Record<string, { readonly result: string; readonly detail: string; readonly missing: readonly string[] }>>; readonly blocking_reasons: readonly string[]; readonly missing_requirements: readonly string[]; readonly floor_failures: readonly string[]; readonly total_score: number | null; readonly weight_coverage: number | null; readonly recommended_action: string; readonly policy_version: number }
const DECISION_LABELS = ["READY_FOR_BLUEPRINT", "DATA_REQUIRED", "RESEARCH_REQUIRED", "REJECTED"];
const OVERSTATE = /(pode ser publicad|pronta? para (publica|gerar)|está aprovad|foi aprovad|elegível para publica)/i;
/** A explicação não pode contradizer, suavizar ou reinterpretar a decisão: o código confere. */
export function explanationErrors(e: Agent5Out, d: DecisionInput): string[] {
  const r: string[] = [];
  if (e.topic_id !== d.topic_id) r.push("topic_id da explicação difere do INPUT");
  for (const l of DECISION_LABELS) if (l !== d.decision && e.explanation.includes(l)) r.push(`a explicação cita outra decisão (${l}); a decisão é ${d.decision}`);
  if (d.decision !== "READY_FOR_BLUEPRINT" && OVERSTATE.test(`${e.explanation} ${e.next_best_action}`)) r.push("a explicação sugere aprovação ou prontidão que a decisão não tem");
  if (sentences(e.explanation) > 4) r.push("a explicação tem mais de 4 frases");
  return r;
}
export const explainerSpec = (d: DecisionInput): AgentSpec<Agent5Out> => ({ agent: 5, inputVar: "ELIGIBILITY_DECISION_JSON", schema: agent5Schema, validate: (o) => explanationErrors(o, d) });
/** Explica e GRAVA a explicação ligada à decisão (uma por decisão); a decisão em si nunca é tocada. */
export async function explainDecision(ctx: AgentCtx, base: AgentBase, decisionId: string, input: DecisionInput): Promise<AgentResult<Agent5Out>> {
  const r = await runAgent(ctx, base, explainerSpec(input), input, { kind: "decision", ref: decisionId });
  if (r.state === "ok") await base.db.query(`INSERT INTO plataforma.decision_explanation (tenant_id, decision_id, agent_run_id, explanation, next_best_action) VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4) ON CONFLICT (tenant_id, decision_id) DO NOTHING`, [decisionId, r.agentRunId, r.data.explanation, r.data.next_best_action]);
  return r;
}
export async function getExplanation(db: TenantDb, decisionId: string): Promise<{ explanation: string; nextBestAction: string; agentRunId: string } | null> {
  const r = (await db.query<{ explanation: string; next_best_action: string; agent_run_id: string }>(`SELECT explanation, next_best_action, agent_run_id FROM plataforma.decision_explanation WHERE decision_id = $1`, [decisionId])).rows[0];
  return r ? { explanation: r.explanation, nextBestAction: r.next_best_action, agentRunId: r.agent_run_id } : null;
}

// --- Agente 6: campos semânticos do blueprint --------------------------------------------------------------------------------
export interface BlueprintDraftInput { readonly page_id: string; readonly fill: readonly string[]; readonly data_contract: readonly { readonly module_id: string; readonly fields: readonly string[] }[]; readonly intent: { readonly variants: readonly string[] }; readonly related_pages: readonly string[]; readonly sample_values: Readonly<Record<string, string>>; readonly [k: string]: unknown }
const PLACEHOLDER = /\{([a-z0-9_]+)\}/g;
export function blueprintFieldErrors(o: Agent6Out, d: BlueprintDraftInput): string[] {
  const e: string[] = []; const allowed = new Set(d.fill); const fields = new Set(d.data_contract.flatMap((m) => m.fields));
  if (o.page_id !== d.page_id) e.push("page_id difere do INPUT");
  for (const k of Object.keys(o.fields)) if (!allowed.has(k)) e.push(`campo não pedido (__FILL__): ${k}`);
  const fill = (t: string) => t.replace(PLACEHOLDER, (_, k: string) => d.sample_values[k] ?? "");
  const checkPattern = (k: string, max?: number) => { const v = o.fields[k]; if (v === undefined) return; if (typeof v !== "string") { e.push(`${k} deve ser texto`); return; } for (const m of v.matchAll(PLACEHOLDER)) if (!fields.has(m[1]!)) e.push(`${k}: placeholder {${m[1]}} não existe em data_contract`); if (max && fill(v).length > max) e.push(`${k}: ${fill(v).length} caracteres com valores típicos (máximo ${max})`); };
  checkPattern("title_pattern", 60); checkPattern("h1_pattern"); checkPattern("meta_description_pattern", 155);
  const sec = o.fields["target_query_cluster.secondary"]; if (sec !== undefined) { if (!Array.isArray(sec)) e.push("target_query_cluster.secondary deve ser lista"); else for (const q of sec) if (!d.intent.variants.includes(String(q))) e.push(`consulta secundária fora de INPUT.intent.variants: ${String(q)}`); }
  return e;
}
export const blueprintWriterSpec = (d: BlueprintDraftInput): AgentSpec<Agent6Out> => ({ agent: 6, inputVar: "BLUEPRINT_DRAFT_JSON", schema: agent6Schema, validate: (o) => blueprintFieldErrors(o, d) });
export const writeBlueprintFields = (ctx: AgentCtx, base: AgentBase, input: BlueprintDraftInput) => runAgent(ctx, base, blueprintWriterSpec(input), input, { kind: "blueprint", ref: input.page_id });

export { agent7Schema, agent8Schema };
