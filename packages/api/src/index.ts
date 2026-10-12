export { devIdentity } from "./dev-identity";
export {
  ConnectionAcquireTimeoutError,
  ConnectionCleanupError,
  InvalidTenantIdError,
  NestedTenantContextError,
  TenantAccessDeniedError,
  TenantDbClosedError,
  TransactionNotCommittedError,
  UnsafeConnectionError,
  UnsettledTenantOperationError,
} from "./errors";
export { verifiedIdentity, type VerifiedIdentity } from "./identity";
export { parseTenantId, type TenantId } from "./tenant-id";
export {
  withTenant,
  type ClientEvents,
  type ClientLike,
  type PoolLike,
  type QueryResultLike,
  type TenantDb,
  type WithTenantOptions,
} from "./tenant-context";
export {
  OPPORTUNITY_INTENTS,
  OPPORTUNITY_KINDS,
  OPPORTUNITY_LEVELS,
  OPPORTUNITY_STATUSES,
  getOpportunity,
  listOpportunities,
  setOpportunityStatus,
  type ListOpportunitiesOptions,
  type Opportunity,
  type OpportunityIntent,
  type OpportunityKind,
  type OpportunityLevel,
  type OpportunityStatus,
} from "./opportunities";
