import "server-only";
import { unstable_rethrow } from "next/navigation";
import { isDatabaseUnavailable, isUndefinedTable } from "@plataforma/api";
import { logServerError } from "./log";
import { resolveTenantContext, type TenantContext } from "./tenant-data";

// Contexto de AÇÕES do servidor (identidade e tenant SEMPRE da sessão verificada; nunca do formulário) e a tradução de falhas em mensagens.
// Os erros de controle de fluxo do Next.js (cookies(), connection(), redirect...) são repassados ao framework, nunca convertidos em mensagem.
export type ActionContext = { ok: true; ctx: Extract<TenantContext, { ok: true }> } | { ok: false; message: string };

export async function actionContext(scope: string): Promise<ActionContext> {
  let ctx: TenantContext;
  try {
    ctx = await resolveTenantContext();
  } catch (e) {
    unstable_rethrow(e);
    logServerError(scope, e);
    return { ok: false, message: "Não foi possível verificar sua sessão agora. Tente novamente em instantes." };
  }
  if (ctx.ok) return { ok: true, ctx };
  const message = ctx.reason === "unauthenticated" ? "Sua sessão expirou. Entre novamente." : ctx.reason === "no_tenant" ? "Seu usuário ainda não está associado a um workspace." : "Esta área não está configurada neste ambiente.";
  return { ok: false, message };
}

/** Mensagem para uma falha de leitura/execução. Esperados (tabela ausente) não são registrados; os demais ficam no log interno (tipo e código). */
export function explainFailure(scope: string, e: unknown): string {
  unstable_rethrow(e);
  if (isUndefinedTable(e)) return "As tabelas necessárias ainda não existem neste banco: as migrations precisam ser aplicadas.";
  logServerError(scope, e);
  if (isDatabaseUnavailable(e)) return "O banco de dados não respondeu agora. Tente novamente em instantes.";
  return "Não foi possível concluir agora. Tente novamente; se persistir, avise o administrador.";
}
