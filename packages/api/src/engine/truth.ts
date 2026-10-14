// Política de verdade (ADR-023): todo valor relevante diz de onde vem. Ausência de dado é `unknown`, nunca zero nem valor plausível.
export const BASES = ["observed", "provider_metric", "derived", "inferred", "estimated", "unknown"] as const;
/**
 * observed: lido diretamente de uma fonte identificada; provider_metric: métrica entregue por uma integração; derived: cálculo reproduzível sobre dados
 * identificados; inferred: inferência explicável (regra); estimated: estimativa com método e incerteza; unknown: informação não disponível.
 */
export type Basis = (typeof BASES)[number];
export const isBasis = (x: unknown): x is Basis => typeof x === "string" && (BASES as readonly string[]).includes(x);

export interface Measured<T> {
  /** `null` quando `basis` é `unknown`. Nunca 0 como substituto de "não sei". */
  readonly value: T | null;
  readonly basis: Basis;
  /** Identificador da fonte ou da regra que produziu o valor. */
  readonly source: string | null;
  /** Explicação curta, em português, do método ou da lacuna. */
  readonly note: string;
  /** 0..1, quando houver; 1 = incerteza máxima. */
  readonly uncertainty?: number;
}

export const unknown = <T>(note: string): Measured<T> => ({ value: null, basis: "unknown", source: null, note });
export const measured = <T>(value: T, basis: Exclude<Basis, "unknown">, source: string, note: string, uncertainty?: number): Measured<T> => ({ value, basis, source, note, ...(uncertainty === undefined ? {} : { uncertainty }) });
