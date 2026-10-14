import { currentFacts, runCatalog } from "../catalog/store";
import type { CatalogPack } from "../catalog/types";
import type { VerifiedIdentity } from "../identity";
import type { PoolLike, TenantDb } from "../tenant-context";
import type { VerticalDefinition } from "../engine/vertical";
import { generateTopics } from "./generate";
import { withEngineRun, type RunOutcome } from "./run";
import type { SkippedPattern, Topic, TopicEntity, TopicPattern } from "./types";

// Geração e persistência de tópicos (Incremento 2, ADR-030). Um tópico é uma `growth_opportunity` com as colunas da migration 0014: o ciclo de vida, o blueprint e a geração existentes
// continuam valendo. Idempotente por `topic_id`; nenhum tópico é publicável por padrão.
export interface TopicDeps { readonly vertical: VerticalDefinition; readonly catalog: CatalogPack; readonly patterns: readonly TopicPattern[]; readonly now?: () => Date }
export interface TopicRunResult { readonly catalogRunId: string; readonly topics: { readonly created: number; readonly existing: number; readonly duplicates: number }; readonly skipped: readonly SkippedPattern[]; readonly withMissingData: number }

export function validateTopicPatterns(deps: TopicDeps): string[] {
  const e: string[] = [];
  const qp = new Map(deps.vertical.patterns.map((p) => [p.key, p]));
  const attrs = new Set(deps.catalog.attributes.map((a) => a.attributeId));
  const types = new Set(deps.catalog.entityTypes.map((t) => t.entityType));
  const ids = new Set<string>();
  for (const p of deps.patterns) {
    if (ids.has(p.id)) e.push(`padrão de tópico duplicado: ${p.id}`);
    ids.add(p.id);
    const q = qp.get(p.queryPatternKey);
    if (!q) e.push(`${p.id}: o padrão de consulta ${p.queryPatternKey} não existe na vertical`);
    else if (!q.topicOnly) e.push(`${p.id}: ${p.queryPatternKey} precisa ser topicOnly (senão o motor anterior o geraria também)`);
    if (!types.has(p.entityType)) e.push(`${p.id}: tipo de entidade desconhecido (${p.entityType})`);
    if (p.requiredAttributes.length === 0) e.push(`${p.id}: sem atributos exigidos`);
    for (const a of [...p.requiredAttributes, ...p.optionalAttributes]) if (!attrs.has(a)) e.push(`${p.id}: atributo não declarado no catálogo (${a})`);
  }
  return e;
}

export async function loadTopicEntities(db: TenantDb): Promise<TopicEntity[]> {
  const r = await db.query<{ id: string; entity_type: string; source_key: string; name: string; qualifier: string | null }>(
    `SELECT e.id, e.entity_type, e.source_key, e.name, (SELECT f.value #>> '{}' FROM plataforma.fact f WHERE f.entity_id = e.id AND f.attribute_id = e.entity_type || '.uf' AND f.superseded_at IS NULL LIMIT 1) AS qualifier FROM plataforma.entity e WHERE e.status = 'ACTIVE'`);
  return r.rows.map((x) => ({ id: x.id, entityType: x.entity_type, sourceKey: x.source_key, name: x.name, qualifier: x.qualifier }));
}


export interface PersistCtx { readonly vertical: VerticalDefinition; readonly runId: string; readonly actor: string; readonly entities: readonly TopicEntity[]; readonly reason: string }
/** Grava tópicos como `growth_opportunity` (idempotente por cluster_key = topic:<id>) com o evento de descoberta dos novos. Usado pela geração por padrões e pela expansão de combinações. */
export async function persistTopics(db: TenantDb, ctx: PersistCtx, topics: readonly Topic[]): Promise<{ created: number; existing: number }> {
  if (topics.length === 0) return { created: 0, existing: 0 };
  const { vertical, runId, actor, entities } = ctx;
  const qp = new Map(vertical.patterns.map((p) => [p.key, p]));
  const byId = new Map(entities.map((e) => [e.id, e]));
  const cities = new Map((await db.query<{ id: string; ibge_code: string }>(`SELECT id, ibge_code FROM plataforma.city`)).rows.map((c) => [`ibge:${c.ibge_code}`, c.id]));
  const rows = topics.map((t) => {
    const q = qp.get(t.queryPatternKey); if (!q) throw new TypeError(`padrão de consulta desconhecido: ${t.queryPatternKey}`);
    const cityId = t.primaryEntityType === "city" ? cities.get(byId.get(t.primaryEntityId)?.sourceKey ?? "") ?? null : null;
    return {
      cluster_key: `topic:${t.topicId}`, pattern_key: q.key, primary_query: t.queryHypothesis, language: vertical.language, country: vertical.country, entity_kind: cityId ? "city" : null, entity_id: cityId,
      intent: q.intent, stage: q.stage, jtbd: q.jtbd, experience: q.experience, expected_outcome: q.outcome,
      demand: t.demandSignal.value === null ? { value: null, basis: "unknown", source: null, note: "Demanda de busca não medida: tópico gerado sem fonte de demanda." } : { value: t.demandSignal.value, basis: "provider_metric", source: t.demandSignal.source, note: t.demandSignal.uncertainty ?? "estimativa" },
      topic_id: t.topicId, primary_entity_id: t.primaryEntityId, dimensions: t.dimensions, attributes_used: t.attributesUsed, relationships_used: t.relationshipsUsed, data_available: t.dataAvailable, data_missing: t.dataMissing,
      evidence_required: t.evidenceRequired, candidate_page_family: t.candidatePageFamily, geo_granularity: t.geoGranularity, topic_origin: t.origin, intent_type: t.intentType, commercial_potential: t.commercialPotential, user_need: t.userNeed, demand_signal: t.demandSignal, parent_topic_id: t.parentTopicId,
    };
  });
  const up = await db.query<{ id: string; inserted: boolean }>(
    `INSERT INTO plataforma.growth_opportunity (tenant_id, vertical_id, cluster_key, pattern_key, primary_query, variants, language, country, entity_kind, entity_id, intent, stage, jtbd, experience, expected_outcome, hypothesis, demand, trend, status, validation, first_run_id, last_run_id,
       topic_id, primary_entity_id, dimensions, attributes_used, relationships_used, data_available, data_missing, evidence_required, candidate_page_family, geo_granularity, topic_origin, intent_type, commercial_potential, user_need, demand_signal, parent_topic_id)
     SELECT plataforma.current_tenant_id(), $1, x.cluster_key, x.pattern_key, x.primary_query, '{}', x.language, x.country, x.entity_kind, x.entity_id, x.intent, x.stage, x.jtbd, x.experience, x.expected_outcome, true, x.demand, '[]', 'discovered', '{"ok": true, "reasons": []}', $2, $2,
            x.topic_id, x.primary_entity_id, x.dimensions, x.attributes_used, x.relationships_used, x.data_available, x.data_missing, x.evidence_required, x.candidate_page_family, x.geo_granularity, x.topic_origin, x.intent_type, x.commercial_potential, x.user_need, x.demand_signal, x.parent_topic_id
       FROM jsonb_to_recordset($3::jsonb) AS x(cluster_key text, pattern_key text, primary_query text, language text, country text, entity_kind text, entity_id uuid, intent text, stage text, jtbd text, experience text, expected_outcome text, demand jsonb, topic_id text, primary_entity_id uuid, dimensions jsonb, attributes_used text[], relationships_used text[], data_available text[], data_missing text[], evidence_required text[], candidate_page_family text, geo_granularity text, topic_origin text, intent_type text, commercial_potential text, user_need text, demand_signal jsonb, parent_topic_id text)
     ON CONFLICT (tenant_id, vertical_id, cluster_key) DO UPDATE SET last_run_id = EXCLUDED.last_run_id, data_available = EXCLUDED.data_available, data_missing = EXCLUDED.data_missing
     RETURNING id, (xmax = 0) AS inserted`, [vertical.id, runId, JSON.stringify(rows)]);
  const fresh = up.rows.filter((r) => r.inserted);
  if (fresh.length > 0) await db.query(`INSERT INTO plataforma.opportunity_event (tenant_id, opportunity_id, event_type, from_status, to_status, actor, reason, data, run_id) SELECT plataforma.current_tenant_id(), x.id, 'discovered', NULL, 'discovered', $2, $4, '{"hypothesis":true}'::jsonb, $3 FROM jsonb_to_recordset($1::jsonb) AS x(id uuid)`, [JSON.stringify(fresh.map((r) => ({ id: r.id }))), actor, runId, ctx.reason]);
  return { created: fresh.length, existing: topics.length - fresh.length };
}

export async function runTopicGeneration(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, deps: TopicDeps): Promise<RunOutcome<TopicRunResult>> {
  const problems = validateTopicPatterns(deps);
  if (problems.length > 0) throw new TypeError(`padrões de tópico inválidos: ${problems.join("; ")}`);
  const now = (deps.now ?? (() => new Date()))();
  return withEngineRun(pool, identity, tenantId, { verticalId: deps.vertical.id, kind: "topics", params: { patterns: deps.patterns.map((p) => p.id) } }, async (db, runId) => {
    const cat = await runCatalog(db, deps.catalog, now, identity.userId);
    const entities = await loadTopicEntities(db);
    const facts = await currentFacts(db);
    const factsByEntity = new Map<string, Set<string>>();
    for (const f of facts) { const s = factsByEntity.get(f.entityId) ?? new Set<string>(); s.add(f.attributeId); factsByEntity.set(f.entityId, s); }
    const gen = generateTopics({ tenantId, patterns: deps.patterns, catalog: cat.stats, entities, factsByEntity });
    const { created } = await persistTopics(db, { vertical: deps.vertical, runId, actor: identity.userId, entities, reason: "tópico gerado por um padrão do pack a partir de atributos com dados" }, gen.topics);
    const result: TopicRunResult = { catalogRunId: cat.runId, topics: { created, existing: gen.topics.length - created, duplicates: gen.duplicates }, skipped: gen.skipped, withMissingData: gen.topics.filter((t) => t.dataMissing.length > 0).length };
    return { result, stats: { topics: result.topics, skipped: result.skipped.length, catalogRunId: cat.runId } };
  });
}
