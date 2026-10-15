import "server-only";
import { pickTenant, type TenantPick, type VerifiedIdentity } from "@plataforma/api";

// Tenant ativo da requisição (F2). A ÚNICA função que decide qual tenant uma requisição usa; tenant-data.ts, data-flow.ts e gsc.ts a chamam.
// Regra: exatamente um tenant autorizado → ele; vários → só uma seleção EXPLÍCITA que conste na claim assinada; sem isso, `selection_required`
// e nenhuma consulta é feita. Nunca "o primeiro da lista".
//
// NÃO HÁ, hoje, nenhuma fonte de seleção ligada (nem cookie, nem parâmetro de URL): o desenho de como o usuário escolhe e de como a escolha é
// guardada e revalidada ainda precisa de validação com o fluxo de autenticação (ver docs/adr/ADR-018). Até lá, `explicit` é sempre `undefined`
// nos chamadores e quem tem vários tenants recebe o estado de seleção obrigatória. O argumento existe para que a futura fonte entre aqui, e só aqui.
export function activeTenantFor(identity: VerifiedIdentity, explicit?: unknown): TenantPick {
  return pickTenant(identity, explicit);
}
