// Normalização de queries e de nomes (ADR-023, seção 5): minúsculas, sem acento, sem pontuação, sem palavras vazias, plural simples.
const STOP = new Set(["a", "o", "as", "os", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das", "em", "no", "na", "nos", "nas", "ao", "aos", "para", "por", "com", "e"]);

export const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Plural simples (só remove o `s` final de palavras com mais de 4 letras: "apartamentos" → "apartamento", "casas" → "casa"; "mais", "gás", "ônibus" ficam). O mesmo para a query e para os nomes do índice, então a comparação é consistente. */
const stem = (t: string): string => (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("is") && !t.endsWith("us") ? t.slice(0, -1) : t);

export function tokens(s: string, synonyms: Readonly<Record<string, string>> = {}): string[] {
  return fold(s).replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t.length > 0 && !STOP.has(t)).map((t) => { const x = stem(t); return synonyms[x] ?? synonyms[t] ?? x; });
}
/** Forma normalizada de uma query para comparação e deduplicação (mesmos tokens, mesma ordem). */
export const normalizeQuery = (s: string, synonyms: Readonly<Record<string, string>> = {}): string => tokens(s, synonyms).join(" ");

export function jaccard(a: readonly string[], b: readonly string[]): number {
  const A = new Set(a), B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
