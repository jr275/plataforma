import { createHash } from "node:crypto";
import { clusterQueries, clusterKey, entityRef, type QueryCluster, type Unclassified } from "./classify";
import { deriveDimensions, type PageFact } from "./dimensions";
import { buildEntityIndex, type EntityRecord } from "./entities";
import type { EvidenceDraft } from "./evidence";
import { isStale } from "./evidence";
import { computeScore, type DimensionMap, type ScoreResult } from "./score";
import type { ScoreConfig } from "./score-config";
import { configHash } from "./score-config";
import { matchSignals, trendFor, type SignalMatch, type TrendSignal } from "./signals";
import type { QueryPattern, VerticalDefinition } from "./vertical";

// Pipeline PURO de descoberta (ADR-023): entidades reais do tenant × padrões de query da vertical → hipóteses → clusters → sinais de evidência → dimensões →
// score. Sem banco e sem rede: o mesmo código alimenta a persistência e a prévia de desenvolvimento.
export interface EvidenceInput { readonly key: string; readonly draft: EvidenceDraft }
export interface DiscoveryInput {
  readonly def: VerticalDefinition; readonly entities: readonly EntityRecord[]; readonly evidence: readonly EvidenceInput[];
  /** `null` = páginas do tenant desconhecidas. */
  readonly pages: readonly PageFact[] | null; readonly config: ScoreConfig; readonly now: Date; readonly entityLimit: number;
  /** Recorte por código de entidade (escopo); `undefined` = todas. */
  readonly entityCodes?: ReadonlySet<string>;
}
export interface EvidenceLink { readonly evidenceKey: string; readonly role: "signal" | "requirement"; readonly reason: string; readonly topic: string | null }
export interface OpportunityDraft {
  readonly clusterKey: string; readonly pattern: QueryPattern; readonly entity: EntityRecord | null;
  readonly primaryQuery: string; readonly variants: readonly string[];
  readonly language: string; readonly country: string; readonly location: { readonly kind: string; readonly id: string; readonly name: string; readonly qualifier: string | null } | null;
  readonly intent: string; readonly stage: string; readonly jtbd: string; readonly experience: string; readonly expectedOutcome: string;
  /** A query é uma HIPÓTESE gerada pela vertical a partir das entidades do tenant; demanda nunca foi medida. */
  readonly hypothesis: true;
  readonly links: readonly EvidenceLink[]; readonly trend: readonly TrendSignal[];
  readonly dimensions: DimensionMap; readonly strategic: boolean; readonly score: ScoreResult; readonly inputsHash: string;
  readonly validation: { readonly ok: boolean; readonly reasons: readonly string[] };
}
export interface DiscoveryStats { readonly entities: number; readonly candidateQueries: number; readonly clusters: number; readonly unclassified: readonly Unclassified[]; readonly signalLinks: number; readonly staleEvidence: number }

/** Entidades que entram na pesquisa: as de maior peso (ex.: população) primeiro; empate pelo nome. */
export function pickEntities(entities: readonly EntityRecord[], limit: number): EntityRecord[] {
  return [...entities].sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1) || (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1)).slice(0, Math.max(0, limit));
}

/** Texto da query para uma entidade: acrescenta o qualificador (UF) só quando o nome é ambíguo no conjunto (evita classificar a cidade errada). */
export function queryText(template: string, e: EntityRecord, ambiguousNames: ReadonlySet<string>): string {
  const label = ambiguousNames.has(e.name.toLowerCase()) && e.qualifier ? `${e.name} ${e.qualifier}` : e.name;
  return template.replace("{entity}", label);
}

export function buildOpportunities(input: DiscoveryInput): { drafts: OpportunityDraft[]; stats: DiscoveryStats } {
  const { def, now } = input;
  const picked = pickEntities(input.entityCodes ? input.entities.filter((x) => x.code != null && input.entityCodes!.has(x.code)) : input.entities, input.entityLimit);
  const index = buildEntityIndex(input.entities); // o índice conhece TODAS as entidades: homônimos fora do recorte continuam ambíguos
  const nameCount = new Map<string, number>();
  for (const e of input.entities) nameCount.set(e.name.toLowerCase(), (nameCount.get(e.name.toLowerCase()) ?? 0) + 1);
  const ambiguous = new Set([...nameCount].filter(([, n]) => n > 1).map(([k]) => k));

  const queries: string[] = [];
  for (const p of def.patterns) {
    if (p.entityKind === null) queries.push(...p.templates);
    else for (const e of picked.filter((x) => x.kind === p.entityKind)) for (const t of p.templates) queries.push(queryText(t, e, ambiguous));
  }
  const { clusters, unclassified } = clusterQueries(def, index, queries);

  // Sinais: cada evidência atual é ligada a temas da vertical (regra explicada).
  const fresh = input.evidence.filter((e) => !isStale(e.draft.validUntil, now));
  const matches = fresh.flatMap((e) => matchSignals(def, e.draft).map((m) => ({ evidenceKey: e.key, match: m, draft: e.draft })));
  const available = new Set<string>(["entities"].filter(() => input.entities.length > 0));
  for (const e of fresh) if (e.draft.kind === "indicator") available.add(`indicator:${e.draft.sourceRef}`);

  const drafts = clusters.map((cl) => draft(input, cl, matches, available));
  return { drafts, stats: { entities: picked.length, candidateQueries: queries.length, clusters: clusters.length, unclassified, signalLinks: drafts.reduce((n, d) => n + d.links.length, 0), staleEvidence: input.evidence.length - fresh.length } };
}

function draft(input: DiscoveryInput, cl: QueryCluster, all: readonly { evidenceKey: string; match: SignalMatch; draft: EvidenceDraft }[], available: ReadonlySet<string>): OpportunityDraft {
  const { def, config } = input;
  const p = cl.pattern;
  const links: EvidenceLink[] = all.filter((m) => m.match.groups.includes(p.group)).map((m) => ({ evidenceKey: m.evidenceKey, role: "signal" as const, reason: m.match.reason, topic: m.match.topic }));
  const trend = trendFor(p.group, all);
  // evidências que sustentam requisitos: indicadores (`indicator:<ref>`) satisfazem requisitos que os citam
  const byReq = new Map<string, string[]>();
  for (const r of def.evidenceRequirements) byReq.set(r.id, all.filter((m) => r.satisfiedBy.includes(`indicator:${m.draft.sourceRef}`)).map((m) => m.evidenceKey));
  for (const [reqId, keys] of byReq) for (const key of keys) if (p.requiredEvidence.includes(reqId) && !links.some((l) => l.evidenceKey === key && l.role === "requirement")) links.push({ evidenceKey: key, role: "requirement", reason: `sustenta o requisito "${def.evidenceRequirements.find((r) => r.id === reqId)!.label}"`, topic: null });
  const dimensions = deriveDimensions({ def, config, pattern: p, entity: cl.entity, available, evidenceByRequirement: byReq, pages: input.pages });
  const strategic = p.valueTier === "high";
  const score = computeScore({ dimensions, strategic }, config);
  const members = [...cl.members].sort((a, b) => b.count - a.count || (a.text < b.text ? -1 : 1));
  const primary = members.find((m) => m.text === (cl.entity ? p.templates[0]!.replace("{entity}", cl.entity.name) : p.templates[0]))?.text ?? members[0]!.text;
  const reasons: string[] = [];
  if (p.entityKind !== null && cl.entity === null) reasons.push("o padrão exige uma entidade e nenhuma foi resolvida");
  if (!def.intents.some((i) => i.id === p.intent)) reasons.push("intenção fora da vertical");
  return {
    clusterKey: cl.key, pattern: p, entity: cl.entity, primaryQuery: primary, variants: members.map((m) => m.text).filter((t) => t !== primary),
    language: def.language, country: def.country, location: cl.entity ? { kind: cl.entity.kind, id: cl.entity.id, name: cl.entity.name, qualifier: cl.entity.qualifier } : null,
    intent: p.intent, stage: p.stage, jtbd: p.jtbd, experience: p.experience, expectedOutcome: p.outcome, hypothesis: true,
    links, trend, dimensions, strategic, score, inputsHash: hashInputs(dimensions, strategic, config, links.map((l) => `${l.role}:${l.evidenceKey}`).sort()), validation: { ok: reasons.length === 0, reasons },
  };
}

/** Identifica EXATAMENTE as entradas de um cálculo: repetir com as mesmas entradas não cria novo score. */
export function hashInputs(dimensions: DimensionMap, strategic: boolean, config: ScoreConfig, links: readonly string[]): string {
  const dims = Object.entries(dimensions).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, v.value, v.basis, v.source, v.uncertainty ?? null, [...(v.evidenceIds ?? [])].sort()]);
  return createHash("sha256").update(JSON.stringify({ dims, strategic, config: configHash(config), links })).digest("hex");
}
export { clusterKey, entityRef };
