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
export { createAppPool, describeConnection } from "./pool";
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
export * as knowledge from "./knowledge";
export { GATES, META_MAX, META_MIN, TITLE_MAX, checkFactsTraceable, checkLinks, checkMetadata, evaluateCity, type ExistingPage, type GateName, type GateResult, type GenerationContext, type ItemEvaluation } from "./pages/gates";
export { DEFAULT_STALE_AFTER_MINUTES, GenerationBusyError, GenerationScopeError, MAX_GENERATION_ITEMS, PILOT_MIN_VALID, meetsPilotAcceptance, recoverStaleGenerationRuns, runGeneration, selectCandidates, type GenerationInput, type GenerationItemSummary, type GenerationResult, type GenerationScope } from "./pages/generate";
export { getGenerationRunDetail, getPageDetail, listGenerationItems, listGenerationRuns, listPageVersions, listPages, searchPages, type GenerationItemDetail, type GenerationItemView, type GenerationRunDetail, type GenerationRunSummary, type LatestAttempt, type PageDetail, type PageListItem, type PageSearch, type PageSort, type PageSummary, type PageVersionView } from "./pages/read";
export { FACT_LABELS, FACT_REVIEW_AFTER_DAYS, ageInDays, describeOmissions, reviewFacts, type FactReview, type Omission } from "./pages/diagnostics";
export { PG_UNDEFINED_TABLE, isDatabaseUnavailable, isUndefinedTable } from "./pg-errors";
export { getCityDetail, normalizeSearchText, searchCities, type CityDetail, type CityListItem, type CityPageLink, type CityRelations, type CitySearch, type CitySort, type CitySource } from "./ingest/city-search";
export * as graph from "./graph";
export { toolsFor as graphToolsFor, TOOL_LABEL as GRAPH_TOOL_LABEL } from "./graph/tools";
export { TEMPLATE_REGISTRY } from "./pages/registry";
export { previewCityPage, type CityPreview } from "./pages/preview";
export { previewDraftPage, templateFromDraft, type DraftPreview } from "./pages/preview-draft";
export * as engine from "./engine";
export * as provider from "./provider";
export * as catalog from "./catalog";
export * as topics from "./topics";
export { lastCallPerProvider, type LastCall } from "./provider/store";
export * as draft from "./draft";
export * as combination from "./combination";
export * as eligibility from "./eligibility";
export * as agents from "./agents";
export * as blueprintSpec from "./blueprint-spec";
export * as recipe from "./recipe";
export * as qa from "./qa";
export * as runtime from "./runtime";
export * as factory from "./factory";
