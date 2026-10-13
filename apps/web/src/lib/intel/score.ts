// Opportunity Score EXPLICÁVEL e ILUSTRATIVO. Não há cálculo no backend: tudo é derivado dos níveis qualitativos e das
// ligações do dataset ativo. Dimensões sem dado ficam nulas (nunca inventadas) e reduzem a confiança.
// O score ordena trabalho; não prevê nem garante ranking no Google ou citação em respostas de IA.
import type { Level, Opportunity, WorkspaceData } from "@/data/demo/types";
import type { DataState } from "./data-state";

export const SCORE_VERSION = "v0.1-ilustrativo";

export type DimensionId =
  | "demand" | "intent" | "buyerStage" | "businessValue" | "solutionFit" | "conversionProximity" | "pipelinePotential"
  | "evidenceAvailability" | "informationGain" | "citationPotential" | "serpOpportunity" | "authorityGap"
  | "competition" | "cannibalization" | "evidenceRisk";

export type Dimension = { id: DimensionId; label: string; kind: "driver" | "risk"; defaultWeight: number; help: string };

export const DIMENSIONS: readonly Dimension[] = [
  { id: "demand", label: "Demanda", kind: "driver", defaultWeight: 3, help: "Quanto o universo de buscas pede pelo tema." },
  { id: "intent", label: "Intenção", kind: "driver", defaultWeight: 2, help: "Proximidade da intenção com uma decisão." },
  { id: "buyerStage", label: "Estágio de compra", kind: "driver", defaultWeight: 1, help: "Descoberta, consideração ou decisão." },
  { id: "businessValue", label: "Valor de negócio", kind: "driver", defaultWeight: 3, help: "Ligação com produto ou serviço do tenant." },
  { id: "solutionFit", label: "Aderência da solução", kind: "driver", defaultWeight: 2, help: "Quanto as entidades do tema pertencem ao domínio do tenant." },
  { id: "conversionProximity", label: "Proximidade de conversão", kind: "driver", defaultWeight: 2, help: "Requer dados de conversão conectados." },
  { id: "pipelinePotential", label: "Potencial de pipeline", kind: "driver", defaultWeight: 2, help: "Requer CRM ou dados de receita conectados." },
  { id: "evidenceAvailability", label: "Evidência disponível", kind: "driver", defaultWeight: 3, help: "Fatos verificados com fonte ligados ao tema." },
  { id: "informationGain", label: "Ganho de informação", kind: "driver", defaultWeight: 2, help: "O que podemos dizer que os resultados atuais não dizem." },
  { id: "citationPotential", label: "Potencial de citação", kind: "driver", defaultWeight: 2, help: "Requer observações de respostas de IA." },
  { id: "serpOpportunity", label: "Oportunidade na SERP", kind: "driver", defaultWeight: 2, help: "Requer SERP observada para a consulta." },
  { id: "authorityGap", label: "Gap de autoridade", kind: "driver", defaultWeight: 1, help: "Requer perfil de autoridade dos concorrentes." },
  { id: "competition", label: "Concorrência", kind: "risk", defaultWeight: 2, help: "Quão bem atendido o tema já é." },
  { id: "cannibalization", label: "Risco de canibalização", kind: "risk", defaultWeight: 2, help: "Outras oportunidades disputando o mesmo cluster." },
  { id: "evidenceRisk", label: "Risco de evidência", kind: "risk", defaultWeight: 3, help: "Fatos expirados, em revisão ou fontes com falha." },
];

export type Weights = Record<DimensionId, number>;
export const defaultWeights = (): Weights => Object.fromEntries(DIMENSIONS.map((d) => [d.id, d.defaultWeight])) as Weights;

export type DimensionResult = { id: DimensionId; value: number | null; state: DataState; reason: string };
export type ScoreResult = {
  score: number;
  confidence: "alta" | "média" | "baixa";
  coverage: number;
  dimensions: readonly DimensionResult[];
  missing: readonly DimensionId[];
  version: string;
};

const level: Record<Level, number> = { alta: 1, média: 0.6, baixa: 0.25 };
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function clustersOf(d: WorkspaceData, o: Opportunity): string[] {
  return [...new Set(d.queries.filter((q) => q.opportunityId === o.id).map((q) => q.cluster))];
}

export const buyerStageOf = (o: Opportunity) =>
  ({ informacional: "Descoberta", comparação: "Consideração", transacional: "Decisão" } as const)[o.intent];

function evaluate(d: WorkspaceData, o: Opportunity): DimensionResult[] {
  const knowledge = d.knowledge.filter((k) => o.knowledgeIds.includes(k.id));
  const verified = knowledge.filter((k) => k.status === "verified").length;
  const sources = d.sources.filter((s) => o.sourceIds.includes(s.id));
  const entities = d.entities.filter((e) => o.entityIds.includes(e.id));
  const products = d.entities.filter((e) => e.type === "Produto" || e.type === "Organização");
  const owned = new Set(products.flatMap((p) => [p.id, ...p.relatedIds]));
  const clusters = clustersOf(d, o);
  const rivals = d.opportunities.filter((x) => x.id !== o.id && x.status !== "dismissed" && clustersOf(d, x).some((c) => clusters.includes(c)));
  const findings = d.findings.filter((f) => f.opportunityId === o.id && f.section !== "Lacunas");

  const intentValue = { informacional: 0.45, comparação: 0.75, transacional: 1 }[o.intent];
  const fit = entities.length ? entities.filter((e) => owned.has(e.id)).length / entities.length : 0;
  const evidenceShare = knowledge.length ? verified / knowledge.length : 0;
  const riskWeight = knowledge.reduce((n, k) => n + (k.status === "expired" ? 1 : k.status === "needs_review" ? 0.6 : 0), 0);
  const sourceRisk = sources.some((s) => s.health === "error") ? 0.5 : sources.some((s) => s.health === "stale") ? 0.25 : 0;
  const evidenceRisk = knowledge.length ? Math.min(1, riskWeight / knowledge.length + sourceRisk) : 1;

  return [
    { id: "demand", value: level[o.demand], state: "demo", reason: `Nível de demanda "${o.demand}" registrado no dataset demo.` },
    { id: "intent", value: intentValue, state: "derived", reason: `Intenção ${o.intent}.` },
    { id: "buyerStage", value: intentValue, state: "derived", reason: `Estágio inferido da intenção: ${buyerStageOf(o)}.` },
    {
      id: "businessValue",
      value: entities.some((e) => e.type === "Produto") ? 0.8 : entities.some((e) => owned.has(e.id)) ? 0.55 : 0.3,
      state: "derived",
      reason: entities.some((e) => e.type === "Produto") ? "Liga-se diretamente a um produto do tenant." : "Sem ligação direta com produto; valor indireto.",
    },
    { id: "solutionFit", value: fit, state: "derived", reason: `${pct(fit)} das entidades pertencem ao domínio do tenant.` },
    { id: "conversionProximity", value: null, state: "unavailable", reason: "Nenhuma fonte de conversão conectada." },
    { id: "pipelinePotential", value: null, state: "unavailable", reason: "Nenhum CRM ou dado de receita conectado." },
    { id: "evidenceAvailability", value: knowledge.length ? evidenceShare * 0.7 + level[o.evidence] * 0.3 : 0, state: "derived", reason: `${verified} de ${knowledge.length} fatos ligados estão verificados.` },
    findings.length
      ? { id: "informationGain", value: 0.7, state: "estimated", reason: `Inferido de ${findings.length} observação(ões) editorial(is); não é análise de SERP.` }
      : { id: "informationGain", value: null, state: "unavailable", reason: "Sem observação de concorrência nem SERP para comparar." },
    { id: "citationPotential", value: null, state: "unavailable", reason: "Nenhum provedor de respostas de IA conectado." },
    { id: "serpOpportunity", value: null, state: "unavailable", reason: "SERP não observada para as consultas ligadas." },
    { id: "authorityGap", value: null, state: "unavailable", reason: "Sem perfil de autoridade de concorrentes." },
    { id: "competition", value: level[o.competition], state: "demo", reason: `Concorrência "${o.competition}" registrada no dataset demo.` },
    { id: "cannibalization", value: Math.min(1, rivals.length * 0.4), state: "derived", reason: rivals.length ? `${rivals.length} outra(s) oportunidade(s) no mesmo cluster: ${rivals.map((r) => r.title).join("; ")}.` : "Nenhuma outra oportunidade no mesmo cluster." },
    { id: "evidenceRisk", value: evidenceRisk, state: "derived", reason: knowledge.length ? `${knowledge.length - verified} fato(s) não verificado(s)${sourceRisk ? "; fonte com falha ou desatualizada" : ""}.` : "Nenhum fato ligado: nada pode ser afirmado." },
  ];
}

export function scoreOpportunity(d: WorkspaceData, o: Opportunity, weights: Weights = defaultWeights()): ScoreResult {
  const dims = evaluate(d, o);
  const byId = new Map(DIMENSIONS.map((x) => [x.id, x]));
  let pw = 0, pv = 0, rw = 0, rv = 0, total = 0, available = 0;
  for (const r of dims) {
    const meta = byId.get(r.id)!;
    const w = weights[r.id];
    total += w;
    if (r.value === null) continue;
    available += w;
    if (meta.kind === "driver") { pw += w; pv += w * r.value; } else { rw += w; rv += w * r.value; }
  }
  const drivers = pw ? pv / pw : 0;
  const risk = rw ? rv / rw : 0;
  const coverage = total ? available / total : 0;
  return {
    score: Math.round(100 * drivers * (1 - 0.5 * risk)),
    coverage,
    confidence: coverage >= 0.75 ? "alta" : coverage >= 0.5 ? "média" : "baixa",
    dimensions: dims,
    missing: dims.filter((r) => r.value === null).map((r) => r.id),
    version: SCORE_VERSION,
  };
}

export const dimensionMeta = (id: DimensionId) => DIMENSIONS.find((d) => d.id === id)!;
