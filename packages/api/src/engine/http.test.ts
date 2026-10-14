import { describe, expect, it } from "vitest";
import { SourceError, checkPublicUrl, httpGet } from "./http";
import { fakeFetch } from "./test-support/fake-fetch";

const UA = "plataforma-test/1";
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as SourceError; } throw new Error("não falhou"); };

describe("URLs: só HTTPS público", () => {
  it("aceita HTTPS de host público", () => expect(checkPublicUrl("https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados?formato=json").hostname).toBe("api.bcb.gov.br"));
  it("recusa http, localhost, IPs privados e de loopback, hosts internos, credenciais embutidas e porta não padrão", () => {
    for (const u of ["http://api.bcb.gov.br/x", "https://localhost/x", "https://foo.localhost/x", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://192.168.1.1/x", "https://172.16.0.1/x", "https://169.254.169.254/latest/meta-data", "https://[::1]/x", "https://servidor/x", "https://svc.internal/x", "https://a.local/x", "https://user:senha@api.bcb.gov.br/x", "https://api.bcb.gov.br:8443/x", "ftp://api.bcb.gov.br/x", "não é url", "file:///etc/passwd", "javascript:alert(1)"]) expect(() => checkPublicUrl(u), u).toThrow(SourceError);
    expect(() => checkPublicUrl("https://8.8.8.8/x")).toThrow(/IP literal/); // mesmo um IP público: as fontes sempre usam nome de host
  });
});

describe("httpGet: tempo, tamanho, erros e identificação", () => {
  it("devolve o texto e envia o User-Agent identificado", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const r = await httpGet(fakeFetch({ "https://api.bcb.gov.br/": { body: '[{"a":1}]', headers: { "content-type": "application/json" } } }, calls), "https://api.bcb.gov.br/x", { userAgent: UA });
    expect(r).toMatchObject({ status: 200, text: '[{"a":1}]', contentType: "application/json", bytes: 9 });
    expect(calls[0]!.headers["User-Agent"]).toBe(UA);
  });
  it("HTTP de erro vira SourceError: 429 e 5xx são repetíveis; 404 não", async () => {
    for (const [status, retryable] of [[429, true], [500, true], [503, true], [404, false], [403, false]] as const) {
      const e = await fails(httpGet(fakeFetch({ "https://x.gov.br/": { status } }), "https://x.gov.br/a", { userAgent: UA }));
      expect(e).toMatchObject({ code: "http", status, retryable });
    }
  });
  it("sem resposta no prazo: timeout repetível", async () => {
    const e = await fails(httpGet(fakeFetch({ "https://x.gov.br/": { hang: true } }), "https://x.gov.br/a", { userAgent: UA, timeoutMs: 30 }));
    expect(e).toMatchObject({ code: "timeout", retryable: true });
  });
  it("falha de rede vira erro de rede repetível, sem vazar a mensagem original", async () => {
    const e = await fails(httpGet(fakeFetch({ "https://x.gov.br/": { throws: new Error("connect ECONNREFUSED 10.0.0.1:443 token=SEGREDO") } }), "https://x.gov.br/a", { userAgent: UA }));
    expect(e).toMatchObject({ code: "network", retryable: true });
    expect(e.message).not.toContain("SEGREDO");
  });
  it("resposta grande demais: recusada pelo cabeçalho, pelo texto e pelo fluxo", async () => {
    const big = "x".repeat(5000);
    expect((await fails(httpGet(fakeFetch({ "https://x.gov.br/": { body: "x", headers: { "content-length": "999999" } } }), "https://x.gov.br/a", { userAgent: UA, maxBytes: 1000 }))).code).toBe("too_large");
    expect((await fails(httpGet(fakeFetch({ "https://x.gov.br/": { body: big } }), "https://x.gov.br/a", { userAgent: UA, maxBytes: 1000 }))).code).toBe("too_large");
    expect((await fails(httpGet(fakeFetch({ "https://x.gov.br/": { body: big, stream: true } }), "https://x.gov.br/a", { userAgent: UA, maxBytes: 1000 }))).code).toBe("too_large");
    expect((await httpGet(fakeFetch({ "https://x.gov.br/": { body: big, stream: true } }), "https://x.gov.br/a", { userAgent: UA, maxBytes: 10_000 })).bytes).toBe(5000);
  });
  it("URL insegura é recusada ANTES de qualquer requisição", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    await fails(httpGet(fakeFetch({}, calls), "http://127.0.0.1/x", { userAgent: UA }));
    expect(calls).toEqual([]);
  });
});

describe("mensagens de recusa distinguem o motivo (a defesa em camadas não é uma só)", () => {
  it("loopback, rede privada e host local têm motivos próprios", () => {
    expect(() => checkPublicUrl("https://127.0.0.1/")).toThrow(/privada/);
    expect(() => checkPublicUrl("https://10.1.2.3/")).toThrow(/privada/);
    expect(() => checkPublicUrl("https://localhost/")).toThrow(/local ou interno/);
    expect(() => checkPublicUrl("https://intranet/")).toThrow(/local ou interno/);
    expect(() => checkPublicUrl("https://8.8.8.8/")).toThrow(/IP literal/);
  });
});
