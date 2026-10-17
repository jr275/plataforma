import type { VerifiedIdentity } from "./identity";
import { parseTenantId, type TenantId } from "./tenant-id";

// Escolha do tenant ativo a partir de uma identidade VERIFICADA e de uma preferência do usuário (por exemplo, um cookie). A preferência NUNCA
// autoriza nada: ela só vale se o tenant constar em `identity.tenantIds` (a claim assinada). Não existe "o primeiro da lista" como regra:
// com vários tenants e sem escolha válida o resultado é `selection_required` e nenhuma consulta pode ser feita em nome de um tenant "por conveniência".
export type TenantPick =
  | { readonly kind: "none" }
  /** `only`: a identidade tem exatamente um tenant (não há o que escolher). `explicit`: o usuário escolheu um dos vários e ele é autorizado. */
  | { readonly kind: "selected"; readonly tenantId: TenantId; readonly source: "only" | "explicit" }
  /** Vários tenants e nenhuma escolha válida. `staleSelection`: havia uma preferência, mas ela não é (mais) autorizada ou é malformada. */
  | { readonly kind: "selection_required"; readonly choices: readonly TenantId[]; readonly staleSelection: boolean };

export function pickTenant(identity: VerifiedIdentity, selected: unknown): TenantPick {
  const ids = identity.tenantIds;
  if (ids.length === 0) return { kind: "none" };
  if (ids.length === 1) return { kind: "selected", tenantId: ids[0]!, source: "only" };
  const provided = typeof selected === "string" && selected.trim() !== "";
  if (provided) {
    let parsed: TenantId | undefined;
    try { parsed = parseTenantId(selected); } catch { parsed = undefined; }
    if (parsed !== undefined && ids.includes(parsed)) return { kind: "selected", tenantId: parsed, source: "explicit" };
  }
  return { kind: "selection_required", choices: ids, staleSelection: provided };
}
