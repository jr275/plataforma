import { createHash } from "node:crypto";

// Contrato comum dos provedores externos (ADR-027). Toda chamada devolve UM de três estados explícitos; não existe "mock silencioso" em tempo de execução:
// sem credencial o estado é `provider_not_configured`, com falha é `provider_error`, e só `ok` carrega dados (sempre com a proveniência de onde vieram).
export type ProviderErrorCode = "unauthorized" | "rate_limited" | "http" | "timeout" | "network" | "parse" | "budget_exceeded" | "provider_rejected";

export interface Provenance {
  readonly provider: string;
  readonly endpoint: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly collectedAt: Date;
  /** Custo em US$ informado pelo provedor; 0 quando a resposta veio do cache ou o provedor é gratuito. */
  readonly costUsd: number;
  readonly cacheKey: string;
  /** A resposta veio do cache (nenhuma requisição nova foi feita). */
  readonly cached: boolean;
  /** Linha de `provider_call` com a resposta bruta (raw_ref dos sinais). */
  readonly callId: string | null;
}

export type ProviderResult<T> =
  | { readonly state: "ok"; readonly data: T; readonly provenance: Provenance }
  | { readonly state: "provider_not_configured"; readonly provider: string; readonly missing: readonly string[]; readonly detail: string }
  | { readonly state: "provider_error"; readonly provider: string; readonly code: ProviderErrorCode; readonly message: string; readonly retryable: boolean };

export const isOk = <T>(r: ProviderResult<T>): r is Extract<ProviderResult<T>, { state: "ok" }> => r.state === "ok";

/** JSON canônico: chaves ordenadas em todos os níveis, `undefined` omitido. Mesmos parâmetros, mesma chave, em qualquer ordem. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonicalJson(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}
export const cacheKeyFor = (provider: string, endpoint: string, params: Readonly<Record<string, unknown>>): string =>
  createHash("sha256").update(`${provider}\n${endpoint}\n${canonicalJson(params)}`).digest("hex");

/** Credenciais pelo NOME da variável; o valor nunca é lido para log nem devolvido em erro. */
export type EnvLike = Readonly<Record<string, string | undefined>>;
export function missingEnv(env: EnvLike, names: readonly string[]): string[] { return names.filter((n) => !env[n] || env[n]!.trim() === ""); }

export const notConfigured = (provider: string, missing: readonly string[]): Extract<ProviderResult<never>, { state: "provider_not_configured" }> =>
  ({ state: "provider_not_configured", provider, missing, detail: `variáveis ausentes: ${missing.join(", ")}` });
export const providerError = (provider: string, code: ProviderErrorCode, message: string, retryable = false): Extract<ProviderResult<never>, { state: "provider_error" }> =>
  ({ state: "provider_error", provider, code, message: message.slice(0, 300), retryable });
