import type { EvidenceDraft } from "./evidence";
import { fold } from "./normalize";
import type { SignalRule, VerticalDefinition } from "./vertical";

// Sinais (ADR-023, seção 3): liga um registro de evidência a temas da vertical e, por eles, a grupos de padrões de query. A ligação é uma INFERÊNCIA por regra
// (palavra-chave ou indicador), sempre explicada; não é uma medida de demanda.
export interface SignalMatch { readonly topic: string; readonly label: string; readonly via: "indicator" | "keyword"; readonly matched: readonly string[]; readonly groups: readonly string[]; readonly reason: string }

const hasWord = (haystack: string, kw: string): boolean => new RegExp(`(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(haystack);

export function matchSignals(def: VerticalDefinition, e: Pick<EvidenceDraft, "sourceRef" | "title" | "summary" | "payload">): SignalMatch[] {
  const text = fold(`${e.title} ${e.summary ?? ""}`);
  const out: SignalMatch[] = [];
  for (const rule of def.signals) {
    const viaIndicator = rule.indicators.includes(e.sourceRef) || e.payload.topic === rule.topic;
    const matched = rule.keywords.filter((k) => hasWord(text, fold(k)));
    if (viaIndicator) out.push(build(rule, "indicator", [e.sourceRef], `o indicador ${e.sourceRef} pertence ao tema`));
    else if (matched.length > 0) out.push(build(rule, "keyword", matched, `o texto cita ${matched.map((m) => `"${m}"`).join(", ")}`));
  }
  return out;
}
const build = (r: SignalRule, via: SignalMatch["via"], matched: readonly string[], why: string): SignalMatch => ({ topic: r.topic, label: r.label, via, matched, groups: r.groups, reason: `${r.explain}: ${why}` });

export interface TrendSignal { readonly evidenceKey: string; readonly topic: string; readonly label: string; readonly direction: "up" | "down" | "stable" | "unknown" | null; readonly note: string }
/** Direção observada nos indicadores ligados a um grupo (só indicadores com direção calculada; notícia não tem direção). */
export function trendFor(group: string, links: readonly { evidenceKey: string; match: SignalMatch; draft: Pick<EvidenceDraft, "kind" | "title" | "summary" | "payload"> }[]): TrendSignal[] {
  return links.filter((l) => l.match.groups.includes(group) && l.draft.kind === "indicator").map((l) => ({
    evidenceKey: l.evidenceKey, topic: l.match.topic, label: l.match.label, direction: (l.draft.payload.direction as TrendSignal["direction"]) ?? null, note: `${l.draft.title}. ${l.draft.summary ?? ""}`.trim(),
  }));
}
