"use server";

import { revalidatePath } from "next/cache";
import { provider, runtime, withTenant, agents as agentsApi } from "@plataforma/api";
import { actionContext, explainFailure } from "@/lib/server/action-context";
import { FILE_PROMPTS, PACK_DEPS, PACK_ID, PACK_VERSION, PIPELINE_VARS } from "@/lib/server/engine-runtime";
import { realFetch } from "@/lib/server/vertical";

// Ações do Control Plane do motor (ADR-031). Identidade e tenant SEMPRE da sessão; entradas validadas aqui; nada é publicado por nenhuma delas.
// O LLM nunca é simulado nesta tela: sem ANTHROPIC_API_KEY os passos de agente ficam BLOQUEADOS (externamente) e isso aparece como tal.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type EngineActionState = { error?: string; ok?: string; href?: string } | null;

export async function syncRegistryAction(): Promise<EngineActionState> {
  const c = await actionContext("engine-sync");
  if (!c.ok) return { error: c.message };
  try {
    const r = await withTenant(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, async (db) => ({ defs: await runtime.syncAgentDefinitions(db, c.ctx.identity.userId), prompts: await runtime.seedFilePrompts(db, PACK_ID, FILE_PROMPTS, c.ctx.identity.userId) }));
    revalidatePath("/engine", "layout");
    return { ok: `Definições: ${r.defs.inserted} nova(s), ${r.defs.unchanged} inalterada(s). Prompts do arquivo do pack: ${r.prompts.seeded} ativado(s), ${r.prompts.kept} já tinham versão ativa.` };
  } catch (e) { return { error: explainFailure("engine-sync", e) }; }
}

export async function activatePromptAction(_p: EngineActionState, fd: FormData): Promise<EngineActionState> {
  const id = String(fd.get("id") ?? ""); if (!UUID.test(id)) return { error: "Versão de prompt inválida." };
  const c = await actionContext("engine-activate-prompt");
  if (!c.ok) return { error: c.message };
  try { const v = await withTenant(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, (db) => runtime.activatePrompt(db, id, c.ctx.identity.userId)); revalidatePath("/engine", "layout"); return { ok: `Versão ${v.version} ativada para o agente ${v.agent}.` }; }
  catch (e) { if (e instanceof runtime.PromptRegistryError) return { error: e.message }; return { error: explainFailure("engine-activate-prompt", e) }; }
}
export async function rollbackPromptAction(_p: EngineActionState, fd: FormData): Promise<EngineActionState> {
  const agent = Number.parseInt(String(fd.get("agent") ?? ""), 10); if (!(agent >= 1 && agent <= 8)) return { error: "Agente inválido." };
  const c = await actionContext("engine-rollback-prompt");
  if (!c.ok) return { error: c.message };
  try { const v = await withTenant(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, (db) => runtime.rollbackPrompt(db, agent, PACK_ID, c.ctx.identity.userId)); revalidatePath("/engine", "layout"); return { ok: `Rollback: a versão ${v.version} voltou a ser a ativa do agente ${agent}.` }; }
  catch (e) { if (e instanceof runtime.PromptRegistryError) return { error: e.message }; return { error: explainFailure("engine-rollback-prompt", e) }; }
}
export async function registerPromptAction(_p: EngineActionState, fd: FormData): Promise<EngineActionState> {
  const agent = Number.parseInt(String(fd.get("agent") ?? ""), 10); const body = String(fd.get("body") ?? ""); const changeLog = String(fd.get("changeLog") ?? "").trim();
  if (!(agent >= 1 && agent <= 8)) return { error: "Agente inválido." };
  if (changeLog.length < 3 || changeLog.length > 2000) return { error: "Descreva a mudança em 3 a 2000 caracteres." };
  const problems = runtime.validatePromptBody(agent, body); if (problems.length > 0) return { error: problems.join("; ") };
  const c = await actionContext("engine-register-prompt");
  if (!c.ok) return { error: c.message };
  try { const r = await withTenant(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, (db) => runtime.registerPrompt(db, { agent, domainPackId: PACK_ID, body, header: FILE_PROMPTS.header, source: "control_plane", changeLog, actor: c.ctx.identity.userId })); revalidatePath("/engine", "layout"); return { ok: r.created ? `Rascunho ${r.record.version} criado. Ele só pode ser ativado depois de uma regressão aprovada.` : `Esse texto já existe (${r.record.version}, ${r.record.status}); nada foi duplicado.` }; }
  catch (e) { if (e instanceof runtime.PromptRegistryError) return { error: e.message }; return { error: explainFailure("engine-register-prompt", e) }; }
}

/** Roda o pipeline de UMA página (eligibility → … → quality gate). Com a chave ausente os agentes ficam bloqueados externamente; nada é inventado e nada é publicado. */
export async function runPagePipelineAction(_p: EngineActionState, fd: FormData): Promise<EngineActionState> {
  const opportunityId = String(fd.get("opportunityId") ?? ""); if (!UUID.test(opportunityId)) return { error: "Oportunidade inválida." };
  const c = await actionContext("engine-run-pipeline");
  if (!c.ok) return { error: c.message };
  try {
    let tenantName = "workspace";
    try { tenantName = await withTenant(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, async (db) => (await db.query<{ name: string }>(`SELECT name FROM plataforma.tenant WHERE id = plataforma.current_tenant_id()`)).rows[0]?.name ?? "workspace"); } catch { /* o nome é só rótulo do contexto */ }
    const r = await runtime.runPagePipeline({ pool: c.ctx.pool, identity: c.ctx.identity, tenantId: c.ctx.tenantId, tenantName, mode: "real", domainPack: { id: PACK_ID, version: PACK_VERSION },
      agents: { ctx: { fetch: realFetch, userAgent: provider.PUBLIC_UA, gate: new provider.RateGate({}), env: process.env as Record<string, string | undefined>, prompts: FILE_PROMPTS, vars: PIPELINE_VARS(tenantName) } satisfies agentsApi.AgentCtx, budget: provider.RunBudget.create(), editorialStyle: "direto" },
      eligibility: PACK_DEPS.eligibility, blueprint: PACK_DEPS.blueprint, recipeQa: PACK_DEPS.recipeQa }, { opportunityId });
    revalidatePath("/engine", "layout");
    return { ok: `Execução ${r.run.status}${r.outcome ? ` — decisão final do Quality Gate: ${r.outcome}` : ""}. ${r.reasons.join("; ")}`, href: `/engine/pipelines/${r.run.id}` };
  } catch (e) { return { error: explainFailure("engine-run-pipeline", e) }; }
}

export async function cancelPipelineAction(_p: EngineActionState, fd: FormData): Promise<EngineActionState> {
  const id = String(fd.get("id") ?? ""); if (!UUID.test(id)) return { error: "Execução inválida." };
  const c = await actionContext("engine-cancel");
  if (!c.ok) return { error: c.message };
  try { const ok = await runtime.requestPipelineCancel(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, id); revalidatePath("/engine", "layout"); return ok ? { ok: "Cancelamento pedido: o pipeline para antes do próximo passo." } : { error: "A execução já terminou ou não existe: nada a cancelar." }; }
  catch (e) { return { error: explainFailure("engine-cancel", e) }; }
}
