import { describe, expect, it } from "vitest";
import { evidenceHash } from "./evidence";
import { SourceError } from "./http";
import { bcbSgsAdapter, brToday, indicatorEvidence, parseSgs } from "./adapters/bcb-sgs";
import { MAX_AGE_DAYS as IBGE_MAX, ibgeNewsAdapter, parseIbge, parseIbgeDate } from "./adapters/ibge-news";
import { parseRss, rssNewsAdapter } from "./adapters/rss-news";
import type { AdapterContext } from "./adapters/types";
import { fakeFetch, fixture, type Route } from "./test-support/fake-fetch";
import { TEST_VERTICAL } from "./test-support/vertical.fixture";

// Entradas: respostas REAIS capturadas (ver __fixtures__/README.md). As falhas (timeout, 5xx, robots) são forçadas por um fetch falso.
const NOW = new Date("2026-10-13T20:00:00Z");
const UA = "plataforma-test/1";
const vertical = (over: Partial<typeof TEST_VERTICAL> = {}) => ({ ...TEST_VERTICAL, relevanceKeywords: ["ipca", "inflacao", "bancos", "pib"], ...over });
const ctx = (f: ReturnType<typeof fakeFetch>, v = vertical(), sleeps: number[] = []): AdapterContext => ({ fetch: f, now: NOW, userAgent: UA, vertical: v, sleep: async (ms) => { sleeps.push(ms); }, robots: new Map() });

describe("BCB SGS: indicador com proveniência", () => {
  const SERIES = [{ id: 432, label: "Meta Selic (Copom)", unit: "% a.a.", frequency: "daily" as const, topic: "plant_trends" }, { id: 13522, label: "IPCA em 12 meses", unit: "%", frequency: "monthly" as const, topic: "plant_trends" }];
  const routes: Record<string, Route> = { "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/": { body: fixture("bcb-432.json") }, "https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/": { body: fixture("bcb-13522.json") } };
  const run = (r = routes, series = SERIES) => bcbSgsAdapter.run(ctx(fakeFetch(r), vertical({ sources: { ...TEST_VERTICAL.sources, bcbSeries: series } })));
  it("falha transitória (503) é repetida UMA vez após pausa; falha permanente (400) não é repetida", async () => {
    let n = 0;
    const base = fakeFetch(routes);
    const flaky: typeof base = async (url, init) => (url.includes("sgs.432") && n++ === 0 ? fakeFetch({ [url]: { status: 503 } })(url, init) : base(url, init));
    const sleeps: number[] = [];
    const r = await bcbSgsAdapter.run(ctx(flaky, vertical({ sources: { ...TEST_VERTICAL.sources, bcbSeries: SERIES } }), sleeps));
    expect(r).toMatchObject({ status: "succeeded", requests: 3 });
    expect(sleeps).toEqual([1000]);
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const perm = await bcbSgsAdapter.run(ctx(fakeFetch({ ...routes, "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/": { status: 400 } }, calls), vertical({ sources: { ...TEST_VERTICAL.sources, bcbSeries: SERIES } })));
    expect(perm.status).toBe("partial");
    expect(calls.filter((c) => c.url.includes("sgs.432"))).toHaveLength(1);
  });
  it("cada série vira UM registro, com fonte, URL exata, datas, base 'provider_metric' e limitações", async () => {
    const r = await run();
    expect(r.status).toBe("succeeded");
    expect(r.evidence).toHaveLength(2);
    const selic = r.evidence.find((e) => e.sourceRef === "bcb-sgs:432")!;
    expect(selic).toMatchObject({ adapter: "bcb-sgs", kind: "indicator", basis: "provider_metric", topics: ["plant_trends"] });
    expect(selic.url).toMatch(/^https:\/\/api\.bcb\.gov\.br\/dados\/serie\/bcdata\.sgs\.432\/dados\?formato=json&dataInicial=\d{2}\/\d{2}\/\d{4}&dataFinal=13\/10\/2026$/);
    expect(selic.collectedAt).toEqual(NOW);
    expect(selic.validUntil!.getTime()).toBeGreaterThan(NOW.getTime());
    expect(selic.title).toMatch(/^Meta Selic \(Copom\): \d+,\d{2} % a\.a\. \(\d{2}\/\d{2}\/2026\)$/);
    expect(selic.limitations.join(" ")).toContain("não mede demanda de busca");
    expect(r.requests).toBe(2);
  });
  it("datas FUTURAS que a série devolve são descartadas e contadas; o 'último valor' nunca é de uma data futura", async () => {
    const parsed = parseSgs(JSON.parse(fixture("bcb-432.json")), brToday(NOW));
    expect(parsed.future).toBeGreaterThan(0);
    expect(Math.max(...parsed.points.map((p) => p.time))).toBeLessThanOrEqual(brToday(NOW).getTime());
    const selic = (await run()).evidence.find((e) => e.sourceRef === "bcb-sgs:432")!;
    expect(selic.limitations.join(" ")).toMatch(/\d+ ponto\(s\) com data futura foram descartados/);
    expect((selic.payload.latest as { date: string }).date <= "2026-10-13").toBe(true);
  });
  it("com a janela CURTA da fixture não há ponto de 90 dias: a direção é 'unknown' (nunca inventada), dita no resumo", async () => {
    const e = (await run()).evidence.find((x) => x.sourceRef === "bcb-sgs:432")!;
    expect(e.payload).toMatchObject({ reference: null, delta: null, direction: "unknown" });
    expect(e.summary).toContain("sem ponto de comparação");
  });
  it("com histórico suficiente a variação é DERIVADA (valor mais recente menos o de 90 dias antes), com método descrito e direção coerente", () => {
    const day = (n: number) => Date.UTC(2026, 0, 1) + n * 86_400_000;
    const points = Array.from({ length: 200 }, (_, i) => ({ date: new Date(day(i)).toISOString().slice(0, 10), time: day(i), value: i < 120 ? 14.25 : 13.75 }));
    const e = indicatorEvidence(SERIES[0]!, points, "https://x.gov.br/a", NOW, { invalid: 0, future: 0 })!;
    const p = e.payload as { latest: { value: number }; reference: { date: string; value: number }; delta: number; direction: string; lastChange: { date: string; from: number; to: number } };
    expect(p.reference.value).toBe(14.25);
    expect(p.delta).toBeCloseTo(-0.5, 6);
    expect(p.direction).toBe("down");
    expect(p.lastChange).toEqual({ date: new Date(day(120)).toISOString().slice(0, 10), from: 14.25, to: 13.75 });
    expect(e.summary).toContain("queda de 0,50 em relação a 90 dias");
    expect(e.limitations.join(" ")).toContain("Variação calculada pelo sistema");
    const flat = indicatorEvidence(SERIES[0]!, points.map((x) => ({ ...x, value: 10 })), "https://x.gov.br/a", NOW, { invalid: 0, future: 0 })!;
    expect(flat.payload.direction).toBe("stable");
    expect(flat.payload.lastChange).toBeNull();
  });
  it("mensal: compara com o mês anterior (IPCA 12 meses subiu de 4,22 para 4,58)", async () => {
    const e = (await run()).evidence.find((x) => x.sourceRef === "bcb-sgs:13522")!;
    expect(e.payload).toMatchObject({ latest: { date: "2026-09-01", value: 4.58 }, reference: { date: "2026-08-01", value: 4.22 }, direction: "up" });
    expect(e.summary).toContain("alta de 0,36");
  });
  it("função pura: série sem pontos não vira registro; uma só observação fica 'sem ponto de comparação'", () => {
    const cfg = SERIES[1]!;
    expect(indicatorEvidence(cfg, [], "https://x.gov.br/a", NOW, { invalid: 0, future: 0 })).toBeNull();
    const one = indicatorEvidence(cfg, [{ date: "2026-09-01", time: Date.UTC(2026, 8, 1), value: 4.5 }], "https://x.gov.br/a", NOW, { invalid: 0, future: 0 })!;
    expect(one.payload.direction).toBe("unknown");
    expect(one.summary).toContain("sem ponto de comparação");
  });
  it("linhas malformadas são descartadas e contadas; só lixo = erro de parse", async () => {
    const bad = JSON.stringify([{ data: "01/08/2026", valor: "4.22" }, { data: "xx", valor: "1" }, { data: "01/09/2026", valor: "abc" }, null, { data: "01/09/2026", valor: "4.58" }]);
    const r = await run({ ...routes, "https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/": { body: bad } }, [SERIES[1]!]);
    expect(r.status).toBe("succeeded");
    expect(r.evidence[0]!.limitations.join(" ")).toContain("3 linha(s) malformada(s)");
    const junk = await run({ ...routes, "https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/": { body: JSON.stringify([{ nada: 1 }]) } }, [SERIES[1]!]);
    expect(junk).toMatchObject({ status: "failed", evidence: [] });
    expect(junk.errors[0]).toMatchObject({ code: "parse", retryable: false });
  });
  it("falha de uma série não derruba as outras: 'partial', com o erro explicado e repetível quando cabe", async () => {
    const r = await run({ ...routes, "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/": { status: 503 } });
    expect(r.status).toBe("partial");
    expect(r.evidence.map((e) => e.sourceRef)).toEqual(["bcb-sgs:13522"]);
    expect(r.errors).toEqual([{ target: "sgs.432", code: "http", message: "HTTP 503", retryable: true }]);
  });
  it("tudo falhando: 'failed' (nunca registro inventado); JSON inválido é erro de parse", async () => {
    const r = await run({ "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/": { throws: new Error("x") }, "https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/": { body: "<html>erro</html>" } });
    expect(r).toMatchObject({ status: "failed", evidence: [] });
    expect(r.errors.map((e) => e.code).sort()).toEqual(["network", "parse"]);
  });
  it("repetir a coleta do mesmo conteúdo dá o MESMO hash (idempotência); outro valor, outro hash", async () => {
    const a = (await run()).evidence[0]!, b = (await run()).evidence[0]!;
    expect(evidenceHash(a)).toBe(evidenceHash(b));
    const changed = { ...a, payload: { ...a.payload, latest: { date: "2026-10-14", value: 9.9 } } };
    expect(evidenceHash(changed)).not.toBe(evidenceHash(a));
    for (const [k, v] of [["url", "https://exemplo.gov.br/outra"], ["title", "outro título"], ["sourceRef", "x:1"], ["summary", "outro"]] as const) expect(evidenceHash({ ...a, [k]: v } as typeof a), k).not.toBe(evidenceHash(a));
    expect(evidenceHash({ ...a, collectedAt: new Date("2030-01-01") } as typeof a)).toBe(evidenceHash(a)); // o momento da coleta não entra no hash
  });
  it("sem séries configuradas: 'skipped'", async () => expect((await run(routes, [])).status).toBe("skipped"));
});

describe("IBGE: notícias oficiais", () => {
  const ROUTE = { "https://servicodados.ibge.gov.br/api/v3/noticias/": { body: fixture("ibge-news.json") } };
  const v = (terms: string[] = ["habitação"], kw = ["ipca"]) => vertical({ relevanceKeywords: kw, sources: { ...TEST_VERTICAL.sources, ibgeSearchTerms: terms } });
  it("cada notícia relevante vira um registro com URL oficial, título, trecho, data (UTC-3) e base 'observed'", async () => {
    const r = await ibgeNewsAdapter.run(ctx(fakeFetch(ROUTE), v()));
    expect(r.status).toBe("succeeded");
    expect(r.evidence.map((e) => e.sourceRef)).toEqual(["ibge-news:48246", "ibge-news:48134", "ibge-news:48015"]); // a do Censo não casa com a palavra-chave
    const e = r.evidence[0]!;
    expect(e).toMatchObject({ adapter: "ibge-news", kind: "news_item", basis: "observed", title: "IPCA fica em 0,82% em setembro" });
    expect(e.url).toMatch(/^https?:\/\/agenciadenoticias\.ibge\.gov\.br\//);
    expect(e.publishedAt!.toISOString()).toBe("2026-10-09T12:00:00.000Z"); // 09:00 em Brasília
    expect(e.summary!.length).toBeLessThanOrEqual(280);
    expect(e.limitations[0]).toContain("não demanda de busca");
    expect(r.limitations.join(" ")).toContain("sem relação com as palavras-chave");
  });
  it("sem a palavra-chave nenhuma notícia é guardada (relevância é da vertical, não do provedor)", async () => {
    const r = await ibgeNewsAdapter.run(ctx(fakeFetch(ROUTE), v(["habitação"], ["jardim"])));
    expect(r).toMatchObject({ status: "succeeded", evidence: [], seen: 4 });
  });
  it("notícias velhas (mais de 180 dias) são ignoradas e contadas", async () => {
    const late = { ...ctx(fakeFetch(ROUTE), v()), now: new Date(new Date("2026-10-09T12:00:00Z").getTime() + (IBGE_MAX + 1) * 86_400_000) };
    const r = await ibgeNewsAdapter.run(late);
    expect(r.evidence).toEqual([]);
    expect(r.limitations.join(" ")).toContain("com mais de 180 dias");
  });
  it("o mesmo item achado por dois termos vira UM registro, com os dois termos na proveniência; há pausa entre os termos", async () => {
    const sleeps: number[] = [];
    const r = await ibgeNewsAdapter.run(ctx(fakeFetch(ROUTE), v(["habitação", "inflação"]), sleeps));
    expect(r.evidence).toHaveLength(3);
    expect((r.evidence[0]!.payload.matchedTerms as string[])).toEqual(["habitação", "inflação"]);
    expect(sleeps).toEqual([300]);
    expect(r.requests).toBe(2);
  });
  it("um termo falha e o outro funciona: 'partial'", async () => {
    const f = fakeFetch({ "https://servicodados.ibge.gov.br/api/v3/noticias/?busca=habita%C3%A7%C3%A3o": { status: 500 }, "https://servicodados.ibge.gov.br/api/v3/noticias/?busca=infla%C3%A7%C3%A3o": { body: fixture("ibge-news.json") } });
    const r = await ibgeNewsAdapter.run(ctx(f, v(["habitação", "inflação"])));
    expect(r.status).toBe("partial");
    expect(r.errors[0]).toMatchObject({ target: "busca:habitação", code: "http", retryable: true });
    expect(r.evidence).toHaveLength(3);
  });
  it("parse: data malformada e item sem título/link são descartados; formato inesperado é erro", () => {
    expect(parseIbgeDate("09/10/2026 09:00:00")!.toISOString()).toBe("2026-10-09T12:00:00.000Z");
    for (const s of ["", "2026-10-09", "09/10/2026", "32/13/2026 99:99:99"]) expect(parseIbgeDate(s), s).toBeNull();
    const { items, invalid } = parseIbge({ items: [{ id: 1, titulo: "x", link: "https://a.gov.br/1", data_publicacao: "09/10/2026 09:00:00" }, { id: 2 }, null, { id: 3, titulo: "", link: "https://a", data_publicacao: "x" }] });
    expect(items).toHaveLength(1);
    expect(invalid).toBe(3);
    expect(() => parseIbge({ naoItems: [] })).toThrow(SourceError);
    expect(() => parseIbge(null)).toThrow(SourceError);
  });
});

describe("RSS público: robots, atraso e trecho curto", () => {
  const FEED = "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml";
  const ok = { "https://agenciabrasil.ebc.com.br/robots.txt": { body: fixture("agenciabrasil-robots.txt") }, [FEED]: { body: fixture("agenciabrasil-economia.xml") } };
  it("respeita o Crawl-delay do robots (espera 10 s antes do feed) e guarda só itens relevantes, com atribuição", async () => {
    const sleeps: number[] = [];
    const r = await rssNewsAdapter.run(ctx(fakeFetch(ok), vertical(), sleeps));
    expect(r.status).toBe("succeeded");
    expect(sleeps).toEqual([10_000]);
    expect(r.requests).toBe(2);
    const titles = r.evidence.map((e) => e.title);
    for (const t of ["Dinheiro esquecido em bancos", "FMI prevê crescimento", "Mercado eleva previsão da inflação"]) expect(titles.some((x) => x.startsWith(t)), t).toBe(true); // o título real pode ter espaços especiais
    expect(titles.some((t) => t.includes("golpes telefônicos"))).toBe(false); // sem palavra-chave no título nem no resumo
    expect(titles.some((t) => t.includes("MEIs"))).toBe(false);
    expect(r.limitations.join(" ")).toMatch(/2 item\(ns\) sem relação com as palavras-chave/);
    const e = r.evidence[0]!;
    expect(e).toMatchObject({ adapter: "rss-news", kind: "news_item", basis: "observed" });
    expect(e.url).toMatch(/^https:\/\/agenciabrasil\.ebc\.com\.br\/economia\/noticia\//);
    expect(e.publishedAt!.toISOString()).toBe("2026-10-13T20:03:00.000Z");
    expect(e.payload.attribution).toContain("Agência Brasil");
    expect(e.summary!.length).toBeLessThanOrEqual(280);
    expect(e.summary).not.toMatch(/<|&lt;|&amp;lt;/); // HTML escapado dentro do XML foi decodificado e a marcação removida
    expect(e.limitations.join(" ")).toContain("texto integral não é guardado");
  });
  it("robots que proíbe o caminho: NENHUMA requisição ao feed, status 'skipped' com o motivo", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const r = await rssNewsAdapter.run(ctx(fakeFetch({ "https://agenciabrasil.ebc.com.br/robots.txt": { body: "User-agent: *\nDisallow: /rss/" }, [FEED]: { body: fixture("agenciabrasil-economia.xml") } }, calls)));
    expect(r.status).toBe("skipped");
    expect(r.errors[0]).toMatchObject({ code: "robots_denied" });
    expect(calls.map((c) => c.url)).toEqual(["https://agenciabrasil.ebc.com.br/robots.txt"]);
  });
  it("robots indisponível (5xx): não coleta e o erro é repetível", async () => {
    const r = await rssNewsAdapter.run(ctx(fakeFetch({ "https://agenciabrasil.ebc.com.br/robots.txt": { status: 503 }, [FEED]: { body: "x" } })));
    expect(r.errors[0]).toMatchObject({ code: "robots_unavailable", retryable: true });
    expect(r.evidence).toEqual([]);
  });
  it("feed com defeito: erro de parse (não é RSS); itens velhos são ignorados e contados", async () => {
    const bad = await rssNewsAdapter.run(ctx(fakeFetch({ ...ok, [FEED]: { body: "<html><body>erro</body></html>" } })));
    expect(bad).toMatchObject({ status: "failed" });
    expect(bad.errors[0]).toMatchObject({ code: "parse" });
    const old = await rssNewsAdapter.run({ ...ctx(fakeFetch(ok)), now: new Date("2026-12-31T00:00:00Z") });
    expect(old.evidence).toEqual([]);
    expect(old.limitations.join(" ")).toContain("com mais de 30 dias");
  });
  it("parseRss: CDATA, entidades e item sem título/link", () => {
    const xml = `<rss><channel><item><title><![CDATA[Juros & crédito]]></title><link>https://a.gov.br/1</link><guid>g1</guid><description>&lt;p&gt;Texto &amp;amp; mais&lt;/p&gt;</description><category>Economia</category><category>Crédito</category></item><item><title>Sem link</title></item></channel></rss>`;
    const { items, invalid } = parseRss(xml);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Juros & crédito", link: "https://a.gov.br/1", guid: "g1", categories: ["Economia", "Crédito"] });
    expect(invalid).toBe(1);
    expect(() => parseRss("não é xml")).toThrow(SourceError);
  });
});
