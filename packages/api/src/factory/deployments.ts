import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { FetchLike } from "../engine/http";
import type { VerifiedIdentity } from "../identity";
import { recordDecision } from "../runtime/decision-audit";
import { listRecipes } from "../qa/store";
import { withTenant, type PoolLike, type TenantDb } from "../tenant-context";
import { renderRecipeDocument } from "./render";

// Deployment Center: adaptador DESACOPLADO da Vercel + registro dos deployments. Regras: (1) só entra em deployment página com aprovação humana VIGENTE da versão mais recente do recipe e QA_PASSED dessa versão;
// (2) produção exige autorização explícita registrada, preview é o padrão; (3) "a API aceitou" NÃO é sucesso: o estado vem do provedor (readyState) e só vira VERIFIED depois que as URLs respondem;
// (4) idempotência por chave derivada das versões de recipe + destino. As respostas da Vercel abaixo seguem a documentação pública da API v13; nenhuma foi capturada de uma conta real (a conta não tem projeto).
export type DeploymentStatus = "QUEUED" | "BUILDING" | "READY" | "FAILED" | "CANCELED" | "VERIFICATION_PENDING" | "VERIFIED";
export const DEPLOYMENT_STATUSES: readonly DeploymentStatus[] = ["QUEUED", "BUILDING", "READY", "FAILED", "CANCELED", "VERIFICATION_PENDING", "VERIFIED"];
/** Mapeia o `readyState` da Vercel (QUEUED, INITIALIZING, BUILDING, READY, ERROR, CANCELED, DELETED) para o estado do sistema; estado desconhecido devolve null (nunca se adivinha). */
export function mapVercelState(s: string | null | undefined): DeploymentStatus | null {
  switch ((s ?? "").toUpperCase()) { case "QUEUED": return "QUEUED"; case "INITIALIZING": case "BUILDING": return "BUILDING"; case "READY": return "READY"; case "ERROR": return "FAILED"; case "CANCELED": case "DELETED": return "CANCELED"; default: return null; }
}
export interface VercelEnv { readonly VERCEL_TOKEN?: string; readonly VERCEL_PROJECT?: string; readonly VERCEL_TEAM_ID?: string; readonly VERCEL_WEBHOOK_SECRET?: string; readonly [k: string]: string | undefined }
export type VercelConfig = { readonly configured: true; readonly token: string; readonly project: string; readonly teamId: string | null } | { readonly configured: false; readonly missing: readonly string[] };
export function vercelConfig(env: VercelEnv): VercelConfig {
  const t = env.VERCEL_TOKEN?.trim(); const p = env.VERCEL_PROJECT?.trim(); const missing = [!t ? "VERCEL_TOKEN" : "", !p ? "VERCEL_PROJECT" : ""].filter(Boolean);
  return missing.length > 0 ? { configured: false, missing } : { configured: true, token: t!, project: p!, teamId: env.VERCEL_TEAM_ID?.trim() || null };
}
export class DeploymentError extends Error { constructor(message: string) { super(message); this.name = "DeploymentError"; } }
const API = "https://api.vercel.com";
const q = (c: { teamId: string | null }) => (c.teamId ? `?teamId=${encodeURIComponent(c.teamId)}` : "");

/** Gera os arquivos estáticos do deployment a partir dos recipes (MESMO renderer do preview, sem anotações). */
export function buildStaticFiles(pages: readonly { path: string; html: string }[]): { file: string; data: string; encoding: "utf-8" }[] {
  return [...pages].sort((a, b) => (a.path < b.path ? -1 : 1)).map((p) => ({ file: `${p.path.replace(/^\/+|\/+$/g, "")}/index.html`.replace(/^\//, ""), data: p.html, encoding: "utf-8" as const }));
}
export interface ProviderDeployment { readonly id: string; readonly url: string | null; readonly readyState: string | null; readonly errorMessage: string | null }
async function vercelFetch(fetchFn: FetchLike, cfg: Extract<VercelConfig, { configured: true }>, path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  const sep = path.includes("?") ? "&" : "?"; const url = `${API}${path}${cfg.teamId ? `${sep}teamId=${encodeURIComponent(cfg.teamId)}` : ""}`;
  const res = await fetchFn(url, { method: init.method ?? "GET", ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}), headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json", Accept: "application/json" } });
  let json: Record<string, unknown> = {}; try { json = JSON.parse(await res.text()) as Record<string, unknown>; } catch { /* corpo não-JSON: o status basta */ }
  return { status: res.status, json };
}
const errMsg = (j: Record<string, unknown>) => { const e = j.error as { message?: string; code?: string } | undefined; return e ? `${e.code ?? "erro"}: ${e.message ?? ""}`.slice(0, 300) : null; };
const toProv = (j: Record<string, unknown>): ProviderDeployment => ({ id: String(j.id ?? ""), url: typeof j.url === "string" ? `https://${j.url}` : null, readyState: typeof j.readyState === "string" ? j.readyState : typeof j.status === "string" ? j.status : null, errorMessage: typeof j.errorMessage === "string" ? j.errorMessage : null });
export async function vercelCreate(fetchFn: FetchLike, cfg: Extract<VercelConfig, { configured: true }>, a: { target: "preview" | "production"; files: { file: string; data: string; encoding: "utf-8" }[]; meta: Record<string, string> }): Promise<ProviderDeployment> {
  const r = await vercelFetch(fetchFn, cfg, "/v13/deployments?skipAutoDetectionConfirmation=1", { method: "POST", body: { name: cfg.project, project: cfg.project, files: a.files, target: a.target === "production" ? "production" : undefined, projectSettings: { framework: null }, meta: a.meta } });
  if (r.status < 200 || r.status >= 300) throw new DeploymentError(`a Vercel recusou a criação (HTTP ${r.status})${errMsg(r.json) ? `: ${errMsg(r.json)}` : ""}`);
  const d = toProv(r.json); if (!d.id) throw new DeploymentError("resposta da Vercel sem id de deployment"); return d;
}
export async function vercelGet(fetchFn: FetchLike, cfg: Extract<VercelConfig, { configured: true }>, id: string): Promise<ProviderDeployment> {
  const r = await vercelFetch(fetchFn, cfg, `/v13/deployments/${encodeURIComponent(id)}`);
  if (r.status < 200 || r.status >= 300) throw new DeploymentError(`consulta à Vercel falhou (HTTP ${r.status})${errMsg(r.json) ? `: ${errMsg(r.json)}` : ""}`);
  return toProv(r.json);
}
/** Assinatura do webhook da Vercel (HMAC-SHA1 do corpo bruto no cabeçalho x-vercel-signature), comparada em tempo constante. */
export function verifyVercelSignature(rawBody: string, header: string | null | undefined, secret: string): boolean {
  if (!header || !secret) return false; const exp = createHmac("sha1", secret).update(rawBody).digest("hex"); const a = Buffer.from(exp); const b = Buffer.from(header.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}
/** Evento de webhook → estado (deployment.created/ready/error/canceled). Evento desconhecido = null. */
export function statusFromWebhook(type: string): DeploymentStatus | null { return ({ "deployment.created": "QUEUED", "deployment.ready": "READY", "deployment.succeeded": "READY", "deployment.error": "FAILED", "deployment.canceled": "CANCELED" } as Record<string, DeploymentStatus>)[type] ?? null; }

export interface DeploymentRecord { readonly id: string; readonly provider: "vercel"; readonly projectRef: string; readonly target: "preview" | "production"; readonly status: DeploymentStatus; readonly providerDeploymentId: string | null; readonly url: string | null; readonly gitBranch: string | null; readonly gitCommit: string | null; readonly batchId: string | null; readonly authorizedBy: string | null; readonly error: string | null; readonly createdBy: string; readonly createdAt: Date; readonly updatedAt: Date; readonly pages: number }
interface Row { id: string; provider: "vercel"; project_ref: string; target: "preview" | "production"; status: DeploymentStatus; provider_deployment_id: string | null; url: string | null; git_branch: string | null; git_commit: string | null; batch_id: string | null; authorized_by: string | null; error: string | null; created_by: string; created_at: Date; updated_at: Date; pages: string }
const COLS = "id, provider, project_ref, target, status, provider_deployment_id, url, git_branch, git_commit, batch_id, authorized_by, error, created_by, created_at, updated_at, (SELECT count(*) FROM plataforma.deployment_page p WHERE p.deployment_id = d.id) AS pages";
const toRec = (r: Row): DeploymentRecord => ({ id: r.id, provider: r.provider, projectRef: r.project_ref, target: r.target, status: r.status, providerDeploymentId: r.provider_deployment_id, url: r.url, gitBranch: r.git_branch, gitCommit: r.git_commit, batchId: r.batch_id, authorizedBy: r.authorized_by, error: r.error, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, pages: Number(r.pages) });

async function setStatus(db: TenantDb, id: string, status: DeploymentStatus, o: { source: "request" | "poll" | "webhook" | "verification"; providerState?: string | null; url?: string | null; error?: string | null; detail?: Record<string, unknown>; providerId?: string | null }): Promise<void> {
  await db.query(`UPDATE plataforma.deployment SET status = $2, url = COALESCE($3, url), error = $4, provider_deployment_id = COALESCE($5, provider_deployment_id), updated_at = now() WHERE id = $1`, [id, status, o.url ?? null, o.error ?? null, o.providerId ?? null]);
  await db.query(`INSERT INTO plataforma.deployment_event (tenant_id, deployment_id, status, provider_state, source, detail) VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4, $5::jsonb)`, [id, status, o.providerState ?? null, o.source, JSON.stringify(o.detail ?? {})]);
}
export type CreateResult = { readonly state: "ok"; readonly deployment: DeploymentRecord; readonly reused: boolean } | { readonly state: "provider_not_configured"; readonly missing: readonly string[] } | { readonly state: "refused"; readonly reasons: readonly string[] } | { readonly state: "provider_error"; readonly message: string; readonly deployment: DeploymentRecord };
export interface CreateInput { readonly opportunityIds: readonly string[]; readonly target: "preview" | "production"; readonly batchId?: string; readonly authorization?: { readonly phrase: string; readonly reason: string }; readonly git?: { readonly branch?: string; readonly commit?: string } }

/** Cria um deployment: valida cada página (aprovação vigente + QA_PASSED da versão mais recente), registra ANTES de chamar a Vercel (QUEUED) e só depois atualiza com o que o provedor respondeu. */
export async function createDeployment(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, deps: { env: VercelEnv; fetch: FetchLike }, input: CreateInput): Promise<CreateResult> {
  const cfg = vercelConfig(deps.env); if (!cfg.configured) return { state: "provider_not_configured", missing: cfg.missing };
  const ids = [...new Set(input.opportunityIds)]; if (ids.length === 0 || ids.length > 500) return { state: "refused", reasons: ["selecione de 1 a 500 páginas"] };
  if (input.target === "production" && (input.authorization?.phrase.trim() !== "AUTORIZO PRODUÇÃO" || (input.authorization?.reason ?? "").trim().length < 10)) return { state: "refused", reasons: ["publicação em produção exige a frase AUTORIZO PRODUÇÃO e um motivo de ao menos 10 caracteres"] };
  const prep = await withTenant(pool, identity, tenantId, async (db) => {
    const reasons: string[] = []; const pages: { opportunityId: string; recipeId: string; path: string; html: string }[] = [];
    for (const id of ids) {
      const r = (await listRecipes(db, id))[0]; if (!r) { reasons.push(`${id}: sem recipe`); continue; }
      const st = (await db.query<{ q: string | null; qr: string | null; a: string | null }>(`SELECT (SELECT outcome FROM plataforma.qa_report WHERE opportunity_id = $1 ORDER BY seq DESC LIMIT 1) AS q, (SELECT recipe_id FROM plataforma.qa_report WHERE opportunity_id = $1 ORDER BY seq DESC LIMIT 1) AS qr, (SELECT decision FROM plataforma.page_approval WHERE recipe_id = $2 ORDER BY seq DESC LIMIT 1) AS a`, [id, r.id])).rows[0]!;
      if (st.qr !== r.id || st.q !== "QA_PASSED") reasons.push(`${r.recipe.url ?? id}: QA da versão ${r.version} não está aprovado`);
      else if (st.a !== "APPROVED") reasons.push(`${r.recipe.url ?? id}: sem aprovação humana vigente da versão ${r.version}`);
      else if (!r.recipe.url) reasons.push(`${id}: a página não tem URL definida`);
      else pages.push({ opportunityId: id, recipeId: r.id, path: r.recipe.url, html: renderRecipeDocument(r.recipe).html });
    }
    const dup = pages.map((p) => p.path).filter((p, i, a) => a.indexOf(p) !== i); if (dup.length) reasons.push(`URLs duplicadas no deployment: ${[...new Set(dup)].join(", ")}`);
    return { reasons, pages };
  });
  if (prep.reasons.length > 0) return { state: "refused", reasons: prep.reasons };
  const key = createHash("sha256").update(JSON.stringify([input.target, cfg.project, prep.pages.map((p) => p.recipeId).sort()])).digest("hex").slice(0, 40);
  const dep = await withTenant(pool, identity, tenantId, async (db) => {
    const ex = (await db.query<Row>(`SELECT ${COLS} FROM plataforma.deployment d WHERE idempotency_key = $1`, [key])).rows[0];
    if (ex) return { rec: toRec(ex), reused: true };
    const ins = (await db.query<Row>(`INSERT INTO plataforma.deployment AS d (tenant_id, provider, project_ref, target, status, batch_id, idempotency_key, git_branch, git_commit, authorized_by, authorization_reason, created_by)
      VALUES (plataforma.current_tenant_id(), 'vercel', $1, $2, 'QUEUED', $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLS.replace("(SELECT count(*) FROM plataforma.deployment_page p WHERE p.deployment_id = d.id)", "0")}`,
      [cfg.project, input.target, input.batchId ?? null, key, input.git?.branch ?? null, input.git?.commit ?? null, input.target === "production" ? identity.userId : null, input.target === "production" ? input.authorization!.reason.trim() : null, identity.userId])).rows[0]!;
    for (const p of prep.pages) await db.query(`INSERT INTO plataforma.deployment_page (tenant_id, deployment_id, opportunity_id, recipe_id, url_path) VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4)`, [ins.id, p.opportunityId, p.recipeId, p.path]);
    await db.query(`INSERT INTO plataforma.deployment_event (tenant_id, deployment_id, status, source, detail) VALUES (plataforma.current_tenant_id(), $1, 'QUEUED', 'request', $2::jsonb)`, [ins.id, JSON.stringify({ pages: prep.pages.length, target: input.target })]);
    await recordDecision(db, { subjectKind: "deployment", subjectRef: ins.id, decision: input.target === "production" ? "DEPLOY_PRODUCTION_REQUESTED" : "DEPLOY_PREVIEW_REQUESTED", decidedBy: "human", applied: true, reason: input.target === "production" ? input.authorization!.reason.trim() : `deployment de preview com ${prep.pages.length} página(s)`, actor: identity.userId });
    return { rec: toRec({ ...ins, pages: String(prep.pages.length) }), reused: false };
  });
  if (dep.reused) return { state: "ok", deployment: dep.rec, reused: true };
  try {
    const p = await vercelCreate(deps.fetch, cfg, { target: input.target, files: buildStaticFiles(prep.pages), meta: { plataformaDeployment: dep.rec.id } });
    const st = mapVercelState(p.readyState) ?? "QUEUED";
    const rec = await withTenant(pool, identity, tenantId, async (db) => { await setStatus(db, dep.rec.id, st, { source: "request", providerState: p.readyState, url: p.url, providerId: p.id, detail: { accepted: true, note: "aceito pela Vercel; ainda não é sucesso" } }); return toRec((await db.query<Row>(`SELECT ${COLS} FROM plataforma.deployment d WHERE id = $1`, [dep.rec.id])).rows[0]!); });
    return { state: "ok", deployment: rec, reused: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const rec = await withTenant(pool, identity, tenantId, async (db) => { await setStatus(db, dep.rec.id, "FAILED", { source: "request", error: msg.slice(0, 900), detail: { accepted: false } }); return toRec((await db.query<Row>(`SELECT ${COLS} FROM plataforma.deployment d WHERE id = $1`, [dep.rec.id])).rows[0]!); });
    return { state: "provider_error", message: msg, deployment: rec };
  }
}
/** Consulta o provedor e registra a transição (só grava quando o estado mudou). Estado final (FAILED, CANCELED, VERIFIED) não é reaberto. */
export async function refreshDeployment(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, deps: { env: VercelEnv; fetch: FetchLike }, deploymentId: string): Promise<{ deployment: DeploymentRecord; changed: boolean } | { state: "provider_not_configured"; missing: readonly string[] } | { state: "not_found" }> {
  const cfg = vercelConfig(deps.env); if (!cfg.configured) return { state: "provider_not_configured", missing: cfg.missing };
  const cur = await withTenant(pool, identity, tenantId, async (db) => (await db.query<Row>(`SELECT ${COLS} FROM plataforma.deployment d WHERE id = $1`, [deploymentId])).rows[0] ?? null);
  if (!cur) return { state: "not_found" };
  if (["FAILED", "CANCELED", "VERIFIED"].includes(cur.status) || !cur.provider_deployment_id) return { deployment: toRec(cur), changed: false };
  let p: ProviderDeployment;
  try { p = await vercelGet(deps.fetch, cfg, cur.provider_deployment_id); } catch (e) { return { deployment: toRec(cur), changed: false }; }
  const mapped = mapVercelState(p.readyState);
  if (mapped === null || mapped === cur.status || (cur.status === "VERIFICATION_PENDING" && mapped === "READY")) return { deployment: toRec(cur), changed: false };
  return withTenant(pool, identity, tenantId, async (db) => { await setStatus(db, deploymentId, mapped, { source: "poll", providerState: p.readyState, url: p.url, error: mapped === "FAILED" ? (p.errorMessage ?? "build falhou na Vercel") : null }); return { deployment: toRec((await db.query<Row>(`SELECT ${COLS} FROM plataforma.deployment d WHERE id = $1`, [deploymentId])).rows[0]!), changed: true }; });
}
/** Verificação pós-deploy: cada URL do deployment precisa responder 200 com o <h1> esperado. Só então vira VERIFIED; senão fica VERIFICATION_PENDING com o motivo registrado. */
export async function verifyDeployment(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, deps: { fetch: FetchLike }, deploymentId: string): Promise<{ deployment: DeploymentRecord; verified: boolean; results: readonly { path: string; httpStatus: number | null; ok: boolean; reason: string | null }[] }> {
  const ctx = await withTenant(pool, identity, tenantId, async (db) => {
    const d = (await db.query<Row>(`SELECT ${COLS} FROM plataforma.deployment d WHERE id = $1`, [deploymentId])).rows[0]; if (!d) throw new DeploymentError("deployment não encontrado");
    if (!["READY", "VERIFICATION_PENDING", "VERIFIED"].includes(d.status)) throw new DeploymentError(`o deployment está ${d.status}: só se verifica um deployment pronto`);
    if (!d.url) throw new DeploymentError("o deployment não tem URL");
    const pages = (await db.query<{ id: string; url_path: string; recipe_id: string }>(`SELECT id, url_path, recipe_id FROM plataforma.deployment_page WHERE deployment_id = $1 ORDER BY url_path`, [deploymentId])).rows;
    const h1s = new Map<string, string>(); for (const p of pages) h1s.set(p.id, (await db.query<{ h1: string }>(`SELECT content ->> 'h1' AS h1 FROM plataforma.page_recipe WHERE id = $1`, [p.recipe_id])).rows[0]?.h1 ?? "");
    if (d.status === "READY") await setStatus(db, deploymentId, "VERIFICATION_PENDING", { source: "verification", detail: { pages: pages.length } });
    return { url: d.url, pages, h1s };
  });
  const results: { path: string; httpStatus: number | null; ok: boolean; reason: string | null; id: string }[] = [];
  for (const p of ctx.pages) {
    try { const res = await deps.fetch(`${ctx.url}${p.url_path}`, { method: "GET", headers: { Accept: "text/html" } }); const text = await res.text(); const h1 = ctx.h1s.get(p.id) ?? "";
      const ok = res.status === 200 && h1 !== "" && text.includes(`<h1>${h1.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")}</h1>`);
      results.push({ id: p.id, path: p.url_path, httpStatus: res.status, ok, reason: ok ? null : res.status !== 200 ? `HTTP ${res.status}` : "o conteúdo esperado (h1) não está na resposta" });
    } catch (e) { results.push({ id: p.id, path: p.url_path, httpStatus: null, ok: false, reason: `sem resposta: ${e instanceof Error ? e.name : "erro"}` }); }
  }
  const verified = results.length > 0 && results.every((r) => r.ok);
  const rec = await withTenant(pool, identity, tenantId, async (db) => {
    for (const r of results) await db.query(`UPDATE plataforma.deployment_page SET http_status = $2, verified_at = CASE WHEN $3 THEN now() ELSE NULL END WHERE id = $1`, [r.id, r.httpStatus, r.ok]);
    await setStatus(db, deploymentId, verified ? "VERIFIED" : "VERIFICATION_PENDING", { source: "verification", error: verified ? null : `${results.filter((r) => !r.ok).length} URL(s) não passaram na verificação`, detail: { ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).map((r) => ({ path: r.path, reason: r.reason })).slice(0, 20) } });
    await recordDecision(db, { subjectKind: "deployment", subjectRef: deploymentId, decision: verified ? "DEPLOY_VERIFIED" : "DEPLOY_VERIFICATION_FAILED", decidedBy: "code", applied: true, reason: verified ? `${results.length} URL(s) responderam 200 com o conteúdo esperado` : `${results.filter((r) => !r.ok).length} de ${results.length} URL(s) falharam`, actor: identity.userId });
    return toRec((await db.query<Row>(`SELECT ${COLS} FROM plataforma.deployment d WHERE id = $1`, [deploymentId])).rows[0]!);
  });
  return { deployment: rec, verified, results: results.map(({ id: _id, ...r }) => r) };
}
export async function listDeployments(db: TenantDb, f: { status?: string; limit?: number } = {}): Promise<{ total: number; byStatus: Record<string, number>; rows: DeploymentRecord[] }> {
  const rows = (await db.query<Row>(`SELECT ${COLS} FROM plataforma.deployment d WHERE ($1::text IS NULL OR status = $1) ORDER BY seq DESC LIMIT $2`, [f.status ?? null, Math.min(f.limit ?? 50, 200)])).rows.map(toRec);
  const by = (await db.query<{ status: string; n: string }>(`SELECT status, count(*) AS n FROM plataforma.deployment GROUP BY status`)).rows; const byStatus = Object.fromEntries(by.map((r) => [r.status, Number(r.n)]));
  return { total: Object.values(byStatus).reduce((s, n) => s + n, 0), byStatus, rows };
}
export async function getDeployment(db: TenantDb, id: string): Promise<{ deployment: DeploymentRecord; events: { status: DeploymentStatus; providerState: string | null; source: string; detail: Record<string, unknown>; at: Date }[]; pages: { opportunityId: string; recipeId: string; path: string; httpStatus: number | null; verifiedAt: Date | null }[] } | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const d = (await db.query<Row>(`SELECT ${COLS} FROM plataforma.deployment d WHERE id = $1`, [id])).rows[0]; if (!d) return null;
  const ev = (await db.query<{ status: DeploymentStatus; provider_state: string | null; source: string; detail: Record<string, unknown>; created_at: Date }>(`SELECT status, provider_state, source, detail, created_at FROM plataforma.deployment_event WHERE deployment_id = $1 ORDER BY seq DESC LIMIT 100`, [id])).rows;
  const pg = (await db.query<{ opportunity_id: string; recipe_id: string; url_path: string; http_status: number | null; verified_at: Date | null }>(`SELECT opportunity_id, recipe_id, url_path, http_status, verified_at FROM plataforma.deployment_page WHERE deployment_id = $1 ORDER BY url_path LIMIT 500`, [id])).rows;
  return { deployment: toRec(d), events: ev.map((e) => ({ status: e.status, providerState: e.provider_state, source: e.source, detail: e.detail, at: e.created_at })), pages: pg.map((p) => ({ opportunityId: p.opportunity_id, recipeId: p.recipe_id, path: p.url_path, httpStatus: p.http_status, verifiedAt: p.verified_at })) };
}

/** Deployments em que UMA página entrou (histórico de publicação da página, com a versão do recipe). */
export async function listPageDeployments(db: TenantDb, opportunityId: string): Promise<{ deploymentId: string; target: "preview" | "production"; status: DeploymentStatus; url: string | null; recipeVersion: number; path: string; httpStatus: number | null; verifiedAt: Date | null; createdAt: Date }[]> {
  return (await db.query<{ id: string; target: "preview" | "production"; status: DeploymentStatus; url: string | null; version: number; url_path: string; http_status: number | null; verified_at: Date | null; created_at: Date }>(`SELECT d.id, d.target, d.status, d.url, r.version, dp.url_path, dp.http_status, dp.verified_at, d.created_at FROM plataforma.deployment_page dp JOIN plataforma.deployment d ON d.id = dp.deployment_id AND d.tenant_id = dp.tenant_id JOIN plataforma.page_recipe r ON r.id = dp.recipe_id AND r.tenant_id = dp.tenant_id WHERE dp.opportunity_id = $1 ORDER BY d.seq DESC LIMIT 50`, [opportunityId])).rows.map((r) => ({ deploymentId: r.id, target: r.target, status: r.status, url: r.url, recipeVersion: r.version, path: r.url_path, httpStatus: r.http_status, verifiedAt: r.verified_at, createdAt: r.created_at }));
}
