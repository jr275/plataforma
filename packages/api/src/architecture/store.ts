import { createHash } from "node:crypto";
import { ensurePolicy, savePolicyVersion } from "../catalog/store";
import type { VerifiedIdentity } from "../identity";
import type { SpecBlueprint } from "../blueprint-spec/types";
import type { PageRecipe } from "../recipe/types";
import { recordDecision } from "../runtime/decision-audit";
import { withTenant, type PoolLike, type TenantDb } from "../tenant-context";
import { archetypeOf } from "./catalog";
import { runGate, type GateInput, type GateResult } from "./gate";
import { diagnoseIntents, type IntentConflict, type IntentPage } from "./intents";
import { buildJsonLd, validateJsonLd, type JsonLdValidation, type Node } from "./jsonld";
import { DEFAULT_LINK_POLICY, compileLinkGraph, evaluateInlinks, outlinksOf, validateLinkPolicy, type CompiledGraph, type Edge, type LinkNode, type LinkPolicy, type RawLink } from "./links";
import type { ArchetypeContract, ArchetypeId, LinkRelation, Provenance, ValidationResult } from "./types";
import { validateArchetypeData, type ProfileOverride } from "./validate";

// Serviço de arquitetura: lê as páginas REAIS do Page Factory (recipe, blueprint, QA, aprovação), pede ao Domain Pack a adaptação para o contrato do archetype e executa validação, intenção, grafo de links,
// JSON-LD e o Quality Gate. Persiste (idempotente por hash de entrada) e NÃO cria uma segunda fonte de verdade: recipe/QA/aprovação continuam onde estão. O núcleo é genérico; o domínio entra por `ArchitecturePack`.
export interface AdaptedPage { readonly data: Record<string, unknown>; readonly provenance: readonly Provenance[]; readonly primaryIntent: string; readonly intentEvidence: readonly string[]; /** Páginas-pai candidatas (breadcrumb/hierarquia), da mais ampla à mais próxima. */ readonly hierarchy: readonly { readonly name: string; readonly url: string }[] }
export interface ArchitecturePack {
  readonly domain: string; readonly locale: string; readonly market: string;
  archetypeOfFamily(family: string): ArchetypeId | null;
  adapt(i: { readonly recipe: PageRecipe; readonly blueprint: SpecBlueprint }): AdaptedPage | { readonly error: string };
  clusterOf(i: { readonly recipe: PageRecipe; readonly archetype: ArchetypeContract; readonly adapted: AdaptedPage }): { readonly key: string; readonly name: string; readonly scope: Readonly<Record<string, string>> };
  relationOf?(i: { readonly from: PageRecipe; readonly path: string; readonly text: string; readonly adapted: AdaptedPage; readonly toExists: boolean }): LinkRelation;
}
export interface ArchitectureDeps { readonly pack: ArchitecturePack; readonly templates: readonly { readonly key: string }[]; readonly now?: () => Date }
export class ArchitectureError extends Error { constructor(message: string) { super(message); this.name = "ArchitectureError"; } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export interface PageRow { opportunity_id: string; family: string | null; dimensions: Record<string, string>; primary_entity_id: string | null; recipe_id: string; recipe_version: number; recipe: PageRecipe; blueprint: SpecBlueprint | null; bp_status: string | null; bp_template: string | null; bp_gap: boolean | null; qa_outcome: "QA_PASSED" | "QA_FAILED" | "QA_INCOMPLETE" | null; qa_blocking: string[] | null; qa_results: Record<string, { status: string }> | null; approval: "APPROVED" | "REJECTED" | "REVOKED" | null }
async function loadPages(db: TenantDb, only?: readonly string[]): Promise<PageRow[]> {
  return (await db.query<PageRow>(`
    WITH rc AS (SELECT DISTINCT ON (opportunity_id) opportunity_id, id, version, content FROM plataforma.page_recipe ORDER BY opportunity_id, version DESC),
         bp AS (SELECT DISTINCT ON (opportunity_id) opportunity_id, status, template_id, template_gap, content FROM plataforma.spec_blueprint ORDER BY opportunity_id, version DESC),
         qa AS (SELECT DISTINCT ON (opportunity_id) opportunity_id, recipe_id, outcome, blocking_failures, results FROM plataforma.qa_report ORDER BY opportunity_id, seq DESC),
         ap AS (SELECT DISTINCT ON (recipe_id) recipe_id, decision FROM plataforma.page_approval ORDER BY recipe_id, seq DESC)
    SELECT o.id AS opportunity_id, o.candidate_page_family AS family, o.dimensions, o.primary_entity_id, rc.id AS recipe_id, rc.version AS recipe_version, rc.content AS recipe, bp.content AS blueprint, bp.status AS bp_status, bp.template_id AS bp_template, bp.template_gap AS bp_gap,
           CASE WHEN qa.recipe_id = rc.id THEN qa.outcome END AS qa_outcome, CASE WHEN qa.recipe_id = rc.id THEN qa.blocking_failures END AS qa_blocking, CASE WHEN qa.recipe_id = rc.id THEN qa.results END AS qa_results, ap.decision AS approval
    FROM plataforma.growth_opportunity o JOIN rc ON rc.opportunity_id = o.id LEFT JOIN bp ON bp.opportunity_id = o.id LEFT JOIN qa ON qa.opportunity_id = o.id LEFT JOIN ap ON ap.recipe_id = rc.id
    WHERE o.topic_id IS NOT NULL AND ($1::uuid[] IS NULL OR o.id = ANY($1::uuid[])) ORDER BY o.id`, [only ? [...only] : null])).rows;
}

export interface PageModel { readonly row: PageRow; readonly archetype: ArchetypeContract; readonly adapted: AdaptedPage; readonly cluster: { readonly key: string; readonly name: string; readonly scope: Readonly<Record<string, string>> } }
export interface Model { readonly pages: ReadonlyMap<string, PageModel>; readonly skipped: readonly { readonly opportunityId: string; readonly reason: string }[]; readonly nodes: readonly LinkNode[]; readonly rawLinks: readonly RawLink[]; readonly graph: CompiledGraph; readonly conflicts: readonly IntentConflict[]; readonly policy: LinkPolicy; readonly policyVersion: number; readonly profiles: Readonly<Partial<Record<ArchetypeId, ProfileOverride>>>; readonly profilesVersion: number }
const DEFAULT_PROFILES: Readonly<Partial<Record<ArchetypeId, ProfileOverride>>> = {};

export async function getLinkPolicy(db: TenantDb, actor = "system"): Promise<{ policy: LinkPolicy; version: number }> {
  const p = await ensurePolicy<LinkPolicy>(db, "link_policy", DEFAULT_LINK_POLICY, actor); return { policy: { ...p.content, version: String(p.version) }, version: p.version };
}
/** Nova versão da política de links (auditada: autor, motivo e versão ficam em `policy` e em `decision_audit`). Exceções precisam de escopo, justificativa e responsável. */
export async function setLinkPolicy(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, policy: LinkPolicy, note: string): Promise<{ version: number; created: boolean }> {
  const errors = validateLinkPolicy(policy); if (errors.length > 0) throw new ArchitectureError(`política de links inválida: ${errors.join("; ")}`);
  if (note.trim().length < 5) throw new ArchitectureError("informe o motivo da alteração (mín. 5 caracteres)");
  return withTenant(pool, identity, tenantId, async (db) => {
    const cur = await getLinkPolicy(db, identity.userId); const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, stable(x)])) : v); const norm = (p: LinkPolicy) => JSON.stringify(stable({ ...p, version: "", supersedes: undefined }));
    if (norm(cur.policy) === norm(policy)) return { version: cur.version, created: false };
    // `supersedes` torna cada versão única: voltar a um conteúdo antigo cria uma versão NOVA (e ativa), em vez de reaproveitar a antiga
    const r = await savePolicyVersion(db, "link_policy", { ...policy, version: "", supersedes: cur.version } as object, note.trim(), identity.userId);
    await recordDecision(db, { subjectKind: "link_policy", subjectRef: `v${r.version}`, decision: "LINK_POLICY_CHANGED", decidedBy: "human", applied: true, reason: note.trim(), actor: identity.userId });
    return r;
  });
}
/** Remove os metadados de versionamento (`_supersedes`) do conteúdo guardado do perfil. */
function withoutMeta(c: Partial<Record<ArchetypeId, ProfileOverride>>): Partial<Record<ArchetypeId, ProfileOverride>> { const { _supersedes: _s, ...rest } = c as Record<string, unknown>; return rest as Partial<Record<ArchetypeId, ProfileOverride>>; }
export async function setArchetypeProfiles(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, profiles: Partial<Record<ArchetypeId, ProfileOverride>>, note: string): Promise<{ version: number; created: boolean }> {
  for (const [id, o] of Object.entries(profiles)) { const c = archetypeOf(id); if (!c) throw new ArchitectureError(`archetype desconhecido: ${id}`); const sum = c.density.signals.reduce((a, s) => a + (o!.weights?.[s.id] ?? s.weight), 0); if (Math.abs(sum - 1) > 1e-9) throw new ArchitectureError(`${id}: pesos somam ${sum}, não 1`); const t = o!.indexingThreshold ?? c.density.indexingThreshold; if (!(t > 0 && t <= 1)) throw new ArchitectureError(`${id}: limiar inválido`); for (const k of Object.keys(o!.weights ?? {})) if (!c.density.signals.some((s) => s.id === k)) throw new ArchitectureError(`${id}: sinal desconhecido ${k}`); }
  if (note.trim().length < 5) throw new ArchitectureError("informe o motivo da alteração (mín. 5 caracteres)");
  return withTenant(pool, identity, tenantId, async (db) => {
    const cur = await ensurePolicy<Partial<Record<ArchetypeId, ProfileOverride>>>(db, "archetype_profiles", DEFAULT_PROFILES as Partial<Record<ArchetypeId, ProfileOverride>>, identity.userId);
    const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, stable(x)])) : v);
    if (JSON.stringify(stable(withoutMeta(cur.content))) === JSON.stringify(stable(profiles))) return { version: cur.version, created: false };
    // `_supersedes` torna cada versão única: voltar a um perfil antigo cria uma versão NOVA (e vigente), em vez de reaproveitar a antiga
    const r = await savePolicyVersion(db, "archetype_profiles", { ...profiles, _supersedes: cur.version } as object, note.trim(), identity.userId); if (r.created) await recordDecision(db, { subjectKind: "archetype_profiles", subjectRef: `v${r.version}`, decision: "ARCHETYPE_PROFILES_CHANGED", decidedBy: "human", applied: true, reason: note.trim(), actor: identity.userId }); return r; });
}

/** Monta o modelo da arquitetura a partir das páginas reais (puro depois da leitura). */
export function buildModel(rows: readonly PageRow[], deps: ArchitectureDeps, policy: LinkPolicy, policyVersion: number, profiles: Model["profiles"], profilesVersion: number): Model {
  const pages = new Map<string, PageModel>(); const skipped: { opportunityId: string; reason: string }[] = [];
  for (const row of rows) {
    const aid = row.family ? deps.pack.archetypeOfFamily(row.family) : null; const archetype = aid ? archetypeOf(aid) : undefined;
    if (!archetype) { skipped.push({ opportunityId: row.opportunity_id, reason: `a família ${row.family ?? "—"} não mapeia para um archetype neste pack` }); continue; }
    if (!row.blueprint) { skipped.push({ opportunityId: row.opportunity_id, reason: "sem blueprint da especificação" }); continue; }
    const adapted = deps.pack.adapt({ recipe: row.recipe, blueprint: row.blueprint });
    if ("error" in adapted) { skipped.push({ opportunityId: row.opportunity_id, reason: `adaptação ao archetype falhou: ${adapted.error}` }); continue; }
    pages.set(row.opportunity_id, { row, archetype, adapted, cluster: deps.pack.clusterOf({ recipe: row.recipe, archetype, adapted }) });
  }
  const urlOf = new Map([...pages.values()].filter((p) => p.row.recipe.url).map((p) => [p.row.recipe.url!, p.row.opportunity_id] as const));
  const nodes: LinkNode[] = [...pages.values()].map((p) => { const parent = [...p.adapted.hierarchy].reverse().map((h) => urlOf.get(h.url)).find((x) => x !== undefined) ?? null; return { id: p.row.opportunity_id, url: p.row.recipe.url, canonical: p.row.recipe.canonical, archetypeId: p.archetype.id, clusterId: p.cluster.key, parentId: parent, sourceEligible: p.row.approval !== "REJECTED" }; });
  const rawLinks: RawLink[] = [];
  for (const p of pages.values()) for (const l of p.row.recipe.links) {
    const toExists = urlOf.has(l.path); const relation = deps.pack.relationOf?.({ from: p.row.recipe, path: l.path, text: l.text, adapted: p.adapted, toExists }) ?? (p.adapted.hierarchy.some((h) => h.url === l.path) ? "parent" : "sibling");
    rawLinks.push({ fromId: p.row.opportunity_id, toPath: l.path, relation, moduleId: "links", reason: l.text, evidence: [`recipe v${p.row.recipe_version}`] });
  }
  const graph = compileLinkGraph(nodes, rawLinks, policy);
  const intentPages: IntentPage[] = [...pages.values()].map((p) => ({ id: p.row.opportunity_id, tenantId: p.row.recipe.tenantId, locale: deps.pack.locale, market: deps.pack.market, clusterId: p.cluster.key, archetypeId: p.archetype.id, primaryEntityId: p.row.primary_entity_id, primaryIntent: p.adapted.primaryIntent, dimensions: p.row.dimensions, url: p.row.recipe.url, canonical: p.row.recipe.canonical, title: p.row.recipe.title, h1: p.row.recipe.h1, recipeFingerprint: sha(JSON.stringify(p.row.recipe.blocks.map((b) => b.text))) }));
  return { pages, skipped, nodes, rawLinks, graph, conflicts: diagnoseIntents(intentPages), policy, policyVersion, profiles, profilesVersion };
}

export interface PageAnalysis { readonly opportunityId: string; readonly archetypeId: ArchetypeId; readonly contractVersion: string; readonly clusterKey: string; readonly validation: ValidationResult; readonly gate: GateResult; readonly gateInputHash: string; readonly generatedJsonLd: readonly Node[]; readonly jsonLdValidation: JsonLdValidation | null; readonly inlinks: ReturnType<typeof evaluateInlinks>; readonly outlinks: { readonly valid: readonly Edge[]; readonly invalid: readonly Edge[] } }
const text = (r: PageRecipe) => [r.title, r.h1, r.metaDescription, ...r.blocks.map((b) => b.text)].join("\n");
export function analyzePageInModel(m: Model, opportunityId: string, deps: ArchitectureDeps, now: Date): PageAnalysis {
  const p = m.pages.get(opportunityId); if (!p) throw new ArchitectureError(`página fora do modelo: ${opportunityId}`);
  const { row, archetype } = p; const r = row.recipe; const bp = row.blueprint!;
  const validation = validateArchetypeData(archetype, { data: p.adapted.data, provenance: p.adapted.provenance, now }, m.profiles[archetype.id]);
  const urls = new Set(m.nodes.map((n) => n.url)); const hasHierarchy = p.adapted.hierarchy.length > 0 && p.adapted.hierarchy.every((h) => urls.has(h.url));
  const parsed = archetype.schema.safeParse(p.adapted.data); const canonicalUrl = r.canonical ?? r.url ?? "";
  const generated = parsed.success ? buildJsonLd(archetype, parsed.data, { canonicalUrl, ...(hasHierarchy ? { breadcrumb: [...p.adapted.hierarchy, { name: r.h1, url: canonicalUrl }] } : {}) }) : [];
  const jsonLdValidation = validateJsonLd(archetype, r.jsonLd as Node[], { ...(parsed.success ? { data: parsed.data } : {}), visibleText: text(r), hasHierarchy });
  const inlinks = evaluateInlinks(opportunityId, m.nodes, m.graph, m.policy, now); const outlinks = outlinksOf(opportunityId, m.graph);
  const bpModules = new Set(bp.data_contract.map((c) => c.module_id));
  const input: GateInput = { archetype, validation, conflicts: m.conflicts.filter((c) => c.pages.some((x) => x.id === opportunityId)), entity: { primaryEntityId: row.primary_entity_id, relationsCount: null },
    template: { blueprintStatus: row.bp_status, templateAvailable: deps.templates.some((t) => t.key === row.bp_template), templateGap: row.bp_gap === true, omittedModules: r.modules.filter((x) => x.render !== "RENDERED").map((x) => ({ moduleId: x.moduleId, reason: x.render === "REMOVED" ? "removido por falta de dados" : "mostra insuficiência por falta de dados" })), unknownModules: r.modules.map((x) => x.moduleId).filter((x) => !bpModules.has(x)) },
    links: { inlinks, outlinksValid: outlinks.valid.length, outlinksInvalid: outlinks.invalid.length, graphHash: m.graph.hash }, canonical: { url: r.url, canonical: r.canonical, rule: archetype.canonical.rule, indexabilityPolicy: bp.indexability_policy ?? null }, schema: jsonLdValidation,
    content: { qaOutcome: row.qa_outcome, blocking: row.qa_blocking ?? [], notRun: Object.entries(row.qa_results ?? {}).filter(([, c]) => c.status === "NOT_RUN").map(([k]) => k) }, approval: row.approval };
  const gate = runGate(input);
  const { archetype: _a, ...hashable } = input;
  return { opportunityId, archetypeId: archetype.id, contractVersion: archetype.version, clusterKey: p.cluster.key, validation, gate, gateInputHash: sha(JSON.stringify([hashable, m.policyVersion, m.profilesVersion, row.recipe_id])), generatedJsonLd: generated, jsonLdValidation, inlinks, outlinks };
}

export interface AnalyzeResult { readonly graphId: string; readonly graphCreated: boolean; readonly graph: CompiledGraph["stats"]; readonly analyses: readonly PageAnalysis[]; readonly created: number; readonly unchanged: number; readonly skipped: readonly { readonly opportunityId: string; readonly reason: string }[]; readonly conflicts: number }
/** Executa a arquitetura para as páginas pedidas (ou todas): compila o grafo, diagnostica intenção e roda o gate. Tudo idempotente: mesma entrada, mesmo hash, nenhuma linha nova. */
export async function analyzeArchitecture(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, deps: ArchitectureDeps, input: { opportunityIds?: readonly string[] } = {}): Promise<AnalyzeResult> {
  if (input.opportunityIds?.some((x) => !UUID.test(x))) throw new ArchitectureError("oportunidade inválida");
  const now = (deps.now ?? (() => new Date()))();
  return withTenant(pool, identity, tenantId, async (db) => {
    const { policy, version } = await getLinkPolicy(db, identity.userId);
    const prof = await ensurePolicy<Partial<Record<ArchetypeId, ProfileOverride>>>(db, "archetype_profiles", DEFAULT_PROFILES as Partial<Record<ArchetypeId, ProfileOverride>>, identity.userId);
    const rows = await loadPages(db); const m = buildModel(rows, deps, policy, version, withoutMeta(prof.content), prof.version);
    const g = await persistGraph(db, m, deps.pack.domain, identity.userId);
    const targets = input.opportunityIds ? input.opportunityIds.filter((id) => m.pages.has(id)) : [...m.pages.keys()];
    const analyses: PageAnalysis[] = []; let created = 0; let unchanged = 0;
    for (const id of targets) {
      const a = analyzePageInModel(m, id, deps, now); analyses.push(a); const p = m.pages.get(id)!;
      const cid = await ensureCluster(db, p, deps.pack, identity.userId);
      await db.query(`INSERT INTO plataforma.page_architecture (tenant_id, opportunity_id, recipe_id, archetype_id, contract_version, topic_cluster_id, primary_intent, intent_evidence, primary_entity_id, domain, locale, market, canonical_url, canonical_rule, template_contract_version, created_by)
        VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15) ON CONFLICT (tenant_id, recipe_id) DO NOTHING`, [id, p.row.recipe_id, p.archetype.id, p.archetype.version, cid, p.adapted.primaryIntent, JSON.stringify(p.adapted.intentEvidence), p.row.primary_entity_id, deps.pack.domain, deps.pack.locale, deps.pack.market, p.row.recipe.canonical, p.archetype.canonical.rule, p.row.bp_template, identity.userId]);
      // idempotente só contra o resultado MAIS RECENTE da receita: voltar a um estado anterior (mesmo hash de antes) grava um novo registro, para que o "atual" nunca fique preso a um resultado velho
      const ins = await db.query(`INSERT INTO plataforma.quality_gate_result (tenant_id, opportunity_id, recipe_id, archetype_id, contract_version, graph_id, input_hash, result, quality_score, eligible_approval, eligible_publication, eligible_indexing, failed_rules, created_by)
        SELECT plataforma.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12::jsonb, $13
        WHERE NOT EXISTS (SELECT 1 FROM (SELECT input_hash FROM plataforma.quality_gate_result WHERE recipe_id = $2 ORDER BY seq DESC LIMIT 1) l WHERE l.input_hash = $6) RETURNING id`, [id, p.row.recipe_id, a.archetypeId, a.contractVersion, g.id, a.gateInputHash, JSON.stringify(a.gate), a.gate.qualityScore, a.gate.eligibility.approval, a.gate.eligibility.publication, a.gate.eligibility.indexing, JSON.stringify(a.gate.failedRules), identity.userId]);
      if (ins.rows.length > 0) created += 1; else unchanged += 1;
    }
    return { graphId: g.id, graphCreated: g.created, graph: m.graph.stats, analyses, created, unchanged, skipped: m.skipped, conflicts: m.conflicts.length };
  });
}
async function persistGraph(db: TenantDb, m: Model, domain: string, actor: string): Promise<{ id: string; created: boolean }> {
  const ex = (await db.query<{ id: string }>(`SELECT id FROM plataforma.link_graph WHERE content_hash = $1`, [m.graph.hash])).rows[0]; if (ex) return { id: ex.id, created: false };
  const id = (await db.query<{ id: string }>(`INSERT INTO plataforma.link_graph (tenant_id, domain, content_hash, policy_version, stats, created_by) VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4::jsonb, $5) RETURNING id`, [domain, m.graph.hash, m.policy.version || String(m.policyVersion), JSON.stringify(m.graph.stats), actor])).rows[0]!.id;
  const E = m.graph.edges; const B = 500;
  for (let i = 0; i < E.length; i += B) { const part = E.slice(i, i + B);
    await db.query(`INSERT INTO plataforma.link_edge (tenant_id, graph_id, from_opportunity_id, to_opportunity_id, to_path, relation, module_id, reason, state, invalid_reason, evidence) SELECT plataforma.current_tenant_id(), $1, x.f, x.t, x.p, x.r, x.m, x.why, x.s, x.ir, x.ev FROM jsonb_to_recordset($2::jsonb) AS x(f uuid, t uuid, p text, r text, m text, why text, s text, ir text, ev jsonb)`,
      [id, JSON.stringify(part.map((e) => ({ f: e.fromId, t: e.toId, p: e.toPath, r: e.relation, m: e.moduleId, why: e.reason.slice(0, 500), s: e.state, ir: e.invalidReason, ev: e.evidence ?? [] })))]); }
  return { id, created: true };
}
async function ensureCluster(db: TenantDb, p: PageModel, pack: ArchitecturePack, actor: string): Promise<string> {
  await db.query(`INSERT INTO plataforma.topic_cluster (tenant_id, cluster_key, name, archetype_id, primary_intent, domain, locale, market, scope) VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb) ON CONFLICT (tenant_id, cluster_key) DO NOTHING`, [p.cluster.key, p.cluster.name, p.archetype.id, `${p.archetype.primaryIntent.primary} / ${p.archetype.primaryIntent.secondary}`, pack.domain, pack.locale, pack.market, JSON.stringify(p.cluster.scope)]); void actor;
  return (await db.query<{ id: string }>(`SELECT id FROM plataforma.topic_cluster WHERE cluster_key = $1`, [p.cluster.key])).rows[0]!.id;
}

// --- leituras (persistido) ------------------------------------------------------------------------------------------------------------------------------------------------------------
export interface StoredArchitecture { readonly architecture: { readonly archetypeId: ArchetypeId; readonly contractVersion: string; readonly clusterId: string | null; readonly clusterName: string | null; readonly primaryIntent: string; readonly intentEvidence: readonly string[]; readonly domain: string; readonly locale: string; readonly market: string; readonly canonicalUrl: string | null; readonly canonicalRule: string; readonly recipeId: string; readonly createdAt: Date };
  readonly gate: (GateResult & { readonly resultId: string; readonly graphId: string | null; readonly createdAt: Date; readonly recipeId: string }) | null; readonly inlinks: readonly StoredEdge[]; readonly outlinks: readonly StoredEdge[] }
export interface StoredEdge { readonly fromId: string; readonly toId: string | null; readonly toPath: string; readonly relation: string; readonly moduleId: string | null; readonly reason: string; readonly state: "VALID" | "INVALID"; readonly invalidReason: string | null; readonly otherUrl: string | null }
export async function getStoredArchitecture(db: TenantDb, opportunityId: string): Promise<StoredArchitecture | null> {
  if (!UUID.test(opportunityId)) return null;
  const a = (await db.query<{ archetype_id: ArchetypeId; contract_version: string; topic_cluster_id: string | null; cluster_name: string | null; primary_intent: string; intent_evidence: string[]; domain: string; locale: string; market: string; canonical_url: string | null; canonical_rule: string; recipe_id: string; created_at: Date }>(`SELECT a.archetype_id, a.contract_version, a.topic_cluster_id, c.name AS cluster_name, a.primary_intent, a.intent_evidence, a.domain, a.locale, a.market, a.canonical_url, a.canonical_rule, a.recipe_id, a.created_at FROM plataforma.page_architecture a LEFT JOIN plataforma.topic_cluster c ON c.id = a.topic_cluster_id AND c.tenant_id = a.tenant_id WHERE a.opportunity_id = $1 ORDER BY a.seq DESC LIMIT 1`, [opportunityId])).rows[0]; if (!a) return null;
  const g = (await db.query<{ id: string; graph_id: string | null; result: GateResult; created_at: Date; recipe_id: string }>(`SELECT id, graph_id, result, created_at, recipe_id FROM plataforma.quality_gate_result WHERE opportunity_id = $1 ORDER BY seq DESC LIMIT 1`, [opportunityId])).rows[0];
  const edges = g?.graph_id ? (await db.query<{ from_opportunity_id: string; to_opportunity_id: string | null; to_path: string; relation: string; module_id: string | null; reason: string; state: "VALID" | "INVALID"; invalid_reason: string | null; other_url: string | null }>(`SELECT e.from_opportunity_id, e.to_opportunity_id, e.to_path, e.relation, e.module_id, e.reason, e.state, e.invalid_reason, (SELECT r.content ->> 'url' FROM plataforma.page_recipe r WHERE r.opportunity_id = CASE WHEN e.from_opportunity_id = $1 THEN e.to_opportunity_id ELSE e.from_opportunity_id END ORDER BY r.version DESC LIMIT 1) AS other_url FROM plataforma.link_edge e WHERE e.graph_id = $2 AND (e.from_opportunity_id = $1 OR e.to_opportunity_id = $1) ORDER BY e.state DESC, e.to_path LIMIT 200`, [opportunityId, g.graph_id])).rows : [];
  const se = (r: (typeof edges)[number]): StoredEdge => ({ fromId: r.from_opportunity_id, toId: r.to_opportunity_id, toPath: r.to_path, relation: r.relation, moduleId: r.module_id, reason: r.reason, state: r.state, invalidReason: r.invalid_reason, otherUrl: r.other_url });
  return { architecture: { archetypeId: a.archetype_id, contractVersion: a.contract_version, clusterId: a.topic_cluster_id, clusterName: a.cluster_name, primaryIntent: a.primary_intent, intentEvidence: a.intent_evidence, domain: a.domain, locale: a.locale, market: a.market, canonicalUrl: a.canonical_url, canonicalRule: a.canonical_rule, recipeId: a.recipe_id, createdAt: a.created_at }, gate: g ? { ...g.result, resultId: g.id, graphId: g.graph_id, createdAt: g.created_at, recipeId: g.recipe_id } : null, inlinks: edges.filter((e) => e.to_opportunity_id === opportunityId).map(se), outlinks: edges.filter((e) => e.from_opportunity_id === opportunityId).map(se) };
}
export interface ClusterRow { readonly id: string; readonly key: string; readonly name: string; readonly archetypeId: string; readonly primaryIntent: string; readonly domain: string; readonly locale: string; readonly market: string; readonly pages: number; readonly eligibleApproval: number; readonly eligibleIndexing: number; readonly insufficientInlinks: number; readonly withConflicts: number; readonly avgQuality: number | null }
/** Clusters com cobertura REAL (gate mais recente por página): quantas páginas, quantas elegíveis, com inlinks insuficientes e com conflito. */
export async function listClusters(db: TenantDb): Promise<ClusterRow[]> {
  return (await db.query<{ id: string; cluster_key: string; name: string; archetype_id: string; primary_intent: string; domain: string; locale: string; market: string; pages: string; ea: string; ei: string; il: string; cf: string; aq: string | null }>(`
    WITH pa AS (SELECT DISTINCT ON (opportunity_id) opportunity_id, topic_cluster_id FROM plataforma.page_architecture ORDER BY opportunity_id, seq DESC),
         g AS (SELECT DISTINCT ON (opportunity_id) opportunity_id, eligible_approval, eligible_indexing, quality_score, failed_rules, result FROM plataforma.quality_gate_result ORDER BY opportunity_id, seq DESC)
    SELECT c.id, c.cluster_key, c.name, c.archetype_id, c.primary_intent, c.domain, c.locale, c.market, count(pa.opportunity_id) AS pages, count(*) FILTER (WHERE g.eligible_approval) AS ea, count(*) FILTER (WHERE g.eligible_indexing) AS ei,
           count(*) FILTER (WHERE g.failed_rules ? 'INSUFFICIENT_CONTEXTUAL_INLINKS') AS il, count(*) FILTER (WHERE jsonb_array_length(coalesce(g.result -> 'intentConflicts', '[]'::jsonb)) > 0) AS cf, avg(g.quality_score) AS aq
    FROM plataforma.topic_cluster c LEFT JOIN pa ON pa.topic_cluster_id = c.id LEFT JOIN g ON g.opportunity_id = pa.opportunity_id GROUP BY c.id ORDER BY c.name`)).rows.map((r) => ({ id: r.id, key: r.cluster_key, name: r.name, archetypeId: r.archetype_id, primaryIntent: r.primary_intent, domain: r.domain, locale: r.locale, market: r.market, pages: Number(r.pages), eligibleApproval: Number(r.ea), eligibleIndexing: Number(r.ei), insufficientInlinks: Number(r.il), withConflicts: Number(r.cf), avgQuality: r.aq === null ? null : Number(r.aq) }));
}
export async function recordIndexationObservation(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, o: { opportunityId: string; url: string; state: string; source: "search_console" | "manual_inspection"; observedAt: Date; evidence?: Record<string, unknown> }): Promise<string> {
  if (!UUID.test(o.opportunityId)) throw new ArchitectureError("oportunidade inválida"); if (!/^https?:\/\//.test(o.url)) throw new ArchitectureError("URL inválida");
  return withTenant(pool, identity, tenantId, async (db) => (await db.query<{ id: string }>(`INSERT INTO plataforma.indexation_observation (tenant_id, opportunity_id, url, state, source, observed_at, evidence, created_by) VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id`, [o.opportunityId, o.url, o.state, o.source, o.observedAt, JSON.stringify(o.evidence ?? {}), identity.userId])).rows[0]!.id);
}
export async function latestIndexationObservation(db: TenantDb, opportunityId: string): Promise<{ state: string; source: string; observedAt: Date; url: string } | null> {
  const r = (await db.query<{ state: string; source: string; observed_at: Date; url: string }>(`SELECT state, source, observed_at, url FROM plataforma.indexation_observation WHERE opportunity_id = $1 ORDER BY observed_at DESC, seq DESC LIMIT 1`, [opportunityId])).rows[0];
  return r ? { state: r.state, source: r.source, observedAt: r.observed_at, url: r.url } : null;
}
