import { createHash } from "node:crypto";
import type { AttributeDefinition, DiscoveryPolicy, ValidationStatus } from "./types";

// Attribute Discovery (função PURA): do que há de fato no grafo (fatos correntes) para o catálogo de atributos com cobertura, frescor, confiança, distribuição e status.
// Nenhum atributo factual é criado aqui: só os DECLARADOS pelo pack são medidos, e o que não tem dado é DATA_PENDING (R12), nunca preenchido.
export interface FactSample { readonly entityId: string; readonly attributeId: string; readonly value: unknown; readonly observedAt: Date; readonly confidence: number }
export interface Distribution { readonly n: number; readonly min?: number; readonly p25?: number; readonly median?: number; readonly p75?: number; readonly max?: number; readonly cardinality?: number; readonly top?: readonly { value: string; count: number }[] }
export interface AttributeStat {
  readonly definition: AttributeDefinition;
  readonly entitiesTotal: number; readonly entitiesWithValue: number;
  /** `null` = não existem entidades do tipo (nada a medir); 0 = existem e nenhuma tem o atributo. */
  readonly coverage: number | null; readonly freshnessDays: number | null; readonly confidence: number | null;
  readonly distribution: Distribution; readonly invalidValues: number; readonly staleValues: number;
  readonly usableAsFact: boolean; readonly status: ValidationStatus; readonly reasons: readonly string[];
}

const DAY = 86_400_000;
const r4 = (n: number) => Number(n.toFixed(4));
function quantile(sorted: readonly number[], q: number): number { const i = (sorted.length - 1) * q; const lo = Math.floor(i); const hi = Math.ceil(i); return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo); }

/** O valor é do tipo declarado? (numérico = número finito; categórico/qualitativo = texto não vazio; temporal = data ISO). */
export function valueMatches(def: AttributeDefinition, v: unknown): boolean {
  switch (def.dataType) {
    case "numeric": case "derived": case "commercial": return typeof v === "number" && Number.isFinite(v);
    case "categorical": case "qualitative": case "semantic": case "contextual": return typeof v === "string" && v.trim() !== "";
    case "temporal": return typeof v === "string" && !Number.isNaN(Date.parse(v));
    case "geographic": case "relational": return v !== null && typeof v === "object";
  }
}

export function discoverAttributes(input: { definitions: readonly AttributeDefinition[]; entityCounts: Readonly<Record<string, number>>; facts: readonly FactSample[]; policy: DiscoveryPolicy; now: Date }): AttributeStat[] {
  const byAttr = new Map<string, FactSample[]>();
  for (const f of input.facts) byAttr.set(f.attributeId, [...(byAttr.get(f.attributeId) ?? []), f]);
  return input.definitions.map((def) => {
    const total = input.entityCounts[def.entityType] ?? 0;
    const facts = byAttr.get(def.attributeId) ?? [];
    const valid = facts.filter((f) => valueMatches(def, f.value));
    const invalid = facts.length - valid.length;
    const withValue = new Set(valid.map((f) => f.entityId)).size;
    const coverage = total === 0 ? null : r4(withValue / total);
    const ages = valid.map((f) => Math.max(0, Math.floor((input.now.getTime() - f.observedAt.getTime()) / DAY)));
    const freshnessDays = ages.length === 0 ? null : Math.max(...ages); // a observação MAIS ANTIGA manda: um atributo é tão fresco quanto o seu pior fato
    const stale = def.maxAgeDays === null ? 0 : ages.filter((a) => a > def.maxAgeDays!).length;
    const confidence = valid.length === 0 ? null : r4(valid.reduce((s, f) => s + f.confidence, 0) / valid.length);
    let distribution: Distribution = { n: valid.length };
    if (valid.length > 0 && ["numeric", "derived", "commercial"].includes(def.dataType)) {
      const nums = valid.map((f) => f.value as number).sort((a, b) => a - b);
      distribution = { n: nums.length, min: nums[0]!, p25: r4(quantile(nums, 0.25)), median: r4(quantile(nums, 0.5)), p75: r4(quantile(nums, 0.75)), max: nums[nums.length - 1]! };
    } else if (valid.length > 0 && ["categorical", "qualitative", "semantic", "contextual"].includes(def.dataType)) {
      const c = new Map<string, number>();
      for (const f of valid) c.set(String(f.value), (c.get(String(f.value)) ?? 0) + 1);
      distribution = { n: valid.length, cardinality: c.size, top: [...c].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5).map(([value, count]) => ({ value, count })) };
    }
    const reasons: string[] = [];
    let status: ValidationStatus;
    if (total === 0) { status = "DATA_PENDING"; reasons.push(`não existem entidades do tipo “${def.entityType}”: nada foi medido`); }
    else if (invalid > 0) { status = "INVALID"; reasons.push(`${invalid} valor(es) não correspondem ao tipo declarado (${def.dataType})`); }
    else if (coverage === null || coverage < input.policy.minCoveragePartial) { status = "DATA_PENDING"; reasons.push(coverage === 0 ? `nenhuma das ${total} entidades tem o atributo` : `cobertura ${(coverage! * 100).toFixed(1)}% abaixo do mínimo parcial (${input.policy.minCoveragePartial * 100}%)`); }
    else {
      const problems: string[] = [];
      if (coverage < input.policy.minCoverageValid) problems.push(`cobertura ${(coverage * 100).toFixed(1)}% abaixo do mínimo para VALID (${input.policy.minCoverageValid * 100}%)`);
      if (confidence !== null && confidence < input.policy.minConfidence) problems.push(`confiança média ${confidence} abaixo do mínimo (${input.policy.minConfidence})`);
      if (stale > 0) problems.push(`${stale} fato(s) acima da validade de ${def.maxAgeDays} dias`);
      status = problems.length === 0 ? "VALID" : "PARTIAL"; reasons.push(...problems);
    }
    const usableAsFact = def.origin !== "INFERRED";
    if (!usableAsFact) reasons.push("origem INFERRED: nunca usado como fato em página");
    return { definition: def, entitiesTotal: total, entitiesWithValue: withValue, coverage, freshnessDays, confidence, distribution, invalidValues: invalid, staleValues: stale, usableAsFact, status, reasons };
  });
}

/** Lacunas: atributos que não são VALID, do que mais destrava (famílias de página potenciais) ao que menos destrava. */
export function gapReport(stats: readonly AttributeStat[]): AttributeStat[] {
  return stats.filter((s) => s.status !== "VALID").sort((a, b) => b.definition.potentialPageFamilies.length - a.definition.potentialPageFamilies.length || (a.definition.attributeId < b.definition.attributeId ? -1 : 1));
}

const canon = (v: unknown): string => (v === null || typeof v !== "object" ? JSON.stringify(v) ?? "null" : Array.isArray(v) ? `[${v.map(canon).join(",")}]` : `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`);
/** Hash do resultado (sem horário de execução): mesmos fatos, mesma política e mesmo dia dão o mesmo hash. */
export function statsHash(stats: readonly AttributeStat[], policyHash: string): string {
  return createHash("sha256").update(canon({ policyHash, stats: stats.map((s) => ({ id: s.definition.attributeId, t: s.entitiesTotal, w: s.entitiesWithValue, c: s.coverage, f: s.freshnessDays, k: s.confidence, d: s.distribution, i: s.invalidValues, s: s.staleValues, st: s.status })) })).digest("hex");
}
