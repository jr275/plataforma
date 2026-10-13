export { AuthenticationError, type AuthFailureReason } from "./errors";
export { bearerToken, createSupabaseAuthenticator, supabaseJwks, type SupabaseAuthConfig, type SupabaseAuthenticator, type SupportedAlgorithm } from "./auth/supabase";
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
export { CsvParseError, detectDelimiter, parseCsv, type Delimiter, type ParsedCsv } from "./ingest/csv";
export {
  CITY_FIELDS,
  MappingError,
  REGIONS,
  UFS,
  classifyCityRows,
  ibgeCheckDigitOk,
  validateMapping,
  type CityMapping,
  type ClassifiedRow,
  type Classification,
  type Issue,
  type RowOutcome,
} from "./ingest/cities";
export { MAX_IMPORT_ROWS, runCityImport, type CityImportInput, type ImportOrigin, type ImportResult, type ImportStatus } from "./ingest/run";
export { countCities, getImportRun, listCities, listImportRecords, listImportRuns, type City, type ImportRecordView, type ImportRunSummary } from "./ingest/read";
export { createAppPool } from "./pool";
export {
  CITY_OVERVIEW,
  FACT_KEYS,
  buildCityFacts,
  cityPath,
  formatInt,
  renderCityPage,
  slugify,
  templateHash,
  validateTemplate,
  type CityTemplate,
  type Fact,
  type FactKey,
  type FactsResult,
  type RenderContext,
  type RenderResult,
  type RenderedPage,
  type RenderedSection,
} from "./pages/city-overview";
