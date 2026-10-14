import { describe, expect, it } from "vitest";
import { checkRobots, crawlDelayOf, isAllowed, parseRobots } from "./robots";
import { fakeFetch, fixture } from "./test-support/fake-fetch";

const UA = "plataforma-research/0.1";
const R = (s: string) => parseRobots(s);

describe("robots.txt (RFC 9309)", () => {
  it("o robots.txt REAL da Agência Brasil: grupo '*', Crawl-delay 10, o caminho do feed é permitido e áreas proibidas não", () => {
    const r = R(fixture("agenciabrasil-robots.txt"));
    expect(crawlDelayOf(r, UA)).toBe(10);
    expect(isAllowed(r, UA, "/rss/economia/feed.xml")).toBe(true);
    expect(isAllowed(r, UA, "/includes/x.php")).toBe(false);
    expect(isAllowed(r, UA, "/profiles/x")).toBe(false);
  });
  it("a regra mais longa vence; Allow vence empate; Disallow vazio libera tudo", () => {
    const r = R("User-agent: *\nDisallow: /a\nAllow: /a/b\nDisallow: /a/b/c\nAllow: /x\nDisallow: /x");
    expect(isAllowed(r, UA, "/a/z")).toBe(false);
    expect(isAllowed(r, UA, "/a/b/z")).toBe(true);
    expect(isAllowed(r, UA, "/a/b/c/d")).toBe(false);
    expect(isAllowed(r, UA, "/x")).toBe(true); // empate: Allow vence
    expect(isAllowed(R("User-agent: *\nDisallow:"), UA, "/qualquer")).toBe(true);
  });
  it("curinga e fim de caminho: * e $", () => {
    const r = R("User-agent: *\nDisallow: /*.pdf$\nDisallow: /privado*/dados");
    expect(isAllowed(r, UA, "/docs/a.pdf")).toBe(false);
    expect(isAllowed(r, UA, "/docs/a.pdf?x=1")).toBe(true); // $ ancora no fim
    expect(isAllowed(r, UA, "/privado-1/dados")).toBe(false);
    expect(isAllowed(r, UA, "/publico/dados")).toBe(true);
  });
  it("o grupo do nosso agente tem precedência sobre '*'; vários User-agent seguidos formam um grupo; comentários e linhas em branco são ignorados", () => {
    const r = R("# comentário\nUser-agent: outro\nUser-agent: plataforma-research\nDisallow: /tudo\n\nUser-agent: *\nDisallow:\nCrawl-delay: 3");
    expect(isAllowed(r, UA, "/tudo")).toBe(false);
    expect(isAllowed(r, "navegador/1", "/tudo")).toBe(true);
    expect(crawlDelayOf(r, "navegador/1")).toBe(3);
  });
  it("sem nenhum grupo aplicável, tudo é permitido; texto vazio ou lixo não lança", () => {
    expect(isAllowed(R(""), UA, "/x")).toBe(true);
    expect(isAllowed(R("lixo sem dois pontos\n???"), UA, "/x")).toBe(true);
    expect(isAllowed(R("User-agent: bot-alheio\nDisallow: /"), UA, "/x")).toBe(true);
  });
});

describe("checkRobots: o host decide, e indisponível = não coletar", () => {
  const FEED = "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml";
  it("permitido pelo robots real, com o atraso declarado", async () => {
    const r = await checkRobots(fakeFetch({ "https://agenciabrasil.ebc.com.br/robots.txt": { body: fixture("agenciabrasil-robots.txt") } }), FEED, UA);
    expect(r).toMatchObject({ allowed: true, crawlDelaySeconds: 10 });
  });
  it("caminho proibido: não permitido, com o motivo", async () => {
    const r = await checkRobots(fakeFetch({ "https://h.gov.br/robots.txt": { body: "User-agent: *\nDisallow: /feed" } }), "https://h.gov.br/feed/x.xml", UA);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("proíbe /feed/x.xml");
  });
  it("404: sem restrições; 5xx, timeout e falha de rede: NÃO permitido (RFC 9309)", async () => {
    expect((await checkRobots(fakeFetch({ "https://h.gov.br/robots.txt": { status: 404 } }), "https://h.gov.br/f", UA)).allowed).toBe(true);
    expect((await checkRobots(fakeFetch({ "https://h.gov.br/robots.txt": { status: 503 } }), "https://h.gov.br/f", UA)).allowed).toBe(false);
    expect((await checkRobots(fakeFetch({ "https://h.gov.br/robots.txt": { throws: new Error("x") } }), "https://h.gov.br/f", UA)).allowed).toBe(false);
    const r = await checkRobots(fakeFetch({ "https://h.gov.br/robots.txt": { status: 500 } }), "https://h.gov.br/f", UA);
    expect(r.reason).toContain("robots.txt indisponível");
  });
  it("o robots.txt é buscado UMA vez por host na execução (cache)", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const f = fakeFetch({ "https://h.gov.br/robots.txt": { body: "User-agent: *\nDisallow:" } }, calls);
    const cache = new Map();
    await checkRobots(f, "https://h.gov.br/a", UA, cache);
    await checkRobots(f, "https://h.gov.br/b", UA, cache);
    expect(calls).toHaveLength(1);
  });
});
