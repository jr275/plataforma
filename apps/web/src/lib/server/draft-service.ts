import "server-only";
import { GenerationBusyError, TEMPLATE_REGISTRY, engine, type DraftPreview } from "@plataforma/api";
import type { PoolLike } from "@plataforma/api/src/tenant-context";
import type { VerifiedIdentity } from "@plataforma/api";
import { isDatabaseUnavailable, isUndefinedTable } from "@plataforma/api";
import type { ActionResult, DraftEvaluationDTO } from "@/lib/editor/types";
import { logServerError } from "./log";
import { activeVertical } from "./vertical";

// Serviço do editor de rascunho (ADR-026): a MESMA lógica para as ações reais (sessão verificada) e para a bancada de desenvolvimento (banco descartável). O contexto
// (pool, identidade e tenant) é decidido por quem chama; aqui entram só validação de entrada, chamada ao motor e tradução de falhas em mensagens (nunca a do banco).
export interface EditorCtx { readonly pool: PoolLike; readonly identity: VerifiedIdentity; readonly tenantId: string }
const deps = { vertical: activeVertical, templates: TEMPLATE_REGISTRY } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function failure(scope: string, e: unknown): Extract<ActionResult<never>, { ok: false }> {
  if (e instanceof engine.DraftConflictError) return { ok: false, kind: "conflict", message: `${e.message}. Recarregue para ver a versão mais recente (suas alterações locais continuam na tela até você recarregar).` };
  if (e instanceof engine.DraftInvalidError) return { ok: false, kind: "invalid", message: "O rascunho enviado é inválido e não foi aceito pelo servidor." };
  if (e instanceof engine.NoBlueprintError) return { ok: false, kind: "no_blueprint", message: "Gere o blueprint da oportunidade antes de editar o rascunho." };
  if (e instanceof engine.OpportunityNotFoundError) return { ok: false, kind: "not_found", message: "Oportunidade não encontrada neste workspace." };
  if (isUndefinedTable(e)) return { ok: false, kind: "error", message: "A tabela do rascunho ainda não existe neste banco: a migration 0010 precisa ser aplicada." };
  logServerError(scope, e);
  return { ok: false, kind: "error", message: isDatabaseUnavailable(e) ? "O banco de dados não respondeu agora. Tente novamente." : "Não foi possível concluir agora. Tente novamente; se persistir, avise o administrador." };
}
const bad = (message: string): Extract<ActionResult<never>, { ok: false }> => ({ ok: false, kind: "invalid", message });

export async function saveDraft(c: EditorCtx, input: { opportunityId: string; draft: unknown; baseVersion: number; note?: string }): Promise<ActionResult<{ version: number; created: boolean; evaluation: DraftEvaluationDTO }>> {
  if (!UUID.test(String(input.opportunityId))) return bad("Identificador de oportunidade inválido.");
  try {
    const r = await engine.savePageDraft(c.pool, c.identity, c.tenantId, deps, { opportunityId: input.opportunityId, draft: input.draft, baseVersion: input.baseVersion, note: input.note });
    return { ok: true, data: { version: r.version, created: r.created, evaluation: { validation: r.evaluation.validation, gates: r.evaluation.gates } } };
  } catch (e) { return failure("draft-save", e); }
}
export async function evaluateDraft(c: EditorCtx, input: { opportunityId: string; draft: unknown }): Promise<ActionResult<DraftEvaluationDTO>> {
  if (!UUID.test(String(input.opportunityId))) return bad("Identificador de oportunidade inválido.");
  try { const r = await engine.evaluatePageDraft(c.pool, c.identity, c.tenantId, deps, input); return { ok: true, data: { validation: r.validation, gates: r.gates } }; } catch (e) { return failure("draft-evaluate", e); }
}
export async function previewDraft(c: EditorCtx, input: { opportunityId: string; draft: unknown }): Promise<ActionResult<DraftPreview | null>> {
  if (!UUID.test(String(input.opportunityId))) return bad("Identificador de oportunidade inválido.");
  try { return { ok: true, data: await engine.previewPageDraft(c.pool, c.identity, c.tenantId, input) }; } catch (e) { return failure("draft-preview", e); }
}

/** Resultado da geração a partir do blueprint, em forma serializável para a tela. */
export interface GenerateDTO {
  readonly runId: string; readonly outcome: "generated" | "unchanged" | "blocked"; readonly qaPassed: boolean; readonly from: string; readonly to: string;
  readonly steps: readonly { readonly from: string; readonly to: string; readonly reason: string }[];
  readonly pageId: string | null; readonly path: string | null; readonly version: number | null;
  readonly gates: readonly { readonly gate: string; readonly outcome: "pass" | "fail" | "skipped"; readonly detail: string }[];
  readonly usedDraftVersion: number | null; readonly note: string;
}
/** Gera (ou regenera) o rascunho da página a partir do blueprint e do rascunho salvo, com o pipeline existente. Nunca publica. */
export async function generatePage(c: EditorCtx, input: { opportunityId: string }): Promise<ActionResult<GenerateDTO>> {
  if (!UUID.test(String(input.opportunityId))) return bad("Identificador de oportunidade inválido.");
  try {
    const r = await engine.generateFromBlueprint(c.pool, c.identity, c.tenantId, deps, { opportunityId: input.opportunityId });
    return { ok: true, data: { runId: r.record.runId, outcome: r.record.outcome, qaPassed: r.record.qaPassed, from: r.from, to: r.to, steps: r.steps, pageId: r.record.pageId, path: r.record.path, version: r.record.version, gates: r.record.gates, usedDraftVersion: r.usedDraftVersion, note: r.note } };
  } catch (e) {
    if (e instanceof engine.GenerationPreconditionError) return { ok: false, kind: "invalid", message: `Ainda não dá para gerar: ${e.reasons.join("; ")}.` };
    if (e instanceof GenerationBusyError) return { ok: false, kind: "conflict", message: "Já existe uma geração em andamento neste workspace. Aguarde ela terminar e tente de novo." };
    if (e instanceof engine.StaleStateError) return { ok: false, kind: "conflict", message: "O estado da oportunidade mudou enquanto a página era gerada. Atualize e confira." };
    if (isUndefinedTable(e)) return { ok: false, kind: "error", message: "A tabela da ligação oportunidade-página ainda não existe neste banco: a migration 0012 precisa ser aplicada." };
    return failure("draft-generate", e);
  }
}
