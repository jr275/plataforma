import { ensurePolicy } from "../catalog/store";
import type { AttributeDefinition } from "../catalog/types";
import type { VerifiedIdentity } from "../identity";
import { assertExecutable, type LifecycleState } from "../engine/lifecycle";
import type { VerticalDefinition } from "../engine/vertical";
import type { FamilyRecipe, SpecBlueprint } from "../blueprint-spec/types";
import { applyNarrative, verifyQaWithAgent8, writeNarrative, type AgentBase, type AgentCtx, type NarrativeInput, type QaBundleInput } from "../agents";
import { compileRecipe, recipeHash } from "../recipe/compile";
import type { FamilyRenderer, PageRecipe, RecipeEntity, RecipeFact } from "../recipe/types";
import type { RunBudget } from "../provider/budget";
import { withTenant, type PoolLike, type TenantDb } from "../tenant-context";
import { mergeVerifier, outcomeOf, runCodeChecks } from "./checks";
import { QA_IDS, type QaBundle, type QaCheck, type QaId, type QaOutcome, type QaPolicy } from "./types";

// Compilação do recipe e QA Q1–Q14 sobre ele (Incremento 6). NÃO publica nem indexa: o recipe é noindex, o QA só registra resultados, e o ciclo de vida avança no máximo até `qa`.
// Um gate que não rodou é NOT_RUN (nunca aprovado por padrão): sem o verificador (Agente 8) a utilidade (Q14) não é presumida e o desfecho é QA_INCOMPLETE.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class RecipeQaError extends Error { readonly code = "RECIPE_QA"; constructor(readonly reasons: readonly string[]) { super(`não é possível compilar o recipe: ${reasons.join("; ")}`); this.name = "RecipeQaError"; } }
export interface RecipeQaDeps {
  readonly vertical: VerticalDefinition; readonly recipes: readonly FamilyRecipe[]; readonly renderers: readonly FamilyRenderer[]; readonly qaPolicy: QaPolicy; readonly attributes: readonly AttributeDefinition[]; readonly now?: () => Date;
  /** Agentes de runtime (opcionais): sem eles o recipe usa a narrativa determinística do pack e Q14 fica NOT_RUN. */
  readonly agents?: { readonly ctx: AgentCtx; readonly budget: RunBudget; readonly editorialStyle: string };
}
export interface QaReportRecord { readonly id: string; readonly recipeId: string; readonly outcome: QaOutcome; readonly results: Record<QaId, QaCheck>; readonly blockingFailures: readonly QaId[]; readonly referenceTime: Date; readonly agentRunId: string | null; readonly createdAt: Date }
export interface RecipeRecord { readonly id: string; readonly version: number; readonly narrativeSource: "template" | "agent7"; readonly recipe: PageRecipe; readonly contentHash: string; readonly createdAt: Date }
export interface RecipeQaResult { readonly recipe: RecipeRecord; readonly report: QaReportRecord; readonly from: LifecycleState; readonly to: LifecycleState; readonly steps: readonly { from: LifecycleState; to: LifecycleState }[]; readonly narrative: { readonly attempted: boolean; readonly state?: string }; readonly verifier: { readonly attempted: boolean; readonly state?: string } }

interface RecRow { id: string; version: number; narrative_source: "template" | "agent7"; content: PageRecipe; content_hash: string; created_at: Date }
const toRec = (r: RecRow): RecipeRecord => ({ id: r.id, version: r.version, narrativeSource: r.narrative_source, recipe: r.content, contentHash: r.content_hash, createdAt: r.created_at });
const textOf = (r: PageRecipe) => [r.title, r.h1, r.metaDescription, ...r.blocks.map((b) => b.text)].join("\n");

const START: readonly LifecycleState[] = ["blueprinted", "data_assembled", "evidence_validated", "experience_built", "qa"];
const ORDER: LifecycleState[] = ["blueprinted", "data_assembled", "evidence_validated", "experience_built", "qa"];

async function insertRecipe(db: TenantDb, o: { oppId: string; bpId: string; recipe: PageRecipe; source: "template" | "agent7"; agentRunId: string | null; actor: string }): Promise<RecipeRecord> {
  const h = recipeHash(o.recipe);
  const ins = await db.query<RecRow>(`INSERT INTO plataforma.page_recipe (tenant_id, opportunity_id, spec_blueprint_id, version, narrative_source, content, content_hash, agent_run_id, created_by)
    VALUES (plataforma.current_tenant_id(), $1, $2, (SELECT COALESCE(max(version), 0) + 1 FROM plataforma.page_recipe WHERE opportunity_id = $1), $3, $4::jsonb, $5, $6, $7)
    ON CONFLICT (tenant_id, opportunity_id, content_hash) DO NOTHING RETURNING id, version, narrative_source, content, content_hash, created_at`, [o.oppId, o.bpId, o.source, JSON.stringify(o.recipe), h, o.agentRunId, o.actor]);
  return toRec(ins.rows[0] ?? (await db.query<RecRow>(`SELECT id, version, narrative_source, content, content_hash, created_at FROM plataforma.page_recipe WHERE opportunity_id = $1 AND content_hash = $2`, [o.oppId, h])).rows[0]!);
}

export async function compileRecipeAndRunQa(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, deps: RecipeQaDeps, input: { opportunityId: string }): Promise<RecipeQaResult> {
  if (!UUID.test(input.opportunityId)) throw new RecipeQaError(["oportunidade inválida"]);
  const now = (deps.now ?? (() => new Date()))();
  return withTenant(pool, identity, tenantId, async (db) => {
    const o = (await db.query<{ id: string; status: LifecycleState; topic_id: string | null; primary_entity_id: string | null; dimensions: Record<string, string> | null; candidate_page_family: string | null }>(`SELECT id, status, topic_id, primary_entity_id, dimensions, candidate_page_family FROM plataforma.growth_opportunity WHERE id = $1 FOR UPDATE`, [input.opportunityId])).rows[0];
    if (!o) throw new RecipeQaError(["oportunidade não encontrada"]);
    const reasons: string[] = [];
    if (!START.includes(o.status)) reasons.push(`o tópico está em “${o.status}”; o recipe só é compilado a partir de “blueprinted” (READY_FOR_GENERATION)`);
    const bp = (await db.query<{ id: string; version: number; status: string; template_gap: boolean; content: SpecBlueprint }>(`SELECT id, version, status, template_gap, content FROM plataforma.spec_blueprint WHERE opportunity_id = $1 ORDER BY version DESC LIMIT 1`, [o.id])).rows[0];
    if (!bp) reasons.push("não há blueprint da especificação"); else if (bp.status !== "COMPLETE") reasons.push(`o blueprint mais recente está ${bp.status}`);
    const renderer = bp ? deps.renderers.find((r) => r.family === bp.content.page_family) : undefined;
    if (bp && !renderer) reasons.push(`não há renderizador para a família ${bp.content.page_family}`);
    if (reasons.length > 0 || !bp) throw new RecipeQaError(reasons);

    // entidades e fatos COM referência (fact_id): só fatos correntes dos atributos do blueprint
    const keys = [...new Set([...Object.values(o.dimensions ?? {})])];
    const ents = (await db.query<{ id: string; source_key: string; name: string; entity_type: string }>(`SELECT id, source_key, name, entity_type FROM plataforma.entity WHERE id = $1 OR source_key = ANY($2::text[]) ORDER BY source_key`, [o.primary_entity_id, keys])).rows;
    const recipeDef = deps.recipes.find((r) => r.family === bp.content.page_family);
    const fieldOf = new Map((recipeDef?.modules.flatMap((m) => m.fields) ?? []).filter((f) => f.attribute).map((f) => [f.attribute!, f.field] as const));
    const maxAge = new Map(deps.attributes.map((a) => [a.attributeId, a.maxAgeDays] as const));
    const facts = (await db.query<{ id: string; entity_id: string; attribute_id: string; value: unknown; unit: string | null; observed_at: Date; source_name: string; confidence: string }>(`SELECT id, entity_id, attribute_id, value, unit, observed_at, source_name, confidence FROM plataforma.fact WHERE superseded_at IS NULL AND entity_id = ANY($1::uuid[]) AND attribute_id = ANY($2::text[]) ORDER BY attribute_id, entity_id`, [ents.map((e) => e.id), bp.content.required_attributes])).rows;
    const keyOf = new Map(ents.map((e) => [e.id, e.source_key]));
    const ufOf = new Map<string, string>(); for (const f of (await db.query<{ entity_id: string; value: unknown }>(`SELECT entity_id, value FROM plataforma.fact WHERE superseded_at IS NULL AND entity_id = ANY($1::uuid[]) AND attribute_id LIKE '%.uf'`, [ents.map((e) => e.id)])).rows) ufOf.set(f.entity_id, String(f.value));
    const entities: RecipeEntity[] = ents.map((e) => ({ key: e.source_key, name: e.name, uf: ufOf.get(e.id) ?? null }));
    const rfacts: RecipeFact[] = facts.map((f) => ({ factId: f.id, entityKey: keyOf.get(f.entity_id)!, attributeId: f.attribute_id, field: fieldOf.get(f.attribute_id) ?? f.attribute_id, value: f.value as RecipeFact["value"], unit: f.unit, observedAt: f.observed_at.toISOString(), sourceName: f.source_name, confidence: Number(f.confidence), maxAgeDays: maxAge.get(f.attribute_id) ?? null }));
    const known = new Set((await db.query<{ path: string }>(`SELECT path FROM plataforma.page`)).rows.map((r) => r.path));
    for (const l of ["/cidades"]) known.add(l);
    const compiled = compileRecipe({ tenantId, blueprint: bp.content, specBlueprintId: bp.id, specBlueprintVersion: bp.version, templateGap: bp.template_gap, entities, facts: rfacts, knownPaths: known, renderer, referenceTime: now.toISOString() });
    if (!compiled.recipe) throw new RecipeQaError(compiled.problems);

    let rec = await insertRecipe(db, { oppId: o.id, bpId: bp.id, recipe: compiled.recipe, source: "template", agentRunId: null, actor: identity.userId });
    const base: AgentBase | null = deps.agents ? { db, budget: deps.agents.budget, runId: null, actor: identity.userId, now: () => now } : null;
    // Agente 7 (opcional): reescreve a narrativa; o código valida (números, referências, tempo de deslocamento)
    let narrative: RecipeQaResult["narrative"] = { attempted: false };
    if (deps.agents && base) {
      const slots = compiled.recipe.blocks.filter((b) => b.kind === "paragraph").map((b) => ({ slot_id: b.blockId, module_id: b.moduleId, facts: b.refs.map((r) => { const f = rfacts.find((x) => x.factId === r)!; return { fact_id: f.factId, field: f.field, value: f.value, unit: f.unit }; }), template_text: b.text }));
      const nin: NarrativeInput = { page_id: compiled.recipe.pageId, narrative_slots: slots, blueprint: { topic_definition: bp.content.topic_definition, page_type: bp.content.page_type }, editorial_style: deps.agents.editorialStyle };
      const r = await writeNarrative(deps.agents.ctx, base, nin, compiled.recipe.travelTime !== null);
      narrative = { attempted: true, state: r.state };
      if (r.state === "ok") rec = await insertRecipe(db, { oppId: o.id, bpId: bp.id, recipe: applyNarrative(compiled.recipe, r.data), source: "agent7", agentRunId: r.agentRunId, actor: identity.userId });
    }

    // QA: código (Q1–Q13) + verificador opcional (Q1, Q2, Q8, Q13, Q14)
    const policy = await ensurePolicy<QaPolicy>(db, "qa_policy", deps.qaPolicy, identity.userId);
    const sibs = (await db.query<{ opportunity_id: string; content: PageRecipe }>(`SELECT DISTINCT ON (opportunity_id) opportunity_id, content FROM plataforma.page_recipe WHERE opportunity_id <> $1 AND content ->> 'family' = $2 ORDER BY opportunity_id, version DESC`, [o.id, bp.content.page_family])).rows;
    const competing = (await db.query<{ topic_id: string; path: string }>(`SELECT o.topic_id, p.path FROM plataforma.growth_opportunity o JOIN plataforma.page p ON p.entity_id = o.entity_id AND p.status = 'published' WHERE o.id <> $1 AND o.candidate_page_family = $2`, [o.id, bp.content.page_family])).rows;
    const bundle: QaBundle = { recipe: rec.recipe, blueprint: bp.content, referenceTime: now.toISOString(), siblings: sibs.map((s) => ({ pageId: s.content.pageId, text: textOf(s.content), entityNames: s.content.entities.map((e) => e.name), values: s.content.facts.map((f) => String(f.value)) })), competing: competing.map((c) => ({ url: c.path, topicId: c.topic_id })), knownPaths: known, policy: policy.content };
    let results = runCodeChecks(bundle);
    let verifier: RecipeQaResult["verifier"] = { attempted: false }; let verifierRun: string | null = null;
    if (deps.agents && base) {
      const qin: QaBundleInput = { page_id: rec.recipe.pageId, page_text: textOf(rec.recipe), facts: rfacts.map((f) => ({ fact_id: f.factId, value: f.value, unit: f.unit })), sibling_summaries: bundle.siblings.slice(0, 5).map((s) => s.text.slice(0, 300)), parent_summary: null, travel_time_source: rec.recipe.travelTime?.source ?? null };
      const r = await verifyQaWithAgent8(deps.agents.ctx, base, qin);
      verifier = { attempted: true, state: r.state };
      if (r.state === "ok") { verifierRun = r.agentRunId; results = mergeVerifier(results, Object.fromEntries((["Q1", "Q2", "Q8", "Q13", "Q14"] as const).map((id) => [id, { result: r.data.checks[id].result, issues: r.data.checks[id].issues.map((x) => `${x.excerpt}: esperado “${x.expected}”, encontrado “${x.found}”`) }])) as never); }
    }
    const { outcome, blocking } = outcomeOf(results);
    const rep = (await db.query<{ id: string; created_at: Date }>(`INSERT INTO plataforma.qa_report (tenant_id, opportunity_id, recipe_id, reference_time, results, outcome, blocking_failures, agent_run_id, created_by) VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8) RETURNING id, created_at`, [o.id, rec.id, now, JSON.stringify(results), outcome, JSON.stringify(blocking), verifierRun, identity.userId])).rows[0]!;

    // ciclo de vida: no máximo até `qa` (nunca publica); um evento por passo; falha ou verificação incompleta vira bloqueio auditado
    const from = o.status; let st: LifecycleState = o.status; const steps: { from: LifecycleState; to: LifecycleState }[] = [];
    const move = async (to: LifecycleState, reason: string) => {
      if (ORDER.indexOf(st) >= ORDER.indexOf(to)) return;
      assertExecutable(st, to);
      const u = await db.query<{ id: string }>(`UPDATE plataforma.growth_opportunity SET status = $2 WHERE id = $1 AND status = $3 RETURNING id`, [o.id, to, st]);
      if (u.rows.length === 0) throw new Error("o estado do tópico mudou durante o QA");
      await db.query(`INSERT INTO plataforma.opportunity_event (tenant_id, opportunity_id, event_type, from_status, to_status, actor, reason, data) VALUES (plataforma.current_tenant_id(), $1, 'transition', $2, $3, $4, $5, $6::jsonb)`, [o.id, st, to, identity.userId, reason, JSON.stringify({ recipeId: rec.id, qaReportId: rep.id, outcome, authorizesPublication: false })]);
      steps.push({ from: st, to }); st = to;
    };
    await move("data_assembled", "recipe compilado: fatos reais reunidos com referência (fact_id)");
    await move("evidence_validated", "verificações de evidência executadas (Q1, Q2, Q12)");
    await move("experience_built", "recipe renderizado pelo renderizador da família");
    await move("qa", `QA Q1–Q14 executado: ${outcome}${blocking.length ? ` (bloqueantes: ${blocking.join(", ")})` : ""}; continua noindex e a publicação está bloqueada`);
    if (outcome !== "QA_PASSED") {
      const failed = QA_IDS.filter((id) => results[id].status === "FAIL"); const notRun = QA_IDS.filter((id) => results[id].status === "NOT_RUN");
      await db.query(`INSERT INTO plataforma.opportunity_event (tenant_id, opportunity_id, event_type, actor, reason, data) VALUES (plataforma.current_tenant_id(), $1, 'blocker', $2, $3, $4::jsonb)`, [o.id, identity.userId, `QA ${outcome}: ${failed.length ? `reprovados ${failed.join(", ")}` : ""}${failed.length && notRun.length ? "; " : ""}${notRun.length ? `não executados ${notRun.join(", ")}` : ""}`.slice(0, 1000), JSON.stringify({ qaReportId: rep.id, failed, notRun })]);
    }
    return { recipe: rec, report: { id: rep.id, recipeId: rec.id, outcome, results, blockingFailures: blocking, referenceTime: now, agentRunId: verifierRun, createdAt: rep.created_at }, from, to: st, steps, narrative, verifier };
  });
}

export async function listRecipes(db: TenantDb, opportunityId: string): Promise<RecipeRecord[]> {
  if (!UUID.test(opportunityId)) return [];
  return (await db.query<RecRow>(`SELECT id, version, narrative_source, content, content_hash, created_at FROM plataforma.page_recipe WHERE opportunity_id = $1 ORDER BY version DESC`, [opportunityId])).rows.map(toRec);
}
export async function listQaReports(db: TenantDb, opportunityId: string): Promise<QaReportRecord[]> {
  if (!UUID.test(opportunityId)) return [];
  return (await db.query<{ id: string; recipe_id: string; outcome: QaOutcome; results: Record<QaId, QaCheck>; blocking_failures: QaId[]; reference_time: Date; agent_run_id: string | null; created_at: Date }>(`SELECT id, recipe_id, outcome, results, blocking_failures, reference_time, agent_run_id, created_at FROM plataforma.qa_report WHERE opportunity_id = $1 ORDER BY seq DESC`, [opportunityId])).rows.map((r) => ({ id: r.id, recipeId: r.recipe_id, outcome: r.outcome, results: r.results, blockingFailures: r.blocking_failures, referenceTime: r.reference_time, agentRunId: r.agent_run_id, createdAt: r.created_at }));
}
