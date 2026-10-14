import type { Blueprint, BlueprintRequirement, BlueprintSection } from "../engine/blueprint";
import type { GateReport } from "../engine/experience-gates";
import { GATE_IDS, type NodeType } from "./contracts";
import type { DraftContext } from "./context";
import { contentSig, type DraftEdge, type DraftNode, type PageDraft } from "./model";
import { sig } from "./sig";

// Conversões do domínio: (1) blueprint gravado -> rascunho inicial; (2) rascunho -> blueprint avaliável (para os gates e a prévia); (3) estado de execução por nó.
// O grafo do React Flow nunca é fonte de fatos: tudo sai do rascunho + contexto + blueprint gravado.
const matches = (srcToken: string, token: string) => token === srcToken || token.startsWith(`${srcToken}:`);
export const blueprintSig = (b: Blueprint): string => sig(b);

export function defaultDraft(b: Blueprint, c: DraftContext, blueprintVersion: number): PageDraft {
  const nodes: DraftNode[] = [];
  const edges: DraftEdge[] = [];
  const node = (id: string, type: NodeType, config: DraftNode["config"] = {}) => { nodes.push({ id, type, config }); return id; };
  const edge = (from: string, to: string) => { if (!edges.some((e) => e.id === `${from}>${to}`)) edges.push({ id: `${from}>${to}`, from, to }); };
  const opp = node("opportunity-1", "opportunity");
  const intent = node("search_intent-1", "search_intent"); edge(opp, intent);
  const ent = b.entity ? node("entity-1", "entity") : null; if (ent) edge(opp, ent);
  const reqIds: string[] = [];
  let ri = 0;
  for (const r of b.requirements) {
    const def = c.requirements.find((x) => x.id === r.id);
    const id = node(`evidence_requirement-${++ri}`, "evidence_requirement", { requirementId: r.id, acceptedSources: [...(def?.satisfiedBy ?? [])], criterion: "any" });
    reqIds.push(id);
    if (ent && (def?.satisfiedBy ?? []).includes("entities")) edge(ent, id);
  }
  const usedSources = new Set<string>();
  for (const [i, r] of b.requirements.entries()) for (const s of c.sources) if (r.by && matches(s.token, r.by) && !usedSources.has(s.id)) { usedSources.add(s.id); const id = node(`data_source-${usedSources.size}`, "data_source", { source: s.id }); edge(id, reqIds[i]!); if (ent && s.token === "entities") edge(id, ent); }
  const tmpl = node("page_template-1", "page_template", { templateKey: b.template.key ?? "" }); edge(intent, tmpl);
  const secIds: string[] = [];
  const tdef = c.templates.find((t) => t.key === b.template.key);
  tdef?.sections.forEach((s, i) => { const id = node(`page_section-${i + 1}`, "page_section", { sectionId: s.id, order: i + 1, enabled: true, onMissing: "omit" }); secIds.push(id); edge(tmpl, id); for (const r of reqIds) edge(r, id); });
  const linkIds = b.internalLinks.map((l, i) => { const id = node(`internal_link-${i + 1}`, "internal_link", { path: l.path, text: l.text }); edge(tmpl, id); return id; });
  const seo = node("seo_metadata-1", "seo_metadata"); edge(tmpl, seo);
  const sdIds = b.structuredData.map((t, i) => { const id = node(`structured_data-${i + 1}`, "structured_data", { type: t }); edge(tmpl, id); return id; });
  const gate = Object.fromEntries(GATE_IDS.map((g) => [g, node(`quality_gate-${GATE_IDS.indexOf(g) + 1}`, "quality_gate", { gate: g })])) as Record<(typeof GATE_IDS)[number], string>;
  const pub = node("publication-1", "publication");
  edge(opp, gate.business);
  for (const r of reqIds) edge(r, gate.knowledge);
  for (const s of secIds) { edge(s, gate.knowledge); edge(s, gate.experience); edge(s, gate.geo); }
  edge(tmpl, gate.experience); edge(tmpl, gate.technical);
  edge(seo, gate.search); edge(opp, gate.search); edge(seo, gate.technical);
  for (const s of sdIds) { edge(s, gate.geo); edge(s, gate.technical); }
  for (const l of linkIds) edge(l, gate.technical);
  for (const g of GATE_IDS) edge(gate[g], pub);
  return { schema: "page-draft/v1", nodes, edges, layout: {}, basis: { blueprintVersion, blueprintSig: blueprintSig(b) } };
}

/** O blueprint que o rascunho descreve: serve para reavaliar os gates e para a prévia. Só usa o que está no rascunho + contexto + blueprint base; nada é inventado. */
export function draftToBlueprint(d: PageDraft, base: Blueprint, c: DraftContext): Blueprint {
  const tn = d.nodes.find((n) => n.type === "page_template");
  const tdef = c.templates.find((t) => t.key === tn?.config.templateKey);
  const facts = new Set(c.facts);
  const template: Blueprint["template"] = tdef && base.template.status === "selected" && base.template.key === tdef.key ? base.template
    : tdef && base.entity && tdef.entityKind === base.entity.kind
    ? { status: "selected", key: tdef.key, version: tdef.version, reason: `template ${tdef.key} v${tdef.version} (rascunho) atende entidades do tipo ${tdef.entityKind}` }
    : tdef ? { status: "entity_mismatch", key: null, version: null, reason: "o template escolhido no rascunho não atende a entidade desta oportunidade" }
    : { status: "missing", key: null, version: null, reason: "nenhum template válido selecionado no rascunho" };
  const requirements: BlueprintRequirement[] = d.nodes.filter((n) => n.type === "evidence_requirement").flatMap((n) => {
    const r = c.requirements.find((x) => x.id === n.config.requirementId);
    if (!r) return [];
    const tokens = ((n.config.acceptedSources as readonly string[]) ?? []).filter((t) => r.satisfiedBy.includes(t));
    const have = tokens.filter((t) => c.available.includes(t));
    const satisfied = tokens.length > 0 && (n.config.criterion === "all" ? have.length === tokens.length : have.length > 0);
    return [{ id: r.id, label: r.label, weight: r.weight, satisfied, by: satisfied ? have[0]! : null, note: r.note }];
  });
  const sections: BlueprintSection[] = template.status !== "selected" ? [] : d.nodes.filter((n) => n.type === "page_section" && n.config.enabled !== false).sort((a, b) => (a.config.order as number) - (b.config.order as number)).flatMap((n) => {
    const s = tdef!.sections.find((x) => x.id === n.config.sectionId);
    if (!s) return [];
    const ok = s.paragraphs.filter((p) => p.requires.every((f) => facts.has(f))).length;
    const requires = [...new Set(s.paragraphs.flatMap((p) => p.requires))];
    return [{ id: s.id, label: (n.config.heading as string) || s.label, data: ok === s.paragraphs.length ? "available" : ok === 0 ? "missing" : "partial", requires, missingFacts: requires.filter((f) => !facts.has(f)) } as BlueprintSection];
  });
  const first = sections[0] ? tdef!.sections.find((x) => x.id === sections[0]!.id)?.paragraphs[0] : undefined;
  const internalLinks = d.nodes.filter((n) => n.type === "internal_link").map((n) => ({ path: String(n.config.path ?? ""), text: String(n.config.text ?? ""), resolves: c.knownPaths.includes(String(n.config.path ?? "")) }));
  return {
    ...base, template, requirements, sections,
    answerFirst: first ? { available: first.requires.every((f) => facts.has(f)), sectionId: sections[0]!.id, facts: first.requires, reason: first.requires.every((f) => facts.has(f)) ? "o primeiro parágrafo responde com fatos da própria entidade" : `faltam fatos para o primeiro parágrafo: ${first.requires.filter((f) => !facts.has(f)).join(", ")}` } : { available: false, sectionId: null, facts: [], reason: "sem seção configurada, não há bloco de resposta direta" },
    factsProvenance: facts.size > 0,
    structuredData: [...new Set(d.nodes.filter((n) => n.type === "structured_data" && typeof n.config.type === "string").map((n) => n.config.type as string))],
    path: template.status === "selected" ? base.path : { proposed: null, conflict: false },
    internalLinks,
    cannibalization: { risk: c.cannibalizationRisk, max: c.maxCannibalizationRisk },
  };
}

export type ExecStatus = "done" | "warning" | "blocked" | "pending" | "not_evaluated" | "unavailable";
export interface ExecState { readonly status: ExecStatus; readonly detail: string }
const GATE_MAP = { pass: "done", fail: "blocked", warning: "warning", not_evaluated: "not_evaluated" } as const;

/** Estado de EXECUÇÃO por nó (separado da validade da configuração). Resultado de gate só vale se o conteúdo não mudou desde a avaliação (`stale` = invalidado). */
export function executionStates(d: PageDraft, c: DraftContext, bp: Blueprint, report: GateReport | null, stale: boolean): Record<string, ExecState> {
  const out: Record<string, ExecState> = {};
  const facts = new Set(c.facts);
  for (const n of d.nodes) {
    let s: ExecState;
    switch (n.type) {
      case "opportunity": s = { status: "done", detail: "Oportunidade gravada pelo motor" }; break;
      case "search_intent": s = { status: "done", detail: "Definida pela vertical" }; break;
      case "entity": s = facts.size > 0 ? { status: "done", detail: `${facts.size} fato(s) com origem registrada` } : { status: "unavailable", detail: "Sem fatos com origem registrada" }; break;
      case "data_source": { const src = c.sources.find((x) => x.id === n.config.source); s = !src ? { status: "unavailable", detail: "Fonte desconhecida" } : c.available.some((t) => matches(src.token, t)) ? { status: "done", detail: `${src.label}: dados disponíveis` } : { status: "unavailable", detail: `${src.label}: sem dados coletados neste workspace` }; break; }
      case "evidence_requirement": { const r = bp.requirements.find((x) => x.id === n.config.requirementId); s = !r ? { status: "unavailable", detail: "Requisito inválido" } : r.satisfied ? { status: "done", detail: `Atendido por ${r.by}` } : { status: r.weight === "critical" ? "blocked" : "warning", detail: `Não atendido: ${r.note}` }; break; }
      case "page_template": s = bp.template.status === "selected" ? { status: "done", detail: bp.template.reason } : { status: "blocked", detail: bp.template.reason }; break;
      case "page_section": { if (n.config.enabled === false) { s = { status: "pending", detail: "Desligada: não será renderizada" }; break; } const sec = bp.sections.find((x) => x.id === n.config.sectionId); s = !sec ? { status: bp.template.status === "selected" ? "unavailable" : "blocked", detail: "Sem template ou seção inexistente" } : sec.data === "available" ? { status: "done", detail: "Dados completos" } : sec.data === "partial" ? { status: "warning", detail: `Dados parciais: faltam ${sec.missingFacts.join(", ")}` } : { status: n.config.onMissing === "block" ? "blocked" : "unavailable", detail: `Sem dados: faltam ${sec.missingFacts.join(", ")}` }; break; }
      case "internal_link": { const l = bp.internalLinks.find((x) => x.path === n.config.path); s = l?.resolves ? { status: "done", detail: "Destino existe" } : { status: "unavailable", detail: "Destino ainda não existe: o link não será emitido" }; break; }
      case "seo_metadata": s = bp.template.status === "selected" ? { status: "done", detail: "Gerados pelo template com limites fixos" } : { status: "not_evaluated", detail: "Sem template: não há o que gerar" }; break;
      case "structured_data": s = bp.structuredData.includes(String(n.config.type)) ? { status: "done", detail: "Tipo sustentado pelo template (nada é emitido)" } : { status: "blocked", detail: "Tipo não sustentado pelo template" }; break;
      case "quality_gate": {
        const g = report?.gates.find((x) => x.gate === n.config.gate);
        s = stale ? { status: "not_evaluated", detail: "Invalidado por uma alteração: valide para reavaliar" } : !g ? { status: "not_evaluated", detail: "Ainda não avaliado" } : { status: GATE_MAP[g.outcome], detail: `${g.checks.filter((x) => x.outcome === "not_evaluated").length} verificação(ões) sem fonte` };
        break;
      }
      case "publication": s = { status: "blocked", detail: "Bloqueada: sem mecanismo de publicação; gates e rascunho válidos não bastam" }; break;
    }
    out[n.id] = s;
  }
  return out;
}

/** Campos derivados (somente leitura) exibidos no inspector. */
export function derivedFields(n: DraftNode, c: DraftContext, bp: Blueprint, exec: ExecState | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const f = (k: string, v: string) => { out[k] = v; };
  switch (n.type) {
    case "opportunity": f("Consulta", bp.opportunity.query); f("Padrão", bp.opportunity.pattern); break;
    case "search_intent": f("Intenção", bp.opportunity.intent); f("Estágio", bp.opportunity.stage); f("Experiência", bp.experience.label); break;
    case "entity": f("Entidade", bp.entity ? `${bp.entity.name}${bp.entity.qualifier ? ` (${bp.entity.qualifier})` : ""}` : "—"); f("Fatos conhecidos", c.facts.join(", ") || "nenhum"); break;
    case "data_source": { const s = c.sources.find((x) => x.id === n.config.source); f("Estado", exec?.detail ?? "—"); f("Token de dados", s?.token ?? "—"); break; }
    case "evidence_requirement": { const r = c.requirements.find((x) => x.id === n.config.requirementId); f("Peso", r?.weight ?? "—"); f("Situação", exec?.detail ?? "—"); f("Fontes possíveis", r?.satisfiedBy.join(", ") ?? "—"); break; }
    case "page_template": { const t = c.templates.find((x) => x.key === n.config.templateKey); f("Versão", t ? `v${t.version}` : "—"); f("Tipo de entidade", t?.entityKind ?? "—"); f("Seções (slots)", t?.sections.map((s) => s.id).join(", ") ?? "—"); break; }
    case "page_section": { const t = c.templates.find((x) => x.key === d_template(bp)); const s = t?.sections.find((x) => x.id === n.config.sectionId); f("Fatos exigidos", s ? [...new Set(s.paragraphs.flatMap((p) => p.requires))].join(", ") : "—"); f("Situação", exec?.detail ?? "—"); break; }
    case "internal_link": f("Situação", exec?.detail ?? "—"); break;
    case "seo_metadata": f("Canonical", "o próprio caminho da página"); f("Robots", "noindex até a publicação autorizada"); f("Regras", "título até 60 caracteres; descrição entre 70 e 155"); f("Situação", exec?.detail ?? "—"); break;
    case "structured_data": f("Proveniência", "cada propriedade vem de um fato com fonte; sem fato, sem propriedade"); f("Situação", exec?.detail ?? "—"); break;
    case "quality_gate": f("Resultado", exec?.detail ?? "—"); break;
    case "publication": f("Estado", "bloqueada"); f("Pré-requisitos", "gates sem reprovação + rascunho válido + mecanismo de publicação (inexistente) + saúde do índice ≥ 95% (não medida)"); break;
  }
  return out;
}
const d_template = (bp: Blueprint): string => bp.template.key ?? "";
export { contentSig };
