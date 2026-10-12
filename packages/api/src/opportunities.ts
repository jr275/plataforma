import type { TenantDb } from "./tenant-context";

// Oportunidades (ADR-014). Funções tipadas que só recebem o `db` entregue por `withTenant`: o isolamento entre tenants é do RLS
// (política da tabela), não de filtros aqui. Nenhuma tela lê o banco direto (regra 4). Fatores separados: não existe nota.

export const OPPORTUNITY_KINDS = ["page", "cluster", "faq", "comparison"] as const;
export const OPPORTUNITY_INTENTS = ["informational", "comparison", "transactional"] as const;
export const OPPORTUNITY_LEVELS = ["high", "medium", "low"] as const;
export const OPPORTUNITY_STATUSES = ["candidate", "in_review", "ready", "blocked", "dismissed"] as const;

export type OpportunityKind = (typeof OPPORTUNITY_KINDS)[number];
export type OpportunityIntent = (typeof OPPORTUNITY_INTENTS)[number];
export type OpportunityLevel = (typeof OPPORTUNITY_LEVELS)[number];
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export interface Opportunity {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly summary: string;
  readonly nextAction: string;
  readonly kind: OpportunityKind;
  readonly intent: OpportunityIntent;
  readonly demand: OpportunityLevel;
  readonly competition: OpportunityLevel;
  readonly evidence: OpportunityLevel;
  readonly status: OpportunityStatus;
  /** Ordem editorial (1 = mais urgente). Não é uma nota. */
  readonly rank: number;
  readonly rationale: readonly string[];
  readonly gaps: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface Row {
  id: string;
  tenant_id: string;
  title: string;
  summary: string;
  next_action: string;
  kind: OpportunityKind;
  intent: OpportunityIntent;
  demand: OpportunityLevel;
  competition: OpportunityLevel;
  evidence: OpportunityLevel;
  status: OpportunityStatus;
  rank: number;
  rationale: string[];
  gaps: string[];
  created_at: Date;
  updated_at: Date;
}

const COLUMNS =
  "id, tenant_id, title, summary, next_action, kind, intent, demand, competition, evidence, status, rank, rationale, gaps, created_at, updated_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toOpportunity(r: Row): Opportunity {
  return Object.freeze({
    id: r.id,
    tenantId: r.tenant_id,
    title: r.title,
    summary: r.summary,
    nextAction: r.next_action,
    kind: r.kind,
    intent: r.intent,
    demand: r.demand,
    competition: r.competition,
    evidence: r.evidence,
    status: r.status,
    rank: r.rank,
    rationale: Object.freeze([...r.rationale]),
    gaps: Object.freeze([...r.gaps]),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
}

export interface ListOpportunitiesOptions {
  /** Estados a incluir. Padrão: todos menos `dismissed`. Passe `["dismissed"]` para ver as descartadas. */
  readonly statuses?: readonly OpportunityStatus[];
}

/** Lista as oportunidades do tenant corrente, na ordem editorial. */
export async function listOpportunities(db: TenantDb, options: ListOpportunitiesOptions = {}): Promise<Opportunity[]> {
  const statuses = options.statuses ?? OPPORTUNITY_STATUSES.filter((s) => s !== "dismissed");
  for (const s of statuses) assertStatus(s);
  const result = await db.query<Row>(`SELECT ${COLUMNS} FROM plataforma.opportunity WHERE status = ANY($1::text[]) ORDER BY rank, id`, [[...statuses]]);
  return result.rows.map(toOpportunity);
}

/** Uma oportunidade do tenant corrente. `undefined` se não existe OU pertence a outro tenant (o chamador não distingue). */
export async function getOpportunity(db: TenantDb, id: string): Promise<Opportunity | undefined> {
  if (!UUID.test(id)) return undefined;
  const result = await db.query<Row>(`SELECT ${COLUMNS} FROM plataforma.opportunity WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? toOpportunity(row) : undefined;
}

/** Altera só o estado. `undefined` se a oportunidade não existe neste tenant. */
export async function setOpportunityStatus(db: TenantDb, id: string, status: OpportunityStatus): Promise<Opportunity | undefined> {
  assertStatus(status);
  if (!UUID.test(id)) return undefined;
  const result = await db.query<Row>(`UPDATE plataforma.opportunity SET status = $2 WHERE id = $1 RETURNING ${COLUMNS}`, [id, status]);
  const row = result.rows[0];
  return row ? toOpportunity(row) : undefined;
}

function assertStatus(value: string): asserts value is OpportunityStatus {
  if (!(OPPORTUNITY_STATUSES as readonly string[]).includes(value)) throw new TypeError(`status de oportunidade inválido: ${value}`);
}
