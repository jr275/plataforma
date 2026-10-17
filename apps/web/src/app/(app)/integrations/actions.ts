"use server";

import type { GscValidationResult } from "@plataforma/api";
import { integrationAccess, runGscValidation } from "@/lib/server/gsc";

export type ValidateGscState =
  | { kind: "result"; result: GscValidationResult; attemptedAt: string }
  | { kind: "denied"; message: string; attemptedAt: string }
  | null;

const DENIED: Record<"unauthenticated" | "no_tenant" | "tenant_selection_required" | "login_not_configured", string> = {
  unauthenticated: "Sua sessão expirou. Entre novamente para validar a conexão.",
  no_tenant: "Seu usuário ainda não está associado a um workspace.",
  tenant_selection_required: "Seu usuário tem mais de um workspace e a seleção explícita ainda não está disponível; a validação não usa um workspace escolhido por conveniência.",
  login_not_configured: "O login não está configurado neste ambiente; a validação fica bloqueada em produção.",
};

/** Validação explícita, disparada pelo operador. A autorização é refeita aqui no servidor; o estado da tela não conta. */
export async function validateGscAction(): Promise<ValidateGscState> {
  const attemptedAt = new Date().toISOString();
  const access = await integrationAccess();
  if (!access.ok) return { kind: "denied", message: DENIED[access.reason], attemptedAt };
  return { kind: "result", result: await runGscValidation(access), attemptedAt };
}
