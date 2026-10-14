import type { TenantDb } from "../tenant-context";
import type { SidraCityFacts } from "../provider/sidra";
import type { Provenance } from "../provider/contract";
import { recordFacts, upsertEntities, type FactInput, type RecordFactsResult } from "./store";

// Entidades e fatos de MUNICÍPIO a partir do que já existe e é verificável: a importação real do IBGE (tabela `city`) e o SIDRA (Censo 2022). Nada é estimado.
// A confiança de cada fato é a qualidade da fonte DECLARADA pelo pack para o atributo (não um valor do código).
export const CITY_ATTRS = { population: "city.population", uf: "city.uf", region: "city.region", censusPopulation: "city.population_census_2022", censusDensity: "city.density_census_2022" } as const;
export type Confidence = Readonly<Record<string, number>>;

const startOfYear = (y: number) => new Date(Date.UTC(y, 0, 1));
/** Cria a entidade `city` de cada município da importação REAL (concluída) e os fatos da fonte. Importações de teste/falhas/em andamento nunca viram fato. Idempotente. */
export async function materializeCities(db: TenantDb, confidence: Confidence, now: Date): Promise<{ entities: number; facts: RecordFactsResult }> {
  const rows = (await db.query<{ id: string; ibge_code: string; name: string; uf: string; region: string | null; population: string | null; population_year: number | null; run_id: string; source_name: string; file_name: string }>(
    `SELECT c.id, c.ibge_code, c.name, c.uf, c.region, c.population, c.population_year, r.id AS run_id, r.source_name, r.file_name
       FROM plataforma.city c JOIN plataforma.import_run r ON r.id = c.source_run_id AND r.tenant_id = c.tenant_id
      WHERE r.origin = 'real' AND r.status NOT IN ('running', 'failed')`)).rows;
  const ids = await upsertEntities(db, rows.map((c) => ({ entityType: "city", sourceKey: `ibge:${c.ibge_code}`, name: c.name, externalIds: { ibge: c.ibge_code } })));
  const facts: FactInput[] = [];
  for (const c of rows) {
    const entityId = ids.get(`city|ibge:${c.ibge_code}`)!;
    const src = { sourceName: `${c.source_name} (arquivo ${c.file_name})`, importRunId: c.run_id, geospatialPrecision: "city" as const };
    const conf = (a: string) => confidence[a] ?? 0; // atributo sem qualidade declarada: confiança 0 (não é aceito como evidência forte)
    if (c.population !== null && c.population_year !== null) facts.push({ ...src, entityId, attributeId: CITY_ATTRS.population, value: Number(c.population), unit: "pessoas", observedAt: startOfYear(c.population_year), observedPrecision: "year", confidence: conf(CITY_ATTRS.population) });
    facts.push({ ...src, entityId, attributeId: CITY_ATTRS.uf, value: c.uf, observedAt: now, observedPrecision: "day", confidence: conf(CITY_ATTRS.uf) });
    if (c.region) facts.push({ ...src, entityId, attributeId: CITY_ATTRS.region, value: c.region, observedAt: now, observedPrecision: "day", confidence: conf(CITY_ATTRS.region) });
  }
  return { entities: ids.size, facts: await recordFacts(db, facts, now) };
}

/** Fatos do Censo 2022 vindos do SIDRA, ligados à resposta bruta (`provider_call`). Só para municípios que já são entidades; valor ausente (null) NÃO vira fato. */
export async function recordSidraFacts(db: TenantDb, items: readonly { facts: SidraCityFacts; provenance: Provenance }[], confidence: Confidence, now: Date): Promise<RecordFactsResult> {
  const codes = items.map((i) => `ibge:${i.facts.ibgeCode}`);
  const found = new Map((await db.query<{ id: string; source_key: string }>(`SELECT id, source_key FROM plataforma.entity WHERE entity_type = 'city' AND source_key = ANY($1::text[])`, [codes])).rows.map((r) => [r.source_key, r.id]));
  const facts: FactInput[] = [];
  for (const { facts: f, provenance: p } of items) {
    const entityId = found.get(`ibge:${f.ibgeCode}`);
    if (!entityId || f.year === null) continue;
    const base = { entityId, sourceName: "IBGE SIDRA, tabela 4714 (Censo Demográfico 2022)", sourceUrl: `https://apisidra.ibge.gov.br/${p.endpoint}`, sourceLicense: "dados abertos do IBGE", observedAt: startOfYear(f.year), observedPrecision: "year" as const, geospatialPrecision: "city" as const, providerCallId: p.callId };
    if (f.population !== null) facts.push({ ...base, attributeId: CITY_ATTRS.censusPopulation, value: f.population, unit: "pessoas", confidence: confidence[CITY_ATTRS.censusPopulation] ?? 0 });
    if (f.densityPerKm2 !== null) facts.push({ ...base, attributeId: CITY_ATTRS.censusDensity, value: f.densityPerKm2, unit: "hab/km²", confidence: confidence[CITY_ATTRS.censusDensity] ?? 0 });
  }
  return recordFacts(db, facts, now);
}
