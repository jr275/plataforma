import type { PageRecipe, RecipeBlock } from "../recipe/types";

// Renderizador ÚNICO do recipe compilado → documento HTML. O preview do Control Plane e a saída que um deployment publicaria usam ESTA função (não há segunda lógica de render).
// Puro e determinístico: mesmo recipe = mesmo HTML. Todo texto é escapado; JSON-LD vai serializado sem poder fechar a tag; nada vem de um LLM sem passar pelo recipe validado.
export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const ld = (o: unknown): string => JSON.stringify(o).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const safeHref = (p: string): string => (/^\/[A-Za-z0-9\-._~/%]*$/.test(p) ? p : "#");

export interface RenderOptions {
  /** Preview do operador: marca blocos por módulo/origem e mostra módulos removidos. Fora do preview o documento é o publicável (sem anotações). */
  readonly annotate?: boolean;
}
export interface RenderedDocument {
  readonly html: string;
  readonly seo: { readonly title: string; readonly metaDescription: string; readonly canonical: string | null; readonly robots: "index" | "noindex"; readonly h1: string; readonly url: string | null };
  readonly jsonLd: readonly Record<string, unknown>[];
  readonly links: readonly { readonly path: string; readonly text: string }[];
  /** Módulos do contrato e o que aconteceu com cada um na página (por que foi incluído ou omitido). */
  readonly modules: readonly { readonly moduleId: string; readonly status: string; readonly render: string; readonly why: string; readonly blocks: number }[];
  readonly stats: { readonly blocks: number; readonly paragraphs: number; readonly insufficiencies: number; readonly facts: number; readonly textFromAgent7: number };
}
const WHY: Record<string, string> = {
  RENDERED: "dados suficientes: o módulo foi renderizado com fatos referenciados",
  REMOVED: "dados insuficientes e a regra do módulo é remover: omitido da página",
  INSUFFICIENCY_SHOWN: "dados insuficientes e a regra do módulo é mostrar a insuficiência: aviso explícito no lugar do texto",
};
const CSS = "body{font:16px/1.6 system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 1rem;color:#1c1917}h1{font-size:1.9rem;line-height:1.2}h2{margin-top:2rem}.insufficiency{border-left:3px solid #b45309;padding:.5rem .75rem;background:#fffbeb;color:#78350f}.sources{font-size:.85rem;color:#57534e}nav a{margin-right:1rem}[data-annotated] [data-block]{outline:1px dashed #a8a29e;outline-offset:2px;margin:.4rem 0}[data-annotated] [data-block][data-source=agent7]{outline-color:#2563eb}.removed{font:12px ui-monospace,monospace;color:#7f1d1d;background:#fef2f2;padding:.4rem .6rem;margin:.4rem 0}";

export function renderRecipeDocument(r: PageRecipe, o: RenderOptions = {}): RenderedDocument {
  const byModule = new Map<string, RecipeBlock[]>(); for (const b of r.blocks) byModule.set(b.moduleId, [...(byModule.get(b.moduleId) ?? []), b]);
  const order = r.modules.map((m) => m.moduleId); for (const k of byModule.keys()) if (!order.includes(k)) order.push(k);
  const annotate = o.annotate === true;
  const parts: string[] = [];
  for (const id of order) {
    const m = r.modules.find((x) => x.moduleId === id); const blocks = byModule.get(id) ?? [];
    if (m && m.render === "REMOVED") { if (annotate) parts.push(`<div class="removed" data-removed-module="${esc(id)}">módulo “${esc(id)}” omitido: ${esc(WHY.REMOVED!)}</div>`); continue; }
    const inner = blocks.map((b) => {
      const attrs = annotate ? ` data-block="${esc(b.blockId)}" data-source="${b.source}" data-refs="${esc(b.refs.join(","))}"` : "";
      if (b.kind === "heading") return `<h2${attrs}>${esc(b.text)}</h2>`;
      if (b.kind === "insufficiency") return `<p class="insufficiency"${attrs}>${esc(b.text)}</p>`;
      if (b.kind === "sources") return `<p class="sources"${attrs}>${esc(b.text)}</p>`;
      return `<p${attrs}>${esc(b.text)}</p>`;
    }).join("");
    parts.push(`<section data-module="${esc(id)}">${inner}</section>`);
  }
  const nav = r.links.length ? `<nav aria-label="Páginas relacionadas">${r.links.map((l) => `<a href="${safeHref(l.path)}">${esc(l.text)}</a>`).join("")}</nav>` : "";
  const head = [`<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width, initial-scale=1">`, `<title>${esc(r.title)}</title>`, `<meta name="description" content="${esc(r.metaDescription)}">`, `<meta name="robots" content="${r.robots}">`, r.canonical ? `<link rel="canonical" href="${esc(r.canonical)}">` : "", `<style>${CSS}</style>`, ...r.jsonLd.map((j) => `<script type="application/ld+json">${ld(j)}</script>`)].filter(Boolean).join("\n");
  const html = `<!doctype html>\n<html lang="pt-BR">\n<head>\n${head}\n</head>\n<body${annotate ? " data-annotated" : ""}>\n<main>\n<h1>${esc(r.h1)}</h1>\n${parts.join("\n")}\n${nav}\n</main>\n</body>\n</html>\n`;
  const modules = order.map((id) => { const m = r.modules.find((x) => x.moduleId === id); return { moduleId: id, status: m?.status ?? "—", render: m?.render ?? "RENDERED", why: WHY[m?.render ?? "RENDERED"]!, blocks: (byModule.get(id) ?? []).length }; });
  return { html, seo: { title: r.title, metaDescription: r.metaDescription, canonical: r.canonical, robots: r.robots, h1: r.h1, url: r.url }, jsonLd: r.jsonLd, links: r.links, modules,
    stats: { blocks: r.blocks.length, paragraphs: r.blocks.filter((b) => b.kind === "paragraph").length, insufficiencies: r.blocks.filter((b) => b.kind === "insufficiency").length + r.modules.filter((m) => m.render === "REMOVED").length, facts: r.facts.length, textFromAgent7: r.blocks.filter((b) => b.source === "agent7").length } };
}

/** Diferença linha a linha dos textos de duas versões (recipe → texto por bloco), para a comparação entre versões. */
export function diffRecipes(a: PageRecipe, b: PageRecipe): { readonly seo: readonly { field: string; before: string; after: string }[]; readonly blocks: readonly { blockId: string; change: "added" | "removed" | "changed"; before: string | null; after: string | null; sourceBefore: string | null; sourceAfter: string | null }[] } {
  const seo: { field: string; before: string; after: string }[] = [];
  for (const f of ["title", "h1", "metaDescription", "url", "canonical", "robots"] as const) { const x = String(a[f] ?? ""); const y = String(b[f] ?? ""); if (x !== y) seo.push({ field: f, before: x, after: y }); }
  const A = new Map(a.blocks.map((x) => [x.blockId, x])); const B = new Map(b.blocks.map((x) => [x.blockId, x]));
  const blocks: { blockId: string; change: "added" | "removed" | "changed"; before: string | null; after: string | null; sourceBefore: string | null; sourceAfter: string | null }[] = [];
  for (const [id, x] of A) { const y = B.get(id); if (!y) blocks.push({ blockId: id, change: "removed", before: x.text, after: null, sourceBefore: x.source, sourceAfter: null }); else if (x.text !== y.text || x.source !== y.source) blocks.push({ blockId: id, change: "changed", before: x.text, after: y.text, sourceBefore: x.source, sourceAfter: y.source }); }
  for (const [id, y] of B) if (!A.has(id)) blocks.push({ blockId: id, change: "added", before: null, after: y.text, sourceBefore: null, sourceAfter: y.source });
  return { seo, blocks };
}
