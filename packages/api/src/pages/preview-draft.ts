import type { TenantDb } from "../tenant-context";
import { getCityDetail, type CitySource } from "../ingest/city-search";
import type { PageDraft } from "../draft/model";
import { CITY_OVERVIEW, type CityTemplate, type RenderedPage } from "./city-overview";
import { evaluateCity, type GateResult } from "./gates";

// Prévia do RASCUNHO (ADR-026): renderiza com o motor real de páginas, os fatos reais da cidade e a composição configurada no editor (seções, ordem, títulos, links).
// Não grava, não indexa, não publica. Sem dados, a seção some (nunca preenchimento); links só existem se o destino existir.
export interface DraftPreview {
  readonly status: "rendered" | "blocked" | "no_template";
  readonly outcome: "generated" | "unchanged" | "blocked" | null; readonly gates: readonly GateResult[]; readonly page: RenderedPage | null; readonly source: CitySource | null;
  readonly seo: { readonly title: string; readonly metaDescription: string; readonly canonical: string; readonly robots: "noindex" } | null;
  /** Dados estruturados PROPOSTOS: cada propriedade vem de um fato; nada é emitido. */
  readonly structuredData: readonly { readonly type: string; readonly json: Record<string, unknown>; readonly provenance: readonly string[] }[];
  readonly links: { readonly configured: number; readonly emitted: number; readonly missing: readonly string[] };
  readonly note: string;
}
const NOTE = "Prévia de RASCUNHO: calculada agora, não gravada, não publicada e não indexável (noindex).";

export function templateFromDraft(draft: PageDraft): CityTemplate | null {
  const t = draft.nodes.find((n) => n.type === "page_template");
  if (!t || t.config.templateKey !== CITY_OVERVIEW.key) return null;
  const secs = draft.nodes.filter((n) => n.type === "page_section" && n.config.enabled !== false).sort((a, b) => (a.config.order as number) - (b.config.order as number)).flatMap((n) => {
    const s = CITY_OVERVIEW.sections.find((x) => x.id === n.config.sectionId);
    return s ? [{ ...s, heading: typeof n.config.heading === "string" && n.config.heading.trim() ? n.config.heading.trim() : s.heading }] : [];
  });
  return { ...CITY_OVERVIEW, sections: secs };
}

export async function previewDraftPage(db: TenantDb, cityId: string, draft: PageDraft): Promise<DraftPreview | null> {
  const d = await getCityDetail(db, cityId);
  if (!d) return null;
  const template = templateFromDraft(draft);
  if (!template) return { status: "no_template", outcome: null, gates: [], page: null, source: d.source, seo: null, structuredData: [], links: { configured: 0, emitted: 0, missing: [] }, note: `${NOTE} Sem template válido no rascunho: nada a renderizar.` };
  const pages = await db.query<{ path: string; entity_id: string }>(`SELECT path, entity_id FROM plataforma.page`);
  const linkNodes = draft.nodes.filter((n) => n.type === "internal_link" && typeof n.config.path === "string" && typeof n.config.text === "string");
  const ev = evaluateCity(d.city, { id: d.source.runId, sourceName: d.source.sourceName, origin: d.source.origin, status: d.source.status, fileSha256: d.source.fileSha256, finishedAt: d.source.finishedAt },
    { template, knownPaths: new Set(pages.rows.map((p) => p.path)), pathOwners: new Map(pages.rows.map((p) => [p.path, p.entity_id])), titleOwners: new Map(), metaOwners: new Map(), existingByEntity: new Map(), linkCandidates: linkNodes.map((n) => ({ path: n.config.path as string, text: n.config.text as string })) });
  const page = ev.page ?? null;
  const c = d.city;
  const structuredData = draft.nodes.filter((n) => n.type === "structured_data" && n.config.type === "City").map(() => {
    const json: Record<string, unknown> = { "@type": "City" }; const prov: string[] = [];
    if (c.name) { json.name = c.name; prov.push("name"); }
    if (c.uf) { json.containedInPlace = { "@type": "AdministrativeArea", name: c.uf }; prov.push("uf"); }
    if (c.ibgeCode) { json.identifier = { "@type": "PropertyValue", propertyID: "IBGE", value: c.ibgeCode }; prov.push("ibge_code"); }
    return { type: "City", json, provenance: prov };
  });
  const emitted = page?.links.length ?? 0;
  return {
    status: page ? "rendered" : "blocked", outcome: ev.outcome, gates: ev.gates, page, source: d.source,
    seo: page ? { title: page.title, metaDescription: page.metaDescription, canonical: page.canonicalPath, robots: "noindex" } : null,
    structuredData, links: { configured: linkNodes.length, emitted, missing: linkNodes.map((n) => n.config.path as string).filter((p) => !page?.links.some((l) => l.path === p)) },
    note: NOTE,
  };
}
