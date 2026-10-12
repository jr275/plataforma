import { InvalidTenantIdError } from "./errors";

declare const tenantIdBrand: unique symbol;

/** UUID de tenant já validado e normalizado (minúsculo). Só `parseTenantId` o produz. */
export type TenantId = string & { readonly [tenantIdBrand]: true };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function parseTenantId(value: unknown): TenantId {
  if (typeof value !== "string") throw new InvalidTenantIdError();
  const normalized = value.toLowerCase();
  if (!UUID.test(normalized)) throw new InvalidTenantIdError();
  return normalized as TenantId;
}
