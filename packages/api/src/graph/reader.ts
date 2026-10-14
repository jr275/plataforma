import { EDGE_LABEL, clampLimit, formatRef, parseRef, type GraphAttribute, type GraphEdge, type GraphExpandOptions, type GraphExpansion, type GraphNodeDetail, type GraphNodeKind, type GraphNodeSummary, type GraphProvenance, type GraphReader, type GraphSearchResult, type GraphSource, type GraphSuggestion } from "./model";
import type { GraphStore, StoreAggregate, StoreCity, StoreSource } from "./store";

// Monta nós, detalhes e expansões a partir da porta de dados. É a única lógica do grafo: o armazenamento SQL e o de memória respondem só às consultas primitivas.
const NA = "não informado";
const fmt = (n: number) => n.toLocaleString("pt-BR");
const toSource = (s: StoreSource): GraphSource => ({ runId: s.runId, sourceName: s.sourceName, origin: s.origin, fileName: s.fileName, fileSha256: s.fileSha256, status: s.status, importedAt: s.importedAt, totalRows: s.totalRows, acceptedRows: s.acceptedRows });
const range = (sources: readonly StoreSource[]) => {
  const t = sources.map((s) => s.importedAt.getTime());
  return { newest: t.length ? new Date(Math.max(...t)) : null, oldest: t.length ? new Date(Math.min(...t)) : null };
};
const provenance = (sources: readonly StoreSource[], record: GraphProvenance["record"] = undefined): GraphProvenance => ({ sources: sources.map(toSource), record, newestImportAt: range(sources).newest, oldestImportAt: range(sources).oldest });

const cityNode = (c: StoreCity): GraphNodeSummary => ({ ref: formatRef("city", c.id), kind: "city", label: c.name, detail: `${c.uf} · ${c.ibgeCode}` });
const ufNode = (code: string, cities?: number): GraphNodeSummary => ({ ref: formatRef("uf", code), kind: "uf", label: code, detail: cities === undefined ? null : `${fmt(cities)} cidade(s)` });
const regionNode = (name: string, cities?: number): GraphNodeSummary => ({ ref: formatRef("region", name), kind: "region", label: name, detail: cities === undefined ? null : `${fmt(cities)} cidade(s)` });
const pageNode = (id: string, path: string, status: string): GraphNodeSummary => ({ ref: formatRef("page", id), kind: "page", label: path, detail: status === "draft" ? "rascunho" : "bloqueada" });

const edge = (kind: GraphEdge["kind"], from: string, to: string): GraphEdge => ({ from, to, kind, label: EDGE_LABEL[kind], basis: kind === "has_page" ? "recorded_link" : "source_column" });

function aggregateSuggestions(uf: string, a: StoreAggregate): GraphSuggestion[] {
  const without = a.cities - a.withPage;
  return without > 0 ? [{ text: `${fmt(without)} cidade(s) desta UF ainda não têm página gerada.`, href: `/cities?uf=${uf}&pages=without` }] : [];
}

export function createGraphReader(store: GraphStore): GraphReader {
  async function node(ref: string): Promise<GraphNodeDetail | undefined> {
    const r = parseRef(ref);
    if (!r) return undefined;
    if (r.kind === "city") {
      const x = await store.city(r.key);
      if (!x) return undefined;
      const c = x.city;
      const attributes: GraphAttribute[] = [
        { label: "Nome", value: c.name, basis: "fact" }, { label: "Código IBGE", value: c.ibgeCode, basis: "fact" }, { label: "UF", value: c.uf, basis: "fact" },
        { label: "Região", value: c.region ?? NA, basis: "fact" }, { label: "População", value: c.population === null ? NA : fmt(c.population), basis: "fact" }, { label: "Ano da estimativa", value: c.populationYear === null ? NA : String(c.populationYear), basis: "fact" },
      ];
      const links = [{ label: "Detalhe da cidade", href: `/cities/${c.id}` }, { label: "Execução de origem", href: `/data-flow?run=${x.source.runId}` }, ...(x.page ? [{ label: "Página gerada", href: `/generation/pages/${x.page.id}` }] : [])];
      const suggestions: GraphSuggestion[] = x.page ? [] : [{ text: "Nenhuma página gerada para esta cidade. Um rascunho pode ser criado em Geração de páginas.", href: "/generation" }];
      return { node: cityNode(c), attributes, provenance: provenance([x.source], x.record), counts: { uf: 1, page: x.page ? 1 : 0 }, links, suggestions };
    }
    if (r.kind === "page") {
      const x = await store.page(r.key);
      if (!x) return undefined;
      const attributes: GraphAttribute[] = [
        { label: "URL gerada", value: x.page.path, basis: "derived" }, { label: "Status", value: x.page.status === "draft" ? "Rascunho (não publicada)" : "Bloqueada", basis: "derived" },
        { label: "Versão mais recente", value: String(x.page.latestVersion), basis: "derived" }, { label: "Cidade de origem", value: `${x.city.name}, ${x.city.uf}`, basis: "fact" },
      ];
      const suggestions: GraphSuggestion[] = x.page.status === "blocked" ? [{ text: "Página bloqueada: os gates reprovados estão no detalhe da página.", href: `/generation/pages/${x.page.id}` }] : [];
      return { node: pageNode(x.page.id, x.page.path, x.page.status), attributes, provenance: provenance([x.source]), counts: { city: 1 }, links: [{ label: "Detalhe da página", href: `/generation/pages/${x.page.id}` }, { label: "Cidade de origem", href: `/cities/${x.city.id}` }], suggestions };
    }
    if (r.kind === "uf") {
      const a = await store.uf(r.key);
      if (!a) return undefined;
      const attributes: GraphAttribute[] = [
        { label: "Sigla", value: r.key, basis: "fact" }, { label: "Cidades neste workspace", value: fmt(a.cities), basis: "derived" }, { label: "Com população informada", value: fmt(a.withPopulation), basis: "derived" },
        { label: "Com página gerada", value: fmt(a.withPage), basis: "derived" }, { label: "Regiões observadas nas cidades", value: a.regions.length ? a.regions.map((x) => x.name).join(", ") : NA, basis: "derived" },
      ];
      return { node: ufNode(r.key, a.cities), attributes, provenance: provenance(a.sources), counts: { city: a.cities, region: a.regions.length }, links: [{ label: "Ver as cidades desta UF", href: `/cities?uf=${r.key}` }], suggestions: aggregateSuggestions(r.key, a) };
    }
    const a = await store.region(r.key);
    if (!a) return undefined;
    const attributes: GraphAttribute[] = [
      { label: "Nome", value: r.key, basis: "fact" }, { label: "Cidades neste workspace", value: fmt(a.cities), basis: "derived" }, { label: "UFs observadas nas cidades", value: a.ufs.map((x) => x.code).join(", "), basis: "derived" },
      { label: "Com página gerada", value: fmt(a.withPage), basis: "derived" },
    ];
    return { node: regionNode(r.key, a.cities), attributes, provenance: provenance(a.sources), counts: { uf: a.ufs.length, city: a.cities }, links: [], suggestions: [] };
  }

  async function expand(ref: string, options: GraphExpandOptions = {}): Promise<GraphExpansion | undefined> {
    const r = parseRef(ref);
    if (!r) return undefined;
    const limit = clampLimit(options.limit);
    const want = (k: GraphNodeKind) => !options.kinds || options.kinds.includes(k);
    const neighbors: GraphNodeSummary[] = [];
    const edges: GraphEdge[] = [];
    const totals: Partial<Record<GraphNodeKind, number>> = {};
    const shown: Partial<Record<GraphNodeKind, number>> = {};
    const add = (kind: GraphNodeKind, n: GraphNodeSummary, e: GraphEdge) => { neighbors.push(n); edges.push(e); shown[kind] = (shown[kind] ?? 0) + 1; };

    if (r.kind === "city") {
      const x = await store.city(r.key);
      if (!x) return undefined;
      const center = cityNode(x.city);
      const uf = await store.uf(x.city.uf);
      totals.uf = 1; totals.page = x.page ? 1 : 0;
      if (want("uf")) add("uf", ufNode(x.city.uf, uf?.cities), edge("belongs_to_uf", center.ref, formatRef("uf", x.city.uf)));
      if (x.page && want("page")) add("page", pageNode(x.page.id, x.page.path, x.page.status), edge("has_page", center.ref, formatRef("page", x.page.id)));
      return { center, neighbors, edges, totals, shown, truncated: false };
    }
    if (r.kind === "page") {
      const x = await store.page(r.key);
      if (!x) return undefined;
      const center = pageNode(x.page.id, x.page.path, x.page.status);
      totals.city = 1;
      if (want("city")) add("city", cityNode(x.city), edge("has_page", formatRef("city", x.city.id), center.ref));
      return { center, neighbors, edges, totals, shown, truncated: false };
    }
    if (r.kind === "uf") {
      const a = await store.uf(r.key);
      if (!a) return undefined;
      const center = ufNode(r.key, a.cities);
      totals.region = a.regions.length; totals.city = a.cities;
      if (want("region")) for (const g of a.regions) add("region", regionNode(g.name, g.cities), edge("in_region", center.ref, formatRef("region", g.name)));
      if (want("city")) for (const c of await store.topCities({ uf: r.key }, limit)) add("city", cityNode(c), edge("belongs_to_uf", formatRef("city", c.id), center.ref));
      return { center, neighbors, edges, totals, shown, truncated: (shown.city ?? 0) < (want("city") ? a.cities : 0) };
    }
    const a = await store.region(r.key);
    if (!a) return undefined;
    const center = regionNode(r.key, a.cities);
    totals.uf = a.ufs.length;
    if (want("uf")) for (const u of a.ufs) add("uf", ufNode(u.code, u.cities), edge("in_region", formatRef("uf", u.code), center.ref));
    return { center, neighbors, edges, totals, shown, truncated: false };
  }

  async function search(q: string, options: { kinds?: readonly GraphNodeKind[]; perKind?: number } = {}): Promise<GraphSearchResult> {
    const perKind = Math.min(Math.max(Math.trunc(options.perKind ?? 8), 1), 25);
    const want = (k: GraphNodeKind) => !options.kinds || options.kinds.includes(k);
    const s = await store.search(q, perKind);
    const nodes: GraphNodeSummary[] = [];
    const totals: Partial<Record<GraphNodeKind, number>> = { region: s.regions.length, uf: s.ufs.length, city: s.cities.total, page: s.pages.total };
    if (want("region")) nodes.push(...s.regions.slice(0, perKind).map((x) => regionNode(x.name, x.cities)));
    if (want("uf")) nodes.push(...s.ufs.slice(0, perKind).map((x) => ufNode(x.code, x.cities)));
    if (want("city")) nodes.push(...s.cities.rows.slice(0, perKind).map(cityNode));
    if (want("page")) nodes.push(...s.pages.rows.slice(0, perKind).map((p) => ({ ref: formatRef("page", p.id), kind: "page" as const, label: p.path, detail: `${p.cityName}, ${p.uf}` })));
    return { nodes, totals };
  }
  return { node, expand, search };
}
