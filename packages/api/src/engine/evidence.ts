import { createHash } from "node:crypto";
import type { Basis } from "./truth";

// Registro de evidência (ADR-023, seção 1): o que foi coletado, de onde, quando, com que garantia e por quanto tempo vale.
export type EvidenceKind = "news_item" | "indicator";
export interface EvidenceDraft {
  readonly adapter: string;
  readonly kind: EvidenceKind;
  /** Identificador estável do registro NA FONTE (por exemplo `ibge-news:48246` ou `bcb-sgs:432`). */
  readonly sourceRef: string;
  readonly url: string;
  readonly title: string;
  /** Trecho curto permitido pela fonte (nunca o conteúdo inteiro). */
  readonly summary: string | null;
  readonly publishedAt: Date | null;
  readonly collectedAt: Date;
  /** Até quando o registro vale como "atual"; depois vira defasado (não é apagado). */
  readonly validUntil: Date | null;
  readonly basis: Basis;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Temas e entidades extraídos pelo motor (preenchidos depois, por regra da vertical). */
  readonly topics: readonly string[];
  readonly limitations: readonly string[];
}

const canon = (x: unknown): unknown => Array.isArray(x) ? x.map(canon) : x instanceof Date ? x.toISOString() : x && typeof x === "object" ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, canon(v)])) : x;
/** Hash do CONTEÚDO observado (não do momento da coleta): repetir a coleta do mesmo conteúdo não cria outro registro; conteúdo novo cria. */
export function evidenceHash(d: Pick<EvidenceDraft, "adapter" | "kind" | "sourceRef" | "url" | "title" | "summary" | "publishedAt" | "payload">): string {
  return createHash("sha256").update(JSON.stringify(canon({ a: d.adapter, k: d.kind, r: d.sourceRef, u: d.url, t: d.title, s: d.summary, p: d.publishedAt, x: d.payload }))).digest("hex");
}
export const isStale = (validUntil: Date | null, now: Date): boolean => validUntil !== null && validUntil.getTime() < now.getTime();
export const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * 86_400_000);

const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0*39;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
/** Decodifica entidades HTML (inclusive HTML escapado dentro de XML), remove a marcação e limita o tamanho (trecho curto, nunca o texto integral). */
export function excerpt(html: string, max = 280): string {
  const text = decode(decode(html).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
export { decode as decodeEntities };
