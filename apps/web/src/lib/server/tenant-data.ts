import "server-only";
import { connection } from "next/server";
import { isUndefinedTable, withTenant, type TenantDb, type VerifiedIdentity } from "@plataforma/api";
import { appPool, dbOrigin } from "./db";
import { requestIdentity } from "./identity";
import { activeTenantFor } from "./tenant-selection";

// Acesso a dados POR TENANT para as telas (ADR-018): identidade verificada no servidor, tenant só da claim assinada, tudo por withTenant.
// Cada situação que a interface precisa distinguir é um estado explícito; nunca há dado de demonstração no lugar.
export type Loaded<T> =
  | { state: "ready"; data: T; origin: { kind: "local" | "remote"; host: string } | undefined }
  | { state: "not_configured"; missing: string }
  | { state: "unauthenticated" }
  | { state: "no_tenant" }
  /** O usuário tem VÁRIOS tenants e ainda não escolheu um (ou a escolha não é mais autorizada): nada é consultado até a escolha explícita. */
  | { state: "tenant_selection_required"; choices: readonly string[] }
  /** As tabelas que a tela precisa ainda não existem neste banco (migrations pendentes). */
  | { state: "not_migrated" }
  | { state: "error" };

export type TenantContext =
  | { ok: true; pool: NonNullable<ReturnType<typeof appPool>>; identity: VerifiedIdentity; tenantId: string }
  | { ok: false; reason: "not_configured" | "unauthenticated" | "no_tenant"; missing?: string }
  | { ok: false; reason: "tenant_selection_required"; choices: readonly string[] };

export async function resolveTenantContext(): Promise<TenantContext> {
  await connection(); // lê sessão e relógio: só em tempo de requisição
  const who = await requestIdentity();
  if (who.state === "not_configured") return { ok: false, reason: "not_configured", missing: "login (Supabase)" };
  if (who.state === "unauthenticated") return { ok: false, reason: "unauthenticated" };
  const pool = appPool();
  if (!pool) return { ok: false, reason: "not_configured", missing: "banco de dados (PLATAFORMA_APP_DATABASE_URL)" };
  const pick = activeTenantFor(who.identity); // nunca "o primeiro da lista": 1 tenant = ele; vários = só o escolhido E autorizado
  if (pick.kind === "none") return { ok: false, reason: "no_tenant" };
  if (pick.kind === "selection_required") return { ok: false, reason: "tenant_selection_required", choices: pick.choices };
  return { ok: true, pool, identity: who.identity, tenantId: pick.tenantId };
}

/** SQLSTATE 42P01 (tabela inexistente), mesmo que o erro venha embrulhado em `cause`. A lógica vive em packages/api (testada contra erros reais). */
export const isNotMigrated = isUndefinedTable;

export async function loadForTenant<T>(fn: (db: TenantDb) => Promise<T>): Promise<Loaded<T>> {
  const ctx = await resolveTenantContext();
  if (!ctx.ok) {
    if (ctx.reason === "not_configured") return { state: "not_configured", missing: ctx.missing ?? "configuração" };
    if (ctx.reason === "tenant_selection_required") return { state: "tenant_selection_required", choices: ctx.choices };
    return { state: ctx.reason };
  }
  try {
    const data = await withTenant(ctx.pool, ctx.identity, ctx.tenantId, fn);
    return { state: "ready", data, origin: dbOrigin() };
  } catch (e) {
    return isNotMigrated(e) ? { state: "not_migrated" } : { state: "error" }; // nunca devolve a mensagem do banco (pode ter host ou usuário)
  }
}
