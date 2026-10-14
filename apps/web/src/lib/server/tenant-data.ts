import "server-only";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { isDatabaseUnavailable, isUndefinedTable, withTenant, type TenantDb, type VerifiedIdentity } from "@plataforma/api";
import { appPool, dbOrigin } from "./db";
import { requestIdentity } from "./identity";
import { logServerError } from "./log";

// Acesso a dados POR TENANT para as telas (ADR-018): identidade verificada no servidor, tenant só da claim assinada, tudo por withTenant.
// Cada situação que a interface precisa distinguir é um estado explícito; nunca há dado de demonstração no lugar.
export type Loaded<T> =
  | { state: "ready"; data: T; origin: { kind: "local" | "remote"; host: string } | undefined }
  | { state: "not_configured"; missing: string }
  | { state: "unauthenticated" }
  | { state: "no_tenant" }
  /** As tabelas que a tela precisa ainda não existem neste banco (migrations pendentes). */
  | { state: "not_migrated" }
  /** O banco não respondeu (conexão recusada ou perdida, desligamento, timeout): diferente de "não há dados" e de erro de consulta. */
  | { state: "db_unavailable" }
  /** Falha INESPERADA ao verificar a sessão (serviço de login fora do ar, chaves inacessíveis): diferente de "sem sessão". */
  | { state: "auth_unavailable" }
  | { state: "error" };

export type TenantContext = { ok: true; pool: NonNullable<ReturnType<typeof appPool>>; identity: VerifiedIdentity; tenantId: string } | { ok: false; reason: "not_configured" | "unauthenticated" | "no_tenant"; missing?: string };

export async function resolveTenantContext(): Promise<TenantContext> {
  await connection(); // lê sessão e relógio: só em tempo de requisição
  const who = await requestIdentity();
  if (who.state === "not_configured") return { ok: false, reason: "not_configured", missing: "login (Supabase)" };
  if (who.state === "unauthenticated") return { ok: false, reason: "unauthenticated" };
  let pool: ReturnType<typeof appPool>;
  try {
    pool = appPool();
  } catch (e) { // URL do banco malformada: é configuração, não falha de login
    logServerError("db-config", e);
    return { ok: false, reason: "not_configured", missing: "banco de dados (PLATAFORMA_APP_DATABASE_URL inválida)" };
  }
  if (!pool) return { ok: false, reason: "not_configured", missing: "banco de dados (PLATAFORMA_APP_DATABASE_URL)" };
  const tenantId = who.identity.tenantIds[0];
  if (!tenantId) return { ok: false, reason: "no_tenant" };
  return { ok: true, pool, identity: who.identity, tenantId };
}

/** SQLSTATE 42P01 (tabela inexistente), mesmo que o erro venha embrulhado em `cause`. A lógica vive em packages/api (testada contra erros reais). */
export const isNotMigrated = isUndefinedTable;

export async function loadForTenant<T>(fn: (db: TenantDb) => Promise<T>): Promise<Loaded<T>> {
  let ctx: TenantContext;
  try {
    ctx = await resolveTenantContext();
  } catch (e) { // falha inesperada ao verificar a sessão: nunca vira "sem dados" nem "sem sessão"
    unstable_rethrow(e); // cookies()/connection() sinalizam o prerender por exceções: o framework precisa recebê-las (só repassa as dele)
    logServerError("tenant-context", e);
    return { state: "auth_unavailable" };
  }
  if (!ctx.ok) return ctx.reason === "not_configured" ? { state: "not_configured", missing: ctx.missing ?? "configuração" } : { state: ctx.reason };
  try {
    const data = await withTenant(ctx.pool, ctx.identity, ctx.tenantId, fn);
    return { state: "ready", data, origin: dbOrigin() };
  } catch (e) {
    if (isNotMigrated(e)) return { state: "not_migrated" };
    logServerError("tenant-query", e); // só tipo e código; a interface nunca recebe a mensagem do banco (pode ter host ou usuário)
    return { state: isDatabaseUnavailable(e) ? "db_unavailable" : "error" };
  }
}
