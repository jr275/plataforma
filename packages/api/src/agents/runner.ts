import { createHash } from "node:crypto";
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
export interface AgentCtx extends PublicCtx { readonly env: EnvLike; readonly prompts: AgentPrompts; readonly vars: Readonly<Record<string, string>> }
export interface AgentBase { readonly db: TenantDb; readonly budget: RunBudget; readonly runId: string | null; readonly actor: string; readonly now: () => Date }
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
  | { readonly state: "failed"; readonly errors: readonly string[]; readonly attempts: number; readonly agentRunId: string };

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
export const DEFAULT_AGENT_MODEL = "claude-sonnet-5-5";

export async function runAgent<T>(ctx: AgentCtx, base: AgentBase, spec: AgentSpec<T>, input: unknown, subject: { kind: string; ref: string }): Promise<AgentResult<T>> {
  const def = ctx.prompts.agents[spec.agent]; if (!def) throw new PromptError(`agente ${spec.agent} não existe no arquivo de prompts`);
  const model = ctx.env.PLATAFORMA_AGENT_MODEL?.trim() || DEFAULT_AGENT_MODEL;
  const inputJson = JSON.stringify(input, null, 1);
  const system = fillTemplate(ctx.prompts.header, ctx.vars);
  const user = fillTemplate(def.body, { ...ctx.vars, ...(spec.extraVars ?? {}), [spec.inputVar]: inputJson });
  const promptSha = sha(`${system}\n---\n${user.replace(inputJson, "")}`);
  const audit = async (o: { status: "succeeded" | "failed" | "not_configured"; attempts: number; output: unknown; errors: readonly string[]; usage: Record<string, unknown> }) => (await base.db.query<{ id: string }>(
    `INSERT INTO plataforma.agent_run (tenant_id, agent, agent_name, prompt_version, prompt_sha256, model, status, attempts, subject_kind, subject_ref, input, output, errors, usage, created_by) VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14) RETURNING id`,
    [spec.agent, def.name, ctx.prompts.version, promptSha, model, o.status, o.attempts, subject.kind, subject.ref, inputJson, o.output === null ? null : JSON.stringify(o.output), JSON.stringify(o.errors), JSON.stringify(o.usage), base.actor])).rows[0]!.id;

  const missing = missingEnv(ctx.env, ["ANTHROPIC_API_KEY"]);
  if (missing.length > 0) return { state: "provider_not_configured", missing, agentRunId: await audit({ status: "not_configured", attempts: 0, output: null, errors: [`variáveis ausentes: ${missing.join(", ")}`], usage: {} }) };

  const baseUrl = (ctx.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com").replace(/\/+$/, "");
  const usage = { inputTokens: 0, outputTokens: 0 }; const allErrors: string[] = [];
  let prevBad: string | null = null; let prevErrors: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const messages = attempt === 1 ? [{ role: "user", content: user }] : [{ role: "user", content: user }, { role: "assistant", content: prevBad ?? "" }, { role: "user", content: `Sua saída anterior foi inválida: ${prevErrors.join("; ")}. Responda de novo somente com JSON válido no schema pedido, sem texto extra.` }];
    const body = { model, max_tokens: 4000, temperature: 0, system, messages };
    const params = { agent: spec.agent, model, promptVersion: ctx.prompts.version, attempt, inputSha: sha(inputJson), feedbackSha: attempt === 1 ? null : sha(prevErrors.join("|") + (prevBad ?? "")) };
    let failure: string[] = []; let lastText = "";
    const fetchRaw = async (): Promise<Fetched> => {
      const f = await publicJson(ctx, `${baseUrl}/v1/messages`, { method: "POST", body: JSON.stringify(body), headers: { "x-api-key": ctx.env.ANTHROPIC_API_KEY!.trim(), "anthropic-version": "2023-06-01", "Content-Type": "application/json" } });
      const msg = f.body as { content?: { type?: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
      usage.inputTokens += msg.usage?.input_tokens ?? 0; usage.outputTokens += msg.usage?.output_tokens ?? 0;
      lastText = (msg.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      let json: unknown;
      try { json = extractJson(lastText); } catch { failure = ["a saída não contém um objeto JSON"]; throw new ProviderCallError("parse", "saída do agente sem JSON", false, f.httpStatus); }
      const parsed = spec.schema.safeParse(json);
      if (!parsed.success) { failure = parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`); throw new ProviderCallError("parse", "saída do agente fora do esquema", false, f.httpStatus); }
      const codeErrors = spec.validate?.(parsed.data) ?? [];
      if (codeErrors.length > 0) { failure = codeErrors.slice(0, 6); throw new ProviderCallError("parse", "saída do agente reprovada na validação do código", false, f.httpStatus); }
      return { body: { output: parsed.data, model, promptVersion: ctx.prompts.version }, costUsd: 0, httpStatus: f.httpStatus };
    };
    const r = await callProvider({ ...base, provider: "anthropic", endpoint: `v1/messages#agent${spec.agent}`, params, ttlMs: null, fetchRaw });
    if (r.state === "ok") {
      const output = (r.data as { output: T }).output;
      return { state: "ok", data: output, attempts: attempt, agentRunId: await audit({ status: "succeeded", attempts: attempt, output, errors: allErrors, usage: { ...usage, model, cached: r.provenance.cached } }) };
    }
    if (r.state === "provider_error" && r.code !== "parse") { allErrors.push(`tentativa ${attempt}: ${r.code}: ${r.message}`); return { state: "failed", errors: allErrors, attempts: attempt, agentRunId: await audit({ status: "failed", attempts: attempt, output: null, errors: allErrors, usage }) }; }
    prevBad = lastText; prevErrors = failure.length > 0 ? failure : ["saída inválida"];
    allErrors.push(`tentativa ${attempt}: ${prevErrors.join("; ")}`);
  }
  return { state: "failed", errors: allErrors, attempts: MAX_ATTEMPTS, agentRunId: await audit({ status: "failed", attempts: MAX_ATTEMPTS, output: null, errors: allErrors, usage }) };
}
