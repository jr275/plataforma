// Blueprint de página e Experience Quality Gate. O blueprint é uma composição local (não persistida) de arquétipo +
// módulos; os gates são avaliados contra o dataset ativo e nunca afirmam publicação ou indexação sem estado verificado.
import type { Opportunity, WorkspaceData } from "@/data/demo/types";
import { archetypeById, availability, requirementLabel, type Archetype, type ModuleId, type Requirement } from "./archetypes";
import { scoreOpportunity } from "./score";

export type GateResult = "pass" | "fail" | "warning" | "not_evaluated";
export type GateCategory = "Business" | "Knowledge" | "Experience" | "Search" | "GEO" | "Technical";
export const GATE_CATEGORIES: readonly GateCategory[] = ["Business", "Knowledge", "Experience", "Search", "GEO", "Technical"];

export type GateCheck = {
  id: string;
  category: GateCategory;
  name: string;
  result: GateResult;
  critical: boolean;
  explanation: string;
  evidence: string;
  action?: string;
};

export type PublicationState = "draft" | "needs_evidence" | "blocked" | "ready_for_review" | "approved" | "published" | "monitoring";
export const publicationLabel: Record<PublicationState, string> = {
  draft: "Rascunho",
  needs_evidence: "Precisa de evidência",
  blocked: "Bloqueado",
  ready_for_review: "Pronto para revisão",
  approved: "Aprovado",
  published: "Publicado",
  monitoring: "Em monitoramento",
};
/** Estados que exigem um registro verificado que o produto ainda não grava: nunca são atribuídos pela interface. */
export const UNVERIFIED_STATES: readonly PublicationState[] = ["approved", "published", "monitoring"];

export type Blueprint = { opportunityId: string; archetypeId: string; modules: readonly ModuleId[]; cta: string };

export function defaultBlueprint(o: Opportunity, archetype: Archetype): Blueprint {
  return { opportunityId: o.id, archetypeId: archetype.id, modules: archetype.modules, cta: "Falar com a equipe" };
}

export function evaluateGates(d: WorkspaceData, o: Opportunity, bp: Blueprint): GateCheck[] {
  const a = archetypeById(bp.archetypeId)!;
  const avail = availability(d, o);
  const knowledge = d.knowledge.filter((k) => o.knowledgeIds.includes(k.id));
  const sources = d.sources.filter((s) => o.sourceIds.includes(s.id));
  const page = d.pages.find((p) => p.opportunityId === o.id);
  const score = scoreOpportunity(d, o);
  const dim = (id: string) => score.dimensions.find((x) => x.id === id)!;
  const has = (m: ModuleId) => bp.modules.includes(m);
  const missing = a.requires.filter((r) => !avail[r]);
  const expired = knowledge.filter((k) => k.status === "expired");
  const review = knowledge.filter((k) => k.status === "needs_review");
  const failing = sources.filter((s) => s.health === "error");
  const stale = sources.filter((s) => s.health === "stale");
  const canonicalGate = page?.gates.find((g) => g.name === "Canonical");
  const crawler = d.sources.find((s) => s.type === "Crawler");
  const cannibal = dim("cannibalization");

  return [
    {
      id: "biz-fit", category: "Business", name: "Aderência ao negócio", critical: false,
      result: (dim("businessValue").value ?? 0) >= 0.55 ? "pass" : "warning",
      explanation: dim("businessValue").reason, evidence: `Entidades ligadas: ${o.entityIds.length}`,
      action: (dim("businessValue").value ?? 0) >= 0.55 ? undefined : "Ligar a oportunidade a um produto ou serviço do tenant.",
    },
    {
      id: "biz-cta", category: "Business", name: "Próximo passo definido", critical: false,
      result: has("cta") && bp.cta.trim() ? "pass" : "warning",
      explanation: has("cta") ? `CTA: “${bp.cta}”.` : "O blueprint não inclui um módulo de chamada para ação.",
      evidence: "Blueprint local", action: has("cta") ? undefined : "Adicionar o módulo de chamada para ação.",
    },
    {
      id: "kn-facts", category: "Knowledge", name: "Fatos com fonte e validade", critical: true,
      result: knowledge.length === 0 || expired.length ? "fail" : review.length ? "warning" : "pass",
      explanation: knowledge.length === 0 ? "Nenhum fato ligado: a página não pode afirmar nada." : expired.length ? `${expired.length} fato(s) expirado(s).` : review.length ? `${review.length} fato(s) em revisão editorial.` : `${knowledge.length} fato(s) verificados.`,
      evidence: knowledge.map((k) => `${k.id} · ${k.status} · válido até ${k.validUntil}`).join("\n") || "—",
      action: expired.length ? `Reconfirmar: ${expired.map((k) => k.title).join(", ")}.` : review.length ? `Concluir a revisão: ${review.map((k) => k.title).join(", ")}.` : knowledge.length === 0 ? "Extrair fatos de uma fonte cadastrada." : undefined,
    },
    {
      id: "kn-sources", category: "Knowledge", name: "Fontes saudáveis", critical: true,
      result: sources.length === 0 || failing.length ? "fail" : stale.length ? "warning" : "pass",
      explanation: sources.length === 0 ? "Nenhuma fonte cadastrada." : failing.length ? `Falha em ${failing.map((s) => s.name).join(", ")}.` : stale.length ? `Desatualizada: ${stale.map((s) => s.name).join(", ")}.` : "Todas as fontes ligadas estão saudáveis.",
      evidence: sources.map((s) => `${s.name} · ${s.health} · ${s.freshness}`).join("\n") || "—",
      action: failing.length ? "Reexecutar a coleta da fonte com falha." : stale.length ? "Atualizar a fonte desatualizada." : sources.length === 0 ? "Cadastrar uma fonte." : undefined,
    },
    {
      id: "ex-contract", category: "Experience", name: "Contrato do template atendido", critical: true,
      result: missing.length ? "fail" : "pass",
      explanation: missing.length ? `Faltam dados exigidos por ${a.name}.` : `Todos os dados exigidos por ${a.name} estão disponíveis.`,
      evidence: a.requires.map((r) => `${avail[r] ? "✓" : "✗"} ${requirementLabel[r]}`).join("\n"),
      action: missing.length ? `Obter: ${missing.map((r: Requirement) => requirementLabel[r]).join("; ")}. Ou escolher outro arquétipo.` : undefined,
    },
    {
      id: "ex-modules", category: "Experience", name: "Módulos úteis além do texto", critical: false,
      result: bp.modules.some((m) => ["comparison", "map", "filters", "dataTable", "timeSeries", "steps", "faq"].includes(m)) ? "pass" : "warning",
      explanation: "Experiências com estrutura (tabela, mapa, passos, FAQ) tendem a resolver melhor a tarefa do usuário.",
      evidence: `${bp.modules.length} módulos selecionados`,
      action: undefined,
    },
    {
      id: "se-serp", category: "Search", name: "SERP analisada", critical: false, result: "not_evaluated",
      explanation: "Nenhuma SERP foi observada para as consultas ligadas.", evidence: "Provedor de SERP não conectado",
      action: "Conectar um provedor de SERP para comparar formatos e concorrentes.",
    },
    {
      id: "se-cannibal", category: "Search", name: "Sem canibalização", critical: false,
      result: (cannibal.value ?? 0) > 0 ? "warning" : "pass",
      explanation: cannibal.reason, evidence: "Clusters do universo de buscas",
      action: (cannibal.value ?? 0) > 0 ? "Definir qual página é a canônica do cluster." : undefined,
    },
    {
      id: "geo-citable", category: "GEO", name: "Afirmações citáveis", critical: false,
      result: avail.verified_fact ? "pass" : "fail",
      explanation: avail.verified_fact ? "Existe ao menos uma afirmação verificada, com fonte e validade." : "Sem afirmação verificada, sistemas de resposta não têm o que citar.",
      evidence: `${knowledge.filter((k) => k.status === "verified").length} fato(s) verificados`,
      action: avail.verified_fact ? undefined : "Verificar ao menos um fato.",
    },
    {
      id: "geo-visibility", category: "GEO", name: "Visibilidade em respostas de IA", critical: false, result: "not_evaluated",
      explanation: "Nenhum provedor de respostas de IA está conectado; nada foi observado.", evidence: "—",
      action: "Conectar provedores em AI Search Visibility.",
    },
    {
      id: "tc-schema", category: "Technical", name: "Dados estruturados", critical: false,
      result: has("schema") ? "pass" : "warning",
      explanation: has("schema") ? `Tipo ${a.schemaType} declarado pelo contrato do template.` : "O módulo de dados estruturados foi removido.",
      evidence: `schema.org/${a.schemaType}`, action: has("schema") ? undefined : "Reativar o módulo de dados estruturados.",
    },
    {
      id: "tc-canonical", category: "Technical", name: "Canonical e duplicidade", critical: true,
      result: crawler?.health === "error" ? "fail" : canonicalGate ? (canonicalGate.status === "pass" ? "pass" : canonicalGate.status === "fail" ? "fail" : "not_evaluated") : "not_evaluated",
      explanation: crawler?.health === "error" ? "O rastreamento do site falhou: duplicidades não podem ser verificadas." : canonicalGate ? `Gate registrado: ${canonicalGate.status}.` : "Ainda não verificado.",
      evidence: crawler ? `${crawler.name} · ${crawler.health} · ${crawler.freshness}` : "Sem crawler cadastrado",
      action: crawler?.health === "error" ? "Reexecutar o rastreamento do site." : undefined,
    },
  ];
}

export function publicationStateOf(checks: readonly GateCheck[]): PublicationState {
  if (checks.some((c) => c.critical && c.result === "fail")) return "blocked";
  if (checks.some((c) => c.category === "Knowledge" && c.result === "warning")) return "needs_evidence";
  if (checks.every((c) => c.result === "pass" || c.result === "not_evaluated" || !c.critical) && checks.filter((c) => c.result === "warning").length === 0) return "ready_for_review";
  return "draft";
}
