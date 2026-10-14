import type { VerifiedIdentity } from "../identity";
import { withTenant, type PoolLike, type TenantDb } from "../tenant-context";
import { blueprintHash, buildBlueprint, type Blueprint, type TemplateInfo } from "./blueprint";
import { evaluateExperienceGates, type GateReport } from "./experience-gates";
import { assertTransition, type LifecycleState } from "./lifecycle";
import { OpportunityNotFoundError, StaleStateError, loadCurrentEvidence } from "./store";
import type { VerticalDefinition } from "./vertical";

// Criação e leitura de blueprints (ADR-024). Uma transação por chamada; a oportunidade fica TRAVADA (FOR UPDATE) para duas criações simultâneas não disputarem a versão.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const BLUEPRINT_STATES: readonly LifecycleState[] = ["eligible", "serp_analyzed", "blueprinted"];

export class BlueprintStateError extends Error { readonly code = "BLUEPRINT_STATE"; constructor(readonly status: string) { super(`o blueprint só pode ser criado para oportunidades elegíveis (estado atual: ${status})`); this.name = "BlueprintStateError"; } }

export interface BlueprintDeps { readonly vertical: VerticalDefinition; readonly templates: readonly TemplateInfo[]; readonly now?: () => Date }
export interface BlueprintRecord { readonly id: string; readonly version: number; readonly createdAt: Date; readonly createdBy: string; readonly ready: boolean; readonly templateKey: string | null; readonly contentHash: string; readonly blueprint: Blueprint; readonly report: GateReport }
export interface BlueprintResult { readonly record: BlueprintRecord; readonly created: boolean; /** A oportunidade avançou para "blueprinted" nesta chamada (e por qual caminho). */ readonly transitioned: null | { readonly from: LifecycleState; readonly serpWaived: boolean } }

interface OppRow { id: string; status: string; primary_query: string; intent: string; stage: string; pattern_key: string; experience: string; expected_outcome: string; entity_kind: string | null; entity_id: string | null; eligible: boolean | null; latest_score_id: string | null }
interface BpRow { id: string; version: number; created_at: Date; created_by: string; ready: boolean; template_key: string | null; content_hash: string; content: Blueprint; gates: GateReport["gates"]; blockers: GateReport["blockers"] }
const toRecord = (r: BpRow): BlueprintRecord => ({ id: r.id, version: r.version, createdAt: r.created_at, createdBy: r.created_by, ready: r.ready, templateKey: r.template_key, contentHash: r.content_hash, blueprint: r.content, report: { gates: r.gates, ready: r.ready, blockers: r.blockers } });
const COLS = "id, version, created_at, created_by, ready, template_key, content_hash, content, gates, blockers";

export interface BlueprintInputs { readonly entity: { kind: string; id: string; name: string; qualifier: string | null } | null; readonly facts: Record<string, string | number | null> | null; readonly available: Set<string>; readonly allPaths: readonly { path: string; entity_id: string }[]; readonly cannibalization: number | null; readonly maxCannibalization: number }
/** Reúne, do que está gravado, os insumos do blueprint (e do editor de rascunho): entidade e fatos com origem real, o que existe, caminhos do site e o risco de canibalização. */
export async function loadBlueprintInputs(db: TenantDb, o: { entity_id: string | null; entity_kind: string | null; latest_score_id: string | null }, now: Date): Promise<BlueprintInputs> {
    // dados da entidade (cidade) e a origem dos fatos: só importação REAL conta como fonte (mesma regra da geração)
    let entity: { kind: string; id: string; name: string; qualifier: string | null } | null = null;
    let facts: Record<string, string | number | null> | null = null;
    if (o.entity_id && o.entity_kind === "city") {
      const c = (await db.query<{ id: string; name: string; uf: string; region: string | null; population: string | null; population_year: number | null; ibge_code: string; origin: string; status: string }>(
        `SELECT c.id, c.name, c.uf, c.region, c.population, c.population_year, c.ibge_code, r.origin, r.status FROM plataforma.city c JOIN plataforma.import_run r ON r.id = c.source_run_id AND r.tenant_id = c.tenant_id WHERE c.id = $1`, [o.entity_id])).rows[0];
      if (c) {
        entity = { kind: "city", id: c.id, name: c.name, qualifier: c.uf };
        facts = c.origin === "real" && c.status !== "running" && c.status !== "failed"
          ? { name: c.name, uf: c.uf, region: c.region, population: c.population === null ? null : Number(c.population), population_year: c.population_year, ibge_code: c.ibge_code } : null;
      }
    }
    const cityCount = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.city`)).rows[0]!.n);
    const available = new Set<string>(cityCount > 0 ? ["entities"] : []);
    for (const e of await loadCurrentEvidence(db, now)) { if (e.draft.kind === "indicator") available.add(`indicator:${e.draft.sourceRef}`); else available.add(`news:${e.draft.adapter}`); }
    const paths = await db.query<{ path: string; entity_id: string }>(`SELECT path, entity_id FROM plataforma.page`);

    // canibalização e limite vêm do score que sustenta a elegibilidade
    let cannibalization: number | null = null;
    let maxCannibalization = 1;
    if (o.latest_score_id) {
      const s = (await db.query<{ dims: { cannibalization_risk?: { value: number | null } }; max: string | null }>(`SELECT s.dimensions AS dims, c.config #>> '{eligibility,maxCannibalizationRisk}' AS max FROM plataforma.opportunity_score s JOIN plataforma.score_config c ON c.id = s.config_id AND c.tenant_id = s.tenant_id WHERE s.id = $1`, [o.latest_score_id])).rows[0];
      cannibalization = s?.dims.cannibalization_risk?.value ?? null;
      maxCannibalization = s?.max === null || s?.max === undefined ? 1 : Number(s.max);
    }

  return { entity, facts, available, allPaths: paths.rows, cannibalization, maxCannibalization };
}

export async function createBlueprint(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, deps: BlueprintDeps, input: { opportunityId: string }): Promise<BlueprintResult> {
  if (!UUID.test(input.opportunityId)) throw new OpportunityNotFoundError();
  const now = (deps.now ?? (() => new Date()))();
  return withTenant(pool, identity, tenantId, async (db) => {
    const o = (await db.query<OppRow>(`SELECT id, status, primary_query, intent, stage, pattern_key, experience, expected_outcome, entity_kind, entity_id, eligible, latest_score_id FROM plataforma.growth_opportunity WHERE id = $1 FOR UPDATE`, [input.opportunityId])).rows[0];
    if (!o) throw new OpportunityNotFoundError();
    if (!(BLUEPRINT_STATES as readonly string[]).includes(o.status)) throw new BlueprintStateError(o.status);

    const inp = await loadBlueprintInputs(db, o, now);
    const { entity, facts, available, cannibalization, maxCannibalization } = inp;
    const paths = { rows: inp.allPaths };
    const blueprint = buildBlueprint({
      vertical: deps.vertical, templates: deps.templates, available, entityFacts: facts, existingPaths: new Set(paths.rows.filter((p) => p.entity_id !== o.entity_id).map((p) => p.path)), knownPaths: new Set(paths.rows.map((p) => p.path)), cannibalizationRisk: cannibalization, maxCannibalizationRisk: maxCannibalization,
      opportunity: { id: o.id, primaryQuery: o.primary_query, intent: o.intent, stage: o.stage, pattern: o.pattern_key, experience: o.experience, expectedOutcome: o.expected_outcome, eligible: o.eligible, scoreId: o.latest_score_id, entity: entity ? { kind: entity.kind, id: entity.id, name: entity.name, qualifier: entity.qualifier } : null },
    });
    const report = evaluateExperienceGates(blueprint);
    const hash = blueprintHash(blueprint);

    const ins = await db.query<BpRow>(
      `INSERT INTO plataforma.page_blueprint (tenant_id, opportunity_id, version, content, content_hash, template_key, template_version, ready, gates, blockers, created_by)
       VALUES (plataforma.current_tenant_id(), $1, (SELECT COALESCE(max(version), 0) + 1 FROM plataforma.page_blueprint WHERE opportunity_id = $1), $2::jsonb, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
       ON CONFLICT (tenant_id, opportunity_id, content_hash) DO NOTHING RETURNING ${COLS}`,
      [o.id, JSON.stringify(blueprint), hash, blueprint.template.key, blueprint.template.version, report.ready, JSON.stringify(report.gates), JSON.stringify(report.blockers), identity.userId]);
    const created = ins.rows.length > 0;
    const row = ins.rows[0] ?? (await db.query<BpRow>(`SELECT ${COLS} FROM plataforma.page_blueprint WHERE opportunity_id = $1 AND content_hash = $2`, [o.id, hash])).rows[0]!;

    if (created) {
      await db.query(`INSERT INTO plataforma.opportunity_event (tenant_id, opportunity_id, event_type, actor, reason, data) VALUES (plataforma.current_tenant_id(), $1, 'blueprint', $2, $3, $4::jsonb)`,
        [o.id, identity.userId, report.ready ? `blueprint v${row.version} pronto: nenhum gate reprovou` : `blueprint v${row.version} com bloqueios: ${[...new Set(report.blockers.map((b) => b.key))].join(", ")}`, JSON.stringify({ version: row.version, ready: report.ready, hash, blockers: report.blockers.map((b) => b.key) })]);
    }
    // Só a etapa SERP cumprida (serp_analyzed) avança sozinha. De "elegível" o avanço exige a EXCEÇÃO explícita (applySerpWaiver, ADR-025): nunca automática.
    let transitioned: BlueprintResult["transitioned"] = null;
    const from = o.status as LifecycleState;
    if (report.ready && from === "serp_analyzed") {
      assertTransition(from, "blueprinted");
      const u = await db.query<{ id: string }>(`UPDATE plataforma.growth_opportunity SET status = 'blueprinted' WHERE id = $1 AND status = $2 RETURNING id`, [o.id, from]);
      if (u.rows.length === 0) throw new StaleStateError(from, "outro");
      await db.query(`INSERT INTO plataforma.opportunity_event (tenant_id, opportunity_id, event_type, from_status, to_status, actor, reason, data) VALUES (plataforma.current_tenant_id(), $1, 'transition', $2, 'blueprinted', $3, $4, $5::jsonb)`,
        [o.id, from, identity.userId, `blueprint v${row.version} pronto`, JSON.stringify({ serpWaived: false, blueprintVersion: row.version })]);
      transitioned = { from, serpWaived: false };
    }
    return { record: toRecord(row), created, transitioned };
  });
}

export async function listBlueprints(db: TenantDb, opportunityId: string): Promise<BlueprintRecord[]> {
  if (!UUID.test(opportunityId)) return [];
  return (await db.query<BpRow>(`SELECT ${COLS} FROM plataforma.page_blueprint WHERE opportunity_id = $1 ORDER BY version DESC`, [opportunityId])).rows.map(toRecord);
}

export class WaiverError extends Error { readonly code = "SERP_WAIVER"; constructor(message: string) { super(message); this.name = "WaiverError"; } }

/**
 * EXCEÇÃO explícita (ADR-025): avança "elegível" -> "com blueprint" sem a análise de SERP, enquanto não há provedor de SERP operacional.
 * Exige blueprint PRONTO e motivo escrito; grava autor, horário (do evento), motivo e `serp: not_evaluated`. NÃO autoriza publicação e é revisável.
 */
export async function applySerpWaiver(pool: PoolLike, identity: VerifiedIdentity, tenantId: string, input: { opportunityId: string; reason: string }): Promise<{ blueprintVersion: number }> {
  if (!UUID.test(input.opportunityId)) throw new OpportunityNotFoundError();
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 1000) throw new WaiverError("o motivo da exceção precisa ter de 10 a 1000 caracteres");
  return withTenant(pool, identity, tenantId, async (db) => {
    const o = (await db.query<{ status: string }>(`SELECT status FROM plataforma.growth_opportunity WHERE id = $1 FOR UPDATE`, [input.opportunityId])).rows[0];
    if (!o) throw new OpportunityNotFoundError();
    if (o.status !== "eligible") throw new BlueprintStateError(o.status);
    const bp = (await db.query<{ version: number; ready: boolean }>(`SELECT version, ready FROM plataforma.page_blueprint WHERE opportunity_id = $1 ORDER BY version DESC LIMIT 1`, [input.opportunityId])).rows[0];
    if (!bp) throw new WaiverError("gere o blueprint antes de registrar a exceção");
    if (!bp.ready) throw new WaiverError("o blueprint mais recente tem gates reprovados: a exceção de SERP não resolve bloqueios");
    assertTransition("eligible", "blueprinted");
    const u = await db.query<{ id: string }>(`UPDATE plataforma.growth_opportunity SET status = 'blueprinted' WHERE id = $1 AND status = 'eligible' RETURNING id`, [input.opportunityId]);
    if (u.rows.length === 0) throw new StaleStateError("eligible", "outro");
    await db.query(`INSERT INTO plataforma.opportunity_event (tenant_id, opportunity_id, event_type, from_status, to_status, actor, reason, data) VALUES (plataforma.current_tenant_id(), $1, 'transition', 'eligible', 'blueprinted', $2, $3, $4::jsonb)`,
      [input.opportunityId, identity.userId, `EXCEÇÃO de SERP: ${reason}`, JSON.stringify({ serpWaived: true, serp: "not_evaluated", reviewable: true, authorizesPublication: false, blueprintVersion: bp.version, waiverReason: reason })]);
    return { blueprintVersion: bp.version };
  });
}

export interface SerpWaiver { readonly reason: string; readonly actor: string; readonly at: Date; readonly blueprintVersion: number | null; /** Já revisada: a oportunidade passou depois por "SERP analisada" com provedor. */ readonly reviewed: boolean }
/** A exceção de SERP vigente no histórico (a última), se houver. Puro. */
export function findSerpWaiver(events: readonly { type: string; from: string | null; to: string | null; actor: string; at: Date; reason: string | null; data: Record<string, unknown> }[]): SerpWaiver | null {
  const i = events.map((e) => e.type === "transition" && e.from === "eligible" && e.to === "blueprinted" && e.data.serpWaived === true).lastIndexOf(true);
  if (i < 0) return null;
  const e = events[i]!;
  return { reason: String(e.data.waiverReason ?? e.reason ?? ""), actor: e.actor, at: e.at, blueprintVersion: typeof e.data.blueprintVersion === "number" ? e.data.blueprintVersion : null, reviewed: events.slice(i + 1).some((x) => x.type === "transition" && x.to === "serp_analyzed") };
}
