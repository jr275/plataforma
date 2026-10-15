import "server-only";
import { connection } from "next/server";
import { diagnoseGscConfiguration, resolveDataForSeoConfig, validateGscConnection, validationEvent, type GoogleFetch, type GscValidationResult } from "@plataforma/api";
import { requestIdentity } from "./identity";
import { activeTenantFor } from "./tenant-selection";

// Integração com o Search Console no servidor. A credencial é lida e usada só aqui: o cliente recebe um resultado
// estruturado (status, etapas, e-mail da service account, código de erro) e nunca a chave, o JSON ou o token.

export type IntegrationAccess =
  | { ok: true; tenantId: string | null; actor: string | null; mode: "session" | "local_dev" }
  | { ok: false; reason: "unauthenticated" | "no_tenant" | "tenant_selection_required" | "login_not_configured" };

/**
 * Ver e validar a integração exige sessão verificada com tenant. Sem login configurado, só é permitido fora de produção
 * (preview e desenvolvimento local); em produção isso nunca libera acesso.
 */
export async function integrationAccess(): Promise<IntegrationAccess> {
  await connection();
  const who = await requestIdentity();
  if (who.state === "ok") {
    const pick = activeTenantFor(who.identity); // nunca "o primeiro da lista": 1 tenant = ele; vários = só o escolhido E autorizado
    if (pick.kind === "none") return { ok: false, reason: "no_tenant" };
    if (pick.kind === "selection_required") return { ok: false, reason: "tenant_selection_required" };
    const tenantId = pick.tenantId;
    return { ok: true, tenantId, actor: who.identity.userId, mode: "session" };
  }
  if (who.state === "unauthenticated") return { ok: false, reason: "unauthenticated" };
  if (process.env.NODE_ENV !== "production") return { ok: true, tenantId: null, actor: null, mode: "local_dev" };
  return { ok: false, reason: "login_not_configured" };
}

/** Passo sem rede: o que está configurado. Nunca afirma conexão. */
export function gscConfigurationReport(): GscValidationResult {
  return diagnoseGscConfiguration(process.env);
}

export interface ProviderSummary {
  readonly id: "gsc" | "dataforseo";
  readonly name: string;
  readonly configured: boolean;
  readonly missing: readonly string[];
}

export function otherProviders(): ProviderSummary[] {
  const dfs = resolveDataForSeoConfig(process.env);
  return [{ id: "dataforseo", name: "DataForSEO", configured: dfs.ok, missing: dfs.ok ? [] : dfs.missing }];
}

const googleFetch: GoogleFetch = async (url, init) => {
  const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: init.signal, cache: "no-store" });
  return { status: res.status, json: () => res.json() };
};

/** Validação ao vivo, somente leitura. Registra um evento operacional seguro (sem segredo) no log do servidor. */
export async function runGscValidation(access: Extract<IntegrationAccess, { ok: true }>): Promise<GscValidationResult> {
  const result = await validateGscConnection({ env: process.env, fetch: googleFetch });
  console.info(JSON.stringify(validationEvent(result, { tenantId: access.tenantId, actor: access.actor })));
  return result;
}
