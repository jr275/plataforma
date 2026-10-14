import { describe, expect, it } from "vitest";
import { bcbSgsAdapter } from "./adapters/bcb-sgs";
import { buildOpportunities, hashInputs, pickEntities, queryText, type DiscoveryInput, type EvidenceInput } from "./discovery";
import type { EntityRecord } from "./entities";
import { DIMENSIONS } from "./score-config";
import { TEST_CONFIG } from "./test-support/score-fixtures";
import { fakeFetch, fixture } from "./test-support/fake-fetch";
import { TEST_VERTICAL as V } from "./test-support/vertical.fixture";

const NOW = new Date("2026-10-13T20:00:00Z");
const city = (id: string, name: string, uf: string, weight: number | null): EntityRecord => ({ kind: "city", id, name, qualifier: uf, weight });
const ENTITIES = [city("c1", "Campinas", "SP", 1_100_000), city("c2", "São Paulo", "SP", 11_900_000), city("c3", "Santos", "SP", 420_000), city("h1", "Santa Rita", "PB", 130_000), city("h2", "Santa Rita", "MA", 40_000)];

/** Evidência de indicador REAL (fixture do BCB passada pelo adaptador de verdade), para exercitar a ligação de sinais. */
async function realIndicator(): Promise<EvidenceInput> {
  const r = await bcbSgsAdapter.run({ fetch: fakeFetch({ "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/": { body: fixture("bcb-432.json") } }), now: NOW, userAgent: "t", vertical: V, sleep: async () => {}, robots: new Map() });
  return { key: "ev-selic", draft: r.evidence[0]! };
}
const input = (over: Partial<DiscoveryInput> = {}): DiscoveryInput => ({ def: V, entities: ENTITIES, evidence: [], pages: [], config: TEST_CONFIG, now: NOW, entityLimit: 2, ...over });

describe("seleção de entidades e texto das queries", () => {
  it("as de maior peso primeiro; empate pelo nome; recorte pelo limite; limite 0 não escolhe nenhuma", () => {
    expect(pickEntities(ENTITIES, 3).map((e) => e.id)).toEqual(["c2", "c1", "c3"]);
    expect(pickEntities([city("a", "B", "X", 5), city("b", "A", "X", 5)], 2).map((e) => e.name)).toEqual(["A", "B"]);
    expect(pickEntities([city("a", "B", "X", null), city("b", "A", "X", 9)], 2).map((e) => e.id)).toEqual(["b", "a"]); // peso ausente vai por último
    expect(pickEntities(ENTITIES, 0)).toEqual([]);
  });
  it("o qualificador entra no texto SÓ quando o nome é ambíguo", () => {
    const amb = new Set(["santa rita"]);
    expect(queryText("plantas em {entity}", ENTITIES[3]!, amb)).toBe("plantas em Santa Rita PB");
    expect(queryText("plantas em {entity}", ENTITIES[0]!, amb)).toBe("plantas em Campinas");
  });
});

describe("pipeline: hipóteses geradas pela vertical, agrupadas e explicadas", () => {
  const { drafts, stats } = buildOpportunities(input());
  it("um cluster por padrão e entidade (3 padrões com entidade x 2 entidades + 1 sem entidade), nada fica sem classificar", () => {
    expect(drafts).toHaveLength(7);
    expect(stats).toMatchObject({ entities: 2, clusters: 7 });
    expect(stats.unclassified).toEqual([]); // uma vertical bem formada nunca gera query ambígua
    expect(stats.candidateQueries).toBe(2 * (3 + 2 + 2) + 2);
  });
  it("cada oportunidade é uma HIPÓTESE com query principal, variações da mesma intenção, entidade, idioma, país e JTBD", () => {
    const d = drafts.find((x) => x.clusterKey === "buy-plants:transactional:city:c2")!;
    expect(d.hypothesis).toBe(true);
    expect(d.primaryQuery).toBe("comprar plantas em São Paulo");
    expect([...d.variants].sort()).toEqual(["loja de plantas em São Paulo", "plantas à venda em São Paulo"]);
    expect(d).toMatchObject({ intent: "transactional", stage: "decide", language: "pt-BR", country: "BR", jtbd: "Encontrar onde comprar plantas", experience: "directory", expectedOutcome: "visitas à loja", location: { kind: "city", id: "c2", name: "São Paulo", qualifier: "SP" } });
  });
  it("intenções diferentes para a mesma entidade são oportunidades diferentes (nunca fundidas)", () => {
    const keys = drafts.filter((x) => x.entity?.id === "c2").map((x) => x.clusterKey).sort();
    expect(keys).toEqual(["buy-plants:transactional:city:c2", "buy-pots:transactional:city:c2", "compare-stores:comparison:city:c2"]);
  });
  it("padrão sem entidade vira UMA oportunidade sem localização", () => {
    const d = drafts.find((x) => x.pattern.key === "fern-care")!;
    expect(d.entity).toBeNull();
    expect(d.location).toBeNull();
    expect(d.clusterKey).toBe("fern-care:informational:-");
  });
  it("homônimos entram com a UF no texto e viram clusters distintos, cada um com a entidade certa", () => {
    const r = buildOpportunities(input({ entityLimit: 10 }));
    const sr = r.drafts.filter((x) => x.pattern.key === "buy-plants" && x.entity?.name === "Santa Rita");
    expect(sr.map((x) => x.entity!.id).sort()).toEqual(["h1", "h2"]);
    expect(sr.find((x) => x.entity!.id === "h1")!.primaryQuery).toBe("comprar plantas em Santa Rita PB");
    expect(r.stats.unclassified).toEqual([]);
  });
  it("determinístico: mesma entrada, mesma saída; independe da ordem das entidades e das evidências", async () => {
    const ev = [await realIndicator()];
    const a = buildOpportunities(input({ evidence: ev }));
    const b = buildOpportunities(input({ entities: [...ENTITIES].reverse(), evidence: [...ev].reverse() }));
    expect(b.drafts.map((x) => [x.clusterKey, x.inputsHash])).toEqual(a.drafts.map((x) => [x.clusterKey, x.inputsHash]));
  });
});

describe("dimensões: só o que se sabe; o resto é 'unknown' com o que falta (critério 4)", () => {
  const { drafts } = buildOpportunities(input());
  const buy = drafts.find((x) => x.clusterKey === "buy-plants:transactional:city:c2")!;
  it("demanda, pipeline, ganho de informação, citação, SERP, autoridade e concorrência: desconhecidos, sem número", () => {
    for (const k of ["demand", "pipeline_potential", "information_gain", "citation_potential", "serp_opportunity", "authority_gap", "competition"] as const) {
      expect(buy.dimensions[k], k).toMatchObject({ value: null, basis: "unknown" });
      expect(buy.dimensions[k].note, k).toContain("sem dado");
    }
    for (const d of DIMENSIONS) expect(buy.dimensions[d].value === 0 && buy.dimensions[d].basis === "unknown", d).toBe(false); // nenhum zero disfarçando "não sei"
  });
  it("derivadas da vertical e dos dados: valor, intenção, estágio, conversão e aderência", () => {
    expect(buy.dimensions.intent).toMatchObject({ value: 1, basis: "derived" });
    expect(buy.dimensions.buyer_stage.value).toBe(1);
    expect(buy.dimensions.business_value.value).toBe(1); // valor "high"
    expect(buy.dimensions.conversion_proximity.value).toBeCloseTo(0.9, 9);
    expect(buy.dimensions.solution_fit.value).toBe(0.5); // experiência "directory" planejada
    expect(buy.dimensions.intent.note).toContain("peso definido pela vertical, não medido");
  });
  it("evidência: o estoque não existe como fonte, então 1 de 2 requisitos e risco crítico (0,9)", () => {
    expect(buy.dimensions.evidence_availability.value).toBe(0.5);
    expect(buy.dimensions.evidence_availability.note).toContain("faltam: Estoque da loja");
    expect(buy.dimensions.evidence_risk.value).toBe(0.9);
    const guide = drafts.find((x) => x.pattern.key === "fern-care")!;
    expect(guide.dimensions.evidence_risk.value).toBe(0.1); // só exige conteúdo editorial, atendido pelos dados do tenant
  });
  it("canibalização: página existente que atende a experiência = risco alto; sem página = baixo e incerto; páginas desconhecidas = unknown", () => {
    const withPage = buildOpportunities(input({ pages: [{ entityId: "c2", templateKey: "city-overview" }] })).drafts.find((x) => x.clusterKey === "buy-plants:transactional:city:c2")!;
    expect(withPage.dimensions.cannibalization_risk).toMatchObject({ value: 0.85 });
    expect(withPage.dimensions.cannibalization_risk.note).toContain("já existe uma página gerada para São Paulo");
    expect(buy.dimensions.cannibalization_risk).toMatchObject({ value: 0.1, uncertainty: 0.5 });
    expect(buy.dimensions.cannibalization_risk.note).toContain("páginas externas do site não foram analisadas");
    const unknownPages = buildOpportunities(input({ pages: null })).drafts[0]!;
    expect(unknownPages.dimensions.cannibalization_risk).toMatchObject({ value: null, basis: "unknown" });
    const otherEntity = buildOpportunities(input({ pages: [{ entityId: "c1", templateKey: "city-overview" }] })).drafts.find((x) => x.clusterKey === "buy-plants:transactional:city:c2")!;
    expect(otherEntity.dimensions.cannibalization_risk.value).toBe(0.1); // a página é de OUTRA cidade
  });
});

describe("score do pipeline: prioridade parcial honesta e elegibilidade", () => {
  const { drafts } = buildOpportunities(input());
  it("sem demanda nem SERP: prioridade PARCIAL (nunca geral), descoberta desconhecida, explicações presentes", () => {
    for (const d of drafts) { expect(d.score.priority.kind, d.clusterKey).toBe("partial"); expect(d.score.objectives.discovery_opportunity.adjusted).toBeNull(); expect(d.score.explanations.length).toBeGreaterThan(3); expect(d.score.missing.length).toBeGreaterThan(5); }
  });
  it("risco de evidência crítico (estoque inexistente) derruba a viabilidade e bloqueia a elegibilidade, mesmo com alto valor comercial", () => {
    const buy = drafts.find((x) => x.clusterKey === "buy-plants:transactional:city:c2")!;
    expect(buy.score.eligibility.eligible).toBe(false);
    expect(buy.score.eligibility.checks.find((c) => c.code === "evidence_risk_max")!.ok).toBe(false);
    expect(buy.score.penalties.some((p) => p.kind === "risk" && p.dimension === "evidence_risk")).toBe(true);
    expect(buy.score.objectives.commercial_value.adjusted!).toBeGreaterThan(60);
  });
  it("um tema que só exige dados que existem é elegível (guia informativo), apesar do valor comercial menor", () => {
    const guide = drafts.find((x) => x.pattern.key === "fern-care")!;
    expect(guide.score.eligibility.checks.find((c) => c.code === "evidence_risk_max")!.ok).toBe(true);
    expect(guide.score.objectives.commercial_value.adjusted!).toBeLessThan(drafts.find((x) => x.pattern.key === "buy-plants")!.score.objectives.commercial_value.adjusted!);
  });
  it("usar outra configuração muda o resultado e o hash das entradas", () => {
    const heavier = { ...TEST_CONFIG, uncertaintyFactor: 0.9 };
    const other = buildOpportunities(input({ config: heavier })).drafts[0]!;
    expect(other.score.configHash).not.toBe(drafts[0]!.score.configHash);
    expect(other.inputsHash).not.toBe(drafts[0]!.inputsHash);
  });
});

describe("sinais: evidência real ligada a grupos de padrões, com a razão", () => {
  it("o indicador (BCB) liga-se aos grupos do tema; a tendência vem dele; grupos sem ligação não recebem nada", async () => {
    const ev = await realIndicator();
    const { drafts, stats } = buildOpportunities(input({ evidence: [ev] }));
    const buy = drafts.find((x) => x.clusterKey === "buy-plants:transactional:city:c2")!;
    const link = buy.links.find((l) => l.evidenceKey === "ev-selic" && l.role === "signal")!;
    expect(link).toMatchObject({ topic: "plant_trends" });
    expect(link.reason).toContain("o indicador bcb-sgs:432 pertence ao tema");
    expect(buy.trend[0]).toMatchObject({ evidenceKey: "ev-selic", topic: "plant_trends" });
    expect(buy.trend[0]!.note).toContain("Meta Selic");
    expect(drafts.find((x) => x.pattern.key === "compare-stores")!.links).toEqual([]);
    expect(stats.signalLinks).toBeGreaterThan(0);
  });
  it("notícia liga-se por palavra-chave, com o trecho que casou, e NÃO gera tendência (notícia não tem direção)", () => {
    const news: EvidenceInput = { key: "ev-news", draft: { adapter: "rss-news", kind: "news_item", sourceRef: "rss-news:f:1", url: "https://a.gov.br/1", title: "Procura por samambaia cresce em feiras", summary: "Jardim e plantas em alta.", publishedAt: NOW, collectedAt: NOW, validUntil: new Date(NOW.getTime() + 86_400_000), basis: "observed", payload: {}, topics: [], limitations: [] } };
    const { drafts } = buildOpportunities(input({ evidence: [news] }));
    const guide = drafts.find((x) => x.pattern.key === "fern-care")!;
    expect(guide.links[0]).toMatchObject({ evidenceKey: "ev-news", role: "signal", topic: "plant_trends" });
    expect(guide.links[0]!.reason).toMatch(/o texto cita "planta"|o texto cita .*samambaia/);
    expect(guide.trend).toEqual([]);
  });
  it("evidência VENCIDA é ignorada (e contada), nunca sustenta um sinal", async () => {
    const ev = await realIndicator();
    const stale = { ...ev, draft: { ...ev.draft, validUntil: new Date(NOW.getTime() - 1) } };
    const { drafts, stats } = buildOpportunities(input({ evidence: [stale] }));
    expect(stats.staleEvidence).toBe(1);
    expect(drafts.every((d) => d.links.length === 0)).toBe(true);
  });
});

describe("hash das entradas: identifica o cálculo (idempotência)", () => {
  it("muda com qualquer dimensão, com o estratégico, com a configuração e com os vínculos; não muda com a ordem", () => {
    const d = buildOpportunities(input()).drafts[0]!;
    const base = hashInputs(d.dimensions, d.strategic, TEST_CONFIG, ["a", "b"]);
    expect(hashInputs(d.dimensions, d.strategic, TEST_CONFIG, ["a", "b"])).toBe(base);
    expect(hashInputs(d.dimensions, !d.strategic, TEST_CONFIG, ["a", "b"])).not.toBe(base);
    expect(hashInputs(d.dimensions, d.strategic, { ...TEST_CONFIG, uncertaintyFactor: 0.1 }, ["a", "b"])).not.toBe(base);
    expect(hashInputs(d.dimensions, d.strategic, TEST_CONFIG, ["a"])).not.toBe(base);
    expect(hashInputs({ ...d.dimensions, intent: { ...d.dimensions.intent, value: 0.123 } }, d.strategic, TEST_CONFIG, ["a", "b"])).not.toBe(base);
  });
});
