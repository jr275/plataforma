import { verifiedIdentity, type VerifiedIdentity } from "./identity";

/** Identidade de DESENVOLVIMENTO com tenants fixos. Não é autenticação; recusa rodar em produção. */
export function devIdentity(tenantIds: readonly string[]): VerifiedIdentity {
  if (process.env.NODE_ENV === "production") throw new Error("devIdentity não pode ser usada em produção");
  return verifiedIdentity({ userId: "dev-user", tenantIds });
}
