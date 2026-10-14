import type { AttributeDefinition } from "../catalog/types";
import type { VerifiedIdentity } from "../identity";
import { createBlueprint } from "../engine/blueprint-store";
import type { TemplateInfo } from "../engine/blueprint";
import { assertExecutable } from "../engine/lifecycle";
import type { VerticalDefinition } from "../engine/vertical";
import { withTenant, type PoolLike, type TenantDb } from "../tenant-context";
import { applySemanticFields, buildSpecBlueprint, contentHash, structuralHash } from "./build";
import { specBlueprintSchema, type BlueprintStatus, type FamilyRecipe, type SpecBlueprint } from "./types";
import { blueprintFieldErrors, writeBlueprintFields, type BlueprintDraftInput } from "../agents/agents";
import type { AgentBase, AgentCtx } from "../agents/runner";

// Criação e leitura do Blueprint da especificação (Incremento 5). Só tópicos READY_FOR_BLUEPRINT (estado `eligible` com a decisão vigente READY). Versões imutáveis e únicas por conteúdo.
// Também gera o blueprint do motor existente (`page_blueprint`) quando o padrão da vertical tem template, para que a geração reaproveite o pipeline; NÃO avança o estado (eligible → blueprinted
// continua exigindo a análise de SERP ou a exceção escrita, ADR-025).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class SpecBlueprintPreconditionError extends Error { readonly code = "SPEC_BLUEPRINT_PRECONDITION"; constructor(readonly reasons: readonly string[]) { super(`não é possível criar o blueprint: ${reasons.join("; ")}`); this.name = "SpecBlueprintPreconditionError"; } }
export class SpecBlueprintInvalidError extends Error { readonly code = "SPEC_BLUEPRINT_INVALID"; constructor(readonly problems: readonly string[]) { super(`blueprint inválido (nada foi gravado): ${problems.join("; ")}`); this.name = "SpecBlueprintInvalidError"; } }

export interface SpecBlueprintDeps { readonly vertical: VerticalDefinition; readonly recipes: readonly FamilyRecipe[]; readonly templates: readonly TemplateInfo[]; readonly attributes: readonly AttributeDefinition[]; readonly version?: string; readonly now?: () => Date }
export interface SpecBlueprintRecord { readonly id: string; readonly version: number; readonly status: BlueprintStatus; readonly semanticSource: "code" | "agent6"; readonly blueprint: SpecBlueprint; readonly contentHash: string; readonly structuralHash: string; readonly templateId: string; readonly templateGap: boolean; readonly agentRunId: string | null; readonly createdAt: Date; readonly createdBy: string }
interface Row { id: string; version: number; status: BlueprintStatus; semantic_source: "code" | "agent6"; content: SpecBlueprint; content_hash: string; structural_hash: string; template_id: string; template_gap: boolean; agent_run_id: string | null; created_at: Date; created_by: string }
const COLS = "id, version, status, semantic_source, content, content_hash, structural_hash, template_id, template_gap, agent_run_id, created_at, created_by";
const toRec = (r: Row): SpecBlueprintRecord => ({ id: r.id, version: r.version, status: r.status, semanticSource: r.semantic_source, blueprint: r.content, contentHash: r.content_hash, structuralHash: r.structural_hash, templateId: r.template_id, templateGap: r.template_gap, agentRunId: r.agent_run_id, createdAt: r.created_at, createdBy: r.created_by });
export async function listSpecBlueprints(db: TenantDb, opportunityId: string): Promise<SpecBlueprintRecord[]> {
  if (!UUID.test(opportunityId)) return [];
  return (await db.query<Row>(`SELECT ${COLS} FROM plataforma.spec_blueprint WHERE opportunity_id = $1 ORDER BY version DESC`, [opportunityId])).rows.map(toRec);
}

interface OppRow { id: string; status: string; topic_id: string | null; primary_entity_id: string | null; candidate_page_family: string | null; intent_type: string | null; primary_query: string; user_need: string | null; demand_signal: { value: number | null; source: string | null } | null; attributes_used: string[]; relationships_used: string[]; dimensions: Record<string, string> | null; parent_topic_id: string | null; intent_model: { variants?: string[] } | null; eligible: boolean | null }

async function loadInputs(db: TenantDb, opportunityId: string, deps: SpecBlueprintDeps, forUpdate: boolean) {
  const o = (await db.query<OppRow>(`SELECT id, status, topic_id, primary_entity_id, candidate_page_family, intent_type, primary_query, user_need, demand_signal, attributes_used, relationships_used, dimensions, parent_topic_id, intent_model, eligible FROM plataforma.growth_opportunity WHERE id = $1 ${forUpdate ? "FOR UPDATE" : ""}`, [opportunityId])).rows[0];
  if (!o) return { o: null };
  const dec = (await db.query<{ id: string; decision: string; eligible: boolean; snapshot: { varyingAttributes?: string[] } }>(`SELECT id, decision, eligible, snapshot FROM plataforma.eligibility_decision WHERE opportunity_id = $1 ORDER BY seq DESC LIMIT 1`, [opportunityId])).rows[0] ?? null;
  const ent = o.primary_entity_id ? (await db.query<{ name: string; source_key: string; qualifier: string | null }>(`SELECT e.name, e.source_key, (SELECT f.value #>> '{}' FROM plataforma.fact f WHERE f.entity_id = e.id AND f.attribute_id = e.entity_type || '.uf' AND f.superseded_at IS NULL LIMIT 1) AS qualifier FROM plataforma.entity e WHERE e.id = $1`, [o.primary_entity_id])).rows[0] ?? null : null;
  const entityIds = [o.primary_entity_id, ...(await db.query<{ id: string }>(`SELECT id FROM plataforma.entity WHERE source_key = ANY($1::text[])`, [Object.values(o.dimensions ?? {})])).rows.map((r) => r.id)].filter((x): x is string => !!x);
  const have = new Map<string, number>();
  for (const r of (await db.query<{ attribute_id: string; entity_id: string }>(`SELECT attribute_id, entity_id FROM plataforma.fact WHERE superseded_at IS NULL AND entity_id = ANY($1::uuid[]) AND attribute_id = ANY($2::text[])`, [[...new Set(entityIds)], o.attributes_used])).rows) have.set(r.attribute_id, (have.get(r.attribute_id) ?? 0) + 1);
  const available = new Set([...have].filter(([, n]) => n >= new Set(entityIds).size).map(([a]) => a));
  const sib = (await db.query<{ topic_id: string }>(`SELECT topic_id FROM plataforma.growth_opportunity WHERE topic_id IS NOT NULL AND candidate_page_family = $1 AND topic_id <> $2 AND pattern_key = (SELECT pattern_key FROM plataforma.growth_opportunity WHERE id = $3) ORDER BY priority_value DESC NULLS LAST, topic_id LIMIT 5`, [o.candidate_page_family, o.topic_id, o.id])).rows.map((r) => r.topic_id);
  const kids = (await db.query<{ topic_id: string }>(`SELECT topic_id FROM plataforma.growth_opportunity WHERE parent_topic_id = $1 ORDER BY topic_id LIMIT 20`, [o.topic_id])).rows.map((r) => r.topic_id);
  return { o, dec, ent, available, sib, kids };
}

export interface CreateSpecResult { readonly record: SpecBlueprintRecord; readonly created: boolean; readonly legacy: { readonly attempted: boolean; readonly ready?: boolean; readonly template?: string | null; readonly error?: string } }
export async function createSpecBlueprint(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, deps: SpecBlueprintDeps, input: { opportunityId: string }): Promise<CreateSpecResult> {
  if (!UUID.test(input.opportunityId)) throw new SpecBlueprintPreconditionError(["oportunidade inválida"]);
  const now = (deps.now ?? (() => new Date()))();
  const out = await withTenant(pool, identity, tenantId, async (db) => {
    const L = await loadInputs(db, input.opportunityId, deps, true);
    if (L.o === null) throw new SpecBlueprintPreconditionError(["oportunidade não encontrada"]);
    const { o, dec, ent, available, sib, kids } = L;
    const reasons: string[] = [];
    if (!o.topic_id) reasons.push("a oportunidade não é um tópico do motor (sem topic_id)");
    if (o.status !== "eligible") reasons.push(`o tópico está em “${o.status}”; o blueprint só nasce de READY_FOR_BLUEPRINT (estado “eligible”)`);
    if (!dec || dec.decision !== "READY_FOR_BLUEPRINT" || !dec.eligible) reasons.push(`a decisão vigente é ${dec?.decision ?? "inexistente"}, não READY_FOR_BLUEPRINT`);
    const recipe = deps.recipes.find((r) => r.family === o.candidate_page_family);
    if (!recipe) reasons.push(`não há receita de blueprint para a família ${o.candidate_page_family}`);
    if (!ent) reasons.push("entidade primária não encontrada");
    if (reasons.length > 0 || !recipe || !ent || !dec) throw new SpecBlueprintPreconditionError(reasons);
    const maxAge = new Map(deps.attributes.map((a) => [a.attributeId, a.maxAgeDays] as const));
    const built = buildSpecBlueprint({ tenantId, version: deps.version ?? "1.0.0", now, topic: { topicId: o.topic_id!, family: o.candidate_page_family!, intentType: o.intent_type!, queryHypothesis: o.primary_query, userNeed: o.user_need ?? "", demand: { value: o.demand_signal?.value ?? null, source: o.demand_signal?.source ?? null }, attributesUsed: o.attributes_used, relationshipsUsed: o.relationships_used, dimensions: o.dimensions ?? {}, intentVariants: o.intent_model?.variants ?? [] },
      entity: { name: ent.name, qualifier: ent.qualifier, sourceKey: ent.source_key }, availableAttributes: available, varyingAttributes: dec.snapshot.varyingAttributes ?? [], attributeMaxAge: maxAge, graph: { parents: o.parent_topic_id ? [o.parent_topic_id] : [], siblings: sib, children: kids }, recipe, templates: new Set(deps.templates.map((t) => t.key)) });
    if (built.problems.length > 0) throw new SpecBlueprintInvalidError(built.problems);
    const bp = built.blueprint; const status: BlueprintStatus = bp.differentiation_strategy === "INSUFFICIENT" ? "SEMANTIC_INSUFFICIENT" : "COMPLETE";
    const h = contentHash(bp);
    const ins = await db.query<Row>(
      `INSERT INTO plataforma.spec_blueprint (tenant_id, opportunity_id, version, status, semantic_source, content, content_hash, structural_hash, template_id, template_gap, created_by)
       VALUES (plataforma.current_tenant_id(), $1, (SELECT COALESCE(max(version), 0) + 1 FROM plataforma.spec_blueprint WHERE opportunity_id = $1), $2, 'code', $3::jsonb, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, opportunity_id, content_hash) DO NOTHING RETURNING ${COLS}`, [o.id, status, JSON.stringify(bp), h, structuralHash(bp), bp.template_id, built.templateGap, identity.userId]);
    const created = ins.rows.length > 0;
    const row = ins.rows[0] ?? (await db.query<Row>(`SELECT ${COLS} FROM plataforma.spec_blueprint WHERE opportunity_id = $1 AND content_hash = $2`, [o.id, h])).rows[0]!;
    if (created) await db.query(`INSERT INTO plataforma.opportunity_event (tenant_id, opportunity_id, event_type, actor, reason, data) VALUES (plataforma.current_tenant_id(), $1, 'blueprint', $2, $3, $4::jsonb)`, [o.id, identity.userId, `blueprint da especificação v${row.version} (${status}${built.templateGap ? `; template_gap: ${bp.template_id}` : ""})`, JSON.stringify({ specBlueprintId: row.id, version: row.version, status, templateGap: built.templateGap, decisionId: dec.id })]);
    return { rec: toRec(row), created };
  });
  // blueprint do motor existente (geração): só se o padrão da vertical tem template; não avança o estado
  let legacy: CreateSpecResult["legacy"] = { attempted: true };
  try { const r = await createBlueprint(pool, identity, tenantId, { vertical: deps.vertical, templates: deps.templates }, { opportunityId: input.opportunityId }); legacy = { attempted: true, ready: r.record.ready, template: r.record.templateKey }; }
  catch (e) { legacy = { attempted: true, error: e instanceof Error ? e.message.slice(0, 200) : String(e) }; }
  return { record: out.rec, created: out.created, legacy };
}

export interface RefineResult { readonly state: "ok" | "provider_not_configured" | "failed" | "insufficient"; readonly record?: SpecBlueprintRecord; readonly agentRunId?: string; readonly errors?: readonly string[]; readonly missing?: readonly string[] }
/** Agente 6: refina os campos semânticos. O código valida; `INSUFFICIENT` devolve o tópico (eligible → scored, DATA_REQUIRED na especificação) com o motivo. */
export async function refineWithAgent6(ctx: AgentCtx, pool: PoolLike, identity: VerifiedIdentity, tenantId: string, input: { opportunityId: string; sampleValues: Readonly<Record<string, string>>; budget: AgentBase["budget"]; now?: () => Date }): Promise<RefineResult> {
  return withTenant(pool, identity, tenantId, async (db) => {
    const latest = (await db.query<Row>(`SELECT ${COLS} FROM plataforma.spec_blueprint WHERE opportunity_id = $1 ORDER BY version DESC LIMIT 1`, [input.opportunityId])).rows[0];
    if (!latest) throw new SpecBlueprintPreconditionError(["não há blueprint para refinar"]);
    const bp = latest.content;
    const draft: BlueprintDraftInput = { page_id: bp.page_id, fill: ["topic_definition", "title_pattern", "h1_pattern", "meta_description_pattern", "target_query_cluster.secondary", "differentiation_strategy", "internal_link_plan.anchor_texts"], data_contract: bp.data_contract.map((m) => ({ module_id: m.module_id, fields: m.fields })), intent: { variants: bp.target_query_cluster.secondary }, related_pages: [...bp.internal_link_plan.siblings, ...bp.internal_link_plan.parents], sample_values: input.sampleValues, blueprint: bp };
    const r = await writeBlueprintFields(ctx, { db, budget: input.budget, runId: null, actor: identity.userId, now: input.now ?? (() => new Date()) }, draft);
    if (r.state === "provider_not_configured") return { state: "provider_not_configured" as const, missing: r.missing, agentRunId: r.agentRunId };
    if (r.state === "failed") return { state: "failed" as const, errors: r.errors, agentRunId: r.agentRunId };
    const merged = applySemanticFields(bp, r.data.fields);
    const valid = specBlueprintSchema.safeParse(merged);
    if (!valid.success) return { state: "failed" as const, errors: valid.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`), agentRunId: r.agentRunId };
    const insufficient = merged.differentiation_strategy === "INSUFFICIENT";
    const h = contentHash(merged);
    const ins = await db.query<Row>(
      `INSERT INTO plataforma.spec_blueprint (tenant_id, opportunity_id, version, status, semantic_source, content, content_hash, structural_hash, template_id, template_gap, agent_run_id, created_by)
       VALUES (plataforma.current_tenant_id(), $1, (SELECT COALESCE(max(version), 0) + 1 FROM plataforma.spec_blueprint WHERE opportunity_id = $1), $2, 'agent6', $3::jsonb, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tenant_id, opportunity_id, content_hash) DO NOTHING RETURNING ${COLS}`, [input.opportunityId, insufficient ? "SEMANTIC_INSUFFICIENT" : "COMPLETE", JSON.stringify(merged), h, structuralHash(merged), merged.template_id, latest.template_gap, r.agentRunId, identity.userId]);
    const row = ins.rows[0] ?? (await db.query<Row>(`SELECT ${COLS} FROM plataforma.spec_blueprint WHERE opportunity_id = $1 AND content_hash = $2`, [input.opportunityId, h])).rows[0]!;
    if (insufficient) {
      const cur = (await db.query<{ status: string }>(`SELECT status FROM plataforma.growth_opportunity WHERE id = $1 FOR UPDATE`, [input.opportunityId])).rows[0]!;
      if (cur.status === "eligible") {
        assertExecutable("eligible", "scored");
        await db.query(`UPDATE plataforma.growth_opportunity SET status = 'scored', eligible = false WHERE id = $1 AND status = 'eligible'`, [input.opportunityId]);
        await db.query(`INSERT INTO plataforma.opportunity_event (tenant_id, opportunity_id, event_type, from_status, to_status, actor, reason, data) VALUES (plataforma.current_tenant_id(), $1, 'transition', 'eligible', 'scored', $2, 'O Agente 6 não conseguiu descrever a diferenciação com blocos concretos (INSUFFICIENT): o tópico volta a DATA_REQUIRED', $3::jsonb)`, [input.opportunityId, identity.userId, JSON.stringify({ specBlueprintId: row.id, agentRunId: r.agentRunId, mapped: "DATA_REQUIRED" })]);
      }
    }
    return { state: insufficient ? "insufficient" as const : "ok" as const, record: toRec(row), agentRunId: r.agentRunId };
  });
}
export { blueprintFieldErrors };
