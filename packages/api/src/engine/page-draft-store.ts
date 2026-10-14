import { createHash } from "node:crypto";
import type { VerifiedIdentity } from "../identity";
import { withTenant, type PoolLike, type TenantDb } from "../tenant-context";
import { blueprintSig, defaultDraft, draftToBlueprint } from "../draft/convert";
import type { DraftContext } from "../draft/context";
import { diffDrafts, parseDraft, contentSig, type Change, type PageDraft } from "../draft/model";
import { stable } from "../draft/sig";
import { validateDraft, type Validation } from "../draft/validate";
import type { Blueprint, TemplateInfo } from "./blueprint";
import { BLUEPRINT_STATES, loadBlueprintInputs, type BlueprintRecord } from "./blueprint-store";
import { evaluateExperienceGates, type GateReport } from "./experience-gates";
import { previewDraftPage, type DraftPreview } from "../pages/preview-draft";
import { OpportunityNotFoundError } from "./store";
import type { VerticalDefinition } from "./vertical";

// Persistência e validação do rascunho do editor visual (ADR-026). Autoridade no SERVIDOR: o cliente envia o modelo de domínio; aqui ele é lido de forma defensiva,
// validado de novo, avaliado pelos gates e gravado como VERSÃO imutável (tenant pela sessão, RLS, concorrência otimista). Salvar não gera nem publica nada.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class DraftConflictError extends Error { readonly code = "DRAFT_CONFLICT"; constructor(readonly expected: number, readonly actual: number) { super(`o rascunho mudou: você editou a versão ${expected}, a mais recente é a ${actual}`); this.name = "DraftConflictError"; } }
export class NoBlueprintError extends Error { readonly code = "NO_BLUEPRINT"; constructor() { super("gere o blueprint da oportunidade antes de editar o rascunho"); this.name = "NoBlueprintError"; } }
export class DraftInvalidError extends Error { readonly code = "DRAFT_INVALID"; constructor(readonly errors: readonly string[]) { super(`rascunho malformado: ${errors.slice(0, 3).join("; ")}`); this.name = "DraftInvalidError"; } }

/** Estados em que o rascunho pode ser editado: do blueprint até QA (depois de gerada, a página pode ser refeita a partir de um rascunho novo). */
export const DRAFT_EDITABLE_STATES: readonly string[] = [...BLUEPRINT_STATES, "data_assembled", "evidence_validated", "experience_built", "qa"];

export interface DraftDeps { readonly vertical: VerticalDefinition; readonly templates: readonly TemplateInfo[]; readonly now?: () => Date }
/** Fontes REAIS já implementadas (as únicas que o editor permite adicionar); o token liga a fonte aos requisitos da vertical. */
export const DRAFT_SOURCES = [
  { id: "city_import", label: "Importação de cidades (IBGE)", token: "entities", state: "implemented_tested" },
  { id: "bcb-sgs", label: "Banco Central (SGS)", token: "indicator:bcb-sgs", state: "implemented_tested" },
  { id: "ibge-news", label: "Notícias do IBGE", token: "news:ibge-news", state: "implemented_tested" },
  { id: "rss-news", label: "Agência Brasil (RSS)", token: "news:rss-news", state: "implemented_tested" },
] as const;

interface OppRow { id: string; status: string; entity_id: string | null; entity_kind: string | null; latest_score_id: string | null }
async function lockOpportunity(db: TenantDb, id: string, lock: boolean): Promise<OppRow> {
  if (!UUID.test(id)) throw new OpportunityNotFoundError();
  const o = (await db.query<OppRow>(`SELECT id, status, entity_id, entity_kind, latest_score_id FROM plataforma.growth_opportunity WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`, [id])).rows[0];
  if (!o) throw new OpportunityNotFoundError();
  return o;
}
async function latestBlueprint(db: TenantDb, id: string): Promise<{ version: number; blueprint: Blueprint } | null> {
  const r = (await db.query<{ version: number; content: Blueprint }>(`SELECT version, content FROM plataforma.page_blueprint WHERE opportunity_id = $1 ORDER BY version DESC LIMIT 1`, [id])).rows[0];
  return r ? { version: r.version, blueprint: r.content } : null;
}

export async function buildDraftContext(db: TenantDb, o: OppRow, deps: DraftDeps): Promise<DraftContext> {
  const inp = await loadBlueprintInputs(db, o, (deps.now ?? (() => new Date()))());
  return {
    verticalId: deps.vertical.id,
    templates: deps.templates.map((t) => ({ key: t.key, version: t.version, entityKind: t.entityKind, sections: t.sections.map((s) => ({ id: s.id, label: s.label, paragraphs: s.paragraphs.map((p) => ({ requires: [...p.requires] })) })), structuredData: [...t.structuredData] })),
    requirements: deps.vertical.evidenceRequirements.map((r) => ({ id: r.id, label: r.label, weight: r.weight, satisfiedBy: [...r.satisfiedBy], note: r.note })),
    sources: DRAFT_SOURCES.map((s) => ({ ...s })),
    available: [...inp.available],
    facts: inp.facts ? Object.entries(inp.facts).filter(([, v]) => v !== null && v !== undefined).map(([k]) => k) : [],
    knownPaths: inp.allPaths.map((p) => p.path),
    maxCannibalizationRisk: inp.maxCannibalization, cannibalizationRisk: inp.cannibalization,
    publicationAvailable: false,
  };
}

export interface DraftEvaluation { readonly validation: Validation; readonly gates: GateReport }
export function evaluateDraft(draft: PageDraft, base: Blueprint, ctx: DraftContext, latestBlueprintVersion: number): DraftEvaluation {
  const v = validateDraft(draft, ctx);
  const extra = draft.basis.blueprintVersion < latestBlueprintVersion ? [{ severity: "info" as const, code: "base_outdated", message: `existe um blueprint mais novo (v${latestBlueprintVersion}); este rascunho nasceu do v${draft.basis.blueprintVersion}` }] : [];
  const validation: Validation = extra.length ? { ...v, issues: [...v.issues, ...extra] } : v;
  return { validation, gates: evaluateExperienceGates(draftToBlueprint(draft, base, ctx)) };
}

export interface DraftVersion { readonly version: number; readonly createdAt: Date; readonly createdBy: string; readonly valid: boolean; readonly errors: number; readonly warnings: number; readonly changes: readonly Change[]; readonly note: string | null }
export interface DraftState {
  readonly opportunityId: string; readonly blueprintVersion: number; readonly baseBlueprint: Blueprint; readonly ctx: DraftContext;
  /** Última versão gravada, ou `null` (então `draft` é o rascunho inicial derivado do blueprint, ainda não salvo). */
  readonly saved: null | { readonly version: number; readonly createdAt: Date; readonly createdBy: string };
  readonly draft: PageDraft; readonly evaluation: DraftEvaluation; readonly versions: readonly DraftVersion[]; readonly cityId: string | null;
}

export async function loadPageDraft(db: TenantDb, opportunityId: string, deps: DraftDeps): Promise<DraftState> {
  const o = await lockOpportunity(db, opportunityId, false);
  const bp = await latestBlueprint(db, o.id);
  if (!bp) throw new NoBlueprintError();
  const ctx = await buildDraftContext(db, o, deps);
  const rows = (await db.query<{ version: number; created_at: Date; created_by: string; valid: boolean; errors: number; warnings: number; changes: Change[]; note: string | null; content: PageDraft }>(`SELECT version, created_at, created_by, valid, errors, warnings, changes, note, content FROM plataforma.page_draft WHERE opportunity_id = $1 ORDER BY version DESC`, [o.id])).rows;
  const latest = rows[0];
  const parsed = latest ? parseDraft(latest.content) : null;
  if (parsed && !parsed.ok) throw new DraftInvalidError(parsed.errors); // conteúdo gravado inválido: falha visível, nunca "rascunho vazio"
  const draft = parsed ? parsed.draft : defaultDraft(bp.blueprint, ctx, bp.version);
  return {
    opportunityId: o.id, blueprintVersion: bp.version, baseBlueprint: bp.blueprint, ctx, cityId: o.entity_kind === "city" ? o.entity_id : null,
    saved: latest ? { version: latest.version, createdAt: latest.created_at, createdBy: latest.created_by } : null,
    draft, evaluation: evaluateDraft(draft, bp.blueprint, ctx, bp.version),
    versions: rows.map((r) => ({ version: r.version, createdAt: r.created_at, createdBy: r.created_by, valid: r.valid, errors: r.errors, warnings: r.warnings, changes: r.changes, note: r.note })),
  };
}

export interface SaveResult { readonly version: number; readonly created: boolean; readonly evaluation: DraftEvaluation; readonly changes: readonly Change[] }
/** Grava uma VERSÃO do rascunho. `baseVersion` é a versão que a pessoa estava editando (0 = nenhuma ainda); se não for a mais recente, recusa (concorrência). Conteúdo igual: sem versão nova. */
export async function savePageDraft(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, deps: DraftDeps, input: { opportunityId: string; draft: unknown; baseVersion: number; note?: string }): Promise<SaveResult> {
  const parsed = parseDraft(input.draft);
  if (!parsed.ok) throw new DraftInvalidError(parsed.errors);
  const note = input.note?.trim().slice(0, 300) || null;
  if (!Number.isInteger(input.baseVersion) || input.baseVersion < 0) throw new DraftInvalidError(["versão base inválida"]);
  return withTenant(pool, identity, tenantId, async (db) => {
    const o = await lockOpportunity(db, input.opportunityId, true);
    if (!(DRAFT_EDITABLE_STATES as readonly string[]).includes(o.status)) throw new NoBlueprintError();
    const bp = await latestBlueprint(db, o.id);
    if (!bp) throw new NoBlueprintError();
    const prev = (await db.query<{ version: number; content: PageDraft; content_sha: string }>(`SELECT version, content, content_sha FROM plataforma.page_draft WHERE opportunity_id = $1 ORDER BY version DESC LIMIT 1`, [o.id])).rows[0];
    const latestVersion = prev?.version ?? 0;
    if (input.baseVersion !== latestVersion) throw new DraftConflictError(input.baseVersion, latestVersion);
    const ctx = await buildDraftContext(db, o, deps);
    const draft: PageDraft = { ...parsed.draft, basis: { blueprintVersion: Math.min(parsed.draft.basis.blueprintVersion, bp.version), blueprintSig: parsed.draft.basis.blueprintSig } };
    const evaluation = evaluateDraft(draft, bp.blueprint, ctx, bp.version);
    const sha = createHash("sha256").update(stable(draft)).digest("hex");
    const prevParsed = prev ? parseDraft(prev.content) : null;
    // A primeira versão é comparada com o rascunho inicial derivado do blueprint: o histórico mostra o que a PESSOA mudou, não a criação do modelo.
    const changes = diffDrafts(prevParsed && prevParsed.ok ? prevParsed.draft : defaultDraft(bp.blueprint, ctx, bp.version), draft);
    const ins = await db.query<{ version: number }>(
      `INSERT INTO plataforma.page_draft (tenant_id, opportunity_id, version, base_blueprint_version, content, content_sha, content_sig, validation, gates, valid, errors, warnings, changes, note, created_by)
       VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12::jsonb, $13, $14)
       ON CONFLICT (tenant_id, opportunity_id, content_sha) DO NOTHING RETURNING version`,
      [o.id, latestVersion + 1, draft.basis.blueprintVersion, JSON.stringify(draft), sha, contentSig(draft), JSON.stringify(evaluation.validation), JSON.stringify(evaluation.gates.gates), evaluation.validation.valid, evaluation.validation.errors, evaluation.validation.warnings, JSON.stringify(changes), note, identity.userId]);
    if (ins.rows.length === 0) {
      const same = (await db.query<{ version: number }>(`SELECT version FROM plataforma.page_draft WHERE opportunity_id = $1 AND content_sha = $2`, [o.id, sha])).rows[0]!;
      return { version: same.version, created: false, evaluation, changes: [] };
    }
    return { version: ins.rows[0]!.version, created: true, evaluation, changes };
  });
}

/** Valida e avalia os gates de um rascunho NÃO salvo (o que está no canvas agora). Não grava nada. */
export async function evaluatePageDraft(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, deps: DraftDeps, input: { opportunityId: string; draft: unknown }): Promise<DraftEvaluation> {
  const parsed = parseDraft(input.draft);
  if (!parsed.ok) throw new DraftInvalidError(parsed.errors);
  return withTenant(pool, identity, tenantId, async (db) => {
    const o = await lockOpportunity(db, input.opportunityId, false);
    const bp = await latestBlueprint(db, o.id);
    if (!bp) throw new NoBlueprintError();
    return evaluateDraft(parsed.draft, bp.blueprint, await buildDraftContext(db, o, deps), bp.version);
  });
}

export function blueprintRecordSig(r: Pick<BlueprintRecord, "blueprint">): string { return blueprintSig(r.blueprint); }

/** Prévia (renderizada agora, não gravada) do rascunho que está no canvas, para a entidade da oportunidade. */
export async function previewPageDraft(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, input: { opportunityId: string; draft: unknown }): Promise<DraftPreview | null> {
  const parsed = parseDraft(input.draft);
  if (!parsed.ok) throw new DraftInvalidError(parsed.errors);
  return withTenant(pool, identity, tenantId, async (db) => {
    const o = await lockOpportunity(db, input.opportunityId, false);
    if (o.entity_kind !== "city" || !o.entity_id) return null;
    return previewDraftPage(db, o.entity_id, parsed.draft);
  });
}
