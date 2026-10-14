import { DIMENSION_INFO } from "./score-config";
import { describeBlocker, type Lane } from "./roadmap";
import type { LifecycleState } from "./lifecycle";
import type { ScoreResult } from "./score";
import type { VerticalDefinition } from "./vertical";

// Resumo operacional de uma oportunidade (puro): responde, a partir do que está gravado, "o que sei, de onde, o que falta, o que bloqueia e qual é o próximo passo".
export interface InvestigationInput {
  readonly status: LifecycleState; readonly score: ScoreResult | null;
  readonly evidence: readonly { readonly adapter: string; readonly role: "signal" | "requirement" }[];
  readonly blueprint: null | { readonly version: number; readonly ready: boolean; readonly blockers: readonly string[] };
  readonly serpWaiver: null | { readonly reviewed: boolean };
}
export interface NextAction { readonly kind: "action" | "decision" | "blocked" | "wait"; readonly label: string; readonly detail: string }
export interface Investigation {
  readonly known: readonly string[]; readonly sources: readonly { readonly adapter: string; readonly count: number }[]; readonly missing: readonly string[];
  readonly blockers: readonly { readonly key: string; readonly label: string }[]; readonly lane: Lane | null; readonly next: NextAction;
}

export function investigate(i: InvestigationInput, v: VerticalDefinition): Investigation {
  const known: string[] = [];
  const by = new Map<string, number>();
  for (const e of i.evidence) by.set(e.adapter, (by.get(e.adapter) ?? 0) + 1);
  if (i.score) {
    const o = i.score.objectives;
    const n = (["commercial_value", "execution_feasibility", "discovery_opportunity"] as const).filter((k) => o[k].adjusted !== null).length;
    known.push(`${n} de 3 objetivos do score calculados (confiança ${Math.round(i.score.confidence * 100)}%)`);
    known.push(`${15 - i.score.missing.length} de 15 dimensões com dado`);
  }
  if (i.evidence.length > 0) known.push(`${i.evidence.length} evidência(s) real(is) ligada(s), de ${by.size} fonte(s)`);
  const missing = (i.score?.missing ?? []).map((m) => `${DIMENSION_INFO[m.dimension].label}: ${m.needs}`);
  const blockers: { key: string; label: string }[] = [];
  const add = (key: string) => { if (!blockers.some((b) => b.key === key)) blockers.push({ key, label: describeBlocker(key, v) }); };
  let lane: Lane | null = null;
  let next: NextAction;
  const s = i.status;
  if (s === "rejected" || s === "retired") { next = { kind: "wait", label: s === "retired" ? "Encerrada" : "Rejeitada", detail: s === "retired" ? "Nada a fazer: a oportunidade foi aposentada." : "A validação da vertical a recusou; pode ser reaberta com motivo." }; return { known, sources: [...by].map(([adapter, count]) => ({ adapter, count })), missing, blockers, lane, next }; }
  if (!i.score) next = { kind: "wait", label: "Aguardando score", detail: "Uma nova pesquisa calcula o score das oportunidades validadas." };
  else if (i.blueprint?.ready === true && s !== "eligible" && s !== "serp_analyzed") { lane = "ready"; next = { kind: "decision", label: "Pronta para construir", detail: "Blueprint pronto. As etapas seguintes (dados, QA, publicação) ainda não têm fluxo implementado; publicar depende da decisão do dono." }; }
  else if (i.blueprint?.ready === true) { lane = "awaiting_blueprint"; if (s === "eligible") add("serp_pending"); next = s === "serp_analyzed" ? { kind: "action", label: "Reavaliar o blueprint", detail: "Com a SERP analisada, reavaliar o blueprint avança a oportunidade." } : { kind: "decision", label: "Registrar a exceção de SERP", detail: "O blueprint está pronto, mas a SERP não foi analisada (sem provedor). Avançar exige uma exceção escrita; ela não autoriza publicação." }; }
  else if (i.blueprint) { lane = "blocked"; for (const b of i.blueprint.blockers) add(b); next = { kind: "blocked", label: "Resolver os bloqueios do blueprint", detail: "Os gates que reprovaram dependem de template, evidência ou dados que ainda não existem." }; }
  else if (s === "eligible" || s === "serp_analyzed") { lane = "awaiting_blueprint"; next = { kind: "action", label: "Gerar o blueprint", detail: "Elegível: monte o plano da página e avalie os seis gates." }; }
  else { lane = "needs_work"; for (const c of i.score.eligibility.checks.filter((x) => !x.ok)) add(`eligibility:${c.code}`); next = { kind: "blocked", label: "Ainda não elegível", detail: "Não passa na elegibilidade da vertical. Ordenar por prioridade parcial não substitui os critérios." }; }
  if (i.serpWaiver && !i.serpWaiver.reviewed) add("serp_waiver");
  return { known, sources: [...by].map(([adapter, count]) => ({ adapter, count })), missing, blockers, lane, next };
}
