import { CONTRACTS, addNode, connect, type Config, type DraftContext, type NodeType, type OpResult, type PageDraft } from "@plataforma/api/src/draft";

/** Tipos que a pessoa pode adicionar (contrato) e a configuração inicial VÁLIDA de cada um, derivada do contexto real. `null` = não há como adicionar agora (com o motivo). */
export const ADDABLE: readonly NodeType[] = (Object.keys(CONTRACTS) as NodeType[]).filter((t) => CONTRACTS[t].addable && !CONTRACTS[t].singleton);
export type Default = { readonly ok: true; readonly config: Config } | { readonly ok: false; readonly reason: string };
export function defaultConfigFor(type: NodeType, d: PageDraft, c: DraftContext): Default {
  const t = d.nodes.find((n) => n.type === "page_template");
  const tmpl = c.templates.find((x) => x.key === t?.config.templateKey);
  const used = (key: string, type2: NodeType) => new Set(d.nodes.filter((n) => n.type === type2).map((n) => String(n.config[key])));
  switch (type) {
    case "page_section": {
      if (!tmpl) return { ok: false, reason: "Escolha um template antes de adicionar seções." };
      const free = tmpl.sections.find((s) => !used("sectionId", "page_section").has(s.id));
      if (!free) return { ok: false, reason: "Todas as seções do template já estão no rascunho." };
      const order = Math.max(0, ...d.nodes.filter((n) => n.type === "page_section").map((n) => Number(n.config.order) || 0)) + 1;
      return { ok: true, config: { sectionId: free.id, order, enabled: true, onMissing: "omit" } };
    }
    case "internal_link": return { ok: true, config: { path: "/cidades", text: "Todas as cidades" } };
    case "structured_data": {
      if (!tmpl) return { ok: false, reason: "Escolha um template antes de adicionar dados estruturados." };
      const free = tmpl.structuredData.find((x) => !used("type", "structured_data").has(x));
      return free ? { ok: true, config: { type: free } } : { ok: false, reason: "Todos os tipos que o template sustenta já estão no rascunho." };
    }
    case "data_source": {
      const free = c.sources.find((s) => !used("source", "data_source").has(s.id));
      return free ? { ok: true, config: { source: free.id } } : { ok: false, reason: "Todas as fontes implementadas já estão no rascunho." };
    }
    case "evidence_requirement": {
      const free = c.requirements.find((r) => !used("requirementId", "evidence_requirement").has(r.id));
      return free ? { ok: true, config: { requirementId: free.id, acceptedSources: [...free.satisfiedBy], criterion: "any" } } : { ok: false, reason: "Todos os requisitos da vertical já estão no rascunho." };
    }
    default: return { ok: false, reason: "Este tipo de nó é fixo no modelo." };
  }
}

/** Adiciona o nó com a configuração inicial e já faz as ligações OBRIGATÓRIAS do modelo (seção, link e dados estruturados dependem do template). As demais ligações são da pessoa. */
export function addWired(d: PageDraft, type: NodeType, c: DraftContext): OpResult {
  const cfg = defaultConfigFor(type, d, c);
  if (!cfg.ok) return { ok: false, error: cfg.reason };
  const added = addNode(d, type, cfg.config);
  if (!added.ok) return added;
  const tmpl = d.nodes.find((n) => n.type === "page_template");
  if (tmpl && (type === "page_section" || type === "internal_link" || type === "structured_data")) {
    const wired = connect(added.draft, tmpl.id, added.nodeId!);
    return wired.ok ? { ok: true, draft: wired.draft, nodeId: added.nodeId! } : wired;
  }
  return added;
}
