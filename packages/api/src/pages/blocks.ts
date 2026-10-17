import { FACT_KEYS, FACT_LABELS, showFact, type RenderedPage } from "./city-overview";

// Catálogo fechado de blocos das páginas publicadas (ADR-040). Módulo PURO: sem E/S, sem LLM e sem texto novo. A conversão
// RenderedPage → PageBlock[] só reorganiza o que o motor produziu; a validação falha fechada (bloco fora do catálogo, texto com
// marcação, linha de fatos sem fonte).

export const BLOCK_TYPES = ["hero", "breadcrumb", "prose", "facts", "links", "sources"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export interface FactRow {
  readonly factId: string;
  readonly label: string;
  readonly value: string;
  /** Ano de referência do fato, quando existe (por exemplo, a estimativa de população). */
  readonly asOf: number | null;
  readonly source: string;
  readonly collectedAt: string;
}

export type PageBlock =
  | { readonly type: "hero"; readonly h1: string; readonly lead: string | null }
  | { readonly type: "breadcrumb"; readonly items: readonly { readonly label: string; readonly path: string | null }[] }
  | { readonly type: "prose"; readonly id: string; readonly heading: string; readonly paragraphs: readonly string[] }
  | { readonly type: "facts"; readonly heading: string; readonly rows: readonly FactRow[] }
  | { readonly type: "links"; readonly heading: string; readonly items: readonly { readonly path: string; readonly text: string }[] }
  | { readonly type: "sources"; readonly heading: string; readonly items: readonly string[] };

/** Rótulos FIXOS dos blocos (não são conteúdo da página: não passam pelo motor e não contêm algarismos). */
export const BLOCK_LABELS = { facts: "Dados da cidade", links: "Veja também", home: "Início", cities: "Cidades" } as const;

/** Fatos que entram na tabela: o nome já está no h1 e o ano da estimativa aparece como referência da população. */
const FACT_TABLE_KEYS = FACT_KEYS.filter((k) => k !== "name" && k !== "population_year");

export function toBlocks(page: RenderedPage): PageBlock[] {
  const blocks: PageBlock[] = [];
  const main = page.sections.filter((s) => s.id !== "sources");
  const sources = page.sections.find((s) => s.id === "sources");

  // Lead: o primeiro parágrafo da primeira seção sobe para o hero e sai da seção (cada parágrafo aparece uma única vez).
  const lead = main[0]?.paragraphs[0] ?? null;

  const m = /^\/cidades\/([a-z]{2})\/[^/]+$/.exec(page.path);
  if (m) {
    const linked = new Set(page.links.map((l) => l.path));
    const uf = m[1]!;
    const name = page.factsUsed.find((f) => f.key === "name")?.value;
    blocks.push({
      type: "breadcrumb",
      items: [
        { label: BLOCK_LABELS.home, path: linked.has("/") ? "/" : null },
        { label: BLOCK_LABELS.cities, path: linked.has("/cidades") ? "/cidades" : null },
        { label: uf.toUpperCase(), path: linked.has(`/cidades/${uf}`) ? `/cidades/${uf}` : null },
        { label: typeof name === "string" ? name : page.h1, path: null },
      ],
    });
  }

  blocks.push({ type: "hero", h1: page.h1, lead });

  main.forEach((s, i) => {
    const paragraphs = i === 0 && lead !== null ? s.paragraphs.slice(1) : s.paragraphs;
    if (paragraphs.length > 0) blocks.push({ type: "prose", id: s.id, heading: s.heading, paragraphs });
  });

  const rows: FactRow[] = [];
  for (const key of FACT_TABLE_KEYS) {
    const f = page.factsUsed.find((x) => x.key === key);
    if (f) rows.push({ factId: f.id, label: FACT_LABELS[f.key], value: showFact(f), asOf: f.asOf ?? null, source: f.source.name, collectedAt: f.source.collectedAt });
  }
  if (rows.length > 0) blocks.push({ type: "facts", heading: BLOCK_LABELS.facts, rows });

  if (page.links.length > 0) blocks.push({ type: "links", heading: BLOCK_LABELS.links, items: page.links.map((l) => ({ path: l.path, text: l.text })) });
  if (sources && sources.paragraphs.length > 0) blocks.push({ type: "sources", heading: sources.heading, items: sources.paragraphs });
  return blocks;
}

/** Todos os parágrafos de conteúdo dos blocos, na ordem. Serve ao invariante "nada é acrescentado nem repetido". */
export function blockParagraphs(blocks: readonly PageBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === "hero" && b.lead !== null) out.push(b.lead);
    else if (b.type === "prose") out.push(...b.paragraphs);
    else if (b.type === "sources") out.push(...b.items);
  }
  return out;
}

const MARKUP = /[<>]/;

/** Erros do conjunto de blocos (lista vazia = válido). Aceita `unknown`: o que vem de fora nunca é presumido bem formado. */
export function validateBlocks(input: unknown): string[] {
  const errors: string[] = [];
  if (!Array.isArray(input) || input.length === 0) return ["a página não tem blocos"];
  const text = (where: string, v: unknown): void => {
    if (typeof v !== "string" || v.trim() === "") errors.push(`${where}: texto vazio ou ausente`);
    else if (MARKUP.test(v)) errors.push(`${where}: o texto contém marcação (< ou >); HTML livre não é permitido`);
  };
  const types: string[] = [];
  input.forEach((raw, i) => {
    const b = raw as Record<string, unknown> | null;
    const t = b && typeof b === "object" ? b.type : undefined;
    if (typeof t !== "string" || !(BLOCK_TYPES as readonly string[]).includes(t)) { errors.push(`bloco ${i}: tipo desconhecido (${String(t)})`); return; }
    types.push(t);
    const where = `bloco ${i} (${t})`;
    const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
    switch (t) {
      case "hero": text(`${where} h1`, b!.h1); if (b!.lead !== null && b!.lead !== undefined) text(`${where} lead`, b!.lead); break;
      case "breadcrumb":
        if (list(b!.items).length === 0) errors.push(`${where}: sem itens`);
        list(b!.items).forEach((it, k) => { const o = it as Record<string, unknown>; text(`${where} item ${k}`, o?.label); if (o?.path != null && !(typeof o.path === "string" && /^\/(?!\/)/.test(o.path))) errors.push(`${where} item ${k}: caminho inválido`); });
        break;
      case "prose":
        text(`${where} id`, b!.id); text(`${where} título`, b!.heading);
        if (list(b!.paragraphs).length === 0) errors.push(`${where}: sem parágrafos`);
        list(b!.paragraphs).forEach((p, k) => text(`${where} parágrafo ${k}`, p));
        break;
      case "facts":
        text(`${where} título`, b!.heading);
        if (list(b!.rows).length === 0) errors.push(`${where}: sem linhas`);
        list(b!.rows).forEach((r, k) => { const o = r as Record<string, unknown>; for (const f of ["factId", "label", "value", "source", "collectedAt"] as const) text(`${where} linha ${k} ${f}`, o?.[f]); });
        break;
      case "links":
        text(`${where} título`, b!.heading);
        if (list(b!.items).length === 0) errors.push(`${where}: sem itens`);
        list(b!.items).forEach((it, k) => { const o = it as Record<string, unknown>; text(`${where} item ${k} texto`, o?.text); if (!(typeof o?.path === "string" && /^\/(?!\/)/.test(o.path))) errors.push(`${where} item ${k}: o caminho precisa ser interno e começar por /`); });
        break;
      case "sources":
        text(`${where} título`, b!.heading);
        if (list(b!.items).length === 0) errors.push(`${where}: sem fontes`);
        list(b!.items).forEach((s, k) => text(`${where} fonte ${k}`, s));
        break;
    }
  });
  const count = (t: string) => types.filter((x) => x === t).length;
  if (count("hero") !== 1) errors.push(`a página precisa de exatamente um hero (tem ${count("hero")})`);
  const hi = types.indexOf("hero");
  if (hi > 1 || (hi === 1 && types[0] !== "breadcrumb")) errors.push("o hero deve vir primeiro (no máximo depois de um breadcrumb)");
  for (const t of ["breadcrumb", "facts", "links", "sources"]) if (count(t) > 1) errors.push(`só pode haver um bloco ${t}`);
  if (types.includes("sources") && types[types.length - 1] !== "sources") errors.push("o bloco de fontes deve ser o último");
  return errors;
}
