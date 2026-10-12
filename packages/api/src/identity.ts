import { parseTenantId, type TenantId } from "./tenant-id";

declare const identityBrand: unique symbol;

/**
 * Identidade já verificada por um autenticador: quem é o usuário e a quais tenants ele pertence. O tenant NUNCA vem do
 * cliente: `withTenant` só aceita um tenant que conste aqui. Só um autenticador chama `verifiedIdentity` (ver o teste
 * estático em tenant-context.guard.test.ts); nenhum provedor de login foi escolhido ainda.
 */
export interface VerifiedIdentity {
  readonly [identityBrand]: true;
  readonly userId: string;
  readonly tenantIds: readonly TenantId[];
}

export function verifiedIdentity(input: { userId: string; tenantIds: readonly string[] }): VerifiedIdentity {
  if (typeof input.userId !== "string" || input.userId.length === 0) throw new TypeError("userId é obrigatório");
  const tenantIds = input.tenantIds.map((t) => parseTenantId(t));
  return Object.freeze({ userId: input.userId, tenantIds: Object.freeze(tenantIds) }) as unknown as VerifiedIdentity;
}
