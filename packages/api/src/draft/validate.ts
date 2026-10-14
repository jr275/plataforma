import { CONTRACTS, GATE_IDS, NODE_TYPES, canConnectTypes, type FieldSpec, type NodeType } from "./contracts";
import type { DraftContext } from "./context";
import { reaches, type DraftNode, type PageDraft } from "./model";

// Validador do rascunho (ADR-026): topologia, configuração por contrato, dependências e pré-requisitos de publicação. PURO: o mesmo código roda no navegador (feedback
// imediato) e no servidor (autoridade). Validar NÃO executa nada e NÃO autoriza nada: `publishable` é sempre falso aqui (não existe mecanismo de publicação).
export type Severity = "error" | "warning" | "info";
export interface Issue { readonly severity: Severity; readonly code: string; readonly message: string; readonly nodeId?: string; readonly edgeId?: string }
export type NodeValidity = "ok" | "warning" | "error";
export interface Validation {
  readonly issues: readonly Issue[]; readonly nodeValidity: Readonly<Record<string, NodeValidity>>;
  readonly errors: number; readonly warnings: number; readonly valid: boolean;
  /** Pré-requisitos de publicação ainda não atendidos (sempre há, enquanto não existir mecanismo de publicação). */
  readonly publication: { readonly publishable: false; readonly reasons: readonly string[] };
}
const NO_DIGIT = /^[^0-9]*$/;

function optionsOf(f: FieldSpec, n: DraftNode, d: PageDraft, c: DraftContext): readonly string[] | null {
  if (Array.isArray(f.options)) return f.options as readonly string[];
  switch (f.options) {
    case "templates": return c.templates.map((t) => t.key);
    case "sources": return c.sources.map((s) => s.id);
    case "requirements": return c.requirements.map((r) => r.id);
    case "requirementTokens": return c.requirements.find((r) => r.id === n.config.requirementId)?.satisfiedBy ?? [];
    case "sections": { const t = d.nodes.find((x) => x.type === "page_template"); return c.templates.find((x) => x.key === t?.config.templateKey)?.sections.map((s) => s.id) ?? []; }
    case "structuredData": { const t = d.nodes.find((x) => x.type === "page_template"); return c.templates.find((x) => x.key === t?.config.templateKey)?.structuredData ?? []; }
    default: return null;
  }
}
/** Opções de um campo enum/lista para a interface (mesma regra do validador). */
export const fieldOptions = optionsOf;

export function validateDraft(d: PageDraft, c: DraftContext): Validation {
  const issues: Issue[] = [];
  const add = (severity: Severity, code: string, message: string, nodeId?: string, edgeId?: string) => issues.push({ severity, code, message, ...(nodeId ? { nodeId } : {}), ...(edgeId ? { edgeId } : {}) });
  const ids = new Set<string>();
  for (const n of d.nodes) { if (ids.has(n.id)) add("error", "duplicate_id", `identificador repetido: ${n.id}`, n.id); ids.add(n.id); }
  const byId = new Map(d.nodes.map((n) => [n.id, n]));

  // topologia
  for (const e of d.edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) { add("error", "dangling_edge", `conexão ${e.id} aponta para um nó inexistente`, undefined, e.id); continue; }
    if (!canConnectTypes(a.type, b.type)) add("error", "incompatible_edge", `“${CONTRACTS[a.type].label}” não pode alimentar “${CONTRACTS[b.type].label}”`, b.id, e.id);
    if (reaches(d.edges.filter((x) => x.id !== e.id), e.to, e.from)) add("error", "cycle", `a conexão ${e.id} participa de um ciclo`, e.from, e.id);
  }
  for (const t of NODE_TYPES) {
    const k = CONTRACTS[t]; const count = d.nodes.filter((n) => n.type === t).length;
    if (k.singleton && count > 1) add("error", "singleton", `só pode haver um nó “${k.label}” (há ${count})`);
    if ((t === "opportunity" || t === "publication" || t === "page_template" || t === "seo_metadata" || t === "search_intent") && count === 0) add("error", "required_node", `falta o nó “${k.label}”`);
  }
  for (const g of GATE_IDS) {
    const nodes = d.nodes.filter((n) => n.type === "quality_gate" && n.config.gate === g);
    if (nodes.length !== 1) add("error", "gate_missing", `deve haver exatamente um gate “${g}” (há ${nodes.length})`);
  }

  // configuração por contrato
  for (const n of d.nodes) {
    const k = CONTRACTS[n.type];
    const known = new Set(k.fields.map((f) => f.key));
    for (const key of Object.keys(n.config)) if (!known.has(key)) add("error", "unknown_field", `o campo “${key}” não existe no contrato de “${k.label}”`, n.id);
    for (const f of k.fields) {
      const v = n.config[f.key];
      if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) { if (f.required) add("error", "required_field", `“${f.label}” é obrigatório`, n.id); continue; }
      if (f.kind === "text") { if (typeof v !== "string") add("error", "type", `“${f.label}” deve ser texto`, n.id); else { if (f.max && v.length > f.max) add("error", "max", `“${f.label}” passa de ${f.max} caracteres`, n.id); if (f.pattern && !new RegExp(f.pattern).test(v)) add("error", "pattern", `“${f.label}” tem formato inválido${f.pattern === NO_DIGIT.source ? " (sem algarismos)" : ""}`, n.id); } }
      else if (f.kind === "number") { if (typeof v !== "number" || !Number.isInteger(v)) add("error", "type", `“${f.label}” deve ser um número inteiro`, n.id); else if ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) add("error", "range", `“${f.label}” deve ficar entre ${f.min} e ${f.max}`, n.id); }
      else if (f.kind === "bool") { if (typeof v !== "boolean") add("error", "type", `“${f.label}” deve ser sim ou não`, n.id); }
      else {
        const opts = optionsOf(f, n, d, c);
        const vals = f.kind === "list" ? (Array.isArray(v) ? (v as string[]) : null) : typeof v === "string" ? [v] : null;
        if (!vals) add("error", "type", `“${f.label}” tem tipo inválido`, n.id);
        else if (opts) for (const x of vals) if (!opts.includes(x)) add("error", "option", `“${x}” não é uma opção válida para “${f.label}”`, n.id);
      }
    }
  }

  // dependências entre nós
  const incoming = (id: string, type: NodeType) => d.edges.filter((e) => e.to === id && byId.get(e.from)?.type === type).length;
  const tmplNode = d.nodes.find((n) => n.type === "page_template");
  const tmpl = c.templates.find((t) => t.key === tmplNode?.config.templateKey);
  if (tmplNode && !tmpl && tmplNode.config.templateKey) add("error", "template_unknown", "o template não existe no registro", tmplNode.id);
  const orders = new Map<number, string>();
  const facts = new Set(c.facts);
  for (const s of d.nodes.filter((n) => n.type === "page_section")) {
    if (incoming(s.id, "page_template") === 0) add("error", "section_no_template", "a seção precisa estar ligada ao template", s.id);
    const o = s.config.order; if (typeof o === "number") { if (orders.has(o)) add("error", "order_duplicate", `a ordem ${o} já é usada por ${orders.get(o)}`, s.id); else orders.set(o, s.id); }
    const sec = tmpl?.sections.find((x) => x.id === s.config.sectionId);
    if (sec && s.config.enabled !== false) {
      const ok = sec.paragraphs.filter((p) => p.requires.every((f) => facts.has(f))).length;
      const missing = [...new Set(sec.paragraphs.flatMap((p) => p.requires))].filter((f) => !facts.has(f));
      if (ok === 0) add(s.config.onMissing === "block" ? "error" : "warning", "section_no_data", `a seção não tem dados: faltam ${missing.join(", ")}${s.config.onMissing === "block" ? " (configurada para bloquear)" : " (será omitida)"}`, s.id);
      else if (missing.length) add("warning", "section_partial", `dados parciais: faltam ${missing.join(", ")}`, s.id);
    }
  }
  const sectionIds = d.nodes.filter((n) => n.type === "page_section").map((n) => n.config.sectionId);
  if (new Set(sectionIds).size !== sectionIds.length) add("warning", "section_repeated", "a mesma seção do template aparece em mais de um nó");
  for (const n of d.nodes.filter((x) => x.type === "evidence_requirement")) {
    const r = c.requirements.find((x) => x.id === n.config.requirementId);
    const tokens = (n.config.acceptedSources as readonly string[] | undefined) ?? [];
    if (r && tokens.length) {
      const have = tokens.filter((t) => c.available.includes(t));
      const satisfied = n.config.criterion === "all" ? have.length === tokens.length : have.length > 0;
      if (!satisfied) add(r.weight === "critical" ? "error" : "warning", "requirement_unmet", `requisito não atendido: nenhuma fonte aceita existe agora (${tokens.join(", ")}). ${r.note}`, n.id);
      const unavailable = tokens.filter((t) => !c.available.includes(t));
      if (satisfied && unavailable.length) add("info", "source_unavailable", `fontes aceitas ainda indisponíveis: ${unavailable.join(", ")}`, n.id);
    }
  }
  for (const n of d.nodes.filter((x) => x.type === "internal_link")) {
    if (typeof n.config.path === "string" && !c.knownPaths.includes(n.config.path)) add("warning", "link_dangling", `o destino ${n.config.path} ainda não existe no site: o link não será emitido`, n.id);
    if (incoming(n.id, "page_template") === 0) add("error", "link_no_template", "o link precisa estar ligado ao template", n.id);
  }
  for (const n of d.nodes.filter((x) => x.type === "structured_data")) { if (incoming(n.id, "page_template") === 0) add("error", "sd_no_template", "os dados estruturados precisam estar ligados ao template", n.id); }
  for (const n of d.nodes.filter((x) => x.type === "seo_metadata")) { if (incoming(n.id, "page_template") === 0) add("error", "seo_no_template", "os metadados precisam estar ligados ao template", n.id); }
  const pub = d.nodes.find((n) => n.type === "publication");
  if (pub) for (const g of d.nodes.filter((n) => n.type === "quality_gate")) if (!d.edges.some((e) => e.from === g.id && e.to === pub.id)) add("error", "gate_unlinked", `o gate “${g.config.gate}” não está ligado à decisão de publicação`, g.id);
  for (const g of d.nodes.filter((n) => n.type === "quality_gate")) if (incoming(g.id, "page_section") + incoming(g.id, "internal_link") + incoming(g.id, "seo_metadata") + incoming(g.id, "structured_data") + incoming(g.id, "evidence_requirement") === 0) add("warning", "gate_no_input", `o gate “${g.config.gate}” não recebe nenhum conteúdo para avaliar`, g.id);

  const reasons: string[] = [];
  if (!c.publicationAvailable) reasons.push("não existe mecanismo de publicação (decisão do dono)");
  reasons.push("saúde do índice do domínio não medida (sem Search Console)");
  if (issues.some((i) => i.severity === "error")) reasons.push("o rascunho tem erros de validação");
  const nodeValidity: Record<string, NodeValidity> = {};
  for (const n of d.nodes) nodeValidity[n.id] = issues.some((i) => i.nodeId === n.id && i.severity === "error") ? "error" : issues.some((i) => i.nodeId === n.id && i.severity === "warning") ? "warning" : "ok";
  const errors = issues.filter((i) => i.severity === "error").length;
  return { issues, nodeValidity, errors, warnings: issues.filter((i) => i.severity === "warning").length, valid: errors === 0, publication: { publishable: false, reasons } };
}
