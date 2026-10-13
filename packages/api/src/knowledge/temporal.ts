// Intervalos temporais semiabertos [início, fim) com limites possivelmente desconhecidos (ADR-021). Puro: sem relógio nem I/O.

export type Bound = { readonly kind: "instant"; readonly at: Date } | { readonly kind: "unbounded" } | { readonly kind: "unknown" };
export interface TemporalInterval { readonly start: Bound; readonly end: Bound }
/** Resultado de três valores: `'unknown'` nunca é tratado como verdadeiro nem como falso. */
export type Tri = true | false | "unknown";

export const instant = (at: Date): Bound => ({ kind: "instant", at });
export const UNBOUNDED: Bound = { kind: "unbounded" };
export const UNKNOWN: Bound = { kind: "unknown" };
export const interval = (start: Bound, end: Bound): TemporalInterval => ({ start, end });
/** Vale de `from` em diante, sem fim conhecido (em vigor). */
export const since = (from: Date): TemporalInterval => interval(instant(from), UNBOUNDED);

/** Erros do intervalo (lista vazia = válido). Início `unbounded` significa "desde sempre"; fim `unbounded`, "em vigor". */
export function validateInterval(i: TemporalInterval): string[] {
  const errors: string[] = [];
  for (const [name, b] of [["start", i.start], ["end", i.end]] as const) {
    if (b.kind === "instant" && Number.isNaN(b.at.getTime())) errors.push(`${name}: data inválida`);
  }
  if (i.start.kind === "instant" && i.end.kind === "instant" && !(i.start.at.getTime() < i.end.at.getTime())) errors.push("start deve ser anterior a end (intervalo semiaberto não vazio)");
  return errors;
}

export const hasUnknownBound = (i: TemporalInterval): boolean => i.start.kind === "unknown" || i.end.kind === "unknown";

const lo = (b: Bound): number => (b.kind === "instant" ? b.at.getTime() : Number.NEGATIVE_INFINITY);
const hi = (b: Bound): number => (b.kind === "instant" ? b.at.getTime() : Number.POSITIVE_INFINITY);

/** O instante `t` está dentro de `[start, end)`? `'unknown'` se algum limite é desconhecido e o resultado depende dele. */
export function contains(i: TemporalInterval, t: Date): Tri {
  const x = t.getTime();
  const checks: Tri[] = [
    i.start.kind === "unknown" ? "unknown" : x >= lo(i.start),
    i.end.kind === "unknown" ? "unknown" : x < hi(i.end),
  ];
  if (checks.includes(false)) return false;
  return checks.includes("unknown") ? "unknown" : true;
}

/** Dois intervalos se sobrepõem? `'unknown'` se algum tem limite desconhecido. */
export function overlaps(a: TemporalInterval, b: TemporalInterval): Tri {
  if (hasUnknownBound(a) || hasUnknownBound(b)) return "unknown";
  return Math.max(lo(a.start), lo(b.start)) < Math.min(hi(a.end), hi(b.end));
}

export function sameInterval(a: TemporalInterval, b: TemporalInterval): boolean {
  const same = (x: Bound, y: Bound) => x.kind === y.kind && (x.kind !== "instant" || x.at.getTime() === (y as { at: Date }).at.getTime());
  return same(a.start, b.start) && same(a.end, b.end);
}

/** Parte de `a` que fica à esquerda de `b` (antes do início de `b`), ou `undefined` se não sobra nada. Só para intervalos conhecidos. */
export function leftOf(a: TemporalInterval, b: TemporalInterval): TemporalInterval | undefined {
  if (b.start.kind !== "instant") return undefined;
  if (!(lo(a.start) < b.start.at.getTime())) return undefined;
  return interval(a.start, hi(a.end) < b.start.at.getTime() ? a.end : b.start);
}

/** Parte de `a` que fica à direita de `b` (a partir do fim de `b`), ou `undefined`. */
export function rightOf(a: TemporalInterval, b: TemporalInterval): TemporalInterval | undefined {
  if (b.end.kind !== "instant") return undefined;
  if (!(hi(a.end) > b.end.at.getTime())) return undefined;
  return interval(lo(a.start) > b.end.at.getTime() ? a.start : b.end, a.end);
}
