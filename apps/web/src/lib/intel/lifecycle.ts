// Ciclo de vida de uma oportunidade. A etapa é DERIVADA do que o dataset comprova: nenhuma oportunidade passa de
// "QA" porque não existe estado verificado de publicação, indexação ou medição.
import type { Opportunity, WorkspaceData } from "@/data/demo/types";

export const STAGES = [
  { id: "discovered", label: "Descoberta" },
  { id: "validated", label: "Validada" },
  { id: "scored", label: "Pontuada" },
  { id: "eligible", label: "Elegível" },
  { id: "serp_analyzed", label: "SERP analisada" },
  { id: "blueprinted", label: "Blueprint" },
  { id: "data_assembled", label: "Dados montados" },
  { id: "evidence_validated", label: "Evidência validada" },
  { id: "experience_built", label: "Experiência gerada" },
  { id: "qa", label: "QA" },
  { id: "published", label: "Publicada" },
  { id: "indexed", label: "Indexada" },
  { id: "monitored", label: "Monitorada" },
  { id: "converted", label: "Convertendo" },
  { id: "measured", label: "Medida" },
  { id: "learned", label: "Aprendizado" },
  { id: "refreshed", label: "Atualizada / Retirada" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];
export const stageLabel = (id: StageId) => STAGES.find((s) => s.id === id)!.label;
export const stageIndex = (id: StageId) => STAGES.findIndex((s) => s.id === id);

/** Etapas a partir de "published" exigem um estado verificado que este produto ainda não grava. */
export const UNVERIFIABLE_FROM: StageId = "published";

export type Lifecycle = {
  stage: StageId;
  reached: ReadonlySet<StageId>;
  skipped: readonly StageId[];
  blocked: boolean;
  blockedReasons: readonly string[];
  retired: boolean;
};

export function lifecycleOf(d: WorkspaceData, o: Opportunity): Lifecycle {
  const page = d.pages.find((p) => p.opportunityId === o.id);
  const knowledge = d.knowledge.filter((k) => (page?.knowledgeIds ?? o.knowledgeIds).includes(k.id));
  const sources = d.sources.filter((s) => o.sourceIds.includes(s.id));
  const reached = new Set<StageId>(["discovered", "scored"]);
  if (o.status !== "candidate") reached.add("validated");
  if (o.status === "ready") reached.add("eligible");
  if (page) {
    reached.add("blueprinted");
    if (sources.length && sources.every((s) => s.health === "ok")) reached.add("data_assembled");
    if (knowledge.length && knowledge.every((k) => k.status === "verified")) reached.add("evidence_validated");
    if (page.status === "ready" || page.status === "in_review") reached.add("experience_built");
    if (page.status === "ready" && page.gates.every((g) => g.status !== "fail")) reached.add("qa");
  }
  const order = STAGES.map((s) => s.id);
  const furthest = order.filter((s) => reached.has(s)).at(-1) ?? "discovered";
  const skipped = order.slice(0, stageIndex(furthest)).filter((s) => !reached.has(s));

  const blockedReasons: string[] = [];
  if (o.status === "blocked") blockedReasons.push(o.gaps[0] ?? "Marcada como bloqueada.");
  for (const s of sources) if (s.health === "error") blockedReasons.push(`Fonte com falha: ${s.name}.`);
  for (const k of knowledge) if (k.status === "expired") blockedReasons.push(`Fato expirado: ${k.title}.`);
  for (const g of page?.gates ?? []) if (g.status === "fail") blockedReasons.push(`Gate reprovado: ${g.name}.`);

  return {
    stage: furthest,
    reached,
    skipped,
    blocked: blockedReasons.length > 0,
    blockedReasons: [...new Set(blockedReasons)],
    retired: o.status === "dismissed",
  };
}
