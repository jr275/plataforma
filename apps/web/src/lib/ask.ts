import type { WorkspaceData } from "@/data/demo/types";

export type Answer = { text: string; refs: { label: string; href: string }[] };

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const STOP = new Set(["como", "para", "que", "qual", "quais", "uma", "um", "de", "do", "da", "dos", "das", "o", "a", "os", "as", "e", "em", "no", "na", "por", "com", "sobre", "ha", "tem"]);
const words = (s: string) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));

export const suggestions = (d: WorkspaceData): string[] => [
  "Quais oportunidades pedem decisão?",
  `O que sabemos sobre ${d.entities[0]?.label ?? "as entidades"}?`,
  "O que falta saber para avançar?",
  "Quais fontes estão com problema?",
];

/**
 * Resposta DETERMINÍSTICA de demonstração: procura as palavras da pergunta nos registros do workspace e monta um texto fixo.
 * Não há modelo de IA, agente, citação real nem chamada de rede.
 */
export function demoAnswer(question: string, d: WorkspaceData): Answer {
  const q = norm(question);
  const refs: Answer["refs"] = [];
  if (/(decis|pendente|atencao|prioridade)/.test(q)) {
    const list = d.opportunities.filter((o) => ["in_review", "blocked"].includes(o.status));
    list.forEach((o) => refs.push({ label: o.title, href: `/opportunities/${o.id}` }));
    return { text: list.length ? `Nos dados de demonstração de ${d.workspace.name}, ${list.length} oportunidade(s) pedem decisão (em revisão ou bloqueadas).` : "Nos dados de demonstração, nenhuma oportunidade pede decisão agora.", refs };
  }
  if (/(falta|lacuna|gap)/.test(q)) {
    d.gaps.forEach((g) => refs.push({ label: g.text, href: g.opportunityId ? `/opportunities/${g.opportunityId}` : "/knowledge" }));
    return { text: `Há ${d.gaps.length} lacuna(s) de conhecimento registradas nos dados de demonstração.`, refs };
  }
  if (/(fonte|sincron|desatualiz|erro)/.test(q)) {
    const bad = d.sources.filter((s) => s.health !== "ok");
    bad.forEach((s) => refs.push({ label: `${s.name} (${s.freshness})`, href: `/data-sources/${s.id}` }));
    return { text: bad.length ? `${bad.length} fonte(s) pedem atenção nos dados de demonstração.` : "Todas as fontes de demonstração estão saudáveis.", refs };
  }
  const terms = words(question);
  const hit = (text: string) => terms.some((t) => norm(text).includes(t));
  for (const e of d.entities) if (hit(`${e.label} ${e.summary}`)) refs.push({ label: `Entidade: ${e.label}`, href: `/entities/${e.id}` });
  for (const k of d.knowledge) if (hit(`${k.title} ${k.statement}`)) refs.push({ label: `Conhecimento: ${k.title}`, href: `/knowledge/${k.id}` });
  for (const o of d.opportunities) if (hit(`${o.title} ${o.summary}`)) refs.push({ label: `Oportunidade: ${o.title}`, href: `/opportunities/${o.id}` });
  for (const p of d.pages) if (hit(`${p.title} ${p.summary}`)) refs.push({ label: `Página: ${p.title}`, href: `/pages/${p.id}` });
  const top = refs.slice(0, 6);
  if (top.length === 0) return { text: "Não encontrei registros relacionados nos dados de demonstração. Tente citar uma entidade, uma oportunidade ou uma fonte, ou use uma das sugestões.", refs: [] };
  return { text: `Encontrei ${refs.length} registro(s) relacionados nos dados de demonstração de ${d.workspace.name}. Estes são os principais:`, refs: top };
}
