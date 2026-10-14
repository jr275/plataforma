"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { GenerationBusyError, GenerationScopeError, MAX_GENERATION_ITEMS, UFS, getPageDetail, isDatabaseUnavailable, runGeneration, withTenant } from "@plataforma/api";
import { logServerError } from "@/lib/server/log";
import { isNotMigrated, resolveTenantContext } from "@/lib/server/tenant-data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ações do servidor. A identidade e o tenant vêm SEMPRE da sessão verificada (nunca do formulário); os valores do formulário são
// validados aqui, no servidor, e erros viram mensagens compreensíveis (nunca a mensagem crua do banco).
export type GenerateFormState = { error?: string; fieldErrors?: { uf?: string; limit?: string } } | null;

function explain(e: unknown): string {
  if (e instanceof GenerationBusyError) return "Já existe uma geração em andamento neste workspace. Aguarde ela terminar e tente de novo.";
  if (e instanceof GenerationScopeError) return "Alguma cidade pedida não existe neste workspace.";
  if (isNotMigrated(e)) return "As tabelas de geração ainda não existem neste banco: as migrations 0005 a 0007 precisam ser aplicadas.";
  logServerError("generation-action", e); // esperados acima não são registrados; os demais ficam no log interno (tipo e código)
  if (isDatabaseUnavailable(e)) return "O banco de dados não respondeu agora. Tente novamente em instantes.";
  return "Não foi possível gerar agora. Tente novamente; se persistir, avise o administrador.";
}

async function context(): Promise<{ ok: true; ctx: Extract<Awaited<ReturnType<typeof resolveTenantContext>>, { ok: true }> } | { ok: false; message: string }> {
  let ctx: Awaited<ReturnType<typeof resolveTenantContext>>;
  try {
    ctx = await resolveTenantContext();
  } catch (e) { // falha inesperada ao verificar a sessão: mensagem clara, nada é executado
    unstable_rethrow(e); // erros de controle de fluxo do Next.js (cookies()/connection()) seguem para o framework
    logServerError("generation-action", e);
    return { ok: false, message: "Não foi possível verificar sua sessão agora. Tente novamente em instantes." };
  }
  if (ctx.ok) return { ok: true, ctx };
  const message = ctx.reason === "unauthenticated" ? "Sua sessão expirou. Entre novamente." : ctx.reason === "no_tenant" ? "Seu usuário ainda não está associado a um workspace." : "A geração não está configurada neste ambiente.";
  return { ok: false, message };
}

export async function generateAction(_prev: GenerateFormState, formData: FormData): Promise<GenerateFormState> {
  const uf = String(formData.get("uf") ?? "").toUpperCase();
  const limitRaw = String(formData.get("limit") ?? "").trim();
  const limit = Number(limitRaw);
  const fieldErrors: NonNullable<GenerateFormState>["fieldErrors"] = {};
  if (!(UFS as readonly string[]).includes(uf)) fieldErrors.uf = "Escolha uma UF da lista.";
  if (!/^\d+$/.test(limitRaw) || limit < 1 || limit > MAX_GENERATION_ITEMS) fieldErrors.limit = `Informe um número inteiro de 1 a ${MAX_GENERATION_ITEMS}.`;
  if (fieldErrors.uf || fieldErrors.limit) return { fieldErrors };

  const c = await context();
  if (!c.ok) return { error: c.message };
  let runId: string;
  try {
    runId = (await runGeneration(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, { scope: { uf, limit } })).runId;
  } catch (e) {
    return { error: explain(e) };
  }
  redirect(`/generation/runs/${runId}`);
}

export type ReprocessState = { error?: string } | null;

/** Reprocessa UMA página (a cidade de origem): se nada mudou, nenhuma versão nova é criada. */
export async function reprocessAction(_prev: ReprocessState, formData: FormData): Promise<ReprocessState> {
  const pageId = String(formData.get("pageId") ?? "");
  if (!UUID.test(pageId)) return { error: "Identificador de página inválido." }; // entrada inválida: nada é consultado
  const c = await context();
  if (!c.ok) return { error: c.message };
  let runId: string;
  try {
    const detail = await withTenant(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, (db) => getPageDetail(db, pageId));
    if (!detail) return { error: "Página não encontrada neste workspace." };
    runId = (await runGeneration(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, { scope: { cityIds: [detail.page.entityId] } })).runId;
  } catch (e) {
    return { error: explain(e) };
  }
  redirect(`/generation/runs/${runId}`);
}
