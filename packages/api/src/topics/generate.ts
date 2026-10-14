import { createHash } from "node:crypto";
import type { AttributeStat } from "../catalog/discovery";
import type { SkippedPattern, Topic, TopicEntity, TopicPattern } from "./types";

// Geração de tópicos (função PURA). Para cada padrão do pack × entidade do tipo, só gera se os atributos exigidos estão VALID ou PARTIAL no catálogo (spec 6.1). O `topic_id` é o hash
// determinístico do tenant + dimensões normalizadas: a deduplicação exata é gratuita. Nada de demanda, número ou fato é criado aqui.
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Normalização das dimensões: chaves e valores sem acento, minúsculos, espaços colapsados, chaves ordenadas. */
export function normalizeDimensions(d: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(d).sort()) out[strip(k).toLowerCase().trim().replace(/\s+/g, "_")] = strip(d[k]!).toLowerCase().trim().replace(/\s+/g, " ");
  return out;
}
export function topicId(tenantId: string, dims: Readonly<Record<string, string>>): string {
  const n = normalizeDimensions(dims);
  return createHash("sha256").update(`${tenantId}\n${Object.keys(n).map((k) => `${k}=${n[k]}`).join("\n")}`).digest("hex");
}
const fill = (t: string, e: TopicEntity) => t.replaceAll("{name}", e.name).replaceAll("{qualifier}", e.qualifier ?? "").replace(/\s+\(\)/g, "").replace(/\s{2,}/g, " ").trim();

export interface GenerateInput {
  readonly tenantId: string; readonly patterns: readonly TopicPattern[]; readonly catalog: readonly Pick<AttributeStat, "definition" | "status">[];
  readonly entities: readonly TopicEntity[];
  /** Atributos com fato corrente por entidade. */
  readonly factsByEntity: ReadonlyMap<string, ReadonlySet<string>>;
}
export function generateTopics(input: GenerateInput): { topics: Topic[]; skipped: SkippedPattern[]; duplicates: number } {
  const status = new Map(input.catalog.map((c) => [c.definition.attributeId, c.status]));
  const topics = new Map<string, Topic>(); const skipped: SkippedPattern[] = []; let duplicates = 0;
  for (const p of input.patterns) {
    const bad = p.requiredAttributes.filter((a) => { const s = status.get(a); return s !== "VALID" && s !== "PARTIAL"; });
    if (bad.length > 0) { skipped.push({ patternId: p.id, reason: `atributos exigidos sem cobertura suficiente (não VALID/PARTIAL): ${bad.map((a) => `${a} [${status.get(a) ?? "não declarado"}]`).join(", ")}` }); continue; }
    const ents = input.entities.filter((e) => e.entityType === p.entityType);
    if (ents.length === 0) { skipped.push({ patternId: p.id, reason: `não existem entidades do tipo “${p.entityType}”` }); continue; }
    for (const e of [...ents].sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : 1))) {
      const have = input.factsByEntity.get(e.id) ?? new Set<string>();
      const all = [...p.requiredAttributes, ...p.optionalAttributes];
      const dims = normalizeDimensions({ ...p.baseDimensions, [p.entityType]: e.sourceKey });
      const id = topicId(input.tenantId, dims);
      if (topics.has(id)) { duplicates++; continue; }
      topics.set(id, {
        topicId: id, tenantId: input.tenantId, primaryEntityId: e.id, primaryEntityType: e.entityType, patternId: p.id, queryPatternKey: p.queryPatternKey, dimensions: dims,
        attributesUsed: all, relationshipsUsed: p.relationshipsUsed, geoGranularity: p.geoGranularity, intentType: p.intentType, queryHypothesis: fill(p.queryTemplate, e), userNeed: p.userNeed,
        evidenceRequired: p.evidenceRequired, dataAvailable: all.filter((a) => have.has(a)), dataMissing: p.requiredAttributes.filter((a) => !have.has(a)),
        candidatePageFamily: p.family, commercialPotential: p.commercialPotential, refreshDependencies: p.requiredAttributes, origin: p.origin, parentTopicId: null,
        demandSignal: { value: null, source: null, period: null, method: null, uncertainty: "sem fonte de demanda" },
      });
    }
  }
  return { topics: [...topics.values()].sort((a, b) => (a.topicId < b.topicId ? -1 : 1)), skipped, duplicates };
}

// --- propostas do Agente 2 (Topic Proposer): o código valida; o que falhar é descartado com motivo -----------------------------------
export interface Proposal { readonly dimensions: Readonly<Record<string, string>>; readonly attributes_used: readonly string[]; readonly relationships_used: readonly string[]; readonly candidate_page_family: string; readonly user_need: string; readonly query_hypothesis: string; readonly why_not_covered: string; readonly evidence_required: readonly string[] }
export interface ProposalContext { readonly entity: TopicEntity; readonly catalogStatus: ReadonlyMap<string, string>; readonly relationships: ReadonlySet<string>; readonly families: ReadonlySet<string>; readonly dimensionIds: ReadonlySet<string>; readonly existingTopicIds: ReadonlySet<string>; readonly tenantId: string; readonly compatible: (dims: Readonly<Record<string, string>>) => string | null }
export function validateProposal(p: Proposal, c: ProposalContext): { ok: true; topicId: string } | { ok: false; reasons: string[] } {
  const r: string[] = [];
  for (const a of p.attributes_used) { const s = c.catalogStatus.get(a); if (s === undefined) r.push(`atributo inexistente no catálogo: ${a}`); else if (s !== "VALID" && s !== "PARTIAL") r.push(`atributo sem cobertura suficiente: ${a} [${s}]`); }
  for (const x of p.relationships_used) if (!c.relationships.has(x)) r.push(`relação desconhecida: ${x}`);
  if (!c.families.has(p.candidate_page_family)) r.push(`família de página desconhecida: ${p.candidate_page_family}`);
  for (const k of Object.keys(p.dimensions)) if (!c.dimensionIds.has(k)) r.push(`dimensão desconhecida: ${k}`);
  if (p.attributes_used.length === 0) r.push("a proposta não usa nenhum atributo");
  if (p.query_hypothesis.trim() === "" || p.user_need.trim() === "" || p.why_not_covered.trim() === "") r.push("campos obrigatórios vazios");
  const incompat = c.compatible(p.dimensions); if (incompat) r.push(`incompatível: ${incompat}`);
  if (r.length > 0) return { ok: false, reasons: r };
  const id = topicId(c.tenantId, { ...p.dimensions, [c.entity.entityType]: c.entity.sourceKey });
  if (c.existingTopicIds.has(id)) return { ok: false, reasons: ["duplicata exata de um tópico existente"] };
  return { ok: true, topicId: id };
}
