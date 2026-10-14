import { createHash } from "node:crypto";
import type { TenantDb } from "../tenant-context";
import { discoverAttributes, statsHash, type AttributeStat, type FactSample } from "./discovery";
import type { AttributeDefinition, CatalogPack, DiscoveryPolicy } from "./types";
import { validatePack } from "./types";

// Persistência da camada de dados (ADR-029): política versionada, entidades, fatos (bi-temporal, append-only) e catálogo de atributos. Sempre dentro de `withTenant`.
const canon = (v: unknown): string => (v === null || typeof v !== "object" ? JSON.stringify(v) ?? "null" : Array.isArray(v) ? `[${v.map(canon).join(",")}]` : `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export interface ActivePolicy { readonly id: string; readonly version: number; readonly hash: string; readonly content: DiscoveryPolicy }
/** A política ativa é a de maior versão; se o tenant não tem nenhuma, a versão 1 nasce da padrão do pack. */
export async function ensurePolicy(db: TenantDb, kind: string, defaults: DiscoveryPolicy, actor: string): Promise<ActivePolicy> {
  const sel = () => db.query<{ id: string; version: number; content: DiscoveryPolicy; content_hash: string }>(`SELECT id, version, content, content_hash FROM plataforma.policy WHERE kind = $1 ORDER BY version DESC LIMIT 1`, [kind]);
  let r = await sel();
  if (r.rows.length === 0) {
    await db.query(`INSERT INTO plataforma.policy (tenant_id, kind, version, content, content_hash, note, created_by) VALUES (plataforma.current_tenant_id(), $1, 1, $2::jsonb, $3, 'versão inicial: política padrão do pack', $4) ON CONFLICT DO NOTHING`, [kind, JSON.stringify(defaults), sha(canon(defaults)), actor]);
    r = await sel();
  }
  const x = r.rows[0]!;
  return { id: x.id, version: x.version, hash: x.content_hash, content: x.content };
}
/** Nova versão da política (a anterior permanece). Conteúdo igual ao da versão mais recente: nada muda. */
export async function savePolicyVersion(db: TenantDb, kind: string, content: DiscoveryPolicy, note: string, actor: string): Promise<{ version: number; created: boolean }> {
  const hash = sha(canon(content));
  const same = (await db.query<{ version: number }>(`SELECT version FROM plataforma.policy WHERE kind = $1 AND content_hash = $2`, [kind, hash])).rows[0];
  if (same) return { version: same.version, created: false };
  const r = await db.query<{ version: number }>(`INSERT INTO plataforma.policy (tenant_id, kind, version, content, content_hash, note, created_by) VALUES (plataforma.current_tenant_id(), $1, (SELECT COALESCE(max(version), 0) + 1 FROM plataforma.policy WHERE kind = $1), $2::jsonb, $3, $4, $5) RETURNING version`, [kind, JSON.stringify(content), hash, note.slice(0, 500), actor]);
  return { version: r.rows[0]!.version, created: true };
}

export interface EntityInput { readonly entityType: string; readonly sourceKey: string; readonly name: string; readonly aliases?: readonly string[]; readonly externalIds?: Readonly<Record<string, string>> }
/** Registra entidades que ainda não existem (por tipo + chave da fonte). Idempotente; devolve o id de cada chave. */
export async function upsertEntities(db: TenantDb, entities: readonly EntityInput[]): Promise<Map<string, string>> {
  if (entities.length > 0) await db.query(
    `INSERT INTO plataforma.entity (tenant_id, entity_type, source_key, name, aliases, external_ids)
     SELECT plataforma.current_tenant_id(), x.entity_type, x.source_key, x.name, x.aliases, x.external_ids FROM jsonb_to_recordset($1::jsonb) AS x(entity_type text, source_key text, name text, aliases text[], external_ids jsonb)
     ON CONFLICT (tenant_id, entity_type, source_key) DO NOTHING`, [JSON.stringify(entities.map((e) => ({ entity_type: e.entityType, source_key: e.sourceKey, name: e.name, aliases: e.aliases ?? [], external_ids: e.externalIds ?? {} })))]);
  const keys = entities.map((e) => `${e.entityType}|${e.sourceKey}`);
  const r = await db.query<{ id: string; entity_type: string; source_key: string }>(`SELECT id, entity_type, source_key FROM plataforma.entity WHERE (entity_type || '|' || source_key) = ANY($1::text[])`, [keys]);
  return new Map(r.rows.map((x) => [`${x.entity_type}|${x.source_key}`, x.id]));
}
export async function entityCounts(db: TenantDb): Promise<Record<string, number>> {
  const r = await db.query<{ entity_type: string; n: string }>(`SELECT entity_type, count(*) AS n FROM plataforma.entity WHERE status = 'ACTIVE' GROUP BY entity_type`);
  return Object.fromEntries(r.rows.map((x) => [x.entity_type, Number(x.n)]));
}

export interface FactInput {
  readonly entityId: string; readonly attributeId: string; readonly value: unknown; readonly unit?: string | null;
  readonly sourceName: string; readonly sourceUrl?: string | null; readonly sourceLicense?: string | null;
  readonly observedAt: Date; readonly observedPrecision?: "day" | "month" | "year"; readonly confidence: number;
  readonly geospatialPrecision?: "exact" | "street" | "neighborhood" | "city" | null; readonly importRunId?: string | null; readonly providerCallId?: string | null;
}
export class FactError extends Error { constructor(message: string) { super(message); this.name = "FactError"; } }
/** R1: sem fonte, sem data ou sem confiança válida, o fato NÃO entra (nunca preenchido por padrão). */
export function validateFact(f: FactInput): string[] {
  const e: string[] = [];
  if (!f.sourceName || f.sourceName.trim() === "") e.push("fato sem fonte");
  if (!(f.observedAt instanceof Date) || Number.isNaN(f.observedAt.getTime())) e.push("fato sem data observada");
  if (!(typeof f.confidence === "number" && f.confidence >= 0 && f.confidence <= 1)) e.push("confiança fora de 0..1");
  if (f.value === undefined || f.value === null) e.push("valor ausente: ausência não é gravada como fato");
  if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(f.attributeId)) e.push("id de atributo inválido");
  return e;
}
const factHash = (f: FactInput): string => sha(canon({ v: f.value, u: f.unit ?? null, s: f.sourceName, url: f.sourceUrl ?? null, l: f.sourceLicense ?? null, o: f.observedAt.toISOString(), p: f.observedPrecision ?? "day", c: f.confidence, g: f.geospatialPrecision ?? null }));

export interface RecordFactsResult { readonly inserted: number; readonly unchanged: number; readonly superseded: number }
/** Grava fatos de forma idempotente e bi-temporal: igual ao corrente = nada; diferente = encerra o corrente (superseded_at) e insere o novo. Qualquer fato inválido lança ANTES de gravar. */
export async function recordFacts(db: TenantDb, facts: readonly FactInput[], now: Date): Promise<RecordFactsResult> {
  const problems = facts.flatMap((f, i) => validateFact(f).map((p) => `#${i} ${f.attributeId}: ${p}`));
  if (problems.length > 0) throw new FactError(`fatos inválidos (nada foi gravado): ${problems.slice(0, 5).join("; ")}`);
  if (facts.length === 0) return { inserted: 0, unchanged: 0, superseded: 0 };
  const attrs = [...new Set(facts.map((f) => f.attributeId))];
  const cur = await db.query<{ id: string; entity_id: string; attribute_id: string; content_hash: string }>(`SELECT id, entity_id, attribute_id, content_hash FROM plataforma.fact WHERE superseded_at IS NULL AND attribute_id = ANY($1::text[])`, [attrs]);
  const current = new Map(cur.rows.map((r) => [`${r.entity_id}|${r.attribute_id}`, r]));
  const toInsert: FactInput[] = []; const toClose: string[] = []; let unchanged = 0;
  const seen = new Set<string>();
  for (const f of facts) {
    const key = `${f.entityId}|${f.attributeId}`;
    if (seen.has(key)) throw new FactError(`fato repetido no mesmo lote para ${key}`);
    seen.add(key);
    const c = current.get(key);
    if (c && c.content_hash === factHash(f)) { unchanged++; continue; }
    if (c) toClose.push(c.id);
    toInsert.push(f);
  }
  if (toClose.length > 0) await db.query(`UPDATE plataforma.fact SET superseded_at = $2 WHERE id = ANY($1::uuid[]) AND superseded_at IS NULL`, [toClose, now]);
  if (toInsert.length > 0) await db.query(
    `INSERT INTO plataforma.fact (tenant_id, entity_id, attribute_id, value, unit, source_name, source_url, source_license, observed_at, observed_precision, ingested_at, confidence, geospatial_precision, import_run_id, provider_call_id, content_hash)
     SELECT plataforma.current_tenant_id(), x.entity_id, x.attribute_id, x.value, x.unit, x.source_name, x.source_url, x.source_license, x.observed_at, x.observed_precision, $2, x.confidence, x.geospatial_precision, x.import_run_id, x.provider_call_id, x.content_hash
       FROM jsonb_to_recordset($1::jsonb) AS x(entity_id uuid, attribute_id text, value jsonb, unit text, source_name text, source_url text, source_license text, observed_at timestamptz, observed_precision text, confidence numeric, geospatial_precision text, import_run_id uuid, provider_call_id uuid, content_hash text)`,
    [JSON.stringify(toInsert.map((f) => ({ entity_id: f.entityId, attribute_id: f.attributeId, value: f.value, unit: f.unit ?? null, source_name: f.sourceName, source_url: f.sourceUrl ?? null, source_license: f.sourceLicense ?? null, observed_at: f.observedAt.toISOString(), observed_precision: f.observedPrecision ?? "day", confidence: f.confidence, geospatial_precision: f.geospatialPrecision ?? null, import_run_id: f.importRunId ?? null, provider_call_id: f.providerCallId ?? null, content_hash: factHash(f) }))), now]);
  return { inserted: toInsert.length, unchanged, superseded: toClose.length };
}
export async function currentFacts(db: TenantDb, attributeIds?: readonly string[]): Promise<FactSample[]> {
  const r = await db.query<{ entity_id: string; attribute_id: string; value: unknown; observed_at: Date; confidence: string }>(
    `SELECT f.entity_id, f.attribute_id, f.value, f.observed_at, f.confidence FROM plataforma.fact f JOIN plataforma.entity e ON e.id = f.entity_id AND e.tenant_id = f.tenant_id
      WHERE f.superseded_at IS NULL AND e.status = 'ACTIVE' AND ($1::text[] IS NULL OR f.attribute_id = ANY($1::text[]))`, [attributeIds ? [...attributeIds] : null]);
  return r.rows.map((x) => ({ entityId: x.entity_id, attributeId: x.attribute_id, value: x.value, observedAt: x.observed_at, confidence: Number(x.confidence) }));
}

export interface CatalogResult { readonly runId: string; readonly created: boolean; readonly policyVersion: number; readonly stats: readonly AttributeStat[] }
/** Executa o Attribute Discovery sobre os fatos correntes e grava o catálogo. Idempotente: mesmos fatos + mesma política + mesmo dia = a mesma execução. */
export async function runCatalog(db: TenantDb, pack: CatalogPack, now: Date, actor: string): Promise<CatalogResult> {
  const problems = validatePack(pack);
  if (problems.length > 0) throw new TypeError(`pack inválido: ${problems.join("; ")}`);
  const policy = await ensurePolicy(db, "attribute_discovery", pack.defaultPolicy, actor);
  const stats = discoverAttributes({ definitions: pack.attributes, entityCounts: await entityCounts(db), facts: await currentFacts(db, pack.attributes.map((a) => a.attributeId)), policy: policy.content, now });
  const hash = statsHash(stats, `${policy.hash}|${now.toISOString().slice(0, 10)}`);
  const ex = (await db.query<{ id: string }>(`SELECT id FROM plataforma.catalog_run WHERE inputs_hash = $1`, [hash])).rows[0];
  if (ex) return { runId: ex.id, created: false, policyVersion: policy.version, stats };
  const run = (await db.query<{ id: string }>(`INSERT INTO plataforma.catalog_run (tenant_id, policy_id, inputs_hash, computed_at, stats, created_by) VALUES (plataforma.current_tenant_id(), $1, $2, $3, $4::jsonb, $5) RETURNING id`,
    [policy.id, hash, now, JSON.stringify({ attributes: stats.length, byStatus: stats.reduce<Record<string, number>>((m, s) => ({ ...m, [s.status]: (m[s.status] ?? 0) + 1 }), {}) }), actor])).rows[0]!;
  await db.query(
    `INSERT INTO plataforma.attribute_catalog (tenant_id, catalog_run_id, attribute_id, entity_type, attribute_name, data_type, origin, semantic_category, source, source_quality, entities_total, entities_with_value, coverage, freshness_days, confidence, distribution, derivation_method, related_entities, supported_intents, potential_page_families, usable_as_fact, validation_status, reasons)
     SELECT plataforma.current_tenant_id(), $1, x.attribute_id, x.entity_type, x.attribute_name, x.data_type, x.origin, x.semantic_category, x.source, x.source_quality, x.entities_total, x.entities_with_value, x.coverage, x.freshness_days, x.confidence, x.distribution, x.derivation_method, x.related_entities, x.supported_intents, x.potential_page_families, x.usable_as_fact, x.validation_status, x.reasons
       FROM jsonb_to_recordset($2::jsonb) AS x(attribute_id text, entity_type text, attribute_name text, data_type text, origin text, semantic_category text, source text, source_quality numeric, entities_total int, entities_with_value int, coverage numeric, freshness_days int, confidence numeric, distribution jsonb, derivation_method text, related_entities text[], supported_intents text[], potential_page_families text[], usable_as_fact boolean, validation_status text, reasons jsonb)`,
    [run.id, JSON.stringify(stats.map((s) => ({ attribute_id: s.definition.attributeId, entity_type: s.definition.entityType, attribute_name: s.definition.name, data_type: s.definition.dataType, origin: s.definition.origin, semantic_category: s.definition.semanticCategory, source: s.definition.source, source_quality: s.definition.sourceQuality, entities_total: s.entitiesTotal, entities_with_value: s.entitiesWithValue, coverage: s.coverage, freshness_days: s.freshnessDays, confidence: s.confidence, distribution: s.distribution, derivation_method: s.definition.derivationMethod, related_entities: s.definition.relatedEntities, supported_intents: s.definition.supportedIntents, potential_page_families: s.definition.potentialPageFamilies, usable_as_fact: s.usableAsFact, validation_status: s.status, reasons: s.reasons })))]);
  return { runId: run.id, created: true, policyVersion: policy.version, stats };
}
export async function latestCatalog(db: TenantDb): Promise<{ runId: string; computedAt: Date; policyVersion: number; rows: { attributeId: string; entityType: string; status: string; coverage: number | null; entitiesTotal: number; entitiesWithValue: number; freshnessDays: number | null; confidence: number | null; reasons: string[]; origin: string; usableAsFact: boolean }[] } | null> {
  const run = (await db.query<{ id: string; computed_at: Date; version: number }>(`SELECT c.id, c.computed_at, p.version FROM plataforma.catalog_run c JOIN plataforma.policy p ON p.id = c.policy_id AND p.tenant_id = c.tenant_id ORDER BY c.computed_at DESC, c.id LIMIT 1`)).rows[0];
  if (!run) return null;
  const r = await db.query<{ attribute_id: string; entity_type: string; validation_status: string; coverage: string | null; entities_total: number; entities_with_value: number; freshness_days: number | null; confidence: string | null; reasons: string[]; origin: string; usable_as_fact: boolean }>(`SELECT attribute_id, entity_type, validation_status, coverage, entities_total, entities_with_value, freshness_days, confidence, reasons, origin, usable_as_fact FROM plataforma.attribute_catalog WHERE catalog_run_id = $1 ORDER BY attribute_id`, [run.id]);
  return { runId: run.id, computedAt: run.computed_at, policyVersion: run.version, rows: r.rows.map((x) => ({ attributeId: x.attribute_id, entityType: x.entity_type, status: x.validation_status, coverage: x.coverage === null ? null : Number(x.coverage), entitiesTotal: x.entities_total, entitiesWithValue: x.entities_with_value, freshnessDays: x.freshness_days, confidence: x.confidence === null ? null : Number(x.confidence), reasons: x.reasons, origin: x.origin, usableAsFact: x.usable_as_fact })) };
}
export type { AttributeDefinition };
