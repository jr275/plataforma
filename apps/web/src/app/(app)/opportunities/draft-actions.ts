"use server";

import type { DraftPreview } from "@plataforma/api";
import { actionContext } from "@/lib/server/action-context";
import { evaluateDraft, generatePage, previewDraft, saveDraft, type GenerateDTO } from "@/lib/server/draft-service";
import type { ActionResult, DraftEvaluationDTO } from "@/lib/editor/types";

// Ações do editor de rascunho (ADR-026). Identidade e tenant SEMPRE da sessão verificada; o corpo vem do cliente e é validado de novo no servidor.
type Save = ActionResult<{ version: number; created: boolean; evaluation: DraftEvaluationDTO }>;
const deny = (message: string): Extract<ActionResult<never>, { ok: false }> => ({ ok: false, kind: "auth", message });

export async function saveDraftAction(input: { opportunityId: string; draft: unknown; baseVersion: number; note?: string }): Promise<Save> {
  const c = await actionContext("draft-action");
  return c.ok ? saveDraft({ pool: c.ctx.pool, identity: c.ctx.identity, tenantId: c.ctx.tenantId }, input) : deny(c.message);
}
export async function evaluateDraftAction(input: { opportunityId: string; draft: unknown }): Promise<ActionResult<DraftEvaluationDTO>> {
  const c = await actionContext("draft-action");
  return c.ok ? evaluateDraft({ pool: c.ctx.pool, identity: c.ctx.identity, tenantId: c.ctx.tenantId }, input) : deny(c.message);
}
export async function previewDraftAction(input: { opportunityId: string; draft: unknown }): Promise<ActionResult<DraftPreview | null>> {
  const c = await actionContext("draft-action");
  return c.ok ? previewDraft({ pool: c.ctx.pool, identity: c.ctx.identity, tenantId: c.ctx.tenantId }, input) : deny(c.message);
}
export async function generatePageAction(input: { opportunityId: string }): Promise<ActionResult<GenerateDTO>> {
  const c = await actionContext("draft-generate-action");
  return c.ok ? generatePage({ pool: c.ctx.pool, identity: c.ctx.identity, tenantId: c.ctx.tenantId }, input) : deny(c.message);
}
