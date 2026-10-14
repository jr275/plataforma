import { diffConfigs, type ConfigChange, type DimensionId, type ObjectiveId, OBJECTIVES } from "./score-config";
import { DIMENSION_INFO } from "./score-config";
import { LABEL, type ScoreResult } from "./score";
import type { ScoreConfig } from "./score-config";

// Comparação entre dois cálculos de score (ADR-023): o que mudou, onde e por quê. Serve ao "alterei a configuração, recalculei, o que mudou?".
export interface ObjectiveDelta { readonly id: ObjectiveId; readonly from: number | null; readonly to: number | null; readonly delta: number | null }
export interface ContributionDelta { readonly objective: ObjectiveId; readonly dimension: DimensionId; readonly from: number | null; readonly to: number | null; readonly delta: number }
export interface ScoreComparison {
  readonly priority: { readonly from: number | null; readonly to: number | null; readonly delta: number | null; readonly kindFrom: string; readonly kindTo: string };
  readonly objectives: readonly ObjectiveDelta[];
  readonly contributions: readonly ContributionDelta[];
  readonly penaltiesAdded: readonly string[]; readonly penaltiesRemoved: readonly string[];
  readonly eligibility: { readonly from: boolean; readonly to: boolean };
  readonly config: readonly ConfigChange[];
  readonly changed: boolean;
  readonly summary: readonly string[];
}
const r1 = (x: number) => Math.round(x * 10) / 10;
const sign = (x: number) => `${x > 0 ? "+" : ""}${r1(x)}`;

export function compareScores(a: ScoreResult, b: ScoreResult, configA?: ScoreConfig, configB?: ScoreConfig): ScoreComparison {
  const objectives: ObjectiveDelta[] = OBJECTIVES.map((id) => { const f = a.objectives[id].adjusted, t = b.objectives[id].adjusted; return { id, from: f, to: t, delta: f !== null && t !== null ? t - f : null }; });
  const contributions: ContributionDelta[] = [];
  for (const o of OBJECTIVES) {
    const dims = new Set<DimensionId>([...a.objectives[o].contributions.map((c) => c.dimension), ...b.objectives[o].contributions.map((c) => c.dimension)]);
    for (const d of dims) {
      const f = a.objectives[o].contributions.find((c) => c.dimension === d)?.points ?? null, t = b.objectives[o].contributions.find((c) => c.dimension === d)?.points ?? null;
      const delta = (t ?? 0) - (f ?? 0);
      if (Math.abs(delta) > 0.05) contributions.push({ objective: o, dimension: d, from: f, to: t, delta });
    }
  }
  contributions.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const key = (p: ScoreResult["penalties"][number]) => `${p.kind}:${p.objective}:${p.dimension ?? "-"}`;
  const ka = new Set(a.penalties.map(key)), kb = new Set(b.penalties.map(key));
  const pd = a.priority.value !== null && b.priority.value !== null ? b.priority.value - a.priority.value : null;
  const config = configA && configB ? diffConfigs(configA, configB) : [];
  const summary: string[] = [];
  if (a.priority.value === null && b.priority.value === null) summary.push("Prioridade: sem valor calculável antes e depois.");
  else if (pd !== null) summary.push(Math.abs(pd) < 0.05 ? "Prioridade: sem mudança." : `Prioridade: ${r1(a.priority.value!)} → ${r1(b.priority.value!)} (${sign(pd)}).`);
  else summary.push(`Prioridade: ${a.priority.value === null ? "sem valor" : r1(a.priority.value)} (${a.priority.kind}) → ${b.priority.value === null ? "sem valor" : r1(b.priority.value)} (${b.priority.kind}).`);
  for (const o of objectives) if (o.delta !== null && Math.abs(o.delta) >= 0.05) summary.push(`${cap(LABEL[o.id])}: ${r1(o.from!)} → ${r1(o.to!)} (${sign(o.delta)}).`);
  else if ((o.from === null) !== (o.to === null)) summary.push(`${cap(LABEL[o.id])}: ${o.from === null ? "passou a ser calculável" : "deixou de ser calculável"}.`);
  for (const c of contributions.slice(0, 3)) summary.push(`Maior mudança: ${DIMENSION_INFO[c.dimension].label} (${sign(c.delta)} ponto(s) em ${LABEL[c.objective]}).`);
  for (const k of [...kb].filter((x) => !ka.has(x))) summary.push(`Nova penalidade: ${k.replace(/:/g, " / ")}.`);
  for (const k of [...ka].filter((x) => !kb.has(x))) summary.push(`Penalidade removida: ${k.replace(/:/g, " / ")}.`);
  if (a.eligibility.eligible !== b.eligibility.eligible) summary.push(b.eligibility.eligible ? "Passou a ser elegível." : "Deixou de ser elegível.");
  if (config.length > 0) summary.push(`Configuração: ${config.length} alteração(ões) (${config.slice(0, 3).map((c) => c.path).join(", ")}${config.length > 3 ? ", …" : ""}).`);
  const changed = (pd !== null && Math.abs(pd) >= 0.05) || (a.priority.kind !== b.priority.kind) || objectives.some((o) => (o.delta !== null && Math.abs(o.delta) >= 0.05) || (o.from === null) !== (o.to === null)) || ka.size !== kb.size || a.eligibility.eligible !== b.eligibility.eligible || [...ka].some((x) => !kb.has(x));
  return { priority: { from: a.priority.value, to: b.priority.value, delta: pd, kindFrom: a.priority.kind, kindTo: b.priority.kind }, objectives, contributions, penaltiesAdded: [...kb].filter((x) => !ka.has(x)), penaltiesRemoved: [...ka].filter((x) => !kb.has(x)), eligibility: { from: a.eligibility.eligible, to: b.eligibility.eligible }, config, changed, summary };
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
