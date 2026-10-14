import { get } from "./data";
import type { ArchetypeContract } from "./types";

// Geração e validação de JSON-LD POR ARCHETYPE, determinísticas e ancoradas nos dados reais. Regras duras: tipos fora do contrato não são emitidos; Offer/AggregateOffer só com ofertas reais (preço, moeda, fonte, data) e
// `offerCount`/`lowPrice`/`highPrice` calculados DESSAS ofertas (nunca de médias ou multiplicadores); BreadcrumbList só com hierarquia; sem ratings sem dado; sem @id repetido no mesmo conjunto.
export type Node = Record<string, unknown>;
export interface JsonLdContext { readonly canonicalUrl: string; readonly breadcrumb?: readonly { readonly name: string; readonly url: string }[]; /** Mínimo de ofertas reais para emitir AggregateOffer. */ readonly minOffersForAggregate?: number }
const CTX = "https://schema.org";
const node = (type: string | string[], id: string, props: Node): Node => ({ "@context": CTX, "@type": type, "@id": id, ...props });
const clean = <T extends Node>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0) && v !== "")) as T;
const nm = (d: Record<string, unknown>) => String(get(d, "identity.name") ?? get(d, "topic.name") ?? "");
const geo = (c: unknown): Node | undefined => { const o = c as { lat?: number; lng?: number } | undefined; return o && typeof o.lat === "number" && typeof o.lng === "number" ? { "@type": "GeoCoordinates", latitude: o.lat, longitude: o.lng } : undefined; };
const within = (d: Record<string, unknown>): Node[] => ((get(d, "location.adminHierarchy") as { level: string; name: string }[] | undefined) ?? []).map((a) => ({ "@type": "AdministrativeArea", name: a.name }));
const breadcrumb = (ctx: JsonLdContext): Node | null => (ctx.breadcrumb && ctx.breadcrumb.length > 0 ? node("BreadcrumbList", `${ctx.canonicalUrl}#breadcrumb`, { itemListElement: ctx.breadcrumb.map((b, i) => ({ "@type": "ListItem", position: i + 1, name: b.name, item: b.url })) }) : null);
const realOffers = (d: Record<string, unknown>) => ((d.offers as { price: number; priceCurrency: string; source: string; observedAt: string }[] | undefined) ?? []).filter((o) => o.source && o.observedAt && o.priceCurrency);
function offersNode(d: Record<string, unknown>, ctx: JsonLdContext): Node | undefined {
  const offers = realOffers(d); if (offers.length === 0) return undefined;
  const cur = new Set(offers.map((o) => o.priceCurrency)); const min = ctx.minOffersForAggregate ?? 3;
  if (offers.length >= min && cur.size === 1) { const ps = offers.map((o) => o.price); return { "@type": "AggregateOffer", priceCurrency: offers[0]!.priceCurrency, lowPrice: Math.min(...ps), highPrice: Math.max(...ps), offerCount: offers.length }; }
  if (offers.length === 1) return { "@type": "Offer", price: offers[0]!.price, priceCurrency: offers[0]!.priceCurrency };
  return undefined; // poucas ofertas ou moedas misturadas: nada é inventado nem agregado
}
const list = (id: string, items: { name: string; position?: number }[]): Node => node("ItemList", id, { numberOfItems: items.length, itemListElement: items.map((x, i) => ({ "@type": "ListItem", position: x.position ?? i + 1, name: x.name })) });

type Builder = (d: Record<string, unknown>, ctx: JsonLdContext) => (Node | null)[];
const id = (c: JsonLdContext, k: string) => `${c.canonicalUrl}#${k}`;
const BUILDERS: Record<string, Builder> = {
  T01: (d, c) => [node("TouristDestination", id(c, "destination"), clean({ name: nm(d), description: d.summary, url: c.canonicalUrl, containedInPlace: within(d), geo: geo(get(d, "location.coordinates")) })), breadcrumb(c)],
  T02: (d, c) => [node("TouristDestination", id(c, "region"), clean({ name: nm(d), description: d.summary, url: c.canonicalUrl, containedInPlace: within(d) })), list(id(c, "cities"), ((d.cities as { id: string }[]) ?? []).map((x) => ({ name: x.id }))), breadcrumb(c)],
  T03: (d, c) => [node("AdministrativeArea", id(c, "area"), clean({ name: nm(d), description: d.overviewSynthesis, url: c.canonicalUrl, containedInPlace: within(d) })), node("Place", id(c, "place"), clean({ name: nm(d), geo: geo(get(d, "location.coordinates")), url: c.canonicalUrl })), breadcrumb(c)],
  T04: (d, c) => [node(["TouristAttraction", "Place"], id(c, "poi"), clean({ name: nm(d), description: d.description, url: c.canonicalUrl, address: get(d, "poi.address"), geo: geo(get(d, "poi.coordinates")), containedInPlace: within(d) })), breadcrumb(c)],
  T05: (d, c) => [list(id(c, "items"), ((d.items as { name: string }[]) ?? []).map((x) => ({ name: x.name }))), breadcrumb(c)],
  T06: (d, c) => [node("Product", id(c, "experience"), clean({ name: nm(d), description: get(d, "experience.description"), brand: get(d, "experience.provider") ? { "@type": "Organization", name: get(d, "experience.provider") } : undefined, offers: offersNode(d, c) })), breadcrumb(c)],
  T07: (d, c) => [node("HowTo", id(c, "howto"), clean({ name: nm(d), step: ((d.days as { day: number; stops: { name: string }[] }[]) ?? []).map((x) => ({ "@type": "HowToStep", name: `Dia ${x.day}`, text: x.stops.map((s) => s.name).join(", ") })) })), node("TouristTrip", id(c, "trip"), clean({ name: nm(d), itinerary: list(id(c, "stops"), ((d.days as { stops: { name: string }[] }[]) ?? []).flatMap((x) => x.stops.map((s) => ({ name: s.name })))) })), breadcrumb(c)],
  T08: (d, c) => [node("Article", id(c, "article"), clean({ headline: nm(d), about: { "@type": "Place", name: nm(d) }, url: c.canonicalUrl })), ((d.faqs as { question: string; answer: string }[]) ?? []).length > 0 ? node("FAQPage", id(c, "faq"), { mainEntity: (d.faqs as { question: string; answer: string }[]).map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })) }) : null],
  T09: (d, c) => [node("Article", id(c, "article"), clean({ headline: ((d.entities as { name: string }[]) ?? []).map((e) => e.name).join(" × "), about: ((d.entities as { name: string }[]) ?? []).map((e) => ({ "@type": "Thing", name: e.name })), url: c.canonicalUrl })), breadcrumb(c)],
  T10: (d, c) => [list(id(c, "ranking"), ((d.items as { name: string; rank?: number }[]) ?? []).map((x) => ({ name: x.name, ...(x.rank !== undefined ? { position: x.rank } : {}) }))), breadcrumb(c)],
  T11: (d, c) => [node("LocalBusiness", id(c, "business"), clean({ name: nm(d), description: d.description, url: c.canonicalUrl, telephone: get(d, "business.phone"), openingHours: get(d, "business.openingHours"), geo: geo(get(d, "location.coordinates")), address: { "@type": "PostalAddress", streetAddress: get(d, "address.street"), addressLocality: get(d, "address.locality"), addressRegion: get(d, "address.region"), postalCode: get(d, "address.postalCode"), addressCountry: get(d, "address.country") } })), breadcrumb(c)],
  T12: (d, c) => [node("CollectionPage", id(c, "collection"), clean({ name: nm(d), description: get(d, "topic.description"), url: c.canonicalUrl, hasPart: ((d.members as { id: string }[]) ?? []).map((m) => ({ "@type": "WebPage", "@id": m.id })) })), breadcrumb(c)],
};
/** JSON-LD do archetype a partir do dado JÁ validado. Determinístico (mesma entrada, mesma saída); remove @id repetido; só emite tipos do contrato. */
export function buildJsonLd(contract: ArchetypeContract, data: Record<string, unknown>, ctx: JsonLdContext): Node[] {
  const build = BUILDERS[contract.id]; if (!build) return [];
  const seen = new Set<string>(); const out: Node[] = [];
  for (const n of build(data, ctx)) { if (!n) continue; const i = String(n["@id"]); if (seen.has(i)) continue; seen.add(i); out.push(n); }
  const allowed = typesAllowed(contract); return out.filter((n) => [n["@type"]].flat().every((t) => allowed.has(String(t))));
}

const PARENT: Record<string, string> = { City: "AdministrativeArea", AdministrativeArea: "Place", TouristAttraction: "Place", TouristDestination: "Place", LocalBusiness: "Place", Place: "Thing", Article: "CreativeWork", CollectionPage: "WebPage", WebPage: "CreativeWork", Dataset: "CreativeWork", HowTo: "CreativeWork", ItemList: "Intangible", TouristTrip: "Trip", Trip: "Intangible", Product: "Thing", AggregateOffer: "Offer", Offer: "Intangible" };
export const ancestors = (t: string): string[] => { const out = [t]; let c = t; while (PARENT[c]) { c = PARENT[c]!; out.push(c); } return out; };
const typesAllowed = (c: ArchetypeContract) => new Set([...c.schemaTypes.required, ...c.schemaTypes.optional, ...c.schemaTypes.conditional]);
export interface JsonLdIssue { readonly rule: string; readonly message: string; readonly path?: string }
export interface JsonLdValidation { readonly valid: boolean; readonly issues: readonly JsonLdIssue[]; readonly warnings: readonly JsonLdIssue[]; readonly types: readonly string[] }
/** Valida o JSON-LD (gerado OU produzido por um pack) contra o contrato do archetype, os dados e o texto visível. */
export function validateJsonLd(contract: ArchetypeContract, nodes: readonly Node[], i: { readonly data?: Record<string, unknown>; readonly visibleText?: string; readonly canonicalUrl?: string; readonly hasHierarchy?: boolean; readonly minOffersForAggregate?: number }): JsonLdValidation {
  const issues: JsonLdIssue[] = []; const warnings: JsonLdIssue[] = []; const allowed = typesAllowed(contract); const ids = new Set<string>(); const present = new Set<string>();
  nodes.forEach((n, idx) => {
    const types = [n["@type"]].flat().map(String); const at = `[${idx}]`;
    if (n["@context"] !== CTX && n["@context"] !== "https://schema.org/") issues.push({ rule: "jsonld.context", message: "@context deve ser https://schema.org", path: at });
    if (types.length === 0 || types[0] === "undefined") issues.push({ rule: "jsonld.type", message: "nó sem @type", path: at });
    for (const t of types) { for (const a of ancestors(t)) present.add(a); if (!ancestors(t).some((x) => allowed.has(x))) issues.push({ rule: "jsonld.type_not_allowed", message: `tipo ${t} fora do contrato do archetype ${contract.id}`, path: at }); }
    const nid = n["@id"]; if (typeof nid === "string") { if (ids.has(nid)) issues.push({ rule: "jsonld.duplicate_id", message: `@id repetido: ${nid}`, path: at }); ids.add(nid); }
    if (types.includes("BreadcrumbList") && !i.hasHierarchy && (i.hasHierarchy === false)) issues.push({ rule: "jsonld.breadcrumb_without_hierarchy", message: "BreadcrumbList sem hierarquia", path: at });
    if (typeof n.url === "string" && i.canonicalUrl && n.url !== i.canonicalUrl) issues.push({ rule: "jsonld.url_not_canonical", message: `url ${n.url} difere da canônica ${i.canonicalUrl}`, path: at });
    // conteúdo estruturado precisa ser sustentado pelo visível
    const name = typeof n.name === "string" ? n.name : typeof n.headline === "string" ? n.headline : null;
    if (name && i.visibleText && !types.some((t) => ["ListItem", "BreadcrumbList", "Organization"].includes(t)) && !fold(i.visibleText).includes(fold(name))) warnings.push({ rule: "jsonld.name_not_visible", message: `“${name}” não aparece no conteúdo visível`, path: at });
    if (types.some((t) => ["Offer", "AggregateOffer"].includes(t)) || n.offers) {
      const offers = (i.data ? ((i.data.offers as { price: number; priceCurrency: string; source?: string; observedAt?: string }[]) ?? []) : []).filter((o) => o.source && o.observedAt);
      const o = (n.offers ?? n) as Node; const agg = (o["@type"] === "AggregateOffer");
      if (offers.length === 0) issues.push({ rule: "jsonld.offer_without_data", message: "Offer/AggregateOffer sem ofertas reais (preço, moeda, fonte e data) nos dados", path: at });
      else if (agg && (o.offerCount !== offers.length || o.lowPrice !== Math.min(...offers.map((x) => x.price)) || o.highPrice !== Math.max(...offers.map((x) => x.price)))) issues.push({ rule: "jsonld.aggregate_not_derived", message: "offerCount/lowPrice/highPrice não correspondem às ofertas reais", path: at });
      else if (agg && offers.length < (i.minOffersForAggregate ?? 3)) issues.push({ rule: "jsonld.aggregate_insufficient", message: "AggregateOffer com poucas ofertas reais", path: at });
    }
    if (types.some((t) => ["Review", "AggregateRating"].includes(t)) || n.aggregateRating) issues.push({ rule: "jsonld.rating_without_data", message: "avaliações só com dados reais de avaliação (não suportados por este contrato)", path: at });
  });
  // BreadcrumbList só é exigido quando a hierarquia EXISTE (sem páginas-pai não há o que declarar)
  for (const t of contract.schemaTypes.required) if (!present.has(t) && !(t === "BreadcrumbList" && i.hasHierarchy !== true)) issues.push({ rule: "jsonld.required_type_missing", message: `tipo obrigatório ausente: ${t}` });
  return { valid: issues.length === 0, issues, warnings, types: [...new Set(nodes.flatMap((n) => [n["@type"]].flat().map(String)))] };
}
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ");
