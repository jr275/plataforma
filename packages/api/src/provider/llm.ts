import { z } from "zod";
import { callProvider, ProviderCallError, type CallArgs, type Fetched } from "./store";
import { missingEnv, notConfigured, providerError, type EnvLike, type ProviderResult } from "./contract";
import { publicJson, type PublicCtx } from "./public";

// Classificação por LLM (ADR-027): SOMENTE rótulos (intenção, estágio, JTBD, tipo de página). Nunca número, volume, preço ou fato. A saída é JSON validada por esquema (zod); saída inválida é
// REJEITADA (provider_error `parse`, não é guardada como cache) e nunca "corrigida" ou adivinhada. Modelo e versão do prompt ficam na proveniência. Chave: ANTHROPIC_API_KEY.
export const LLM_PROVIDER = "anthropic";
export const LLM_ENV = ["ANTHROPIC_API_KEY"] as const;
export const DEFAULT_CLASSIFIER_MODEL = "claude-haiku-5-5";
export const PROMPT_VERSION = "classify-v1";
export const PAGE_TYPES = ["portal", "listing", "article", "tool", "map", "forum", "video", "institutional", "other"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export interface LlmCtx extends PublicCtx { readonly env: EnvLike }
export interface QueryLabels { readonly intents: readonly string[]; readonly stages: readonly string[] }

/** Esquemas estritos: valores só da lista da vertical; texto curto; nenhuma chave extra. */
export function querySchema(l: QueryLabels) {
  if (l.intents.length === 0 || l.stages.length === 0) throw new RangeError("a vertical precisa de intenções e estágios");
  return z.object({ intent: z.enum(l.intents as [string, ...string[]]), stage: z.enum(l.stages as [string, ...string[]]), jtbd: z.string().trim().min(10).max(300) }).strict();
}
export const pageTypeSchema = z.object({ pageType: z.enum(PAGE_TYPES), reason: z.string().trim().min(3).max(200) }).strict();
export type QueryClassification = { intent: string; stage: string; jtbd: string };
export type PageTypeClassification = { pageType: PageType; reason: string };

/** Extrai o JSON da resposta (aceita cerca de código), e só isso; texto fora do JSON é descartado. */
export function extractJson(text: string): unknown {
  const m = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (m ? m[1]! : text).trim();
  const start = body.indexOf("{"); const end = body.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("a resposta não contém um objeto JSON");
  return JSON.parse(body.slice(start, end + 1));
}

export const queryPrompt = (query: string, l: QueryLabels): { system: string; user: string } => ({
  system: "Você classifica consultas de busca de um site imobiliário brasileiro. Responda APENAS com um objeto JSON, sem texto extra. Não invente números, preços ou fatos.",
  user: `Consulta: ${JSON.stringify(query)}\nValores permitidos para intent: ${JSON.stringify(l.intents)}\nValores permitidos para stage: ${JSON.stringify(l.stages)}\nFormato: {"intent":"...","stage":"...","jtbd":"uma frase curta, em português, sobre o que a pessoa quer resolver"}`,
});
export const pageTypePrompt = (p: { url: string; title: string | null; snippet?: string | null }): { system: string; user: string } => ({
  system: "Você classifica o TIPO de uma página de resultado de busca. Responda APENAS com um objeto JSON, sem texto extra.",
  user: `URL: ${JSON.stringify(p.url)}\nTítulo: ${JSON.stringify(p.title ?? "")}\nTrecho: ${JSON.stringify(p.snippet ?? "")}\nValores permitidos para pageType: ${JSON.stringify(PAGE_TYPES)}\nFormato: {"pageType":"...","reason":"motivo curto"}`,
});

type Base = Omit<CallArgs, "provider" | "endpoint" | "params" | "fetchRaw" | "ttlMs">;
async function classify<T>(ctx: LlmCtx, base: Base, o: { task: string; prompt: { system: string; user: string }; schema: z.ZodType<T>; input: Record<string, unknown> }): Promise<ProviderResult<T>> {
  const missing = missingEnv(ctx.env, LLM_ENV);
  if (missing.length > 0) return notConfigured(LLM_PROVIDER, missing);
  const model = ctx.env.PLATAFORMA_CLASSIFIER_MODEL?.trim() || DEFAULT_CLASSIFIER_MODEL;
  const baseUrl = (ctx.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com").replace(/\/+$/, "");
  const params = { task: o.task, model, promptVersion: PROMPT_VERSION, input: o.input };
  const body = { model, max_tokens: 400, temperature: 0, system: o.prompt.system, messages: [{ role: "user", content: o.prompt.user }] };
  const fetchRaw = async (): Promise<Fetched> => {
    const f = await publicJson(ctx, `${baseUrl}/v1/messages`, { method: "POST", body: JSON.stringify(body), headers: { "x-api-key": ctx.env.ANTHROPIC_API_KEY!.trim(), "anthropic-version": "2023-06-01", "Content-Type": "application/json" } });
    const msg = f.body as { content?: { type?: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = (msg.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    let parsed: T;
    try { parsed = o.schema.parse(extractJson(text)); } catch { throw new ProviderCallError("parse", "classificação inválida: a saída não obedece ao esquema e foi rejeitada", false, f.httpStatus); }
    // o custo em US$ não é calculado (a tabela de preços não está configurada): os tokens ficam registrados; costUsd = 0 NÃO significa gratuito
    return { body: { result: parsed, model, promptVersion: PROMPT_VERSION, usage: { inputTokens: msg.usage?.input_tokens ?? null, outputTokens: msg.usage?.output_tokens ?? null } }, costUsd: 0, httpStatus: f.httpStatus };
  };
  const r = await callProvider({ ...base, provider: LLM_PROVIDER, endpoint: `v1/messages#${o.task}`, params, ttlMs: null, fetchRaw });
  if (r.state !== "ok") return r;
  const again = o.schema.safeParse((r.data as { result?: unknown }).result);
  return again.success ? { state: "ok", data: again.data, provenance: r.provenance } : providerError(LLM_PROVIDER, "parse", "classificação inválida no cache: rejeitada");
}
export const classifyQuery = (ctx: LlmCtx, base: Base, query: string, labels: QueryLabels) => classify<QueryClassification>(ctx, base, { task: "query", prompt: queryPrompt(query, labels), schema: querySchema(labels), input: { query, intents: labels.intents, stages: labels.stages } });
export const classifyPageType = (ctx: LlmCtx, base: Base, page: { url: string; title: string | null; snippet?: string | null }) => classify<PageTypeClassification>(ctx, base, { task: "page_type", prompt: pageTypePrompt(page), schema: pageTypeSchema, input: { url: page.url, title: page.title, snippet: page.snippet ?? null } });
