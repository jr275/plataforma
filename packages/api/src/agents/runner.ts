import { createHash, randomUUID } from "node:crypto";
import { agentDefinition } from "./registry";
import type { z } from "zod";
import { extractJson } from "../provider/llm";
import { missingEnv, type EnvLike } from "../provider/contract";
import { publicJson, type PublicCtx } from "../provider/public";
import { ProviderCallError, callProvider, type Fetched } from "../provider/store";
import type { RunBudget } from "../provider/budget";
import type { TenantDb } from "../tenant-context";

// Runner dos agentes (spec seção 14): entrada e saída JSON com esquema validado; saída inválida → nova tentativa (máximo 2, com os erros devolvidos ao modelo) e depois falha EXPLÍCITA.
// Cada execução grava o prompt (versão e sha), o modelo, a entrada, a saída, as tentativas, os erros e os tokens em `agent_run`. O agente nunca decide: o código valida e aplica.
// Sem ANTHROPIC_API_KEY o estado é `not_configured` (registrado, nada é inventado). Nenhum acesso à web: o agente só recebe o recorte de dados do INPUT.
export interface AgentPrompts { readonly version: string; readonly sourceSha256: string; readonly header: string; readonly agents: Readonly<Record<number, { readonly name: string; readonly body: string }>> }
/** Contexto de execução que o runtime injeta no cabeçalho de TODOS os agentes (valores sanitizados; só estas chaves existem). */
export interface RuntimeContext {
  readonly tenantId: string; readonly tenantName: string; readonly domainPackId: string; readonly domainPackVersion: string;
  /** Resolução POR AGENTE (registro de prompts + definição): versão/corpo do prompt, tempo-limite e retentativas. Sem ela vale ctx.prompts. */
  readonly resolve?: (agent: number) => ResolvedAgent | null;
  /** Retentativa de falha transitória (limite de taxa, rede, 5xx, tempo): espera injetável para os testes. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly backoffMs?: (retry: number) => number;
  /** Cancelamento cooperativo: consultado antes de cada chamada ao modelo. */
  readonly isCancelled?: () => boolean;
  /** Proteção contra laço: teto de chamadas ao modelo por execução do pipeline. */
  readonly guard?: CallGuard;
  /** Rastreio herdado por TODA chamada feita com este contexto (inclusive as feitas dentro de stores). */
  readonly trace?: AgentTrace;
}
export interface ResolvedAgent { readonly name: string; readonly body: string; readonly promptVersion: string; readonly promptVersionId: string | null; readonly timeoutMs: number; readonly maxRetries: number }
export class CallGuard { private used = 0; constructor(readonly max: number) {} take(): boolean { if (this.used >= this.max) return false; this.used += 1; return true; } get calls(): number { return this.used; } }
export interface AgentCtx extends PublicCtx { readonly runtime?: RuntimeContext; readonly env: EnvLike; /** Id da versão de prompt do registro (quando resolvida do banco). */ readonly promptVersionId?: string | null; readonly prompts: AgentPrompts; readonly vars: Readonly<Record<string, string>> }
/** Rastreio da execução (Runtime Execution Service): liga cada chamada ao pipeline e ao id de correlação. */
export interface AgentTrace { readonly pipelineRunId: string | null; readonly correlationId: string | null }
export interface AgentBase { readonly trace?: AgentTrace; readonly db: TenantDb; readonly budget: RunBudget; readonly runId: string | null; readonly actor: string; readonly now: () => Date }
export interface AgentSpec<T> {
  readonly agent: number;
  /** Nome da variável do prompt que recebe o JSON de entrada (ex.: ELIGIBILITY_DECISION_JSON). */ readonly inputVar: string;
  readonly schema: z.ZodType<T>;
  /** Validação do CÓDIGO além do esquema (ex.: o que o agente não pode alterar). Devolve a lista de erros. */ readonly validate?: (out: T) => string[];
  readonly extraVars?: Readonly<Record<string, string>>;
}
export type AgentResult<T> =
  | { readonly state: "ok"; readonly data: T; readonly agentRunId: string; readonly attempts: number }
  | { readonly state: "provider_not_configured"; readonly missing: readonly string[]; readonly agentRunId: string }
  | { readonly state: "failed"; readonly errors: readonly string[]; readonly attempts: number; readonly agentRunId: string; readonly failure: AgentFailure };
/** Classe da falha: saída inválida (tentativas de correção esgotadas), tempo, limite de taxa, transitória (rede/5xx), orçamento ou permanente (credencial/rejeição). */
export type FailureKind = "invalid_output" | "timeout" | "rate_limited" | "transient" | "budget" | "permanent" | "cancelled" | "loop_guard";
export interface AgentFailure { readonly kind: FailureKind; readonly retryable: boolean }

/** Valor seguro para o prompt: sem quebras de linha/controle, sem chaves de template (nada é reexpandido) e com tamanho limitado. */
export function safeValue(v: string, max = 100): string { return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[{}]/g, "").replace(/\s+/g, " ").trim().slice(0, max); }
/** Bloco de contexto versionado e explícito (não depende do corpo do prompt do tenant): quem, qual pacote, qual prompt, quais contratos, qual execução. */
export function renderContextBlock(c: { runtime: RuntimeContext; agent: number; promptVersion: string; executionId: string; correlationId: string | null }): string {
  const d = agentDefinition(c.agent);
  return ["CONTEXTO DE EXECUÇÃO (gerado pelo runtime; não é entrada do usuário)", `tenant_id: ${safeValue(c.runtime.tenantId)}`, `tenant_name: ${safeValue(c.runtime.tenantName)}`, `domain_pack_id: ${safeValue(c.runtime.domainPackId)}`, `domain_pack_version: ${safeValue(c.runtime.domainPackVersion)}`, `agent: ${d.slug}`, `prompt_version: ${safeValue(c.promptVersion)}`, `input_schema_version: ${d.inputSchemaVersion}`, `output_schema_version: ${d.outputSchemaVersion}`, `execution_id: ${c.executionId}`, `correlation_id: ${safeValue(c.correlationId ?? "-")}`].join("\n");
}

export class PromptError extends Error { constructor(message: string) { super(message); this.name = "PromptError"; } }
/** Preenche {{VAR}}; QUALQUER variável sem valor lança (nunca se envia um prompt com placeholder cru). */
export function fillTemplate(text: string, vars: Readonly<Record<string, string>>): string {
  const missing = new Set<string>();
  const out = text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, k: string) => { const v = vars[k]; if (v === undefined) { missing.add(k); return ""; } return v; });
  if (missing.size > 0) throw new PromptError(`variáveis do prompt sem valor: ${[...missing].join(", ")}`);
  return out;
}
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const MAX_ATTEMPTS = 3;
export function classifyProviderFailure(code: string, retryable: boolean): AgentFailure {
  if (code === "timeout") return { kind: "timeout", retryable: true };
  if (code === "rate_limited") return { kind: "rate_limited", retryable: true };
  if (code === "budget_exceeded") return { kind: "budget", retryable: false };
  if (code === "network" || (code === "http" && retryable)) return { kind: "transient", retryable: true };
  return { kind: "permanent", retryable: false };
}
export const DEFAULT_AGENT_MODEL = "claude-sonnet-5-5";

export async function runAgent<T>(ctx: AgentCtx, base: AgentBase, spec: AgentSpec<T>, input: unknown, subject: { kind: string; ref: string }): Promise<AgentResult<T>> {
  const rp = ctx.runtime?.resolve?.(spec.agent) ?? null;
  const def = rp ? { name: rp.name, body: rp.body } : ctx.prompts.agents[spec.agent]; if (!def) throw new PromptError(`agente ${spec.agent} não existe no arquivo de prompts`);
  const promptVersion = rp?.promptVersion ?? ctx.prompts.version; const promptVersionId = rp ? rp.promptVersionId : ctx.promptVersionId ?? null;
  const net: AgentCtx = rp ? { ...ctx, timeoutMs: rp.timeoutMs } : ctx; const maxTransient = rp?.maxRetries ?? 0;
  const model = ctx.env.PLATAFORMA_AGENT_MODEL?.trim() || DEFAULT_AGENT_MODEL;
  const inputJson = JSON.stringify(input, null, 1);
  const executionId = randomUUID(); const t0 = Date.now();
  const header = fillTemplate(ctx.prompts.header, ctx.vars);
  const system = ctx.runtime ? `${header}\n\n${renderContextBlock({ runtime: ctx.runtime, agent: spec.agent, promptVersion, executionId, correlationId: (base.trace ?? ctx.runtime?.trace)?.correlationId ?? null })}` : header;
  const user = fillTemplate(def.body, { ...ctx.vars, ...(spec.extraVars ?? {}), [spec.inputVar]: inputJson });
  const promptSha = sha(`${header}\n---\n${user.replace(inputJson, "")}`);
  const audit = async (o: { status: "succeeded" | "failed" | "invalid_output" | "timed_out" | "cancelled" | "not_configured"; attempts: number; output: unknown; errors: readonly string[]; usage: Record<string, unknown> }) => (await base.db.query<{ id: string }>(
    `INSERT INTO plataforma.agent_run (id, tenant_id, agent, agent_name, prompt_version, prompt_sha256, model, status, attempts, subject_kind, subject_ref, input, output, errors, usage, created_by, pipeline_run_id, correlation_id, prompt_version_id, duration_ms) VALUES ('${executionId}', plataforma.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15, $16, $17, $18) RETURNING id`,
    [spec.agent, def.name, promptVersion, promptSha, model, o.status, o.attempts, subject.kind, subject.ref, inputJson, o.output === null ? null : JSON.stringify(o.output), JSON.stringify(o.errors), JSON.stringify(o.usage), base.actor, (base.trace ?? ctx.runtime?.trace)?.pipelineRunId ?? null, (base.trace ?? ctx.runtime?.trace)?.correlationId ?? null, promptVersionId, Date.now() - t0])).rows[0]!.id;

  const missing = missingEnv(ctx.env, ["ANTHROPIC_API_KEY"]);
  if (missing.length > 0) return { state: "provider_not_configured", missing, agentRunId: await audit({ status: "not_configured", attempts: 0, output: null, errors: [`variáveis ausentes: ${missing.join(", ")}`], usage: {} }) };

  const baseUrl = (ctx.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com").replace(/\/+$/, "");
  const usage = { inputTokens: 0, outputTokens: 0 }; const allErrors: string[] = [];
  let prevBad: string | null = null; let prevErrors: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const messages = attempt === 1 ? [{ role: "user", content: user }] : [{ role: "user", content: user }, { role: "assistant", content: prevBad ?? "" }, { role: "user", content: `Sua saída anterior foi inválida: ${prevErrors.join("; ")}. Responda de novo somente com JSON válido no schema pedido, sem texto extra.` }];
    const body = { model, max_tokens: 4000, temperature: 0, system, messages };
    const params = { agent: spec.agent, model, promptVersion, attempt, inputSha: sha(inputJson), feedbackSha: attempt === 1 ? null : sha(prevErrors.join("|") + (prevBad ?? "")) };
    let failure: string[] = []; let lastText = "";
    const fetchRaw = async (): Promise<Fetched> => {
      const f = await publicJson(net, `${baseUrl}/v1/messages`, { method: "POST", body: JSON.stringify(body), headers: { "x-api-key": ctx.env.ANTHROPIC_API_KEY!.trim(), "anthropic-version": "2023-06-01", "Content-Type": "application/json" } });
      const msg = f.body as { content?: { type?: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
      usage.inputTokens += msg.usage?.input_tokens ?? 0; usage.outputTokens += msg.usage?.output_tokens ?? 0;
      lastText = (msg.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      let json: unknown;
      try { json = extractJson(lastText); } catch { failure = ["a saída não contém um objeto JSON"]; throw new ProviderCallError("parse", "saída do agente sem JSON", false, f.httpStatus); }
      const parsed = spec.schema.safeParse(json);
      if (!parsed.success) { failure = parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`); throw new ProviderCallError("parse", "saída do agente fora do esquema", false, f.httpStatus); }
      const codeErrors = spec.validate?.(parsed.data) ?? [];
      if (codeErrors.length > 0) { failure = codeErrors.slice(0, 6); throw new ProviderCallError("parse", "saída do agente reprovada na validação do código", false, f.httpStatus); }
      return { body: { output: parsed.data, model, promptVersion }, costUsd: 0, httpStatus: f.httpStatus };
    };
    let r!: Awaited<ReturnType<typeof callProvider>>; let transient = 0;
    for (;;) {
      if (ctx.runtime?.isCancelled?.()) { allErrors.push("execução cancelada antes da chamada ao modelo"); return { state: "failed", errors: allErrors, attempts: attempt - 1, failure: { kind: "cancelled", retryable: false }, agentRunId: await audit({ status: "cancelled", attempts: attempt - 1, output: null, errors: allErrors, usage: { ...usage, failureKind: "cancelled", transientRetries: transient } }) }; }
      if (ctx.runtime?.guard && !ctx.runtime.guard.take()) { allErrors.push(`proteção contra laço: mais de ${ctx.runtime.guard.max} chamadas ao modelo nesta execução`); return { state: "failed", errors: allErrors, attempts: attempt - 1, failure: { kind: "loop_guard", retryable: false }, agentRunId: await audit({ status: "failed", attempts: attempt - 1, output: null, errors: allErrors, usage: { ...usage, failureKind: "loop_guard", transientRetries: transient } }) }; }
      r = await callProvider({ ...base, provider: "anthropic", endpoint: `v1/messages#agent${spec.agent}`, params, ttlMs: null, fetchRaw });
      if (r.state === "provider_error" && r.code !== "parse" && classifyProviderFailure(r.code, r.retryable).retryable && transient < maxTransient) {
        transient += 1; allErrors.push(`retentativa ${transient}/${maxTransient} após ${r.code}: ${r.message}`);
        await (ctx.runtime?.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms))))(ctx.runtime?.backoffMs?.(transient) ?? Math.min(30_000, 1000 * 2 ** (transient - 1)));
        continue;
      }
      break;
    }
    if (r.state === "ok") {
      const output = (r.data as { output: T }).output;
      return { state: "ok", data: output, attempts: attempt, agentRunId: await audit({ status: "succeeded", attempts: attempt, output, errors: allErrors, usage: { ...usage, model, cached: r.provenance.cached, transientRetries: transient } }) };
    }
    if (r.state === "provider_error" && r.code !== "parse") {
      allErrors.push(`tentativa ${attempt}: ${r.code}: ${r.message}`);
      const failure = classifyProviderFailure(r.code, r.retryable);
      return { state: "failed", errors: allErrors, attempts: attempt, failure, agentRunId: await audit({ status: failure.kind === "timeout" ? "timed_out" : "failed", attempts: attempt, output: null, errors: allErrors, usage: { ...usage, failureKind: failure.kind, transientRetries: transient } }) };
    }
    prevBad = lastText; prevErrors = failure.length > 0 ? failure : ["saída inválida"];
    allErrors.push(`tentativa ${attempt}: ${prevErrors.join("; ")}`);
  }
  return { state: "failed", errors: allErrors, attempts: MAX_ATTEMPTS, failure: { kind: "invalid_output", retryable: false }, agentRunId: await audit({ status: "invalid_output", attempts: MAX_ATTEMPTS, output: null, errors: allErrors, usage: { ...usage, failureKind: "invalid_output" } }) };
}
