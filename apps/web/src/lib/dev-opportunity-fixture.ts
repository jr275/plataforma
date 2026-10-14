import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CITY_OVERVIEW, TEMPLATE_REGISTRY, classifyCityRows, engine, evaluateCity, parseCsv, type CityPreview, type engine as E } from "@plataforma/api";
import { realEstateVertical } from "@plataforma/pack-real-estate";

// FIXTURE DE DESENVOLVIMENTO (nunca em produção): roda o MOTOR REAL (adaptadores, classificação, score) sobre respostas REAIS das fontes públicas capturadas em
// 2026-10-13 (packages/api/src/engine/adapters/__fixtures__) e o extrato REAL do IBGE. Nada é persistido nem inventado; serve para inspecionar as telas sem login nem banco.
// CASO DE TESTE declarado nas telas: a vertical é a imobiliária com dois ajustes (padrão "city-overview" de valor alto e valor comercial mínimo 30), só para existir uma
// oportunidade elegível com template REAL e mostrar o caminho "pronta para construir". Com o padrão da vertical, nenhuma passa dos bloqueios.
const DEV_VERTICAL: E.VerticalDefinition = { ...realEstateVertical, scoring: { ...realEstateVertical.scoring, eligibility: { ...realEstateVertical.scoring.eligibility, minCommercialValue: 30 } }, patterns: realEstateVertical.patterns.map((p) => (p.key === "city-overview" ? { ...p, valueTier: "high" as const } : p)) };
const ROOT = path.resolve(process.cwd(), "../..");
const FX = path.join(ROOT, "packages/api/src/engine/adapters/__fixtures__");
const read = (n: string) => readFileSync(path.join(FX, n), "utf8");
const NOW = new Date("2026-10-13T15:00:00Z");
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" } as const;

const ROUTES: Record<string, string> = {
  "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/": read("bcb-432.json"), "https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/": read("bcb-13522.json"), "https://api.bcb.gov.br/dados/serie/bcdata.sgs.189/": read("bcb-189.json"),
  "https://servicodados.ibge.gov.br/api/v3/noticias/": read("ibge-news.json"), "https://agenciabrasil.ebc.com.br/robots.txt": read("agenciabrasil-robots.txt"),
  "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml": read("agenciabrasil-economia.xml"),
};
const fetchFixture: E.FetchLike = async (url) => {
  const key = Object.keys(ROUTES).find((k) => url.startsWith(k));
  const body = key ? ROUTES[key]! : "";
  return { ok: !!key, status: key ? 200 : 404, headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "text/plain" : null) }, body: null, text: async () => body };
};
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let cache: { rows: E.OpportunityRow[]; details: Map<string, E.OpportunityDetail>; runs: E.ResearchRunRow[]; evidence: E.EvidenceRow[]; blueprints: Map<string, E.BlueprintRecord[]>; roadmap: E.Roadmap; previews: Map<string, CityPreview> } | undefined;
export async function devOpportunities() {
  if (cache) return cache;
  const { rows: cityRows } = classifyCityRows(parseCsv(readFileSync(path.join(ROOT, "db/test-fixtures/generation/sp-ibge-2026-10-12.csv"), "utf8")), MAPPING);
  const entities: E.EntityRecord[] = cityRows.flatMap((r) => (r.city ? [{ kind: "city", id: uuid(Number(r.city.ibgeCode)), name: r.city.name, qualifier: r.city.uf, weight: r.city.population }] : []));
  const ctx = { fetch: fetchFixture, now: NOW, userAgent: "dev-fixture", vertical: DEV_VERTICAL, sleep: async () => undefined, robots: new Map() };
  const results = await engine.runAdapters([engine.bcbSgsAdapter, engine.ibgeNewsAdapter, engine.rssNewsAdapter], ctx);
  const evidence = results.flatMap((r) => r.evidence).map((draft, i) => ({ key: uuid(900000 + i), draft }));
  const { drafts } = engine.buildOpportunities({ def: DEV_VERTICAL, entities, evidence, pages: [], config: DEV_VERTICAL.scoring, now: NOW, entityLimit: 10 });
  const details = new Map<string, E.OpportunityDetail>();
  const rows: E.OpportunityRow[] = [];
  const ev = new Map(evidence.map((e) => [e.key, e.draft]));
  drafts.forEach((d, i) => {
    const id = uuid(i + 1);
    const status = d.validation.ok ? (d.score.eligibility.eligible ? "eligible" : "scored") : "rejected";
    const row: E.OpportunityRow = { id, clusterKey: d.clusterKey, primaryQuery: d.primaryQuery, variants: d.variants, intent: d.intent, stage: d.stage, experience: d.experience, entityId: d.entity?.id ?? null, entityKind: d.entity?.kind ?? null, location: d.location ?? {}, status, hypothesis: true, eligible: d.score.eligibility.eligible, priority: d.score.priority.value, priorityKind: d.score.priority.kind, commercial: d.score.objectives.commercial_value.adjusted, feasibility: d.score.objectives.execution_feasibility.adjusted, discovery: d.score.objectives.discovery_opportunity.adjusted, createdAt: NOW, updatedAt: NOW, confidence: d.score.confidence, unknownDimensions: d.score.missing.length, evidenceCount: d.links.length };
    rows.push(row);
    details.set(id, {
      ...row, pattern: d.pattern.key, jtbd: d.jtbd, expectedOutcome: d.expectedOutcome, language: d.language, country: d.country,
      demand: { value: null, basis: "unknown", source: null, note: "Demanda de busca não medida: não há fonte (Search Console, Trends ou provedor autorizado). A query é uma hipótese gerada pela vertical." },
      trend: {}, validation: d.validation, firstRunId: uuid(500), lastRunId: uuid(500),
      entity: d.entity ? { id: d.entity.id, name: d.entity.name, uf: d.entity.qualifier ?? "", ibgeCode: String(Number(d.entity.id.slice(-12))) } : null,
      evidence: d.links.map((l) => { const e = ev.get(l.evidenceKey)!; return { role: l.role, reason: l.reason, topic: l.topic, evidenceId: l.evidenceKey, evidence: { ...e, id: l.evidenceKey } }; }),
      scores: [{ id: uuid(700000 + i), createdAt: NOW, configVersion: 1, configId: uuid(600), modelVersion: d.score.model, priority: d.score.priority.value, priorityKind: d.score.priority.kind, eligible: d.score.eligibility.eligible, confidence: d.score.confidence, result: d.score, dimensions: d.dimensions as unknown as Record<string, unknown>, strategic: d.strategic, createdBy: "system" }],
      events: [{ id: uuid(800000 + i), type: "discovered", from: null, to: "discovered", actor: "system", reason: "hipótese gerada pela vertical a partir de uma entidade real do tenant", data: {}, at: NOW }, { id: uuid(810000 + i), type: "score", from: null, to: null, actor: "system", reason: "score calculado com a configuração v1", data: {}, at: NOW }],
    });
  });
  const evRows: E.EvidenceRow[] = evidence.map(({ key, draft }) => ({ id: key, adapter: draft.adapter, kind: draft.kind, title: draft.title, url: draft.url, summary: draft.summary, publishedAt: draft.publishedAt, collectedAt: draft.collectedAt, basis: draft.basis, topics: draft.topics, linked: [...details.values()].filter((x) => x.evidence.some((l) => l.evidenceId === key)).length }));
  const runs: E.ResearchRunRow[] = [{ id: uuid(500), status: results.every((r) => r.status === "succeeded") ? "succeeded" : "partial", startedAt: NOW, finishedAt: NOW, error: null, adapters: results.map((r) => ({ adapter: r.adapter, status: r.status, requests: r.requests, kept: r.kept, inserted: r.kept, errors: r.errors })), stats: {}, createdBy: "fixture" }];
  // Blueprint só para as elegíveis (como no fluxo real): dados da cidade vêm do extrato; nada é persistido.
  const facts = new Map(cityRows.flatMap((r) => (r.city ? [[uuid(Number(r.city.ibgeCode)), { name: r.city.name, uf: r.city.uf, region: r.city.region, population: r.city.population, population_year: r.city.populationYear, ibge_code: r.city.ibgeCode }] as const] : [])));
  const available = new Set<string>(["entities", ...evidence.filter((e) => e.draft.kind === "indicator").map((e) => `indicator:${e.draft.sourceRef}`)]);
  const blueprints = new Map<string, E.BlueprintRecord[]>();
  const previews = new Map<string, CityPreview>();
  let waived = false;
  for (const [i, d] of drafts.entries()) {
    const det = details.get(uuid(i + 1))!;
    if (det.status !== "eligible") continue;
    const cr = (d.dimensions.cannibalization_risk.value as number | null) ?? null;
    const bp = engine.buildBlueprint({ vertical: DEV_VERTICAL, templates: TEMPLATE_REGISTRY, available, entityFacts: d.entity ? (facts.get(d.entity.id) ?? null) : null, existingPaths: new Set(), knownPaths: new Set(), cannibalizationRisk: cr, maxCannibalizationRisk: DEV_VERTICAL.scoring.eligibility.maxCannibalizationRisk,
      opportunity: { id: det.id, primaryQuery: d.primaryQuery, intent: d.intent, stage: d.stage, pattern: d.pattern.key, experience: d.experience, expectedOutcome: d.expectedOutcome, eligible: true, scoreId: det.scores[0]!.id, entity: d.entity ? { kind: d.entity.kind, id: d.entity.id, name: d.entity.name, qualifier: d.entity.qualifier } : null } });
    const report = engine.evaluateExperienceGates(bp);
    blueprints.set(det.id, [{ id: uuid(950000 + i), version: 1, createdAt: NOW, createdBy: "fixture", ready: report.ready, templateKey: bp.template.key, contentHash: engine.blueprintHash(bp), blueprint: bp, report }]);
    // Só a PRIMEIRA com blueprint pronto recebe a exceção de SERP (para mostrar o estado "exceção vigente"); as demais ficam elegíveis, à espera da SERP.
    if (report.ready && !waived) {
      waived = true;
      const ev = { id: uuid(820000 + i), type: "transition", from: "eligible", to: "blueprinted", actor: "u-demo0001", reason: "EXCEÇÃO de SERP: nenhum provedor de SERP contratado; revisar ao integrar", data: { serpWaived: true, serp: "not_evaluated", reviewable: true, authorizesPublication: false, blueprintVersion: 1, waiverReason: "nenhum provedor de SERP contratado; revisar ao integrar" }, at: NOW };
      Object.assign(det, { status: "blueprinted", events: [...det.events, ev] });
      Object.assign(rows.find((r) => r.id === det.id)!, { status: "blueprinted" });
    }
    if (report.ready && d.entity) {
      const c = cityRows.find((r) => r.city && uuid(Number(r.city.ibgeCode)) === d.entity!.id)!.city!;
      const city = { id: d.entity.id, ibgeCode: c.ibgeCode, name: c.name, uf: c.uf, region: c.region, population: c.population, populationYear: c.populationYear, sourceRunId: uuid(1) };
      const source = { runId: uuid(1), sourceName: "IBGE", origin: "real" as const, fileName: "sp-ibge-2026-10-12.csv", fileSha256: "0".repeat(64), status: "succeeded" as const, totalRows: 645, acceptedRows: 645, startedAt: NOW, finishedAt: NOW };
      const ev2 = evaluateCity(city, { id: source.runId, sourceName: source.sourceName, origin: source.origin, status: source.status, fileSha256: source.fileSha256, finishedAt: source.finishedAt }, { template: CITY_OVERVIEW, knownPaths: new Set(), pathOwners: new Map(), titleOwners: new Map(), metaOwners: new Map(), existingByEntity: new Map() });
      previews.set(det.id, { outcome: ev2.outcome, gates: ev2.gates, page: ev2.page ?? null, source });
    }
  }
  // Roadmap: mesma classificação e soma de bloqueios do motor (puro), aplicada às linhas do fixture.
  const counts: Record<E.Lane, number> = { ready: 0, blocked: 0, awaiting_blueprint: 0, needs_work: 0 };
  const lanes: Record<E.Lane, E.RoadmapItem[]> = { ready: [], blocked: [], awaiting_blueprint: [], needs_work: [] };
  const tally = new Map<string, E.BlockerSummary>();
  for (const row of [...rows].sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1))) {
    const det = details.get(row.id)!;
    const bp = blueprints.get(row.id)?.[0];
    const failed = det.scores[0]!.result.eligibility.checks.filter((c) => !c.ok).map((c) => c.code);
    const c = engine.classify({ status: row.status, eligible: row.eligible, ready: bp ? bp.ready : null, blueprintBlockers: bp ? bp.report.blockers.map((b) => b.key) : null, failedEligibility: failed, serpWaiverPending: engine.findSerpWaiver(det.events)?.reviewed === false });
    counts[c.lane]++;
    if (lanes[c.lane].length < 25) lanes[c.lane].push({ id: row.id, query: row.primaryQuery, intent: row.intent, experience: row.experience, status: row.status, priority: row.priority, priorityKind: row.priorityKind, lane: c.lane, blockers: c.blockers, blockerLabels: c.blockers.map((k) => engine.describeBlocker(k, DEV_VERTICAL)), blueprintVersion: bp?.version ?? null });
    for (const key of c.blockers) { const id = `${c.lane}|${key}`; const prev = tally.get(id); tally.set(id, prev ? { ...prev, count: prev.count + 1 } : { key, label: engine.describeBlocker(key, DEV_VERTICAL), lane: c.lane, count: 1 }); }
  }
  const roadmap: E.Roadmap = { counts, items: lanes, blockers: [...tally.values()].sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1)), total: rows.length, byStatus: Object.fromEntries([...new Set(rows.map((r) => r.status))].map((st) => [st, rows.filter((r) => r.status === st).length])) };
  cache = { rows, details, runs, evidence: evRows, blueprints, roadmap, previews };
  return cache;
}
