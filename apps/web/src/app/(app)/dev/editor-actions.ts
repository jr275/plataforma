"use server";

import type { DraftPreview } from "@plataforma/api";
import { devEditorContext } from "@/lib/server/dev-editor";
import { evaluateDraft, previewDraft, saveDraft } from "@/lib/server/draft-service";
import type { ActionResult, DraftEvaluationDTO } from "@/lib/editor/types";

// Ações da BANCADA (só desenvolvimento; banco descartável). Mesmo serviço das ações reais.
const deny: Extract<ActionResult<never>, { ok: false }> = { ok: false, kind: "auth", message: "A bancada do editor não está disponível neste ambiente." };
export async function devSaveDraftAction(input: { opportunityId: string; draft: unknown; baseVersion: number; note?: string }): Promise<ActionResult<{ version: number; created: boolean; evaluation: DraftEvaluationDTO }>> { const c = devEditorContext(); return c ? saveDraft(c, input) : deny; }
export async function devEvaluateDraftAction(input: { opportunityId: string; draft: unknown }): Promise<ActionResult<DraftEvaluationDTO>> { const c = devEditorContext(); return c ? evaluateDraft(c, input) : deny; }
export async function devPreviewDraftAction(input: { opportunityId: string; draft: unknown }): Promise<ActionResult<DraftPreview | null>> { const c = devEditorContext(); return c ? previewDraft(c, input) : deny; }
