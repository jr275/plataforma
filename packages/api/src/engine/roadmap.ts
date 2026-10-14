import type { TenantDb } from "../tenant-context";
import { isState, type LifecycleState } from "./lifecycle";
import type { VerticalDefinition } from "./vertical";

// Roadmap (ADR-024): leitura derivada, sem tabela própria. Agrupa as oportunidades por PRONTIDÃO e soma os bloqueios (o que destrava mais trabalho vem primeiro).
export const LANES = ["ready", "blocked", "awaiting_blueprint", "needs_work"] as const;
export type Lane = (typeof LANES)[number];
export const LANE_LABEL: Record<Lane, string> = { ready: "Pronta para construir", blocked: "Bloqueada", awaiting_blueprint: "Elegível, aguardando blueprint ou SERP", needs_work: "Ainda não elegível" };

export interface RoadmapItem { readonly id: string; readonly query: string; readonly intent: string; readonly experience: string; readonly status: LifecycleState; readonly priority: number | null; readonly priorityKind: string | null; readonly lane: Lane; readonly blockers: readonly string[]; /** Os mesmos bloqueios, em texto legível. */ readonly blockerLabels: readonly string[]; readonly blueprintVersion: number | null }
export interface BlockerSummary { readonly key: string; readonly label: string; readonly lane: Lane; readonly count: number }
export interface Roadmap { readonly counts: Readonly<Record<Lane, number>>; readonly items: Readonly<Record<Lane, readonly RoadmapItem[]>>; readonly blockers: readonly BlockerSummary[]; readonly total: number;
  /** Quantas oportunidades estão em cada estado do ciclo de vida (as que ainda estão em andamento). */ readonly byStatus: Readonly<Record<string, number>> }

interface Row { id: string; primary_query: string; intent: string; experience: string; status: string; priority_value: string | null; priority_kind: string | null; eligible: boolean | null; version: number | null; ready: boolean | null; blockers: { key: string }[] | null; failed_checks: string[] | null; waiver_pending: boolean }

/** Classifica uma linha: a faixa e os bloqueios que a explicam. Puro. */
export function classify(r: { status: LifecycleState; eligible: boolean | null; ready: boolean | null; blueprintBlockers: readonly string[] | null; failedEligibility: readonly string[]; /** Há exceção de SERP vigente (não revisada) no histórico. */ serpWaiverPending?: boolean }): { lane: Lane; blockers: string[] } {
  // Blueprint pronto mas a oportunidade ainda é "elegível"/"SERP analisada": falta a etapa de SERP (analisar com provedor ou registrar a exceção). Não é "pronta para construir".
  if (r.ready === true && r.status === "eligible") return { lane: "awaiting_blueprint", blockers: ["serp_pending"] };
  if (r.ready === true && r.status === "serp_analyzed") return { lane: "awaiting_blueprint", blockers: [] };
  if (r.ready === true) return { lane: "ready", blockers: r.serpWaiverPending ? ["serp_waiver"] : [] };
  if (r.ready === false) return { lane: "blocked", blockers: [...new Set(r.blueprintBlockers ?? [])] };
  if (r.eligible === true && (r.status === "eligible" || r.status === "serp_analyzed")) return { lane: "awaiting_blueprint", blockers: [] };
  return { lane: "needs_work", blockers: r.failedEligibility.map((c) => `eligibility:${c}`) };
}

const ELIGIBILITY_LABEL: Record<string, string> = {
  commercial_value_min: "Valor comercial abaixo do mínimo", execution_feasibility_min: "Viabilidade abaixo do mínimo", cannibalization_max: "Risco de canibalização acima do máximo",
  evidence_risk_max: "Risco de evidência acima do máximo (dado ausente)", demand_or_strategic: "Sem demanda medida e sem justificativa estratégica da vertical",
};
export function describeBlocker(key: string, vertical: VerticalDefinition): string {
  const [kind, rest = ""] = key.split(":");
  if (kind === "eligibility") return ELIGIBILITY_LABEL[rest] ?? `Elegibilidade: ${rest}`;
  if (kind === "template") return `Falta template para a experiência "${vertical.experiences.find((e) => e.id === rest)?.label ?? rest}"`;
  if (kind === "template_entity") return `Nenhum template atende o tipo de entidade da experiência "${vertical.experiences.find((e) => e.id === rest)?.label ?? rest}"`;
  if (kind === "experience") return `A experiência "${vertical.experiences.find((e) => e.id === rest)?.label ?? rest}" ainda não é suportada pela plataforma`;
  if (kind === "evidence") return `Falta evidência crítica: ${vertical.evidenceRequirements.find((r) => r.id === rest)?.label ?? rest}`;
  if (kind === "facts") return "Faltam dados da entidade com origem registrada";
  return { serp_pending: "Etapa SERP pendente: analisar com um provedor de SERP ou registrar a exceção (não autoriza publicação)", serp_waiver: "Exceção de SERP vigente: a SERP não foi analisada e a exceção ainda não foi revisada", not_eligible: "Oportunidade não elegível", cannibalization: "Canibalização com página existente", path_conflict: "Caminho (URL) já usado por outra entidade", path_invalid: "Caminho (URL) fora do formato" }[key] ?? key;
}

export async function loadRoadmap(db: TenantDb, vertical: VerticalDefinition, opts: { perLane?: number } = {}): Promise<Roadmap> {
  const perLane = Math.min(Math.max(Math.trunc(opts.perLane ?? 25), 1), 200);
  const r = await db.query<Row>(
    `SELECT o.id, o.primary_query, o.intent, o.experience, o.status, o.priority_value, o.priority_kind, o.eligible, b.version, b.ready, b.blockers,
            EXISTS (SELECT 1 FROM plataforma.opportunity_event w WHERE w.opportunity_id = o.id AND w.tenant_id = o.tenant_id AND w.event_type = 'transition' AND w.from_status = 'eligible' AND w.to_status = 'blueprinted' AND w.data->>'serpWaived' = 'true'
                      AND NOT EXISTS (SELECT 1 FROM plataforma.opportunity_event r2 WHERE r2.opportunity_id = o.id AND r2.tenant_id = o.tenant_id AND r2.seq > w.seq AND r2.event_type = 'transition' AND r2.to_status = 'serp_analyzed')) AS waiver_pending,
            COALESCE(jsonb_path_query_array(s.result, '$.eligibility.checks[*] ? (@.ok == false).code') , '[]'::jsonb) AS failed_checks
       FROM plataforma.growth_opportunity o
       LEFT JOIN plataforma.opportunity_score s ON s.id = o.latest_score_id AND s.tenant_id = o.tenant_id
       LEFT JOIN LATERAL (SELECT version, ready, blockers FROM plataforma.page_blueprint pb WHERE pb.opportunity_id = o.id AND pb.tenant_id = o.tenant_id ORDER BY version DESC LIMIT 1) b ON true
      WHERE o.status NOT IN ('discovered', 'validated', 'rejected', 'retired')
      ORDER BY o.priority_value DESC NULLS LAST, o.id`);
  const items: Record<Lane, RoadmapItem[]> = { ready: [], blocked: [], awaiting_blueprint: [], needs_work: [] };
  const counts: Record<Lane, number> = { ready: 0, blocked: 0, awaiting_blueprint: 0, needs_work: 0 };
  const tally = new Map<string, BlockerSummary>();
  const byStatus: Record<string, number> = {};
  for (const x of r.rows) {
    if (!isState(x.status)) continue;
    byStatus[x.status] = (byStatus[x.status] ?? 0) + 1;
    const c = classify({ status: x.status, eligible: x.eligible, ready: x.ready, blueprintBlockers: x.blockers?.map((b) => b.key) ?? null, failedEligibility: x.failed_checks ?? [], serpWaiverPending: x.waiver_pending });
    counts[c.lane]++;
    if (items[c.lane].length < perLane) items[c.lane].push({ id: x.id, query: x.primary_query, intent: x.intent, experience: x.experience, status: x.status, priority: x.priority_value === null ? null : Number(x.priority_value), priorityKind: x.priority_kind, lane: c.lane, blockers: c.blockers, blockerLabels: c.blockers.map((b) => describeBlocker(b, vertical)), blueprintVersion: x.version });
    for (const key of c.blockers) { const id = `${c.lane}|${key}`; const prev = tally.get(id); tally.set(id, prev ? { ...prev, count: prev.count + 1 } : { key, label: describeBlocker(key, vertical), lane: c.lane, count: 1 }); }
  }
  return { counts, items, blockers: [...tally.values()].sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1)), total: r.rows.length, byStatus };
}
