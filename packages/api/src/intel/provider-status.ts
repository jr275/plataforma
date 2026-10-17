// Resultado de qualquer chamada a provedor externo (requisito 9.3). Os quatro estados são distintos de propósito:
// ausência de credencial, erro e "sem dados" NUNCA viram zero nem se confundem com sucesso.

export type ProviderName = "dataforseo" | "gsc" | "ahrefs";

export interface Provenance {
  readonly provider: ProviderName;
  readonly endpoint: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly collectedAt: string;
  readonly cacheKey: string;
  readonly cacheHit: boolean;
  readonly costUsd: number;
  /** Provedores que cobram em unidades (Ahrefs). Em cache hit é 0: nada foi consumido nesta chamada. */
  readonly costUnits?: number;
  /** "estimated" = calculado pela regra documentada do provedor; "reported" = devolvido pelo provedor. */
  readonly costSource?: "estimated" | "reported";
  /** Tenant que pediu a coleta (auditoria); não faz parte da chave de cache de dados públicos. */
  readonly tenantId?: string;
}

export type ProviderResult<T> =
  | { readonly status: "provider_not_configured"; readonly provider: ProviderName; readonly missing: readonly string[] }
  | { readonly status: "provider_error"; readonly provider: ProviderName; readonly endpoint: string; readonly reason: string; readonly httpStatus?: number }
  | { readonly status: "no_data"; readonly provenance: Provenance }
  | { readonly status: "success"; readonly data: T; readonly provenance: Provenance };

export function isSuccess<T>(r: ProviderResult<T>): r is Extract<ProviderResult<T>, { status: "success" }> {
  return r.status === "success";
}
