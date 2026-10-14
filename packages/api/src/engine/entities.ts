import { tokens } from "./normalize";

// Resolução de entidades (ADR-023, seção 5): liga um trecho de query a uma entidade REAL do tenant (por exemplo, uma cidade importada).
// Nome repetido em mais de uma entidade é ambíguo: só se resolve com um qualificador (ex.: a UF) presente na query. Nunca se adivinha.
export interface EntityRecord {
  readonly kind: string; readonly id: string; readonly name: string;
  /** Distingue homônimos (ex.: a UF). */
  readonly qualifier: string | null;
  /** Código oficial da entidade na fonte (ex.: código IBGE do município); usado para recortar o escopo da pesquisa. */
  readonly code?: string | null;
  /** Ordem de importância dos dados do tenant (ex.: população); só para escolher quais entidades entram primeiro. */
  readonly weight?: number | null;
}
export interface EntityIndex { readonly byName: ReadonlyMap<string, readonly EntityRecord[]>; readonly maxTokens: number }
export interface EntityMatch { readonly record: EntityRecord; readonly start: number; readonly end: number }
export interface EntityExtraction {
  readonly resolved: readonly EntityMatch[];
  /** Trechos que casam com mais de uma entidade e não puderam ser desambiguados. */
  readonly ambiguous: readonly { readonly start: number; readonly end: number; readonly candidates: readonly EntityRecord[] }[];
  /** Tokens da query que sobram depois de remover os trechos de entidade (resolvidos ou ambíguos). */
  readonly residual: readonly string[];
}

export function buildEntityIndex(records: readonly EntityRecord[]): EntityIndex {
  const byName = new Map<string, EntityRecord[]>();
  let maxTokens = 1;
  for (const r of records) {
    const t = tokens(r.name);
    if (t.length === 0) continue;
    maxTokens = Math.max(maxTokens, t.length);
    const k = t.join(" ");
    byName.set(k, [...(byName.get(k) ?? []), r]);
  }
  return { byName, maxTokens };
}

/** Procura entidades na query, sempre o trecho MAIS LONGO primeiro ("rio de janeiro" antes de "rio"). */
export function extractEntities(index: EntityIndex, query: string): EntityExtraction {
  const t = tokens(query);
  const used = new Array<boolean>(t.length).fill(false);
  const resolved: EntityMatch[] = [];
  const ambiguous: { start: number; end: number; candidates: readonly EntityRecord[] }[] = [];
  for (let len = Math.min(index.maxTokens, t.length); len >= 1; len--) {
    for (let i = 0; i + len <= t.length; i++) {
      if (used.slice(i, i + len).some(Boolean)) continue;
      const candidates = index.byName.get(t.slice(i, i + len).join(" "));
      if (!candidates) continue;
      let chosen: EntityRecord | undefined;
      let qualifierAt: number | null = null; // posição do token do qualificador (ex.: "sp"), consumido junto com o nome
      if (candidates.length === 1) chosen = candidates[0];
      else {
        const withQualifier = candidates.flatMap((c) => {
          const q = c.qualifier?.toLowerCase();
          const at = q === undefined ? -1 : t.findIndex((x, j) => x === q && (j < i || j >= i + len) && !used[j]);
          return at >= 0 ? [{ c, at }] : [];
        });
        if (withQualifier.length === 1) { chosen = withQualifier[0]!.c; qualifierAt = withQualifier[0]!.at; }
      }
      for (let j = i; j < i + len; j++) used[j] = true;
      if (qualifierAt !== null) used[qualifierAt] = true;
      if (chosen) resolved.push({ record: chosen, start: i, end: i + len });
      else ambiguous.push({ start: i, end: i + len, candidates });
    }
  }
  return { resolved: resolved.sort((a, b) => a.start - b.start), ambiguous, residual: t.filter((_, j) => !used[j]) };
}
