import type { VerifiedIdentity } from "../identity";
import { recordDecision } from "../runtime/decision-audit";
import { analyzeArchitecture, type ArchitectureDeps } from "../architecture/store";
import { withTenant, type PoolLike, type TenantDb } from "../tenant-context";

// Page Factory (leitura e aprovação). A unidade é a OPORTUNIDADE (tópico) e o `stage` é derivado dos registros; candidata, blueprint, gerada, aprovada e publicada NUNCA são o mesmo estado.
export const PAGE_STAGES = ["candidate", "blueprint", "generated", "awaiting_qa", "awaiting_approval", "approved", "preview", "published"] as const;
export type PageStage = (typeof PAGE_STAGES)[number];
export const STAGE_LABEL: Record<PageStage, string> = { candidate: "Candidata", blueprint: "Blueprint", generated: "Gerada", awaiting_qa: "Aguardando QA", awaiting_approval: "Aguardando aprovação", approved: "Aprovada (não publicada)", preview: "Em preview", published: "Publicada" };
export interface PageFilters { readonly q?: string; readonly stage?: PageStage; readonly family?: string; readonly template?: string; readonly qa?: string; readonly deployment?: string; readonly editorial?: "agent7" | "template"; readonly archetype?: string; readonly cluster?: string; readonly eligibility?: "approval" | "publication" | "indexing" | "not_indexing" | "no_gate"; readonly linkFailure?: boolean; readonly conflict?: boolean; readonly limit?: number; readonly offset?: number }
export interface PageRow {
  readonly opportunityId: string; readonly topicId: string; readonly primaryQuery: string; readonly family: string | null; readonly intent: string | null; readonly lifecycle: string; readonly stage: PageStage;
  readonly entity: string | null; readonly title: string | null; readonly h1: string | null; readonly url: string | null; readonly templateId: string | null; readonly blueprintStatus: string | null;
  readonly recipeVersion: number | null; readonly blocksFilled: number | null; readonly blocksInsufficient: number | null; readonly editorial: "agent7" | "template" | null; readonly qaOutcome: string | null; readonly approval: string | null;
  readonly deploymentStatus: string | null; readonly deploymentTarget: string | null; readonly publishedVersion: number | null; readonly updatedAt: Date;
  readonly archetypeId: string | null; readonly clusterId: string | null; readonly clusterName: string | null; readonly qualityScore: number | null; readonly gate: { readonly approval: boolean; readonly publication: boolean; readonly indexing: boolean } | null; readonly insufficientInlinks: boolean; readonly hasConflicts: boolean;
}
const SQL = `
WITH bp AS (SELECT DISTINCT ON (opportunity_id) opportunity_id, status, template_id FROM plataforma.spec_blueprint ORDER BY opportunity_id, version DESC),
     rc AS (SELECT DISTINCT ON (opportunity_id) opportunity_id, id AS recipe_id, version, narrative_source, content, created_at FROM plataforma.page_recipe ORDER BY opportunity_id, version DESC),
     qa AS (SELECT DISTINCT ON (opportunity_id) opportunity_id, recipe_id, outcome FROM plataforma.qa_report ORDER BY opportunity_id, seq DESC),
     ap AS (SELECT DISTINCT ON (recipe_id) recipe_id, decision FROM plataforma.page_approval ORDER BY recipe_id, seq DESC),
     pa AS (SELECT DISTINCT ON (a.opportunity_id) a.opportunity_id, a.archetype_id, a.topic_cluster_id, c.name AS cluster_name FROM plataforma.page_architecture a LEFT JOIN plataforma.topic_cluster c ON c.id = a.topic_cluster_id AND c.tenant_id = a.tenant_id ORDER BY a.opportunity_id, a.seq DESC),
     qg AS (SELECT DISTINCT ON (opportunity_id) opportunity_id, quality_score, eligible_approval, eligible_publication, eligible_indexing, failed_rules, result FROM plataforma.quality_gate_result ORDER BY opportunity_id, seq DESC),
     dp AS (SELECT DISTINCT ON (dp.opportunity_id) dp.opportunity_id, d.status, d.target, r.version AS dep_version FROM plataforma.deployment_page dp JOIN plataforma.deployment d ON d.id = dp.deployment_id AND d.tenant_id = dp.tenant_id JOIN plataforma.page_recipe r ON r.id = dp.recipe_id AND r.tenant_id = dp.tenant_id ORDER BY dp.opportunity_id, (d.target = 'production') DESC, d.seq DESC),
     base AS (
       SELECT o.id AS opportunity_id, o.topic_id, o.primary_query, o.candidate_page_family AS family, o.intent_type AS intent, o.status AS lifecycle, e.name AS entity,
              rc.content ->> 'title' AS title, rc.content ->> 'h1' AS h1, rc.content ->> 'url' AS url, coalesce(rc.content ->> 'templateId', bp.template_id) AS template_id, bp.status AS blueprint_status,
              rc.version AS recipe_version, rc.narrative_source AS editorial,
              (SELECT count(*) FROM jsonb_array_elements(rc.content -> 'blocks') b WHERE b ->> 'kind' = 'paragraph') AS blocks_filled,
              (SELECT count(*) FROM jsonb_array_elements(rc.content -> 'blocks') b WHERE b ->> 'kind' = 'insufficiency') + (SELECT count(*) FROM jsonb_array_elements(rc.content -> 'modules') m WHERE m ->> 'render' = 'REMOVED') AS blocks_insufficient,
              CASE WHEN rc.recipe_id IS NULL THEN NULL WHEN qa.recipe_id = rc.recipe_id THEN qa.outcome ELSE NULL END AS qa_outcome, ap.decision AS approval,
              dp.status AS dep_status, dp.target AS dep_target, dp.dep_version,
              greatest(o.updated_at, rc.created_at) AS updated_at,
              pa.archetype_id, pa.topic_cluster_id AS cluster_id, pa.cluster_name, qg.quality_score, qg.eligible_approval AS g_approval, qg.eligible_publication AS g_publication, qg.eligible_indexing AS g_indexing, (qg.failed_rules ? 'INSUFFICIENT_CONTEXTUAL_INLINKS') AS insufficient_inlinks, (jsonb_array_length(coalesce(qg.result -> 'intentConflicts', '[]'::jsonb)) > 0) AS has_conflicts,
              CASE
                WHEN dp.target = 'production' AND dp.status IN ('READY', 'VERIFICATION_PENDING', 'VERIFIED') THEN 'published'
                WHEN dp.target = 'preview' AND dp.status IN ('READY', 'VERIFICATION_PENDING', 'VERIFIED') THEN 'preview'
                WHEN ap.decision = 'APPROVED' THEN 'approved'
                WHEN rc.recipe_id IS NOT NULL AND qa.recipe_id = rc.recipe_id AND qa.outcome = 'QA_PASSED' THEN 'awaiting_approval'
                WHEN o.status IN ('data_assembled', 'evidence_validated', 'experience_built') THEN 'awaiting_qa'
                WHEN rc.recipe_id IS NOT NULL THEN 'generated'
                WHEN bp.opportunity_id IS NOT NULL THEN 'blueprint'
                ELSE 'candidate' END AS stage
       FROM plataforma.growth_opportunity o
       LEFT JOIN plataforma.entity e ON e.id = o.primary_entity_id
       LEFT JOIN bp ON bp.opportunity_id = o.id LEFT JOIN rc ON rc.opportunity_id = o.id LEFT JOIN qa ON qa.opportunity_id = o.id LEFT JOIN ap ON ap.recipe_id = rc.recipe_id LEFT JOIN dp ON dp.opportunity_id = o.id LEFT JOIN pa ON pa.opportunity_id = o.id LEFT JOIN qg ON qg.opportunity_id = o.id
       WHERE o.topic_id IS NOT NULL)`;
interface R { opportunity_id: string; topic_id: string; primary_query: string; family: string | null; intent: string | null; lifecycle: string; stage: PageStage; entity: string | null; title: string | null; h1: string | null; url: string | null; template_id: string | null; blueprint_status: string | null; recipe_version: number | null; blocks_filled: string | null; blocks_insufficient: string | null; editorial: "agent7" | "template" | null; qa_outcome: string | null; approval: string | null; dep_status: string | null; dep_target: string | null; dep_version: number | null; updated_at: Date; total: string; archetype_id: string | null; cluster_id: string | null; cluster_name: string | null; quality_score: string | null; g_approval: boolean | null; g_publication: boolean | null; g_indexing: boolean | null; insufficient_inlinks: boolean | null; has_conflicts: boolean | null }
const toRow = (r: R): PageRow => ({ opportunityId: r.opportunity_id, topicId: r.topic_id, primaryQuery: r.primary_query, family: r.family, intent: r.intent, lifecycle: r.lifecycle, stage: r.stage, entity: r.entity, title: r.title, h1: r.h1, url: r.url, templateId: r.template_id, blueprintStatus: r.blueprint_status, recipeVersion: r.recipe_version, blocksFilled: r.recipe_version === null ? null : Number(r.blocks_filled), blocksInsufficient: r.recipe_version === null ? null : Number(r.blocks_insufficient), editorial: r.editorial, qaOutcome: r.qa_outcome, approval: r.approval, deploymentStatus: r.dep_status, deploymentTarget: r.dep_target, publishedVersion: r.dep_target === "production" && ["READY", "VERIFICATION_PENDING", "VERIFIED"].includes(r.dep_status ?? "") ? r.dep_version : null, updatedAt: r.updated_at,
  archetypeId: r.archetype_id, clusterId: r.cluster_id, clusterName: r.cluster_name, qualityScore: r.quality_score === null ? null : Number(r.quality_score), gate: r.g_approval === null ? null : { approval: r.g_approval, publication: r.g_publication === true, indexing: r.g_indexing === true }, insufficientInlinks: r.insufficient_inlinks === true, hasConflicts: r.has_conflicts === true });

/** Lista paginada NO SERVIDOR (o filtro é do banco; nada é filtrado no cliente). `total` é a contagem do filtro; `byStage` conta todos os tópicos (sem o filtro de estágio) para a navegação. */
export async function listPages(db: TenantDb, f: PageFilters = {}): Promise<{ total: number; byStage: Record<string, number>; rows: PageRow[] }> {
  const like = f.q ? `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const args = [like, f.stage ?? null, f.family ?? null, f.template ?? null, f.qa ?? null, f.deployment ?? null, f.editorial ?? null, f.archetype ?? null, f.cluster && /^[0-9a-f-]{36}$/i.test(f.cluster) ? f.cluster : null, f.eligibility ?? null, f.linkFailure === true ? true : null, f.conflict === true ? true : null];
  const WHERE = `WHERE ($1::text IS NULL OR primary_query ILIKE $1 OR title ILIKE $1 OR url ILIKE $1 OR entity ILIKE $1 OR h1 ILIKE $1) AND ($2::text IS NULL OR stage = $2 OR ($2 = 'awaiting_qa' AND stage = 'awaiting_qa')) AND ($3::text IS NULL OR family = $3) AND ($4::text IS NULL OR template_id = $4) AND ($5::text IS NULL OR qa_outcome = $5) AND ($6::text IS NULL OR dep_status = $6) AND ($7::text IS NULL OR editorial = $7) AND ($8::text IS NULL OR archetype_id = $8) AND ($9::uuid IS NULL OR cluster_id = $9) AND ($10::text IS NULL OR ($10 = 'approval' AND g_approval) OR ($10 = 'publication' AND g_publication) OR ($10 = 'indexing' AND g_indexing) OR ($10 = 'not_indexing' AND g_indexing IS FALSE) OR ($10 = 'no_gate' AND g_approval IS NULL AND stage <> 'candidate')) AND ($11::boolean IS NULL OR insufficient_inlinks) AND ($12::boolean IS NULL OR has_conflicts)`;
  const rows = (await db.query<R>(`${SQL} SELECT *, count(*) OVER () AS total FROM base ${WHERE} ORDER BY updated_at DESC, opportunity_id LIMIT $13 OFFSET $14`, [...args, Math.min(f.limit ?? 25, 100), f.offset ?? 0])).rows;
  const by = (await db.query<{ stage: string; n: string }>(`${SQL} SELECT stage, count(*) AS n FROM base WHERE ($1::text IS NULL OR primary_query ILIKE $1 OR title ILIKE $1 OR url ILIKE $1 OR entity ILIKE $1 OR h1 ILIKE $1) AND ($2::text IS NULL OR family = $2) GROUP BY stage`, [args[0], args[2]])).rows;
  const total = rows[0] ? Number(rows[0].total) : f.offset ? Number((await db.query<{ n: string }>(`${SQL} SELECT count(*) AS n FROM base ${WHERE}`, args)).rows[0]!.n) : 0;
  return { total, byStage: Object.fromEntries(by.map((r) => [r.stage, Number(r.n)])), rows: rows.map(toRow) };
}
export async function getPageRow(db: TenantDb, opportunityId: string): Promise<PageRow | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(opportunityId)) return null;
  const r = (await db.query<R>(`${SQL} SELECT *, 1 AS total FROM base WHERE opportunity_id = $1`, [opportunityId])).rows[0];
  return r ? toRow(r) : null;
}
export async function pageFacets(db: TenantDb): Promise<{ families: string[]; templates: string[] }> {
  const fam = (await db.query<{ v: string }>(`SELECT DISTINCT candidate_page_family AS v FROM plataforma.growth_opportunity WHERE topic_id IS NOT NULL AND candidate_page_family IS NOT NULL ORDER BY 1`)).rows.map((r) => r.v);
  const tpl = (await db.query<{ v: string }>(`SELECT DISTINCT template_id AS v FROM plataforma.spec_blueprint ORDER BY 1`)).rows.map((r) => r.v);
  return { families: fam, templates: tpl };
}

export interface ApprovalRecord { readonly id: string; readonly recipeId: string; readonly decision: "APPROVED" | "REJECTED" | "REVOKED"; readonly reason: string; readonly actor: string; readonly createdAt: Date }
export async function listApprovals(db: TenantDb, opportunityId: string): Promise<ApprovalRecord[]> {
  return (await db.query<{ id: string; recipe_id: string; decision: ApprovalRecord["decision"]; reason: string; actor: string; created_at: Date }>(`SELECT id, recipe_id, decision, reason, actor, created_at FROM plataforma.page_approval WHERE opportunity_id = $1 ORDER BY seq DESC`, [opportunityId])).rows.map((r) => ({ id: r.id, recipeId: r.recipe_id, decision: r.decision, reason: r.reason, actor: r.actor, createdAt: r.created_at }));
}
export interface DecideResult { readonly opportunityId: string; readonly ok: boolean; readonly message: string }
/** Decisão humana sobre a versão MAIS RECENTE do recipe. Aprovar exige QA_PASSED dessa mesma versão; nunca publica. Cada item é validado e registrado isoladamente (falha de um não afeta os outros). */
export async function decidePages(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, input: { opportunityIds: readonly string[]; decision: "APPROVED" | "REJECTED" | "REVOKED"; reason: string }, deps: { readonly architecture?: ArchitectureDeps } = {}): Promise<DecideResult[]> {
  const reason = input.reason.trim(); if (reason.length < 3 || reason.length > 1000) throw new Error("o motivo precisa ter de 3 a 1000 caracteres");
  const ids = [...new Set(input.opportunityIds)]; if (ids.length === 0 || ids.length > 200) throw new Error("selecione de 1 a 200 páginas");
  const out: DecideResult[] = [];
  for (const id of ids) {
    try {
      // Quality Gate de arquitetura (quando configurado): aprovar exige elegibilidade de APROVAÇÃO (contrato, intenção, template, canonical, schema e QA); não exige indexação
      if (input.decision === "APPROVED" && deps.architecture) {
        const r = await analyzeArchitecture(pool, identity, tenantId, deps.architecture, { opportunityIds: [id] }); const a = r.analyses[0];
        if (a && !a.gate.eligibility.approval) { out.push({ opportunityId: id, ok: false, message: `o Quality Gate de arquitetura não libera a aprovação: ${a.gate.blockedBy.approval.join(", ")}` }); continue; }
      }
      out.push(await withTenant(pool, identity, tenantId, async (db) => {
        const r = (await db.query<{ recipe_id: string; outcome: string | null; qa_recipe: string | null; last: string | null }>(`SELECT rc.id AS recipe_id, q.outcome, q.recipe_id AS qa_recipe, (SELECT decision FROM plataforma.page_approval a WHERE a.recipe_id = rc.id ORDER BY seq DESC LIMIT 1) AS last
          FROM (SELECT id FROM plataforma.page_recipe WHERE opportunity_id = $1 ORDER BY version DESC LIMIT 1) rc LEFT JOIN LATERAL (SELECT outcome, recipe_id FROM plataforma.qa_report WHERE opportunity_id = $1 ORDER BY seq DESC LIMIT 1) q ON true`, [id])).rows[0];
        if (!r) return { opportunityId: id, ok: false, message: "a página não tem recipe" };
        if (input.decision === "APPROVED" && !(r.qa_recipe === r.recipe_id && r.outcome === "QA_PASSED")) return { opportunityId: id, ok: false, message: `o QA da versão mais recente não está aprovado (${r.qa_recipe === r.recipe_id ? r.outcome : "sem relatório desta versão"})` };
        if (input.decision === "REVOKED" && r.last !== "APPROVED") return { opportunityId: id, ok: false, message: "não há aprovação vigente para revogar" };
        if (r.last === input.decision) return { opportunityId: id, ok: true, message: "já estava assim (nada a fazer)" };
        await db.query(`INSERT INTO plataforma.page_approval (tenant_id, opportunity_id, recipe_id, decision, reason, actor) VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4, $5)`, [id, r.recipe_id, input.decision, reason, identity.userId]);
        await recordDecision(db, { subjectKind: "page", subjectRef: id, decision: `APPROVAL_${input.decision}`, decidedBy: "human", applied: true, reason, actor: identity.userId });
        return { opportunityId: id, ok: true, message: input.decision === "APPROVED" ? "aprovada para revisão (não publicada)" : input.decision === "REJECTED" ? "rejeitada" : "aprovação revogada" };
      }));
    } catch (e) { out.push({ opportunityId: id, ok: false, message: e instanceof Error ? e.message.slice(0, 200) : "falha" }); }
  }
  return out;
}
