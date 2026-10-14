import type { Blueprint } from "./blueprint";

// Gates de experiência (ADR-024): seis gates INDEPENDENTES, cada um com as próprias verificações. Sem nota composta (regra 5). Verificação sem fonte é
// `not_evaluated` e aparece como tal; nunca passa por padrão. O blueprint está PRONTO quando nenhum gate reprova.
export const GATE_IDS = ["business", "knowledge", "experience", "search", "geo", "technical"] as const;
export type GateId = (typeof GATE_IDS)[number];
export type Outcome = "pass" | "fail" | "warning" | "not_evaluated";
export interface GateCheck { readonly code: string; readonly outcome: Outcome; readonly detail: string; /** Chave estável do bloqueio (para somar no roadmap); só em `fail`. */ readonly blocker?: string }
export interface GateResult { readonly gate: GateId; readonly outcome: Outcome; readonly checks: readonly GateCheck[] }
export interface GateReport { readonly gates: readonly GateResult[]; readonly ready: boolean; readonly blockers: readonly { readonly key: string; readonly gate: GateId; readonly code: string; readonly detail: string }[] }

export const GATE_LABEL: Record<GateId, string> = { business: "Negócio", knowledge: "Conhecimento", experience: "Experiência", search: "Busca", geo: "GEO (busca por IA)", technical: "Técnico" };
const pass = (code: string, detail: string): GateCheck => ({ code, outcome: "pass", detail });
const fail = (code: string, detail: string, blocker: string): GateCheck => ({ code, outcome: "fail", detail, blocker });
const warn = (code: string, detail: string): GateCheck => ({ code, outcome: "warning", detail });
const ne = (code: string, detail: string): GateCheck => ({ code, outcome: "not_evaluated", detail });
const PATH = /^\/[a-z0-9]+(?:[a-z0-9/-]*[a-z0-9])?$/;

/** Pior resultado das verificações; só é `not_evaluated` se NENHUMA foi avaliada. */
export function gateOutcome(checks: readonly GateCheck[]): Outcome {
  if (checks.some((c) => c.outcome === "fail")) return "fail";
  if (checks.some((c) => c.outcome === "warning")) return "warning";
  if (checks.every((c) => c.outcome === "not_evaluated")) return "not_evaluated";
  return "pass";
}

export function evaluateExperienceGates(b: Blueprint): GateReport {
  const sel = b.template.status === "selected";
  const missingCritical = b.requirements.filter((r) => !r.satisfied && r.weight === "critical");
  const missingImportant = b.requirements.filter((r) => !r.satisfied && r.weight === "important");

  const business: GateCheck[] = [
    b.opportunity.eligible === true ? pass("eligible", "a oportunidade é elegível pelo score ativo") : b.opportunity.eligible === false ? fail("eligible", "a oportunidade não é elegível pelo score ativo", "not_eligible") : fail("eligible", "a oportunidade não tem score para avaliar a elegibilidade", "not_eligible"),
    b.opportunity.expectedOutcome.trim() ? pass("outcome_defined", `resultado esperado: ${b.opportunity.expectedOutcome}`) : fail("outcome_defined", "a vertical não define o resultado esperado", "outcome_undefined"),
    b.experience.status === "supported" ? pass("experience_supported", `a experiência "${b.experience.label}" é suportada pela plataforma`) : fail("experience_supported", `a experiência "${b.experience.label}" está ${b.experience.status === "planned" ? "apenas planejada" : "não suportada"}${b.experience.note ? `: ${b.experience.note}` : ""}`, `experience:${b.experience.id}`),
  ];
  const knowledge: GateCheck[] = [
    missingCritical.length === 0 ? pass("critical_evidence", "todos os requisitos críticos de evidência estão atendidos") : fail("critical_evidence", `faltam requisitos críticos: ${missingCritical.map((r) => `${r.label} (${r.note})`).join("; ")}`, missingCritical.map((r) => `evidence:${r.id}`)[0]!),
    missingImportant.length === 0 ? pass("important_evidence", "nenhum requisito importante ausente") : warn("important_evidence", `faltam requisitos importantes: ${missingImportant.map((r) => r.label).join(", ")}`),
    !sel ? ne("section_data", "sem template selecionado, as seções não foram avaliadas")
      : b.sections.every((s) => s.data === "available") ? pass("section_data", "todas as seções têm os dados exigidos")
      : b.sections.every((s) => s.data === "missing") ? fail("section_data", "nenhuma seção tem os dados exigidos", `facts:${b.entity?.kind ?? "entidade"}`)
      : warn("section_data", `seções com dados incompletos: ${b.sections.filter((s) => s.data !== "available").map((s) => `${s.label} (faltam ${s.missingFacts.join(", ")})`).join("; ")}`),
    b.entity === null ? ne("fact_provenance", "a oportunidade não tem entidade") : b.factsProvenance ? pass("fact_provenance", "os fatos da entidade vêm de uma importação registrada, com fonte e data") : fail("fact_provenance", "a entidade não tem fatos com origem registrada", `facts:${b.entity.kind}`),
  ];
  const experience: GateCheck[] = [
    sel ? pass("template_selected", b.template.reason) : fail("template_selected", b.template.reason, b.template.status === "missing" ? `template:${b.experience.id}` : `template_entity:${b.experience.id}`),
    !sel ? ne("sections_defined", "sem template selecionado") : b.sections.length > 0 ? pass("sections_defined", `${b.sections.length} seção(ões) planejada(s) pelo template`) : fail("sections_defined", "o template não define seções", `template:${b.experience.id}`),
  ];
  const cr = b.cannibalization;
  const search: GateCheck[] = [
    ne("intent_format", "o formato foi definido pela vertical para a intenção; não foi confrontado com a SERP real"),
    cr.risk === null ? warn("cannibalization", "risco de canibalização não medido") : cr.risk > cr.max ? fail("cannibalization", `risco de canibalização ${Math.round(cr.risk * 100)}% acima do máximo de ${Math.round(cr.max * 100)}%: atualize a página existente`, "cannibalization") : pass("cannibalization", `risco de canibalização ${Math.round(cr.risk * 100)}% (máximo ${Math.round(cr.max * 100)}%)`),
    ne("serp_analysis", "SERP não analisada: não há provedor de SERP"),
    ne("search_demand", "demanda de busca não medida: não há fonte"),
  ];
  const geo: GateCheck[] = [
    !sel ? ne("answer_first", "sem template selecionado") : b.answerFirst.available ? pass("answer_first", b.answerFirst.reason) : fail("answer_first", b.answerFirst.reason, `facts:${b.entity?.kind ?? "entidade"}`),
    b.entity === null ? ne("citable_facts", "a oportunidade não tem entidade") : b.factsProvenance ? pass("citable_facts", "fatos citáveis com fonte, data e confiança registradas") : fail("citable_facts", "não há fatos citáveis com origem registrada", `facts:${b.entity.kind}`),
    ne("ai_citation_monitoring", "monitoramento de citações em mecanismos de IA não existe: não há fonte de medição"),
  ];
  const technical: GateCheck[] = [
    b.path.proposed === null ? ne("path_valid", "sem template e entidade não há caminho a validar") : PATH.test(b.path.proposed) ? pass("path_valid", `caminho proposto: ${b.path.proposed}`) : fail("path_valid", `caminho proposto fora do formato: ${b.path.proposed}`, "path_invalid"),
    b.path.proposed === null ? ne("path_unique", "sem caminho proposto") : b.path.conflict ? fail("path_unique", `o caminho ${b.path.proposed} já pertence a outra entidade`, "path_conflict") : pass("path_unique", "nenhuma outra página usa este caminho"),
    !sel ? ne("structured_data", "sem template selecionado") : b.structuredData.length > 0 ? pass("structured_data", `tipos propostos: ${b.structuredData.join(", ")} (nada é emitido nesta etapa)`) : warn("structured_data", "o template não declara tipos de dados estruturados"),
    !sel ? ne("internal_links", "sem template selecionado") : b.internalLinks.length === 0 ? warn("internal_links", "o template não propõe links internos") : b.internalLinks.some((l) => l.resolves) ? pass("internal_links", `${b.internalLinks.filter((l) => l.resolves).length} de ${b.internalLinks.length} link(s) interno(s) apontam para páginas que existem`) : warn("internal_links", "nenhum destino de link interno existe ainda no site: a página sairia sem links internos"),
    b.indexing === "noindex_until_published" ? pass("noindex_policy", "a página sai com noindex até a publicação autorizada (regra 5)") : fail("noindex_policy", "política de indexação inválida", "indexing_policy"),
    ne("indexability", "indexabilidade real não verificada: a página não está publicada"),
  ];
  const by: Record<GateId, GateCheck[]> = { business, knowledge, experience, search, geo, technical };
  const gates = GATE_IDS.map((g) => ({ gate: g, outcome: gateOutcome(by[g]), checks: by[g] }));
  const blockers = gates.flatMap((g) => g.checks.filter((c) => c.outcome === "fail").map((c) => ({ key: c.blocker ?? `${g.gate}:${c.code}`, gate: g.gate, code: c.code, detail: c.detail })));
  return { gates, ready: !gates.some((g) => g.outcome === "fail"), blockers };
}
