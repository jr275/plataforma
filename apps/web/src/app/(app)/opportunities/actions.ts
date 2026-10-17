"use server";

import { revalidatePath } from "next/cache";
import { OPPORTUNITY_STATUSES, getOpportunity, setOpportunityStatus, withTenant, type OpportunityStatus } from "@plataforma/api";
import { isAllowedTransition } from "@/lib/opportunity-transitions";
import { isNotMigrated, resolveTenantContext } from "@/lib/server/tenant-data";

// Muda o STATUS de uma oportunidade real. A identidade e o tenant vêm SEMPRE da sessão verificada (nunca do formulário); o id e o destino
// do formulário são validados aqui e a transição é revalidada contra o estado ATUAL lido no banco, dentro da mesma transação do tenant.
// Erros viram mensagens compreensíveis (nunca a mensagem crua do banco). O RLS impede tocar em oportunidade de outro tenant.
export type OpportunityStatusState = { error?: string; done?: string } | null;

const UNAVAILABLE = "A mudança de status não está disponível neste ambiente.";

function blockedMessage(reason: string): string {
  if (reason === "unauthenticated") return "Sua sessão expirou. Entre novamente.";
  if (reason === "no_tenant") return "Seu usuário ainda não está associado a um workspace.";
  if (reason === "tenant_selection_required") return "Seu usuário tem mais de um workspace e a escolha explícita ainda não está disponível: nenhuma ação foi executada.";
  return UNAVAILABLE;
}

export async function changeStatusAction(_prev: OpportunityStatusState, formData: FormData): Promise<OpportunityStatusState> {
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("to") ?? "");
  if (!(OPPORTUNITY_STATUSES as readonly string[]).includes(to)) return { error: "Status de destino inválido." };
  const target = to as OpportunityStatus;

  const ctx = await resolveTenantContext();
  if (!ctx.ok) return { error: blockedMessage(ctx.reason) };

  try {
    const outcome = await withTenant(ctx.pool, ctx.identity, ctx.tenantId, async (db) => {
      const current = await getOpportunity(db, id);
      if (!current) return { kind: "missing" as const };
      if (current.status === target) return { kind: "same" as const };
      if (!isAllowedTransition(current.status, target)) return { kind: "forbidden" as const, from: current.status };
      return (await setOpportunityStatus(db, id, target)) ? { kind: "changed" as const } : { kind: "missing" as const };
    });
    if (outcome.kind === "missing") return { error: "Oportunidade não encontrada neste workspace." };
    if (outcome.kind === "same") return { done: "Nada a alterar: a oportunidade já está nesse status." };
    if (outcome.kind === "forbidden") return { error: "Essa mudança de status não é permitida a partir do estado atual. Recarregue a página." };
  } catch (e) {
    return { error: isNotMigrated(e) ? "A tabela de oportunidades ainda não existe neste banco: as migrations 0001 e 0002 precisam ser aplicadas." : "Não foi possível alterar o status agora. Tente novamente; se persistir, avise o administrador." };
  }
  revalidatePath("/opportunities");
  revalidatePath(`/opportunities/${id}`);
  return { done: "Status atualizado." };
}
