import { createHash } from "node:crypto";
import type { TenantDb } from "../tenant-context";
import { allowedPlaceholders, agentDefinition } from "../agents/registry";
import type { AgentPrompts, ResolvedAgent } from "../agents/runner";

// Registro de prompts (por tenant e pacote de domínio): DRAFT → ACTIVE → DEPRECATED, sem sobrescrita silenciosa (corpo imutável; o mesmo corpo não duplica), uma ATIVA por (agente, pacote),
// rollback para a versão anterior, validação de placeholders e resultado de regressão gravado ANTES de ativar uma versão editada no Control Plane. O arquivo do pack continua sendo a origem versionada em git.
export class PromptRegistryError extends Error { constructor(message: string) { super(message); this.name = "PromptRegistryError"; } }
export type PromptStatus = "DRAFT" | "ACTIVE" | "DEPRECATED";
export interface PromptVersionRecord { readonly id: string; readonly agent: number; readonly domainPackId: string; readonly version: string; readonly status: PromptStatus; readonly body: string; readonly bodySha256: string; readonly placeholders: readonly string[]; readonly source: "file" | "control_plane"; readonly changeLog: string; readonly regression: PromptRegression | null; readonly createdBy: string; readonly createdAt: Date; readonly activatedAt: Date | null; readonly deprecatedAt: Date | null }
/** Resultado de regressão: a versão foi rodada contra casos de referência (com LLM roteirizado ou real) e `passed` diz se pode ser ativada. */
export interface PromptRegression { readonly passed: boolean; readonly cases: number; readonly failures: readonly string[]; readonly mode: "real" | "test_simulation"; readonly ranAt: string }

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const placeholdersOf = (text: string): string[] => [...new Set([...text.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)].map((m) => m[1]!))].sort();

/** Placeholders desconhecidos reprovam (nada de variável sem valor em produção); a variável de entrada do próprio agente é obrigatória. */
export function validatePromptBody(agent: number, body: string): string[] {
  const e: string[] = []; const allowed = new Set(allowedPlaceholders(agent)); const found = placeholdersOf(body);
  if (body.trim() === "") e.push("o corpo do prompt está vazio");
  if (body.length > 60_000) e.push("o corpo do prompt passa de 60.000 caracteres");
  for (const p of found) if (!allowed.has(p)) e.push(`placeholder desconhecido: {{${p}}}`);
  if (!found.includes(agentDefinition(agent).inputVar)) e.push(`falta o placeholder de entrada {{${agentDefinition(agent).inputVar}}}`);
  return e;
}

interface Row { id: string; agent: number; domain_pack_id: string; version: string; status: PromptStatus; body: string; body_sha256: string; placeholders: string[]; source: "file" | "control_plane"; change_log: string; regression: PromptRegression | null; created_by: string; created_at: Date; activated_at: Date | null; deprecated_at: Date | null }
const COLS = "id, agent, domain_pack_id, version, status, body, body_sha256, placeholders, source, change_log, regression, created_by, created_at, activated_at, deprecated_at";
const toRec = (r: Row): PromptVersionRecord => ({ id: r.id, agent: r.agent, domainPackId: r.domain_pack_id, version: r.version, status: r.status, body: r.body, bodySha256: r.body_sha256, placeholders: r.placeholders, source: r.source, changeLog: r.change_log, regression: r.regression, createdBy: r.created_by, createdAt: r.created_at, activatedAt: r.activated_at, deprecatedAt: r.deprecated_at });

async function audit(db: TenantDb, a: { agent: number; pack: string; decision: string; reason: string; actor: string; ref: string }): Promise<void> {
  await db.query(`INSERT INTO plataforma.decision_audit (tenant_id, subject_kind, subject_ref, decision, decided_by, recommendation_applied, reason, created_by) VALUES (plataforma.current_tenant_id(), 'prompt', $1, $2, 'human', false, $3, $4)`, [`agent${a.agent}:${a.pack}:${a.ref}`.slice(0, 200), a.decision, a.reason.slice(0, 1000), a.actor]);
}

/** Registra uma versão como DRAFT. O mesmo corpo não é gravado duas vezes (devolve a existente); corpo inválido é recusado. */
export async function registerPrompt(db: TenantDb, a: { agent: number; domainPackId: string; body: string; header: string; source: "file" | "control_plane"; changeLog: string; actor: string; version?: string }): Promise<{ record: PromptVersionRecord; created: boolean }> {
  const errors = validatePromptBody(a.agent, a.body); if (errors.length > 0) throw new PromptRegistryError(`prompt inválido: ${errors.join("; ")}`);
  const bodySha = sha(a.body); const version = a.version ?? `${a.source === "file" ? "file" : "cp"}-${bodySha.slice(0, 12)}`;
  const ins = await db.query<Row>(`INSERT INTO plataforma.prompt_version (tenant_id, agent, domain_pack_id, version, status, body, body_sha256, header_sha256, placeholders, source, change_log, created_by) VALUES (plataforma.current_tenant_id(), $1, $2, $3, 'DRAFT', $4, $5, $6, $7::jsonb, $8, $9, $10) ON CONFLICT (tenant_id, agent, domain_pack_id, body_sha256) DO NOTHING RETURNING ${COLS}`,
    [a.agent, a.domainPackId, version, a.body, bodySha, sha(a.header), JSON.stringify(placeholdersOf(a.body)), a.source, a.changeLog, a.actor]);
  if (ins.rows[0]) { await audit(db, { agent: a.agent, pack: a.domainPackId, decision: "PROMPT_REGISTERED", reason: a.changeLog, actor: a.actor, ref: version }); return { record: toRec(ins.rows[0]), created: true }; }
  return { record: toRec((await db.query<Row>(`SELECT ${COLS} FROM plataforma.prompt_version WHERE agent = $1 AND domain_pack_id = $2 AND body_sha256 = $3`, [a.agent, a.domainPackId, bodySha])).rows[0]!), created: false };
}

export async function recordRegression(db: TenantDb, id: string, r: PromptRegression): Promise<void> {
  const n = (await db.query<{ id: string }>(`UPDATE plataforma.prompt_version SET regression = $2::jsonb WHERE id = $1 RETURNING id`, [id, JSON.stringify(r)])).rows.length;
  if (n === 0) throw new PromptRegistryError("versão de prompt não encontrada");
}

/** Ativa uma versão (a ATIVA anterior vira DEPRECATED, na mesma transação). Versão editada no Control Plane exige regressão aprovada. */
export async function activatePrompt(db: TenantDb, id: string, actor: string): Promise<PromptVersionRecord> {
  const v = (await db.query<Row>(`SELECT ${COLS} FROM plataforma.prompt_version WHERE id = $1 FOR UPDATE`, [id])).rows[0]; if (!v) throw new PromptRegistryError("versão de prompt não encontrada");
  if (v.status === "ACTIVE") return toRec(v);
  if (v.source === "control_plane" && v.regression?.passed !== true) throw new PromptRegistryError("versão editada no Control Plane só ativa com regressão aprovada registrada");
  await db.query(`UPDATE plataforma.prompt_version SET status = 'DEPRECATED' WHERE agent = $1 AND domain_pack_id = $2 AND status = 'ACTIVE'`, [v.agent, v.domain_pack_id]);
  const up = (await db.query<Row>(`UPDATE plataforma.prompt_version SET status = 'ACTIVE' WHERE id = $1 RETURNING ${COLS}`, [id])).rows[0]!;
  await audit(db, { agent: v.agent, pack: v.domain_pack_id, decision: "PROMPT_ACTIVATED", reason: `ativada ${v.version}`, actor, ref: v.version });
  return toRec(up);
}

export async function deprecatePrompt(db: TenantDb, id: string, actor: string): Promise<void> {
  const v = (await db.query<Row>(`SELECT ${COLS} FROM plataforma.prompt_version WHERE id = $1 FOR UPDATE`, [id])).rows[0]; if (!v) throw new PromptRegistryError("versão de prompt não encontrada");
  if (v.status === "ACTIVE") throw new PromptRegistryError("a versão ATIVA não é descontinuada diretamente: ative outra ou faça rollback");
  await db.query(`UPDATE plataforma.prompt_version SET status = 'DEPRECATED' WHERE id = $1 AND status <> 'DEPRECATED'`, [id]);
  await audit(db, { agent: v.agent, pack: v.domain_pack_id, decision: "PROMPT_DEPRECATED", reason: `descontinuada ${v.version}`, actor, ref: v.version });
}

/** Rollback: volta para a versão substituída mais recentemente (a ATIVA atual vira DEPRECATED). */
export async function rollbackPrompt(db: TenantDb, agent: number, domainPackId: string, actor: string): Promise<PromptVersionRecord> {
  const cur = (await db.query<Row>(`SELECT ${COLS} FROM plataforma.prompt_version WHERE agent = $1 AND domain_pack_id = $2 AND status = 'ACTIVE' FOR UPDATE`, [agent, domainPackId])).rows[0];
  const prev = (await db.query<Row>(`SELECT ${COLS} FROM plataforma.prompt_version WHERE agent = $1 AND domain_pack_id = $2 AND status = 'DEPRECATED' AND ($3::uuid IS NULL OR id <> $3) AND activated_at IS NOT NULL ORDER BY deprecated_at DESC NULLS LAST LIMIT 1`, [agent, domainPackId, cur?.id ?? null])).rows[0];
  if (!prev) throw new PromptRegistryError("não há versão anterior para o rollback");
  if (cur) await db.query(`UPDATE plataforma.prompt_version SET status = 'DEPRECATED' WHERE id = $1`, [cur.id]);
  const up = (await db.query<Row>(`UPDATE plataforma.prompt_version SET status = 'ACTIVE' WHERE id = $1 RETURNING ${COLS}`, [prev.id])).rows[0]!;
  await audit(db, { agent, pack: domainPackId, decision: "PROMPT_ROLLBACK", reason: `rollback de ${cur?.version ?? "—"} para ${prev.version}`, actor, ref: prev.version });
  return toRec(up);
}

export async function listPromptVersions(db: TenantDb, f: { agent?: number; domainPackId?: string } = {}): Promise<PromptVersionRecord[]> {
  return (await db.query<Row>(`SELECT ${COLS} FROM plataforma.prompt_version WHERE ($1::int IS NULL OR agent = $1) AND ($2::text IS NULL OR domain_pack_id = $2) ORDER BY agent, created_at DESC, id`, [f.agent ?? null, f.domainPackId ?? null])).rows.map(toRec);
}

/** Semeia o registro com os prompts do arquivo do pack: cada agente sem versão ATIVA recebe a versão do arquivo como ATIVA (idempotente; nunca sobrescreve uma ativa existente). */
export async function seedFilePrompts(db: TenantDb, domainPackId: string, prompts: AgentPrompts, actor: string): Promise<{ seeded: number; kept: number }> {
  let seeded = 0; let kept = 0;
  for (const [k, p] of Object.entries(prompts.agents)) {
    const agent = Number(k);
    const active = (await db.query<{ id: string }>(`SELECT id FROM plataforma.prompt_version WHERE agent = $1 AND domain_pack_id = $2 AND status = 'ACTIVE'`, [agent, domainPackId])).rows[0];
    if (active) { kept += 1; continue; }
    const { record } = await registerPrompt(db, { agent, domainPackId, body: p.body, header: prompts.header, source: "file", changeLog: `arquivo do pack (sha256 ${prompts.sourceSha256.slice(0, 12)})`, actor });
    await activatePrompt(db, record.id, actor); seeded += 1;
  }
  return { seeded, kept };
}

export interface ResolvedPrompts { readonly byAgent: ReadonlyMap<number, { readonly name: string; readonly body: string; readonly promptVersion: string; readonly promptVersionId: string | null; readonly source: "registry" | "file" }> }
/** Resolve, por agente, a versão ATIVA do tenant/pacote; sem ela cai para o arquivo do pack (e isso fica visível como source = file). */
export async function resolvePrompts(db: TenantDb, domainPackId: string, fallback: AgentPrompts): Promise<ResolvedPrompts> {
  const rows = (await db.query<Row>(`SELECT ${COLS} FROM plataforma.prompt_version WHERE domain_pack_id = $1 AND status = 'ACTIVE'`, [domainPackId])).rows;
  const by = new Map<number, ResolvedPrompts["byAgent"] extends ReadonlyMap<number, infer V> ? V : never>();
  for (const [k, p] of Object.entries(fallback.agents)) {
    const row = rows.find((r) => r.agent === Number(k));
    by.set(Number(k), row ? { name: p.name, body: row.body, promptVersion: row.version, promptVersionId: row.id, source: "registry" } : { name: p.name, body: p.body, promptVersion: fallback.version, promptVersionId: null, source: "file" });
  }
  return { byAgent: by };
}

/** Monta o resolvedor por agente que o runner usa: prompt resolvido + tempo-limite e retentativas da definição do agente. */
export function agentResolver(resolved: ResolvedPrompts): (agent: number) => ResolvedAgent | null {
  return (agent) => { const p = resolved.byAgent.get(agent); if (!p) return null; const d = agentDefinition(agent); return { name: p.name, body: p.body, promptVersion: p.promptVersion, promptVersionId: p.promptVersionId, timeoutMs: d.timeoutMs, maxRetries: d.maxRetries }; };
}
