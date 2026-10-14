import { createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GSC_SCOPE, buildServiceJwt, gscBody, normalizePrivateKey, ownPagesForQuery, parseGsc } from "./gsc";

const fx = (n: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`./__fixtures__/${n}`, import.meta.url)), "utf8"));
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

describe("JWT da conta de serviço (chave de teste gerada na hora)", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  it("é RS256, com o escopo SOMENTE LEITURA, audiência do token e validade de 1 h, e a assinatura confere", () => {
    const jwt = buildServiceJwt("conta@projeto.iam.gserviceaccount.com", privateKey, now);
    const [h, c, s] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claim = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claim).toMatchObject({ iss: "conta@projeto.iam.gserviceaccount.com", scope: GSC_SCOPE, aud: "https://oauth2.googleapis.com/token", iat: 1791979200, exp: 1791979200 + 3600 });
    expect(GSC_SCOPE).toMatch(/readonly$/);
    expect(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(createPublicKey(publicKey), Buffer.from(s, "base64url"))).toBe(true);
  });
  it("aceita a chave com \\n literais (formato de variável de ambiente)", () => {
    const flat = privateKey.replace(/\n/g, "\\n");
    expect(normalizePrivateKey(flat)).toBe(privateKey.trim());
    expect(() => buildServiceJwt("a@b.c", flat, now)).not.toThrow();
  });
  it("chave inválida lança (nunca assina com outra coisa)", () => { expect(() => buildServiceJwt("a@b.c", "não é uma chave", now)).toThrow(); });
});

describe("consulta e resposta", () => {
  it("valida datas, dimensões e limite", () => {
    expect(gscBody({ startDate: "2026-09-01", endDate: "2026-09-30", dimensions: ["query", "page"] })).toMatchObject({ rowLimit: 1000, startRow: 0, dataState: "final" });
    expect(() => gscBody({ startDate: "2026-09-30", endDate: "2026-09-01", dimensions: ["query"] })).toThrow(RangeError);
    expect(() => gscBody({ startDate: "2026-9-1", endDate: "2026-09-30", dimensions: ["query"] })).toThrow(RangeError);
    expect(() => gscBody({ startDate: "2026-09-01", endDate: "2026-09-30", dimensions: [] })).toThrow(RangeError);
    expect(() => gscBody({ startDate: "2026-09-01", endDate: "2026-09-30", dimensions: ["query"], rowLimit: 30000 })).toThrow(RangeError);
  });
  it("lê as linhas, descartando as sem chaves; CTR/posição ausentes ficam null", () => {
    const rows = parseGsc(fx("gsc-rows.json"));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ keys: ["apartamento à venda em campinas", "https://meusite.com.br/cidades/sp/campinas"], clicks: 12, impressions: 340, ctr: 0.0353, position: 8.4 });
    expect(parseGsc({ rows: [{ keys: ["a"], clicks: 1, impressions: 2 }] })[0]).toMatchObject({ ctr: null, position: null });
  });
  it("{} (sem linhas) é lista vazia; formato inválido lança", () => {
    expect(parseGsc({})).toEqual([]);
    expect(() => parseGsc([])).toThrow(); expect(() => parseGsc({ rows: "x" })).toThrow();
  });
});

describe("canibalização: sem dados é DESCONHECIDO, não 'nenhuma página'", () => {
  it("propriedade sem nenhuma linha → unknown com o motivo", () => { expect(ownPagesForQuery([], "apartamento à venda em campinas")).toMatchObject({ state: "unknown", reason: expect.stringMatching(/não devolveu dados/) }); });
  it("com dados: lista as páginas próprias que já aparecem para a consulta (sem diferenciar maiúsculas)", () => {
    const r = ownPagesForQuery(parseGsc(fx("gsc-rows.json")), "Apartamento à venda em Campinas");
    expect(r).toMatchObject({ state: "known" });
    expect(r.state === "known" && r.pages.map((p) => p.page)).toEqual(["https://meusite.com.br/cidades/sp/campinas", "https://meusite.com.br/blog/mercado"]);
  });
  it("com dados da propriedade mas nenhuma linha para a consulta → known com lista vazia (observado)", () => { expect(ownPagesForQuery(parseGsc(fx("gsc-rows.json")), "outra consulta")).toEqual({ state: "known", pages: [] }); });
});
