import { createHash } from "node:crypto";
import type { ArchetypeId } from "./types";

// Intenção e canibalização. Regras DETERMINÍSTICAS decidem conflito (mesma intenção primária no mesmo contexto; mesma URL; canonical conflitante; mesma entidade já representada); a similaridade semântica só gera SINAL DE
// INVESTIGAÇÃO (nunca prova duplicidade). Contexto = tenant + idioma + mercado + cluster + archetype. Cada achado traz as páginas, as evidências e uma ação recomendada.
export interface IntentPage {
  readonly id: string; readonly tenantId: string; readonly locale: string; readonly market: string; readonly clusterId: string | null; readonly archetypeId: ArchetypeId;
  readonly primaryEntityId: string | null; readonly primaryIntent: string; readonly dimensions: Readonly<Record<string, string>>;
  readonly url: string | null; readonly canonical: string | null; readonly title: string | null; readonly h1: string | null; readonly recipeFingerprint?: string | null;
}
export type ConflictKind = "DUPLICATE_PRIMARY_INTENT" | "SAME_URL" | "CONFLICTING_CANONICAL" | "ENTITY_ALREADY_REPRESENTED" | "REDUNDANT_RECIPE" | "OVERLAP_SIGNAL";
export type RecommendedAction = "consolidate" | "differentiate" | "change_intent" | "adjust_canonical" | "block_generation" | "review";
export interface IntentConflict { readonly id: string; readonly kind: ConflictKind; /** `signal` = investigar; `conflict` = regra determinística violada. */ readonly severity: "conflict" | "signal"; readonly pages: readonly { readonly id: string; readonly url: string | null; readonly title: string | null }[]; readonly evidence: Readonly<Record<string, unknown>>; readonly recommendedAction: RecommendedAction; readonly message: string }
export interface DiagnoseOptions { readonly overlapThreshold?: number }

const STOP = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "em", "para", "por", "the", "of", "in", "and", "to", "for"]);
export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export const normalizeIntent = (s: string): string => fold(s).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t && !STOP.has(t)).sort().join(" ");
const tokens = (s: string | null) => new Set(normalizeIntent(s ?? "").split(" ").filter(Boolean));
const jac = <T>(a: Set<T>, b: Set<T>) => { const i = [...a].filter((x) => b.has(x)).length; const u = new Set([...a, ...b]).size; return u === 0 ? 0 : i / u; };
const pairs = (d: Readonly<Record<string, string>>) => new Set(Object.entries(d).map(([k, v]) => `${k}=${v}`));
const ctx = (p: IntentPage) => [p.tenantId, p.locale, p.market, p.clusterId ?? "-", p.archetypeId].join("|");
const ref = (p: IntentPage) => ({ id: p.id, url: p.url, title: p.title });
const cid = (kind: string, ids: readonly string[]) => createHash("sha256").update(`${kind}|${[...ids].sort().join(",")}`).digest("hex").slice(0, 16);
const groups = <K>(ps: readonly IntentPage[], key: (p: IntentPage) => K | null): IntentPage[][] => { const m = new Map<string, IntentPage[]>(); for (const p of ps) { const k = key(p); if (k === null) continue; const s = JSON.stringify(k); m.set(s, [...(m.get(s) ?? []), p]); } return [...m.values()].filter((g) => g.length > 1).map((g) => [...g].sort((a, b) => a.id.localeCompare(b.id))); };

export function diagnoseIntents(pages: readonly IntentPage[], o: DiagnoseOptions = {}): IntentConflict[] {
  const out: IntentConflict[] = []; const threshold = o.overlapThreshold ?? 0.8; const push = (c: Omit<IntentConflict, "id">, ids: readonly string[]) => out.push({ id: cid(c.kind, ids), ...c });
  for (const g of groups(pages, (p) => (p.url ? [p.tenantId, p.url] : null))) push({ kind: "SAME_URL", severity: "conflict", pages: g.map(ref), evidence: { url: g[0]!.url }, recommendedAction: "block_generation", message: `${g.length} páginas com a mesma URL` }, g.map((p) => p.id));
  for (const g of groups(pages, (p) => (p.canonical ? [p.tenantId, p.canonical] : null))) { if (new Set(g.map((p) => p.url)).size < 2) continue; push({ kind: "CONFLICTING_CANONICAL", severity: "conflict", pages: g.map(ref), evidence: { canonical: g[0]!.canonical, urls: g.map((p) => p.url) }, recommendedAction: "adjust_canonical", message: "URLs diferentes declaram a mesma canonical" }, g.map((p) => p.id)); }
  const byUrl = new Map(pages.filter((p) => p.url).map((p) => [`${p.tenantId}|${p.url}`, p] as const));
  for (const p of pages) if (p.canonical && p.canonical !== p.url && !byUrl.has(`${p.tenantId}|${p.canonical}`)) push({ kind: "CONFLICTING_CANONICAL", severity: "conflict", pages: [ref(p)], evidence: { canonical: p.canonical, reason: "a canonical aponta para uma página inexistente" }, recommendedAction: "adjust_canonical", message: "canonical sem página correspondente" }, [p.id, "ghost"]);
  const dup = groups(pages, (p) => (p.primaryEntityId ? [ctx(p), p.primaryEntityId, normalizeIntent(p.primaryIntent)] : null));
  const dupIds = new Set<string>();
  for (const g of dup) { g.forEach((p) => dupIds.add(p.id)); const sameUrl = new Set(g.map((p) => p.url)).size === 1; push({ kind: "DUPLICATE_PRIMARY_INTENT", severity: "conflict", pages: g.map(ref), evidence: { context: ctx(g[0]!), primaryEntityId: g[0]!.primaryEntityId, intent: normalizeIntent(g[0]!.primaryIntent) }, recommendedAction: sameUrl ? "consolidate" : "change_intent", message: `${g.length} páginas disputam a mesma intenção primária para a mesma entidade no mesmo contexto` }, g.map((p) => p.id)); }
  for (const g of groups(pages, (p) => (p.primaryEntityId ? [ctx(p), p.primaryEntityId] : null))) { const rest = g.filter((p) => !g.every((x) => dupIds.has(x.id) && dupIds.has(p.id))); if (rest.length < 2 || g.every((p) => dupIds.has(p.id))) continue; push({ kind: "ENTITY_ALREADY_REPRESENTED", severity: "signal", pages: g.map(ref), evidence: { primaryEntityId: g[0]!.primaryEntityId, context: ctx(g[0]!) }, recommendedAction: "differentiate", message: "A entidade já tem outra página do mesmo archetype neste contexto" }, g.map((p) => p.id)); }
  for (const g of groups(pages, (p) => (p.recipeFingerprint ? [p.tenantId, p.recipeFingerprint] : null))) push({ kind: "REDUNDANT_RECIPE", severity: "conflict", pages: g.map(ref), evidence: { fingerprint: g[0]!.recipeFingerprint }, recommendedAction: "consolidate", message: "Receitas produziram páginas com conteúdo idêntico" }, g.map((p) => p.id));
  // sinal semântico: dentro do MESMO contexto; só investigação
  const byCtx = new Map<string, IntentPage[]>(); for (const p of pages) byCtx.set(ctx(p), [...(byCtx.get(ctx(p)) ?? []), p]);
  for (const g of byCtx.values()) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
    const a = g[i]!, b = g[j]!; if (dupIds.has(a.id) && dupIds.has(b.id)) continue;
    const d = jac(pairs(a.dimensions), pairs(b.dimensions)); const t = jac(tokens(a.h1 ?? a.title), tokens(b.h1 ?? b.title));
    if (a.primaryEntityId === b.primaryEntityId && Math.max(d, t) >= threshold) push({ kind: "OVERLAP_SIGNAL", severity: "signal", pages: [ref(a), ref(b)], evidence: { dimensionSimilarity: Number(d.toFixed(3)), titleSimilarity: Number(t.toFixed(3)), threshold, note: "similaridade é sinal de investigação, não prova de duplicidade" }, recommendedAction: "review", message: "Páginas semanticamente parecidas: investigar" }, [a.id, b.id]);
  }
  const seen = new Set<string>(); return out.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))).sort((a, b) => a.id.localeCompare(b.id));
}
export const conflictsFor = (pageId: string, cs: readonly IntentConflict[]): IntentConflict[] => cs.filter((c) => c.pages.some((p) => p.id === pageId));
