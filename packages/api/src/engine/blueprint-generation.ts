import type { VerifiedIdentity } from "../identity";
import { withTenant, type PoolLike, type TenantDb } from "../tenant-context";
import { CITY_OVERVIEW, type CityTemplate } from "../pages/city-overview";
import { runGeneration, type GenerationResult } from "../pages/generate";
import type { GateResult } from "../pages/gates";
import { templateFromDraft } from "../pages/preview-draft";
import type { Blueprint, TemplateInfo } from "./blueprint";
import { loadBlueprintInputs, type BlueprintRecord } from "./blueprint-store";
import { assertExecutable, type LifecycleState } from "./lifecycle";
import { loadPageDraft, type DraftDeps } from "./page-draft-store";
import { OpportunityNotFoundError, StaleStateError } from "./store";
import type { GateReport } from "./experience-gates";

// Geração a partir do blueprint (ADR-028). NÃO existe pipeline paralelo: o blueprint (e o rascunho salvo, se houver) escolhem o template, as seções e os links, e a geração
// EXISTENTE (`runGeneration`: render + 6 gates, páginas `draft`, versões imutáveis) produz a página. Aqui só se decide se pode gerar, avança o ciclo de vida até QA e registra a ligação.
// Publicar e indexar continuam bloqueados (ver `assertExecutable`).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const GENERATION_START_STATES: readonly LifecycleState[] = ["blueprinted", "data_assembled", "evidence_validated", "experience_built", "qa"];

export class GenerationPreconditionError extends Error {
  readonly code = "GENERATION_PRECONDITION";
  constructor(readonly reasons: readonly string[]) { super(`não é possível gerar o rascunho: ${reasons.join("; ")}`); this.name = "GenerationPreconditionError"; }
}

export interface PageGenerationDeps extends DraftDeps { readonly knownPaths?: readonly string[] }
export interface OpportunityPageRecord {
  readonly id: string; readonly runId: string; readonly outcome: "generated" | "unchanged" | "blocked"; readonly pageId: string | null; readonly pageVersionId: string | null;
  readonly blueprintId: string; readonly draftId: string | null; readonly gates: readonly GateResult[]; readonly qaPassed: boolean; readonly createdAt: Date; readonly createdBy: string;
  /** Do join com `page`/`page_version` (quando existe). */
  readonly path: string | null; readonly version: number | null;
}
export interface GenerateFromBlueprintResult {
  readonly record: OpportunityPageRecord; readonly generation: Pick<GenerationResult, "runId" | "status" | "generated" | "unchanged" | "blocked">;
  readonly from: LifecycleState; readonly to: LifecycleState; readonly steps: readonly { readonly from: LifecycleState; readonly to: LifecycleState; readonly reason: string }[];
  readonly usedDraftVersion: number | null; readonly note: string;
}

interface OppRow { id: string; status: string; entity_id: string | null; entity_kind: string | null; latest_score_id: string | null }
interface BpRow { id: string; version: number; ready: boolean; template_key: string | null; content: Blueprint; gates: GateReport["gates"] }

/** O que precisa ser verdade para gerar (ordem: do mais estrutural ao mais específico). Devolve TODOS os motivos, não só o primeiro. */
export function generationPreconditions(o: { status: string; entityKind: string | null; entityId: string | null }, bp: { ready: boolean; templateKey: string | null } | null, templates: readonly TemplateInfo[], factsPresent: boolean, draft: { saved: boolean; valid: boolean; hasTemplate: boolean }): string[] {
  const r: string[] = [];
  if (!(GENERATION_START_STATES as readonly string[]).includes(o.status)) r.push(`a oportunidade está em “${o.status}”; é preciso ter blueprint (estado “blueprinted” ou posterior)`);
  if (!bp) r.push("não há blueprint");
  else {
    if (!bp.ready) r.push("o blueprint mais recente tem gates reprovados");
    if (!bp.templateKey || !templates.some((t) => t.key === bp.templateKey)) r.push("o template do blueprint não existe no registro (template_gap)");
  }
  if (o.entityKind !== "city" || !o.entityId) r.push("a oportunidade não está ligada a uma cidade real do tenant");
  else if (!factsPresent) r.push("os fatos reais da cidade não estão disponíveis (a importação precisa ser real e concluída)");
  if (draft.saved && !draft.valid) r.push("o rascunho salvo no editor é inválido; corrija e salve de novo");
  if (draft.saved && draft.valid && !draft.hasTemplate) r.push("o rascunho salvo não tem um template gerável");
  return r;
}

/**
 * Gera (ou regenera) a página da oportunidade com o pipeline existente e avança o ciclo de vida, no máximo, até QA:
 *   blueprinted → data_assembled (fatos reais da entidade presentes) → evidence_validated (blueprint sem gate reprovado)
 *   → experience_built (a geração produziu uma avaliação) → qa (os 6 gates da página foram avaliados; aprovado ou reprovado, com os motivos gravados).
 * Falha da geração (erro, não reprovação de gate) interrompe no último estado alcançado. Idempotente: gerar de novo o mesmo conteúdo dá `unchanged`.
 */
export async function generateFromBlueprint(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, deps: PageGenerationDeps, input: { opportunityId: string }): Promise<GenerateFromBlueprintResult> {
  if (!UUID.test(input.opportunityId)) throw new OpportunityNotFoundError();
  const now = (deps.now ?? (() => new Date()))();

  // 1. leitura e pré-condições (sem gravar nada)
  const prep = await withTenant(pool, identity, tenantId, async (db) => {
    const o = (await db.query<OppRow>(`SELECT id, status, entity_id, entity_kind, latest_score_id FROM plataforma.growth_opportunity WHERE id = $1`, [input.opportunityId])).rows[0];
    if (!o) throw new OpportunityNotFoundError();
    const bp = (await db.query<BpRow>(`SELECT id, version, ready, template_key, content, gates FROM plataforma.page_blueprint WHERE opportunity_id = $1 ORDER BY version DESC LIMIT 1`, [o.id])).rows[0] ?? null;
    const inputs = await loadBlueprintInputs(db, o, now);
    let template: CityTemplate = CITY_OVERVIEW; let linkCandidates: { path: string; text: string }[] | undefined; let usedDraft: { id: string; version: number } | null = null;
    let draftInfo = { saved: false, valid: true, hasTemplate: true };
    if (bp) {
      const st = await loadPageDraft(db, o.id, deps);
      if (st.saved) {
        const row = (await db.query<{ id: string; version: number }>(`SELECT id, version FROM plataforma.page_draft WHERE opportunity_id = $1 ORDER BY version DESC LIMIT 1`, [o.id])).rows[0]!;
        const t = templateFromDraft(st.draft);
        draftInfo = { saved: true, valid: st.evaluation.validation.valid, hasTemplate: t !== null };
        if (t && st.evaluation.validation.valid) {
          template = t; usedDraft = { id: row.id, version: row.version };
          linkCandidates = st.draft.nodes.filter((n) => n.type === "internal_link" && typeof n.config.path === "string" && typeof n.config.text === "string").map((n) => ({ path: n.config.path as string, text: n.config.text as string }));
        }
      }
    }
    const reasons = generationPreconditions({ status: o.status, entityKind: o.entity_kind, entityId: o.entity_id }, bp ? { ready: bp.ready, templateKey: bp.template_key } : null, deps.templates, inputs.facts !== null, draftInfo);
    return { o, bp, reasons, template, linkCandidates, usedDraft, knownPaths: deps.knownPaths ?? inputs.allPaths.map((p) => p.path) };
  });
  if (prep.reasons.length > 0) throw new GenerationPreconditionError(prep.reasons);
  const { o, bp } = prep; const blueprintRow = bp!;

  // 2. geração pelo pipeline EXISTENTE (uma cidade; várias transações próprias; nada é publicado)
  const gen = await runGeneration(pool, identity, tenantId, { scope: { cityIds: [o.entity_id!] }, template: prep.template, knownPaths: prep.knownPaths, ...(prep.linkCandidates ? { linkCandidates: prep.linkCandidates } : {}) });
  const item = gen.items[0];
  // Uma página reprovada nos gates faz a execução de UMA cidade terminar como "failed" no pipeline (nenhum item gerado); isso é um resultado de QA, não uma falha de execução.
  if (!item || item.error || (gen.status === "failed" && item.outcome !== "blocked")) throw new Error(`a geração falhou: ${gen.error ?? item?.error ?? "sem resultado"}`);

  // 3. registra a ligação e avança o ciclo de vida (uma transação, oportunidade travada)
  return withTenant(pool, identity, tenantId, async (db) => {
    const cur = (await db.query<{ status: string }>(`SELECT status FROM plataforma.growth_opportunity WHERE id = $1 FOR UPDATE`, [o.id])).rows[0]!;
    let st = cur.status as LifecycleState;
    if (!(GENERATION_START_STATES as readonly string[]).includes(st)) throw new StaleStateError(o.status, st);
    const from = st;
    const row = (await db.query<{ gates: GateResult[]; page_id: string | null; page_version_id: string | null; outcome: "generated" | "unchanged" | "blocked" }>(`SELECT gates, page_id, page_version_id, outcome FROM plataforma.generation_item WHERE run_id = $1 AND entity_id = $2`, [gen.runId, o.entity_id]))!.rows[0]!;
    const qaPassed = row.outcome !== "blocked" && row.gates.every((g) => g.outcome === "pass" || g.outcome === "skipped");
    const ins = await db.query<{ id: string }>(
      `INSERT INTO plataforma.opportunity_page (tenant_id, opportunity_id, blueprint_id, draft_id, run_id, outcome, page_id, page_version_id, gates, qa_passed, created_by)
       VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
       ON CONFLICT (tenant_id, opportunity_id, run_id) DO NOTHING RETURNING id`,
      [o.id, blueprintRow.id, prep.usedDraft?.id ?? null, gen.runId, row.outcome, row.page_id, row.page_version_id, JSON.stringify(row.gates), qaPassed, identity.userId]);
    const steps: { from: LifecycleState; to: LifecycleState; reason: string }[] = [];
    const move = async (to: LifecycleState, reason: string, data: Record<string, unknown>) => {
      if (st === to) return;
      assertExecutable(st, to);
      const u = await db.query<{ id: string }>(`UPDATE plataforma.growth_opportunity SET status = $2 WHERE id = $1 AND status = $3 RETURNING id`, [o.id, to, st]);
      if (u.rows.length === 0) throw new StaleStateError(st, "outro");
      await db.query(`INSERT INTO plataforma.opportunity_event (tenant_id, opportunity_id, event_type, from_status, to_status, actor, reason, data, run_id) VALUES (plataforma.current_tenant_id(), $1, 'transition', $2, $3, $4, $5, $6::jsonb, NULL)`, [o.id, st, to, identity.userId, reason, JSON.stringify(data)]);
      steps.push({ from: st, to, reason }); st = to;
    };
    const order: LifecycleState[] = ["blueprinted", "data_assembled", "evidence_validated", "experience_built", "qa"];
    const at = (s: LifecycleState) => order.indexOf(s);
    const common = { generationRunId: gen.runId, blueprintVersion: blueprintRow.version, authorizesPublication: false };
    if (at(st) < at("data_assembled")) await move("data_assembled", "fatos reais da cidade reunidos com origem (importação real concluída)", common);
    if (at(st) < at("evidence_validated")) await move("evidence_validated", "o blueprint não tem gate reprovado (evidências exigidas verificadas)", common);
    if (at(st) < at("experience_built")) await move("experience_built", `a geração avaliou a página (${row.outcome === "blocked" ? "reprovada em gates" : row.outcome === "unchanged" ? "conteúdo idêntico ao já gerado" : "nova versão do rascunho"})`, { ...common, outcome: row.outcome });
    if (at(st) < at("qa")) await move("qa", qaPassed ? "QA: os 6 gates da página passaram (continua rascunho, noindex; publicação bloqueada)" : `QA: gates reprovados (${row.gates.filter((g) => g.outcome === "fail").map((g) => g.gate).join(", ") || "sem página gerada"}); a página não é gravada como versão`, { ...common, qaPassed });
    if (!qaPassed) await db.query(`INSERT INTO plataforma.opportunity_event (tenant_id, opportunity_id, event_type, actor, reason, data) VALUES (plataforma.current_tenant_id(), $1, 'blocker', $2, $3, $4::jsonb)`, [o.id, identity.userId, `QA reprovado: ${row.gates.filter((g) => g.outcome === "fail").map((g) => `${g.gate} — ${g.detail}`).join(" | ")}`.slice(0, 1000), JSON.stringify({ generationRunId: gen.runId, gates: row.gates })]);
    const rec = (await listOpportunityPages(db, o.id)).find((r) => r.runId === gen.runId)!;
    return { record: rec, generation: { runId: gen.runId, status: gen.status, generated: gen.generated, unchanged: gen.unchanged, blocked: gen.blocked }, from, to: st, steps, usedDraftVersion: prep.usedDraft?.version ?? null, note: "Rascunho (noindex). Nada foi publicado nem indexado." };
  });
}

export async function listOpportunityPages(db: TenantDb, opportunityId: string): Promise<OpportunityPageRecord[]> {
  if (!UUID.test(opportunityId)) return [];
  const r = await db.query<{ id: string; run_id: string; outcome: OpportunityPageRecord["outcome"]; page_id: string | null; page_version_id: string | null; blueprint_id: string; draft_id: string | null; gates: GateResult[]; qa_passed: boolean; created_at: Date; created_by: string; path: string | null; version: number | null }>(
    `SELECT op.id, op.run_id, op.outcome, op.page_id, op.page_version_id, op.blueprint_id, op.draft_id, op.gates, op.qa_passed, op.created_at, op.created_by, p.path, pv.version
       FROM plataforma.opportunity_page op LEFT JOIN plataforma.page p ON p.id = op.page_id AND p.tenant_id = op.tenant_id LEFT JOIN plataforma.page_version pv ON pv.id = op.page_version_id AND pv.tenant_id = op.tenant_id
      WHERE op.opportunity_id = $1 ORDER BY op.created_at DESC, op.id`, [opportunityId]);
  return r.rows.map((x) => ({ id: x.id, runId: x.run_id, outcome: x.outcome, pageId: x.page_id, pageVersionId: x.page_version_id, blueprintId: x.blueprint_id, draftId: x.draft_id, gates: x.gates, qaPassed: x.qa_passed, createdAt: x.created_at, createdBy: x.created_by, path: x.path, version: x.version }));
}
