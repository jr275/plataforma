"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { architecture, factory, withTenant } from "@plataforma/api";
import { actionContext, explainFailure } from "@/lib/server/action-context";
import { ARCH_DEPS, pipelineEnvFor } from "@/lib/server/engine-runtime";
import { realFetch } from "@/lib/server/vertical";

// Ações da Fábrica de páginas (ADR-032). Identidade e tenant da sessão; entradas validadas aqui E na camada de dados; nada publica sem autorização explícita; o padrão de destino é preview.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type FactoryState = { error?: string; ok?: string; href?: string; items?: readonly { id: string; ok: boolean; message: string }[] } | null;
const ids = (fd: FormData) => [...new Set(fd.getAll("id").map(String).filter((x) => UUID.test(x)))];

export async function decidePagesAction(_p: FactoryState, fd: FormData): Promise<FactoryState> {
  const decision = String(fd.get("decision") ?? ""); const reason = String(fd.get("reason") ?? ""); const list = ids(fd);
  if (!["APPROVED", "REJECTED", "REVOKED"].includes(decision)) return { error: "Decisão inválida." };
  if (list.length === 0) return { error: "Selecione ao menos uma página." };
  if (fd.get("confirm") !== "on") return { error: `Confirme a ação em lote sobre ${list.length} página(s).` };
  const c = await actionContext("factory-decide");
  if (!c.ok) return { error: c.message };
  try {
    const r = await factory.decidePages(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, { opportunityIds: list, decision: decision as "APPROVED", reason });
    revalidatePath("/engine", "layout");
    const ok = r.filter((x) => x.ok).length;
    return { ok: `${ok} de ${r.length} página(s) processadas. Aprovar não publica.`, items: r.map((x) => ({ id: x.opportunityId, ok: x.ok, message: x.message })) };
  } catch (e) { return { error: e instanceof Error && /motivo|selecione/.test(e.message) ? e.message : explainFailure("factory-decide", e) }; }
}

const num = (fd: FormData, k: string, d: number) => { const v = Number.parseInt(String(fd.get(k) ?? ""), 10); return Number.isFinite(v) ? v : d; };
const list = (fd: FormData, k: string) => String(fd.get(k) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
export async function planBatchAction(_p: FactoryState, fd: FormData): Promise<FactoryState> {
  const c = await actionContext("factory-plan");
  if (!c.ok) return { error: c.message };
  const uf = String(fd.get("uf") ?? "").trim();
  const config: factory.BatchConfig = { ...factory.DEFAULT_CONFIG, limit: num(fd, "limit", 50), families: list(fd, "families"), templates: list(fd, "templates"), geo: uf ? { uf } : null, concurrency: num(fd, "concurrency", 2), batchSize: num(fd, "batchSize", 10), maxModelCallsPerPage: num(fd, "maxModelCalls", 40), target: ["none", "preview", "production"].includes(String(fd.get("target"))) ? (String(fd.get("target")) as "none") : "preview" };
  try {
    const { batch } = await factory.planBatch(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, { name: String(fd.get("name") ?? ""), config, mode: "real", llmConfigured: (process.env.ANTHROPIC_API_KEY ?? "").trim() !== "" });
    revalidatePath("/engine/batches");
    return { ok: `Lote planejado: ${batch.estimate.eligible} elegível(is) de ${batch.estimate.candidates}. Nada foi executado.`, href: `/engine/batches/${batch.id}` };
  } catch (e) { if (e instanceof factory.BatchError) return { error: e.message }; return { error: explainFailure("factory-plan", e) }; }
}
export async function confirmBatchAction(_p: FactoryState, fd: FormData): Promise<FactoryState> {
  const id = String(fd.get("id") ?? ""); if (!UUID.test(id)) return { error: "Lote inválido." };
  const c = await actionContext("factory-confirm");
  if (!c.ok) return { error: c.message };
  try { await factory.confirmBatch(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, { batchId: id, authorizeProduction: String(fd.get("authorization") ?? "") }); revalidatePath("/engine", "layout"); return { ok: "Lote confirmado. Ele ainda não foi iniciado." }; }
  catch (e) { if (e instanceof factory.BatchError) return { error: e.message }; return { error: explainFailure("factory-confirm", e) }; }
}
/** Inicia (ou retoma) a execução em segundo plano: responde agora e o lote avança por conta própria; a tela acompanha pelo estado gravado. Em hospedagem serverless o limite de duração da função se aplica (ver ADR-032). */
export async function startBatchAction(_p: FactoryState, fd: FormData): Promise<FactoryState> {
  const id = String(fd.get("id") ?? ""); if (!UUID.test(id)) return { error: "Lote inválido." };
  const c = await actionContext("factory-start");
  if (!c.ok) return { error: c.message };
  try {
    const env = { ...(await pipelineEnvFor(c.ctx)), mode: "real" as const }; const reprocess = fd.get("reprocess") === "on";
    // valida o modo ANTES de responder (a execução em segundo plano não pode mais devolver o erro)
    const b = await withTenant(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, (db) => factory.getBatchView(db, id));
    if (!b) return { error: "Lote não encontrado." };
    if (b.batch.mode !== env.mode) return { error: `Este lote foi planejado como ${b.batch.mode === "test_simulation" ? "SIMULAÇÃO DE TESTE" : "execução real"} e não pode ser iniciado ou retomado por esta tela (modo ${env.mode}). Simulação e execução real não se misturam.` };
    after(async () => { try { await factory.runBatch(env, id, { reprocessAwaiting: reprocess }); } catch (e) { explainFailure("factory-run-batch", e); } });
    revalidatePath("/engine", "layout");
    return { ok: "Execução iniciada em segundo plano. Esta tela acompanha o estado gravado.", href: `/engine/batches/${id}` };
  } catch (e) { return { error: explainFailure("factory-start", e) }; }
}
export async function cancelBatchAction(_p: FactoryState, fd: FormData): Promise<FactoryState> {
  const id = String(fd.get("id") ?? ""); if (!UUID.test(id)) return { error: "Lote inválido." };
  const c = await actionContext("factory-cancel");
  if (!c.ok) return { error: c.message };
  try { const ok = await factory.requestBatchCancel(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, id); revalidatePath("/engine", "layout"); return ok ? { ok: "Cancelamento pedido: o item em curso termina e nenhum novo começa." } : { error: "O lote não está confirmado nem em execução." }; }
  catch (e) { return { error: explainFailure("factory-cancel", e) }; }
}

export async function createDeploymentAction(_p: FactoryState, fd: FormData): Promise<FactoryState> {
  const list2 = ids(fd); const target = String(fd.get("target") ?? "preview") === "production" ? "production" : "preview";
  if (list2.length === 0) return { error: "Selecione ao menos uma página aprovada." };
  if (fd.get("confirm") !== "on") return { error: "Confirme o destino e as páginas antes de enviar." };
  const c = await actionContext("factory-deploy");
  if (!c.ok) return { error: c.message };
  try {
    const r = await factory.createDeployment(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, { env: process.env as factory.VercelEnv, fetch: realFetch }, { opportunityIds: list2, target, ...(target === "production" ? { authorization: { phrase: String(fd.get("phrase") ?? ""), reason: String(fd.get("reason") ?? "") } } : {}) });
    revalidatePath("/engine", "layout");
    if (r.state === "provider_not_configured") return { error: `Integração com a Vercel não configurada: faltam ${r.missing.join(", ")}. Nada foi criado.` };
    if (r.state === "refused") return { error: r.reasons.join(" · ") };
    if (r.state === "provider_error") return { error: `A Vercel recusou: ${r.message}`, href: `/engine/deployments/${r.deployment.id}` };
    return { ok: r.reused ? "Já existia um deployment com exatamente estas versões; nada foi reenviado." : "Deployment solicitado (QUEUED). Aceite pela Vercel não é sucesso: acompanhe o estado.", href: `/engine/deployments/${r.deployment.id}` };
  } catch (e) { return { error: explainFailure("factory-deploy", e) }; }
}
export async function refreshDeploymentAction(_p: FactoryState, fd: FormData): Promise<FactoryState> {
  const id = String(fd.get("id") ?? ""); if (!UUID.test(id)) return { error: "Deployment inválido." };
  const c = await actionContext("factory-refresh");
  if (!c.ok) return { error: c.message };
  try {
    const r = await factory.refreshDeployment(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, { env: process.env as factory.VercelEnv, fetch: realFetch }, id); revalidatePath("/engine", "layout");
    if ("state" in r) return { error: r.state === "not_found" ? "Deployment não encontrado." : `Integração não configurada: faltam ${r.missing.join(", ")}.` };
    return { ok: r.changed ? `Estado atualizado: ${r.deployment.status}.` : `Sem mudança no provedor (${r.deployment.status}).` };
  } catch (e) { return { error: explainFailure("factory-refresh", e) }; }
}
export async function verifyDeploymentAction(_p: FactoryState, fd: FormData): Promise<FactoryState> {
  const id = String(fd.get("id") ?? ""); if (!UUID.test(id)) return { error: "Deployment inválido." };
  const c = await actionContext("factory-verify");
  if (!c.ok) return { error: c.message };
  try { const r = await factory.verifyDeployment(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, { fetch: realFetch }, id); revalidatePath("/engine", "layout"); return r.verified ? { ok: `Verificado: ${r.results.length} URL(s) responderam 200 com o conteúdo esperado.` } : { error: `Não verificado: ${r.results.filter((x) => !x.ok).map((x) => `${x.path} (${x.reason})`).slice(0, 5).join("; ")}` }; }
  catch (e) { if (e instanceof factory.DeploymentError) return { error: e.message }; return { error: explainFailure("factory-verify", e) }; }
}

/** Recalcula o grafo de links e o Quality Gate de arquitetura de todas as páginas com recipe. Não gera, não aprova e não publica: só registra um novo resultado quando algo mudou. */
export async function analyzeArchitectureAction(_p: FactoryState, _fd: FormData): Promise<FactoryState> {
  const c = await actionContext("architecture-analyze");
  if (!c.ok) return { error: c.message };
  try {
    const r = await architecture.analyzeArchitecture(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, ARCH_DEPS);
    revalidatePath("/engine", "layout");
    return { ok: `${r.analyses.length} página(s) analisada(s): ${r.created} resultado(s) novo(s), ${r.unchanged} sem mudança; grafo com ${r.graph.edges} aresta(s) (${r.graph.valid} válidas, ${r.graph.invalid} inválidas)${r.skipped.length ? `; ${r.skipped.length} fora do escopo (sem archetype ou blueprint)` : ""}.` };
  } catch (e) { return { error: e instanceof architecture.ArchitectureError ? e.message : explainFailure("architecture-analyze", e) }; }
}

/** Mínimo de inlinks contextuais válidos por página (padrão 3). Cria uma nova versão da política, com autor e motivo na auditoria; não cria exceções. */
export async function setMinInlinksAction(_p: FactoryState, fd: FormData): Promise<FactoryState> {
  const min = Number.parseInt(String(fd.get("minInlinks") ?? ""), 10); const note = String(fd.get("note") ?? "");
  if (!Number.isInteger(min) || min < 1 || min > 20) return { error: "Informe um mínimo entre 1 e 20." };
  if (note.trim().length < 5) return { error: "Informe o motivo da alteração (mín. 5 caracteres)." };
  const c = await actionContext("architecture-link-policy");
  if (!c.ok) return { error: c.message };
  try {
    const cur = await withTenant(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, (db) => architecture.getLinkPolicy(db, c.ctx.identity.userId));
    const r = await architecture.setLinkPolicy(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, { ...cur.policy, minInlinks: min }, note);
    revalidatePath("/engine", "layout");
    return { ok: r.created ? `Política de links v${r.version}: mínimo de ${min} inlink(s). Rode "Reanalisar" para aplicar às páginas.` : `A política já exige ${min} inlink(s) (v${r.version}).` };
  } catch (e) { return { error: e instanceof architecture.ArchitectureError ? e.message : explainFailure("architecture-link-policy", e) }; }
}
