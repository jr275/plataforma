import { parseRef, type GraphNodeKind, type GraphReader } from "./model";

// Ferramentas REAIS e SOMENTE LEITURA que o painel de investigação executa sobre o grafo do tenant. Não há modelo de linguagem aqui: cada ferramenta
// é uma consulta determinística que devolve passos, achados (com a natureza de cada valor) e citações (links para a evidência).
export const GRAPH_TOOLS = ["describe_entity", "trace_source", "list_relationships", "check_generation", "top_cities"] as const;
export type GraphTool = (typeof GRAPH_TOOLS)[number];
export const isGraphTool = (x: unknown): x is GraphTool => typeof x === "string" && (GRAPH_TOOLS as readonly string[]).includes(x);

export interface ToolStep { readonly label: string; readonly status: "done" | "failed" }
/** `fact` literal da fonte; `derived` calculado ou gravado pelo sistema; `suggestion` ação possível (nunca um fato). */
export interface ToolFinding { readonly label: string; readonly value: string; readonly basis: "fact" | "derived" | "suggestion"; readonly href: string | null }
export interface GraphToolResult {
  readonly tool: GraphTool; readonly ref: string; readonly ok: boolean; readonly title: string;
  readonly steps: readonly ToolStep[]; readonly findings: readonly ToolFinding[]; readonly citations: readonly { readonly label: string; readonly href: string }[];
  readonly error: string | null;
}

const APPLIES: Record<GraphTool, readonly GraphNodeKind[]> = {
  describe_entity: ["city", "uf", "region", "page"], trace_source: ["city", "uf", "region", "page"], list_relationships: ["city", "uf", "region", "page"],
  check_generation: ["city", "uf", "page"], top_cities: ["uf"], // a região só se liga a UFs; as cidades dela aparecem pelas UFs
};
export const TOOL_LABEL: Record<GraphTool, string> = { describe_entity: "Descrever a entidade", trace_source: "Rastrear a origem e a atualidade", list_relationships: "Listar as relações", check_generation: "Conferir a geração de páginas", top_cities: "Maiores cidades por população" };
export const toolsFor = (kind: GraphNodeKind): GraphTool[] => GRAPH_TOOLS.filter((t) => APPLIES[t].includes(kind));

const fmtDate = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const ageDays = (d: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
const fail = (tool: GraphTool, ref: string, title: string, error: string, steps: ToolStep[]): GraphToolResult => ({ tool, ref, ok: false, title, steps: [...steps, { label: error, status: "failed" }], findings: [], citations: [], error });

export async function runGraphTool(reader: GraphReader, tool: GraphTool, ref: string, now: Date): Promise<GraphToolResult> {
  const title = TOOL_LABEL[tool];
  const parsed = parseRef(ref);
  if (!parsed) return fail(tool, ref, title, "Referência de nó inválida.", []);
  if (!APPLIES[tool].includes(parsed.kind)) return fail(tool, ref, title, "Esta ferramenta não se aplica a este tipo de entidade.", []);
  const steps: ToolStep[] = [];
  const detail = await reader.node(ref);
  if (!detail) return fail(tool, ref, title, "A entidade não existe neste workspace.", steps);
  steps.push({ label: `Entidade lida: ${detail.node.label}`, status: "done" });
  const citations = detail.links.map((l) => ({ label: l.label, href: l.href }));
  const findings: ToolFinding[] = [];

  if (tool === "describe_entity") {
    for (const a of detail.attributes) findings.push({ label: a.label, value: a.value, basis: a.basis, href: null });
    for (const s of detail.suggestions) findings.push({ label: "Sugestão", value: s.text, basis: "suggestion", href: s.href });
  } else if (tool === "trace_source") {
    steps.push({ label: "Origem da importação lida", status: "done" });
    for (const s of detail.provenance.sources) {
      findings.push({ label: "Fonte", value: `${s.sourceName} (${s.origin === "real" ? "origem real" : s.origin === "test" ? "origem de TESTE" : "origem manual"})`, basis: "fact", href: `/data-flow?run=${s.runId}` });
      findings.push({ label: "Arquivo", value: s.fileName, basis: "fact", href: null });
      findings.push({ label: "SHA-256", value: s.fileSha256, basis: "fact", href: null });
      findings.push({ label: "Importado em", value: `${fmtDate(s.importedAt)} (há ${ageDays(s.importedAt, now)} dia(s))`, basis: "derived", href: null });
      findings.push({ label: "Execução", value: `${s.status}; ${s.acceptedRows} de ${s.totalRows} linhas aceitas`, basis: "fact", href: null });
    }
    if (detail.provenance.record) findings.push({ label: "Linha original", value: `linha ${detail.provenance.record.rowNumber} (${detail.provenance.record.outcome}): ${Object.entries(detail.provenance.record.raw).map(([k, v]) => `${k}=${v === "" ? "(vazio)" : v}`).join("; ")}`, basis: "fact", href: null });
    if (detail.provenance.sources.length === 0) findings.push({ label: "Fonte", value: "nenhuma execução de importação encontrada", basis: "derived", href: null });
  } else if (tool === "list_relationships") {
    const x = await reader.expand(ref, { limit: 8 });
    if (!x) return fail(tool, ref, title, "Não foi possível expandir a entidade.", steps);
    steps.push({ label: "Vizinhança consultada", status: "done" });
    for (const [kind, total] of Object.entries(x.totals)) findings.push({ label: `Vizinhos do tipo ${kind}`, value: `${total} (mostrando ${x.shown[kind as GraphNodeKind] ?? 0})`, basis: "derived", href: null });
    for (const e of x.edges.slice(0, 12)) findings.push({ label: e.label, value: `${e.from} → ${e.to}`, basis: "derived", href: null });
  } else if (tool === "check_generation") {
    steps.push({ label: "Estado das páginas consultado", status: "done" });
    if (parsed.kind === "city") {
      const x = await reader.expand(ref, { kinds: ["page"] });
      const p = x?.neighbors.find((n) => n.kind === "page");
      findings.push({ label: "Página gerada", value: p ? `${p.label} (${p.detail})` : "nenhuma", basis: "derived", href: p ? `/generation/pages/${p.ref.slice(5)}` : null });
    } else if (parsed.kind === "page") findings.push({ label: "Status", value: detail.attributes.find((a) => a.label === "Status")?.value ?? "desconhecido", basis: "derived", href: null });
    else findings.push({ label: "Com página gerada", value: detail.attributes.find((a) => a.label === "Com página gerada")?.value ?? "desconhecido", basis: "derived", href: null });
    for (const s of detail.suggestions) findings.push({ label: "Sugestão", value: s.text, basis: "suggestion", href: s.href });
  } else {
    const x = await reader.expand(ref, { kinds: ["city"], limit: 5 });
    if (!x) return fail(tool, ref, title, "Não foi possível consultar as cidades.", steps);
    steps.push({ label: "Cidades ordenadas por população", status: "done" });
    for (const n of x.neighbors) findings.push({ label: n.label, value: n.detail ?? "", basis: "fact", href: `/cities/${n.ref.slice(5)}` });
    if (x.neighbors.length === 0) findings.push({ label: "Cidades", value: "nenhuma encontrada", basis: "derived", href: null });
  }
  steps.push({ label: "Resultado montado", status: "done" });
  return { tool, ref, ok: true, title, steps, findings, citations, error: null };
}
