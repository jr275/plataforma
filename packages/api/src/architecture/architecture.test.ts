import { describe, expect, it } from "vitest";
import { ARCHETYPE_CATALOG, ARCHETYPE_IDS, T03_SYNTHESIS_DENSITY_MIN, T03_SYNTHESIS_SCHEMA_MIN, archetypeOf, applyProfile, buildJsonLd, compileLinkGraph, DEFAULT_LINK_POLICY, diagnoseIntents, evaluateInlinks, normalizeIntent, outlinksOf, runGate, validateArchetypeData, validateCatalog, validateJsonLd, validateLinkPolicy, type GateInput, type IntentPage, type LinkNode, type RawLink } from "./index";

// Contratos da arquitetura de conteúdo SEM banco. Os dados abaixo são FIXTURES DE TESTE (formas válidas), nunca exibidas como dado real.
const T03 = archetypeOf("T03")!;
const synth = (n: number) => "a".repeat(n);
const amen = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Lugar ${i}` }));
const t03 = (over: Record<string, unknown> = {}) => ({ identity: { name: "Bairro Teste", slug: "bairro-teste" }, location: { adminHierarchy: [{ level: "city", name: "Cidade" }, { level: "neighborhood", name: "Bairro Teste" }], coordinates: { lat: -23.5, lng: -46.6, precision: "neighborhood" } }, overviewSynthesis: synth(120),
  amenities: { education: amen(2), health: amen(1), mobility: amen(1), gastronomy: amen(1) }, mobility: { indices: [], stations: [{ name: "Estação", kind: "metro", distanceM: 400 }] }, faqs: [{ question: "Como chegar?", answer: "Pelo metrô mais próximo." }, { question: "É seguro?", answer: "Depende de dados oficiais." }], ...over });
const NOW = new Date("2026-10-14T12:00:00Z");

describe("catálogo dos 12 archetypes", () => {
  it("tem exatamente T01..T12, ids únicos e coerência interna (pesos somam 1, limiares válidos, mínimo de inlinks)", () => {
    expect(ARCHETYPE_CATALOG.map((c) => c.id)).toEqual([...ARCHETYPE_IDS]); expect(validateCatalog()).toEqual([]);
    for (const c of ARCHETYPE_CATALOG) { expect(c.urlPattern, c.id).toMatch(/^\//); expect(c.aiPolicy.factsFrom).toBe("knowledge_graph_only"); expect(c.aiPolicy.forbidden.length).toBeGreaterThan(0); expect(c.schemaTypes.required.length + c.schemaTypes.optional.length + c.schemaTypes.conditional.length).toBeGreaterThan(0); expect(c.linkRules.minInlinks).toBe(3); }
  });
  it("os tipos Schema.org do catálogo seguem a referência; Offer/Review só como condicionais", () => {
    const req = (id: string) => archetypeOf(id)!.schemaTypes.required; expect(req("T03")).toEqual(["AdministrativeArea", "Place", "BreadcrumbList"]); expect(req("T01")).toEqual(["TouristDestination", "BreadcrumbList"]); expect(req("T11")).toEqual(["LocalBusiness", "PostalAddress"]); expect(req("T12")).toEqual(["CollectionPage", "BreadcrumbList"]);
    expect(archetypeOf("T06")!.schemaTypes.conditional).toEqual(expect.arrayContaining(["Product", "Event", "Offer"])); expect(archetypeOf("T10")!.schemaTypes.conditional).toContain("AggregateRating");
  });
  it("os pesos de densidade são POR archetype: só o T03 usa os de referência e os perfis diferem", () => {
    expect(T03.density.signals.map((s) => [s.id, s.weight])).toEqual([["amenities_5", 0.4], ["synthesis_100", 0.3], ["station_1", 0.15], ["faqs_2", 0.15]]); expect(T03.density.indexingThreshold).toBe(0.75);
    expect(new Set(ARCHETYPE_CATALOG.map((c) => JSON.stringify(c.density.signals.map((s) => s.weight)))).size).toBeGreaterThan(3);
  });
  it("o núcleo não conhece imóveis: mercado entra só como métricas de domínio com proveniência", () => {
    expect(JSON.stringify(ARCHETYPE_CATALOG.map((c) => [c.key, c.modules]))).not.toMatch(/imov|real.?estate|preco_m2|price_per/i);
  });
});

describe("validação em camadas (T03 como referência)", () => {
  it("dado completo: VÁLIDO para geração e indexação, densidade 1,0 e sinais de referência", () => {
    const r = validateArchetypeData(T03, { data: t03(), now: NOW });
    expect(r).toMatchObject({ status: "VALID", score: 1, isValidForGeneration: true, isValidForIndexing: true, failedRules: [], missingData: [] }); expect(r.density!.signals.map((s) => s.ok)).toEqual([true, true, true, true]);
  });
  it("schema inválido (tipos errados, campo desconhecido) devolve INVALID, sem pontuar, com os campos ausentes", () => {
    const r = validateArchetypeData(T03, { data: { identity: { name: "x", slug: "Slug Inválido" }, extra: 1 } });
    expect(r).toMatchObject({ status: "INVALID", score: null, isValidForGeneration: false, isValidForIndexing: false, density: null }); expect(r.issues.every((i) => i.layer === "schema")).toBe(true); expect(r.missingData).toEqual(expect.arrayContaining(["location", "overviewSynthesis"]));
  });
  it("RECONCILIAÇÃO 50 × 100: síntese de 60 caracteres passa o SCHEMA (≥ 50) mas NÃO o sinal de densidade (≥ 100); duas regras, duas finalidades", () => {
    expect(T03_SYNTHESIS_SCHEMA_MIN).toBe(50); expect(T03_SYNTHESIS_DENSITY_MIN).toBe(100);
    const r60 = validateArchetypeData(T03, { data: t03({ overviewSynthesis: synth(60) }) }); expect(r60.issues.some((i) => i.layer === "schema")).toBe(false); expect(r60.density!.signals.find((s) => s.id === "synthesis_100")).toMatchObject({ ok: false, weight: 0.3 });
    expect(r60.score).toBeCloseTo(0.7, 4); expect(r60.isValidForIndexing).toBe(false); expect(r60.status).toBe("DATA_PENDING"); expect(r60.isValidForGeneration).toBe(true);
    expect(validateArchetypeData(T03, { data: t03({ overviewSynthesis: synth(40) }) }).status).toBe("INVALID");
  });
  it("limiar 0,75: 4 amenidades e 100+ caracteres dão 0,6 (< 0,75); 5 amenidades fecham; a regra de densidade reprova a indexação mas não a geração", () => {
    const low = validateArchetypeData(T03, { data: t03({ amenities: { education: amen(2), health: amen(2) } }) }); expect(low.score).toBeCloseTo(0.6, 4); expect(low.isValidForIndexing).toBe(false); expect(low.isValidForGeneration).toBe(true); expect(low.failedRules).toContain("T03.density"); expect(low.missingData).toContain("density:amenities_5");
    expect(validateArchetypeData(T03, { data: t03({ amenities: { education: amen(3), health: amen(2) } }) }).score).toBe(1);
  });
  it("a PROVENIÊNCIA é camada própria: métrica sem fonte/data tem formato válido mas reprova a indexação (presença não é validade)", () => {
    const d = t03({ mobility: { indices: [{ id: "walk", value: 70, unit: "pts" }], stations: [{ name: "Estação", kind: "metro" }] } });
    const r = validateArchetypeData(T03, { data: d }); expect(r.issues.some((i) => i.layer === "schema")).toBe(false); const p = r.issues.find((i) => i.id === "T03.mobility_sourced")!; expect(p).toMatchObject({ layer: "provenance", passed: false, severity: "block_indexing" }); expect(p.evidence).toEqual({ withoutProvenance: ["walk"], total: 1 }); expect(r.isValidForIndexing).toBe(false);
    const ok = validateArchetypeData(T03, { data: t03({ mobility: { indices: [{ id: "walk", value: 70, source: "OSM", verifiedAt: "2026-10-01" }], stations: [{ name: "E", kind: "metro" }] } }) }); expect(ok.isValidForIndexing).toBe(true);
  });
  it("métricas de mercado (extensão do domínio) exigem fonte e data, e vencidas viram aviso", () => {
    const m = (extra: object) => t03({ domainMetrics: [{ id: "preco_m2", value: 12000, unit: "BRL/m2", ...extra }] });
    expect(validateArchetypeData(T03, { data: m({}) }).failedRules).toContain("T03.domain_metrics_sourced");
    const r = validateArchetypeData(T03, { data: m({ source: "FipeZap", verifiedAt: "2025-01-01", validUntil: "2025-06-01" }), now: NOW }); expect(r.isValidForIndexing).toBe(true); expect(r.warnings.map((w) => w.id)).toEqual(["T03.metrics_fresh"]); expect(r.status).toBe("VALID_WITH_WARNINGS");
  });
  it("R3: tempo de caminhada sem fonte de roteamento bloqueia até a GERAÇÃO (distância não é tempo)", () => {
    const bad = validateArchetypeData(T03, { data: t03({ mobility: { indices: [], stations: [{ name: "E", kind: "metro", distanceM: 400, walkMinutes: 5 }] } }) }); expect(bad).toMatchObject({ isValidForGeneration: false, status: "INVALID" }); expect(bad.failedRules).toContain("T03.no_travel_time");
    expect(validateArchetypeData(T03, { data: t03({ mobility: { indices: [], stations: [{ name: "E", kind: "metro", distanceM: 400, walkMinutes: 5, routingSource: "OSRM" }] } }) }).isValidForGeneration).toBe(true);
  });
  it("sem coordenadas: gera, mas não indexa (dado ausente listado)", () => {
    const r = validateArchetypeData(T03, { data: t03({ location: { adminHierarchy: [{ level: "city", name: "C" }] } }) }); expect(r.isValidForGeneration).toBe(true); expect(r.isValidForIndexing).toBe(false); expect(r.missingData).toContain("location.coordinates");
  });
  it("perfil versionado por tenant: pesos e limiar sobrescrevem; soma ≠ 1 ou sinal desconhecido é recusado", () => {
    expect(applyProfile(T03.density, { version: "2", indexingThreshold: 0.5, weights: { amenities_5: 0.3, synthesis_100: 0.4 } }).errors).toEqual([]);
    expect(applyProfile(T03.density, { version: "2", weights: { amenities_5: 0.9 } }).errors[0]).toMatch(/somam/); expect(applyProfile(T03.density, { version: "2", weights: { nada: 0.1 } }).errors[0]).toMatch(/desconhecido/);
    const r = validateArchetypeData(T03, { data: t03({ amenities: { education: amen(2), health: amen(2) } }) }, { version: "t-2", indexingThreshold: 0.55 }); expect(r.isValidForIndexing).toBe(true); expect(r.density!.version).toBe("t-2");
    expect(() => validateArchetypeData(T03, { data: t03() }, { version: "x", weights: { amenities_5: 0.9 } })).toThrow(/perfil de densidade inválido/);
  });
  it("T04..T12 têm requisitos próprios: POI sem coordenadas, comparação com datas-base diferentes, ranking sem evidência, oferta sem fonte", () => {
    const poi = (extra: object = {}) => ({ identity: { name: "Museu", slug: "museu" }, poi: { category: "tourism_culture", address: "Rua A, 1" }, location: { adminHierarchy: [{ level: "city", name: "C" }] }, description: synth(120), nearby: [{ id: "a", relation: "near" }, { id: "b", relation: "near" }], faqs: [{ question: "Abre aos domingos?", answer: "Consulte o horário oficial." }], ...extra });
    expect(validateArchetypeData(archetypeOf("T04")!, { data: poi() })).toMatchObject({ isValidForGeneration: true, isValidForIndexing: false }); expect(validateArchetypeData(archetypeOf("T04")!, { data: poi({ poi: { category: "x", coordinates: { lat: 1, lng: 2 } } }) }).missingData).not.toContain("poi.coordinates");
    const cmp = (v: object[]) => ({ identity: { name: "A × B", slug: "a-vs-b" }, entities: [{ id: "a", name: "A" }, { id: "b", name: "B" }], comparisons: ["x", "y", "z"].map((k) => ({ attributeId: k, label: k, values: v })) });
    expect(validateArchetypeData(archetypeOf("T09")!, { data: cmp([{ entityId: "a", value: 1, source: "S", observedAt: "2022-01-01" }, { entityId: "b", value: 2, source: "S", observedAt: "2022-06-01" }]) }).failedRules).not.toContain("T09.same_basis"); // mesma data-base (ano)
    expect(validateArchetypeData(archetypeOf("T09")!, { data: cmp([{ entityId: "a", value: 1, source: "S", observedAt: "2022-01-01" }, { entityId: "b", value: 2, source: "S", observedAt: "2023-01-01" }]) }).failedRules).toContain("T09.same_basis");
    expect(validateArchetypeData(archetypeOf("T09")!, { data: cmp([{ entityId: "a", value: 1 }, { entityId: "b", value: 2 }]) }).failedRules).toContain("T09.same_basis");
    const list = (items: object[]) => ({ identity: { name: "Melhores", slug: "melhores" }, category: "parques", methodology: "Seleção por critério X reproduzível com dados Y e Z abertos.", items });
    const ranked = [1, 2, 3].map((n) => ({ entityId: `e${n}`, name: `E${n}`, rank: n, rationale: "motivo curto aqui", evidence: [] as string[] }));
    expect(validateArchetypeData(archetypeOf("T10")!, { data: list(ranked) }).failedRules).toContain("T10.rank_needs_evidence"); expect(validateArchetypeData(archetypeOf("T10")!, { data: list(ranked.map((i) => ({ ...i, evidence: ["fact:1"] }))) }).failedRules).not.toContain("T10.rank_needs_evidence");
    expect(validateArchetypeData(archetypeOf("T10")!, { data: { ...list(ranked), methodology: undefined } }).failedRules).toContain("T10.methodology");
    const exp = (offers: object[]) => ({ identity: { name: "Passeio", slug: "passeio" }, experience: { provider: "Op", description: synth(80) }, location: { adminHierarchy: [{ level: "city", name: "C" }] }, offers });
    expect(validateArchetypeData(archetypeOf("T06")!, { data: exp([{ price: 100, priceCurrency: "BRL", source: "Operador", observedAt: "2026-10-01" }]) }).failedRules).not.toContain("T06.offers_real"); expect(validateArchetypeData(archetypeOf("T06")!, { data: exp([{ price: 100, priceCurrency: "BRL", source: "", observedAt: "2026-10-01" }]) }).status).toBe("INVALID");
  });
  it("para os 12 archetypes: dado vazio é INVALID e nunca pontua (nenhum aceita objeto vazio)", () => { for (const c of ARCHETYPE_CATALOG) { const r = validateArchetypeData(c, { data: {} }); expect(r.status, c.id).toBe("INVALID"); expect(r.score, c.id).toBeNull(); expect(r.isValidForIndexing, c.id).toBe(false); } });
});

describe("JSON-LD por archetype", () => {
  const ctx = { canonicalUrl: "https://ex.com/bairros/bairro-teste", breadcrumb: [{ name: "Cidade", url: "https://ex.com/c" }, { name: "Bairro Teste", url: "https://ex.com/bairros/bairro-teste" }] };
  const data = () => validateArchetypeData(T03, { data: t03() }) && (T03.schema.parse(t03()) as Record<string, unknown>);
  it("T03: AdministrativeArea, Place e BreadcrumbList com ids estáveis, deterministicamente e válidos", () => {
    const a = buildJsonLd(T03, data(), ctx); expect(a.map((n) => n["@type"])).toEqual(["AdministrativeArea", "Place", "BreadcrumbList"]); expect(buildJsonLd(T03, data(), ctx)).toEqual(a); expect(a.map((n) => n["@id"])).toEqual([`${ctx.canonicalUrl}#area`, `${ctx.canonicalUrl}#place`, `${ctx.canonicalUrl}#breadcrumb`]);
    const v = validateJsonLd(T03, a, { data: data(), visibleText: "Bairro Teste: guia", canonicalUrl: ctx.canonicalUrl, hasHierarchy: true }); expect(v).toMatchObject({ valid: true, issues: [] });
  });
  it("breadcrumb só com hierarquia: sem ela não é emitido NEM exigido; com breadcrumb declarado e sem hierarquia, é apontado", () => {
    const a = buildJsonLd(T03, data(), { canonicalUrl: ctx.canonicalUrl }); expect(a.map((n) => n["@type"])).toEqual(["AdministrativeArea", "Place"]);
    expect(validateJsonLd(T03, a, { canonicalUrl: ctx.canonicalUrl, hasHierarchy: false }).valid).toBe(true); expect(validateJsonLd(T03, [...a, { "@context": "https://schema.org", "@type": "BreadcrumbList", "@id": "b" }], { hasHierarchy: false }).issues.map((i) => i.rule)).toEqual(["jsonld.breadcrumb_without_hierarchy"]); expect(validateJsonLd(T03, a, { hasHierarchy: true }).issues.map((i) => i.rule)).toEqual(["jsonld.required_type_missing"]);
  });
  it("NUNCA calcula AggregateOffer/preço/offerCount do nada: sem ofertas reais não há Offer; com 1 real vira Offer; com ≥ 3 reais, agregado derivado delas; moedas misturadas não agregam", () => {
    const T06 = archetypeOf("T06")!; const mkData = (offers: object[]) => T06.schema.parse({ identity: { name: "Passeio", slug: "passeio" }, experience: { provider: "Op", description: synth(80) }, offers }) as Record<string, unknown>;
    const o = (price: number, cur = "BRL") => ({ price, priceCurrency: cur, source: "Operador", observedAt: "2026-10-01" }); const c = { canonicalUrl: "https://ex.com/e/passeio" };
    expect(JSON.stringify(buildJsonLd(T06, mkData([]), c))).not.toMatch(/Offer/); expect(JSON.stringify(buildJsonLd(T06, mkData([o(100)]), c))).toContain('"@type":"Offer"'); const agg = buildJsonLd(T06, mkData([o(100), o(150), o(120)]), c)[0]!.offers as Record<string, unknown>;
    expect(agg).toEqual({ "@type": "AggregateOffer", priceCurrency: "BRL", lowPrice: 100, highPrice: 150, offerCount: 3 }); expect(JSON.stringify(buildJsonLd(T06, mkData([o(100), o(150, "USD"), o(120)]), c))).not.toMatch(/Offer/); expect(JSON.stringify(buildJsonLd(T06, mkData([o(100), o(150)]), c))).not.toMatch(/Offer/);
    // um JSON-LD forjado com agregado inventado é reprovado
    const forged = [{ "@context": "https://schema.org", "@type": "Product", "@id": "x#p", name: "Passeio", offers: { "@type": "AggregateOffer", priceCurrency: "BRL", lowPrice: 1, highPrice: 9, offerCount: 7 } }];
    expect(validateJsonLd(T06, forged, { data: mkData([o(100), o(150), o(120)]) }).issues.map((i) => i.rule)).toContain("jsonld.aggregate_not_derived"); expect(validateJsonLd(T06, forged, { data: mkData([]) }).issues.map((i) => i.rule)).toContain("jsonld.offer_without_data");
  });
  it("valida contra o contrato: tipo fora do archetype, @id repetido, url não canônica, rating sem dado; City é aceito como subtipo de AdministrativeArea", () => {
    const bad = [{ "@context": "https://schema.org", "@type": "Restaurant", "@id": "a", name: "X" }, { "@context": "https://schema.org", "@type": "Place", "@id": "a", name: "Bairro Teste", url: "https://outro.com" }, { "@context": "https://schema.org", "@type": "Place", "@id": "b", name: "Z", aggregateRating: { ratingValue: 5 } }];
    const r = validateJsonLd(T03, bad, { canonicalUrl: "https://ex.com/x" }).issues.map((i) => i.rule); expect(r).toEqual(expect.arrayContaining(["jsonld.type_not_allowed", "jsonld.duplicate_id", "jsonld.url_not_canonical", "jsonld.rating_without_data"]));
    const real = [{ "@context": "https://schema.org", "@type": "City", name: "São Paulo" }, { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [] }]; expect(validateJsonLd(T03, real, { visibleText: "São Paulo" })).toMatchObject({ valid: true });
  });
  it("gera algo coerente para os 12 archetypes a partir de dado mínimo válido (só tipos do contrato)", () => {
    const samples: Record<string, Record<string, unknown>> = { T01: { identity: { name: "D", slug: "d" }, location: { adminHierarchy: [{ level: "city", name: "C" }] }, overviewSynthesis: synth(60) }, T02: { identity: { name: "R", slug: "r" }, location: { adminHierarchy: [{ level: "region", name: "R" }] }, overviewSynthesis: synth(60), cities: [{ id: "a", relation: "contains" }] }, T03: t03(), T04: { identity: { name: "M", slug: "m" }, poi: { category: "c" }, location: { adminHierarchy: [{ level: "city", name: "C" }] }, description: synth(60) }, T05: { identity: { name: "D", slug: "d" }, location: { adminHierarchy: [{ level: "city", name: "C" }] }, items: [{ entityId: "e", name: "E", category: "c", reason: "motivo curto aqui" }] }, T06: { identity: { name: "P", slug: "p" }, experience: { provider: "O", description: synth(60) } }, T07: { identity: { name: "I", slug: "i" }, location: { adminHierarchy: [{ level: "city", name: "C" }] }, durationDays: 1, days: [{ day: 1, stops: [{ entityId: "e", name: "E" }] }] }, T08: { identity: { name: "D", slug: "d" }, location: { adminHierarchy: [{ level: "city", name: "C" }] }, faqs: [{ question: "Quando ir?", answer: "Depende da estação." }] }, T09: { identity: { name: "A × B", slug: "a-b" }, entities: [{ id: "a", name: "A" }, { id: "b", name: "B" }] }, T10: { identity: { name: "L", slug: "l" }, category: "c", items: [{ entityId: "e", name: "E", rationale: "motivo curto aqui" }] }, T11: { identity: { name: "N", slug: "n" }, business: { category: "c" }, address: { street: "Rua A", locality: "Cidade", country: "BR" }, location: { adminHierarchy: [{ level: "city", name: "C" }] }, description: synth(60) }, T12: { identity: { name: "T", slug: "t" }, topic: { name: "T", description: synth(60) }, members: [{ id: "m", relation: "member" }] } };
    for (const c of ARCHETYPE_CATALOG) { const parsed = c.schema.parse(samples[c.id]) as Record<string, unknown>; const nodes = buildJsonLd(c, parsed, { canonicalUrl: `https://ex.com/${c.id}`, breadcrumb: [{ name: "Início", url: "https://ex.com/" }] }); expect(nodes.length, c.id).toBeGreaterThan(0); const allowed = new Set([...c.schemaTypes.required, ...c.schemaTypes.optional, ...c.schemaTypes.conditional]); for (const n of nodes) for (const t of [n["@type"]].flat()) expect(allowed.has(String(t)), `${c.id}:${String(t)}`).toBe(true); expect(new Set(nodes.map((n) => n["@id"])).size, c.id).toBe(nodes.length); }
  });
});

describe("grafo de links internos e política de inlinks", () => {
  const node = (id: string, over: Partial<LinkNode> = {}): LinkNode => ({ id, url: `/p/${id}`, canonical: `/p/${id}`, archetypeId: "T03", clusterId: "c1", parentId: null, sourceEligible: true, ...over });
  const link = (from: string, to: string, over: Partial<RawLink> = {}): RawLink => ({ fromId: from, toPath: `/p/${to}`, relation: "sibling", moduleId: "rel", reason: "mesmo cluster", ...over });
  const N = ["a", "b", "c", "d", "e"].map((i) => node(i));
  it("3 inlinks contextuais válidos liberam; 2 retêm com INSUFFICIENT_CONTEXTUAL_INLINKS, o que falta e SUGESTÕES (que não são arestas)", () => {
    const g3 = compileLinkGraph(N, [link("b", "a"), link("c", "a"), link("d", "a")]); const ok = evaluateInlinks("a", N, g3); expect(ok).toMatchObject({ required: 3, valid: 3, passed: true, ruleId: null, missing: 0 });
    const g2 = compileLinkGraph(N, [link("b", "a"), link("c", "a")]); const no = evaluateInlinks("a", N, g2); expect(no).toMatchObject({ valid: 2, passed: false, ruleId: "INSUFFICIENT_CONTEXTUAL_INLINKS", missing: 1 }); expect(no.suggestions.map((s) => s.fromId)).toEqual(["d", "e"]); expect(g2.edges).toHaveLength(2);
  });
  it("exclui autolinks, duplicatas, destinos inexistentes, não canônicos/conflitantes, origens inelegíveis, relações não permitidas e destinos proibidos", () => {
    const nodes = [...N, node("x", { canonical: "/outro" }), node("y", { canonical: "/p/z" }), node("w1", { url: "/p/dup", canonical: "/p/dup" }), node("w2", { url: "/p/dup", canonical: "/p/dup" }), node("s", { sourceEligible: false }), node("q", { archetypeId: "T12" })];
    const g = compileLinkGraph(nodes, [link("a", "a"), link("b", "a"), link("b", "a", { moduleId: "zz" }), link("c", "nao-existe"), link("d", "x"), link("d", "y"), link("c", "dup"), link("s", "a"), link("e", "a", { relation: "breadcrumb" }), link("e", "d", { relation: "comparison_to_entity" })], { ...DEFAULT_LINK_POLICY, forbiddenPaths: ["^/p/e$"] });
    const by = Object.fromEntries(g.edges.map((e) => [`${e.fromId}>${e.toPath}>${e.relation}>${e.moduleId}`, e.invalidReason])); expect(by["a>/p/a>sibling>rel"]).toBe("SELF_LINK"); expect(by["b>/p/a>sibling>rel"]).toBeNull(); expect(by["b>/p/a>sibling>zz"]).toBe("DUPLICATE"); expect(by["c>/p/nao-existe>sibling>rel"]).toBe("DESTINATION_MISSING"); expect(by["d>/p/x>sibling>rel"]).toBe("NON_CANONICAL_DESTINATION"); expect(by["d>/p/y>sibling>rel"]).toBe("NON_CANONICAL_DESTINATION"); expect(by["c>/p/dup>sibling>rel"]).toBe("CONFLICTING_CANONICAL"); expect(by["s>/p/a>sibling>rel"]).toBe("SOURCE_INELIGIBLE"); expect(by["e>/p/d>comparison_to_entity>rel"]).toBe("RELATION_NOT_ALLOWED");
    expect(evaluateInlinks("a", nodes, g).valid).toBe(2); // b e e(breadcrumb permitida)
    const forb = compileLinkGraph(nodes, [link("a", "e")], { ...DEFAULT_LINK_POLICY, forbiddenPaths: ["^/p/e$"] }); expect(forb.edges[0]!.invalidReason).toBe("FORBIDDEN_DESTINATION");
  });
  it("origem inelegível pode contar SÓ se a política disser; mínimo por archetype sobrescreve o do tenant; a política é validada", () => {
    const nodes = [node("a"), node("s", { sourceEligible: false })]; const raw = [link("s", "a")];
    expect(evaluateInlinks("a", nodes, compileLinkGraph(nodes, raw), { ...DEFAULT_LINK_POLICY, minInlinks: 1 }).valid).toBe(0); expect(evaluateInlinks("a", nodes, compileLinkGraph(nodes, raw, { ...DEFAULT_LINK_POLICY, countFromIneligibleSources: true }), { ...DEFAULT_LINK_POLICY, minInlinks: 1, countFromIneligibleSources: true }).passed).toBe(true);
    expect(evaluateInlinks("a", nodes, compileLinkGraph(nodes, []), { ...DEFAULT_LINK_POLICY, byArchetype: { T03: 5 } }).required).toBe(5);
    expect(validateLinkPolicy({ ...DEFAULT_LINK_POLICY, minInlinks: 0 })).toHaveLength(1); expect(validateLinkPolicy({ ...DEFAULT_LINK_POLICY, exceptions: [{ scope: {}, waivedMinInlinks: 0, reason: "curto", approvedBy: "", approvedAt: "2026-10-01" }] })).toHaveLength(3); expect(validateLinkPolicy(DEFAULT_LINK_POLICY)).toEqual([]);
  });
  it("hub raiz NÃO tem bypass implícito: sem links falha; só uma exceção EXPLÍCITA (escopo, justificativa, responsável) libera e fica registrada no resultado", () => {
    const nodes = [node("home", { archetypeId: "T12", url: "/" , canonical: "/" })]; const g = compileLinkGraph(nodes, []);
    expect(evaluateInlinks("home", nodes, g)).toMatchObject({ passed: false, ruleId: "INSUFFICIENT_CONTEXTUAL_INLINKS" });
    const ex = { scope: { opportunityId: "home" }, waivedMinInlinks: 0, reason: "Página raiz do site: sem páginas acima", approvedBy: "ana", approvedAt: "2026-10-01T00:00:00Z" };
    const r = evaluateInlinks("home", nodes, g, { ...DEFAULT_LINK_POLICY, exceptions: [ex] }); expect(r).toMatchObject({ passed: true, required: 0, exception: ex });
    expect(evaluateInlinks("home", nodes, g, { ...DEFAULT_LINK_POLICY, exceptions: [{ ...ex, expiresAt: "2026-01-01T00:00:00Z" }] }, new Date("2026-10-14")).passed).toBe(false); // vencida
    expect(evaluateInlinks("home", nodes, g, { ...DEFAULT_LINK_POLICY, exceptions: [{ ...ex, scope: { opportunityId: "outra" } }] }).passed).toBe(false); // escopo diferente
  });
  it("a compilação é idempotente e o hash muda quando uma aresta, a política ou um canonical muda", () => {
    const raw = [link("b", "a"), link("c", "a")]; const g1 = compileLinkGraph(N, raw); expect(compileLinkGraph(N, [...raw].reverse()).hash).toBe(g1.hash); expect(compileLinkGraph(N, [...raw, link("d", "a")]).hash).not.toBe(g1.hash);
    expect(compileLinkGraph(N, raw, { ...DEFAULT_LINK_POLICY, version: "2" }).hash).not.toBe(g1.hash); expect(compileLinkGraph(N.map((n) => (n.id === "a" ? { ...n, canonical: "/x" } : n)), raw).hash).not.toBe(g1.hash);
    expect(outlinksOf("b", g1).valid).toHaveLength(1); expect(g1.stats).toMatchObject({ nodes: 5, edges: 2, valid: 2, invalid: 0 });
  });
});

describe("intenção e canibalização", () => {
  const page = (id: string, over: Partial<IntentPage> = {}): IntentPage => ({ id, tenantId: "t", locale: "pt-BR", market: "BR", clusterId: "c", archetypeId: "T03", primaryEntityId: `e-${id}`, primaryIntent: "guia do bairro", dimensions: { city: "sp", topic: "visao" }, url: `/p/${id}`, canonical: `/p/${id}`, title: `Bairro ${id}`, h1: `Bairro ${id}`, ...over });
  it("normaliza a intenção (acento, caixa, ordem e stopwords) e detecta intenção primária duplicada para a mesma entidade no mesmo contexto", () => {
    expect(normalizeIntent("Guia do Bairro")).toBe(normalizeIntent("bairro, guia!")); const cs = diagnoseIntents([page("a", { primaryEntityId: "E" }), page("b", { primaryEntityId: "E", primaryIntent: "Bairro: guia" })]);
    expect(cs.map((c) => [c.kind, c.severity, c.recommendedAction])).toContainEqual(["DUPLICATE_PRIMARY_INTENT", "conflict", "change_intent"]); expect(cs.find((c) => c.kind === "DUPLICATE_PRIMARY_INTENT")!.pages.map((p) => p.id)).toEqual(["a", "b"]);
  });
  it("mesma entidade em contextos diferentes (idioma, mercado, tenant, cluster) NÃO conflita", () => {
    for (const o of [{ locale: "en-US" }, { market: "PT" }, { tenantId: "t2" }, { clusterId: "c2" }, { archetypeId: "T04" as const }]) expect(diagnoseIntents([page("a", { primaryEntityId: "E" }), page("b", { primaryEntityId: "E", url: "/p/b2", ...o })]).filter((c) => c.kind === "DUPLICATE_PRIMARY_INTENT"), JSON.stringify(o)).toEqual([]);
  });
  it("mesma URL e canonical conflitante são conflitos determinísticos com a ação recomendada; canonical para página inexistente também", () => {
    const same = diagnoseIntents([page("a", { url: "/x", canonical: "/x" }), page("b", { url: "/x", canonical: "/x" })]); expect(same.find((c) => c.kind === "SAME_URL")).toMatchObject({ severity: "conflict", recommendedAction: "block_generation" });
    const can = diagnoseIntents([page("a", { canonical: "/z" }), page("b", { canonical: "/z" }), page("z", { url: "/z", canonical: "/z" })]); expect(can.find((c) => c.kind === "CONFLICTING_CANONICAL")).toMatchObject({ recommendedAction: "adjust_canonical" });
    expect(diagnoseIntents([page("a", { canonical: "/nao-existe" })])[0]).toMatchObject({ kind: "CONFLICTING_CANONICAL", evidence: expect.objectContaining({ reason: expect.stringContaining("inexistente") }) });
  });
  it("similaridade semântica é SÓ sinal de investigação (nunca conflito) e exige a mesma entidade e o mesmo contexto", () => {
    const sig = diagnoseIntents([page("a", { primaryEntityId: "E", primaryIntent: "visão geral", h1: "Guia do bairro Centro" }), page("b", { primaryEntityId: "E", primaryIntent: "perfil", h1: "Guia do bairro Centro" })]);
    expect(sig.filter((c) => c.kind === "OVERLAP_SIGNAL")).toHaveLength(1); expect(sig.every((c) => c.severity === "signal" || c.kind === "DUPLICATE_PRIMARY_INTENT")).toBe(true); expect(sig.find((c) => c.kind === "OVERLAP_SIGNAL")!.evidence.note).toMatch(/não prova/);
    expect(diagnoseIntents([page("a", { h1: "Guia do bairro Centro" }), page("b", { h1: "Guia do bairro Centro" })]).filter((c) => c.kind === "OVERLAP_SIGNAL")).toEqual([]); // entidades diferentes
  });
  it("receitas que produzem o mesmo conteúdo são redundantes; resultado ordenado e determinístico", () => {
    const ps = [page("a", { recipeFingerprint: "h" }), page("b", { recipeFingerprint: "h" })]; const cs = diagnoseIntents(ps); expect(cs.find((c) => c.kind === "REDUNDANT_RECIPE")).toMatchObject({ severity: "conflict", recommendedAction: "consolidate" }); expect(diagnoseIntents([...ps].reverse())).toEqual(cs);
  });
});

describe("Quality Gate de arquitetura (10 passos, quatro eligibilidades separadas)", () => {
  const valid = validateArchetypeData(T03, { data: t03() });
  const graphOk = { inlinks: { nodeId: "a", required: 3, valid: 3, passed: true, ruleId: null, exception: null, validEdges: [], rejected: [], missing: 0, suggestions: [] } as never, outlinksValid: 2, outlinksInvalid: 0, graphHash: "h" };
  const input = (o: Partial<GateInput> = {}): GateInput => ({ archetype: T03, validation: valid, conflicts: [], entity: { primaryEntityId: "e", relationsCount: 2 }, template: { blueprintStatus: "COMPLETE", templateAvailable: true, templateGap: false, omittedModules: [], unknownModules: [] }, links: graphOk, canonical: { url: "/p/a", canonical: "/p/a", rule: "self", indexabilityPolicy: "index" }, schema: { valid: true, issues: [], warnings: [], types: [] }, content: { qaOutcome: "QA_PASSED", blocking: [], notRun: [] }, approval: "APPROVED", ...o });
  it("tudo certo: aprovação, publicação e indexação elegíveis; 10 passos na ordem; nenhuma ação pendente", () => {
    const r = runGate(input()); expect(r.steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); expect(r.eligibility).toEqual({ approval: true, publication: true, indexing: true }); expect(r.failedRules).toEqual([]); expect(r.nextActions).toEqual([]); expect(r.qualityScore).toBe(1);
  });
  it("INSUFFICIENT_CONTEXTUAL_INLINKS retém SÓ a indexação (aprovação e publicação seguem), com dados para resolver e ação recomendada", () => {
    const inl = { nodeId: "a", required: 3, valid: 1, passed: false, ruleId: "INSUFFICIENT_CONTEXTUAL_INLINKS", exception: null, validEdges: [], rejected: [], missing: 2, suggestions: [{ fromId: "b", relation: "sibling", why: "mesmo cluster" }] } as never;
    const r = runGate(input({ links: { ...graphOk, inlinks: inl } })); expect(r.eligibility).toEqual({ approval: true, publication: true, indexing: false }); expect(r.blockedBy.indexing).toEqual(["INSUFFICIENT_CONTEXTUAL_INLINKS"]); expect(r.linkProblems[0]).toMatchObject({ rule: "INSUFFICIENT_CONTEXTUAL_INLINKS", detail: { missing: 2 } }); expect(r.nextActions[0]).toMatch(/links contextuais/);
  });
  it("níveis separados: QA falho bloqueia tudo; sem aprovação humana bloqueia publicação e indexação (não a aprovabilidade); noindex bloqueia só a indexação", () => {
    expect(runGate(input({ content: { qaOutcome: "QA_FAILED", blocking: ["Q2"], notRun: [] } })).eligibility).toEqual({ approval: false, publication: false, indexing: false });
    expect(runGate(input({ approval: null })).eligibility).toEqual({ approval: true, publication: false, indexing: false });
    const noidx = runGate(input({ canonical: { url: "/p/a", canonical: "/p/a", rule: "self", indexabilityPolicy: "noindex" } })); expect(noidx.eligibility).toEqual({ approval: true, publication: true, indexing: false }); expect(noidx.blockedBy.indexing).toEqual(["policy.index"]);
  });
  it("densidade, proveniência e dados: dado sem coordenadas/densidade baixa ficam pendentes só para indexar; schema inválido bloqueia aprovação", () => {
    const thin = validateArchetypeData(T03, { data: t03({ amenities: { education: amen(1) }, location: { adminHierarchy: [{ level: "city", name: "C" }] } }) }); const r = runGate(input({ validation: thin })); expect(r.eligibility).toEqual({ approval: true, publication: true, indexing: false }); expect(r.failedRules).toEqual(expect.arrayContaining(["contract.indexing", "contract.density"])); expect(r.missingData).toEqual(expect.arrayContaining(["location.coordinates", "density:amenities_5"]));
    const inv = runGate(input({ validation: validateArchetypeData(T03, { data: {} }) })); expect(inv.eligibility.approval).toBe(false); expect(inv.failedRules).toContain("contract.schema"); expect(inv.qualityScore).toBeNull();
  });
  it("conflito de intenção, template em lacuna, canonical e JSON-LD inválidos bloqueiam todos os níveis; sinal de sobreposição é só aviso", () => {
    const conflict = { id: "x", kind: "SAME_URL", severity: "conflict", pages: [{ id: "a", url: "/p/a", title: null }], evidence: {}, recommendedAction: "block_generation", message: "m" } as const; const sig = { ...conflict, kind: "OVERLAP_SIGNAL", severity: "signal" } as const;
    expect(runGate(input({ conflicts: [conflict] })).eligibility.approval).toBe(false); const w = runGate(input({ conflicts: [sig] })); expect(w.eligibility.approval).toBe(true); expect(w.warnings).toContain("intent.overlap_signal");
    expect(runGate(input({ template: { blueprintStatus: "COMPLETE", templateAvailable: false, templateGap: true, omittedModules: [], unknownModules: [] } })).failedRules).toContain("template.ready"); expect(runGate(input({ canonical: { url: "/p/a", canonical: "/p/b", rule: "self", indexabilityPolicy: "index" } })).failedRules).toContain("canonical.valid");
    expect(runGate(input({ schema: { valid: false, issues: [{ rule: "jsonld.type_not_allowed", message: "x" }], warnings: [], types: [] } })).schemaErrors).toEqual(["jsonld.type_not_allowed: x"]); expect(runGate(input({ schema: null })).eligibility.approval).toBe(false);
    const hier = runGate(input({ schema: { valid: false, issues: [{ rule: "jsonld.breadcrumb_without_hierarchy", message: "b" }], warnings: [], types: [] } })); expect(hier.eligibility).toEqual({ approval: true, publication: true, indexing: false }); expect(hier.blockedBy.indexing).toEqual(["schema.hierarchy"]);
  });
  it("módulos omitidos por falta de dado e relações ausentes são avisos não bloqueantes", () => {
    const r = runGate(input({ template: { blueprintStatus: "COMPLETE", templateAvailable: true, templateGap: false, omittedModules: [{ moduleId: "amenidades", reason: "sem dados" }], unknownModules: [] }, entity: { primaryEntityId: "e", relationsCount: 0 } })); expect(r.eligibility.indexing).toBe(true); expect(r.warnings).toEqual(expect.arrayContaining(["template.omitted_modules", "entity.relations"]));
  });
});
