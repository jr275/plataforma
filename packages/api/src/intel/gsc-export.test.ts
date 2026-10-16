import { describe, expect, it } from "vitest";
import { buildGscExportSnapshot, parseCsv, parseDailySeries, parseGscExportSnapshot, type GscExportFiles } from "./gsc-export";

const H = "Last 6 months Clicks,Previous 6 months Clicks,Last 6 months Impressions,Previous 6 months Impressions,Last 6 months CTR,Previous 6 months CTR,Last 6 months Position,Previous 6 months Position";
const files = (over: Partial<GscExportFiles> = {}): GscExportFiles => ({
  devices: `Device,${H}\nMobile,60,50,600,500,10%,10%,2,3\nDesktop,40,50,400,500,10%,10%,4,3\n`,
  countries: `Country,${H}\nBrazil,95,95,950,950,10%,10%,3,3\nPortugal,5,5,50,50,10%,10%,6,6\n`,
  appearances: `Search Appearance,${H}\nProduct snippets,9,8,90,80,10%,10%,5,5\nWeb Story,0,0,0,0,0%,0%,0,0\n`,
  queries: `Top queries,${H}\n"casa, em sp",30,20,100,90,30%,22%,1,1\nimóvel,20,10,50,40,40%,25%,2,2\n`,
  pages: `Top pages,${H}\nhttps://x.test/,70,60,500,400,14%,15%,3,3\n`,
  filters: "Filter,Value\nSearch type,Web (text-based)\nDate,Last 6 months\n",
  ...over,
});
const META = { property: "https://x.test/", exportedAt: "2026-10-16", tenantId: null };

describe("parseCsv", () => {
  it("lê campos entre aspas com vírgula, aspas duplicadas, BOM e CRLF", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"']]);
  });
});

describe("buildGscExportSnapshot", () => {
  it("totais vêm da tabela de dispositivos; CTR é cliques ÷ impressões e a posição é ponderada por impressões", () => {
    const s = buildGscExportSnapshot(files(), META);
    expect(s.current).toMatchObject({ clicks: 100, impressions: 1000, ctr: 10 });
    expect(s.current.position).toBeCloseTo((2 * 600 + 4 * 400) / 1000);
    expect(s.previous).toMatchObject({ clicks: 100, impressions: 1000 });
    expect(s.searchType).toBe("Web (text-based)");
    expect(s.period).toBe("Last 6 months");
  });
  it("mostra a cobertura das listas: consultas e páginas cobrem só parte do total (nada é extrapolado)", () => {
    const s = buildGscExportSnapshot(files(), META);
    expect(s.coverage.queries).toMatchObject({ rows: 2, clicks: 50, impressions: 150 });
    expect(s.coverage.queries.clicksShare).toBeCloseTo(50);
    expect(s.coverage.queries.impressionsShare).toBeCloseTo(15);
    expect(s.coverage.pages.clicksShare).toBeCloseTo(70);
  });
  it("descarta tipos de resultado sem nenhuma impressão e ordena países por cliques", () => {
    const s = buildGscExportSnapshot(files(), META);
    expect(s.appearances.map((a) => a.key)).toEqual(["Product snippets"]);
    expect(s.countries.map((c) => c.key)).toEqual(["Brazil", "Portugal"]);
  });
  it("IA generativa traz só impressões (não inventa cliques) e conta só páginas com impressão", () => {
    const s = buildGscExportSnapshot(files({ ai: { pages: "Top pages,Last 6 months Impressions,Previous 6 months Impressions\na,10,0\nb,0,0\n", countries: "Country,Last 6 months Impressions,Previous 6 months Impressions\nBrazil,10,0\n", devices: "Device,Last 6 months Impressions,Previous 6 months Impressions\nMobile,10,0\n" } }), META);
    expect(s.ai).toMatchObject({ impressions: 10, prevImpressions: 0, pages: 1 });
    expect(JSON.stringify(s.ai)).not.toMatch(/clicks/i);
  });
  it("sem a tabela de dispositivos não há como calcular totais: falha em vez de chutar", () => {
    expect(() => buildGscExportSnapshot(files({ devices: `Device,${H}\n` }), META)).toThrow(/dispositivo/);
    expect(() => buildGscExportSnapshot(files({ devices: "a,b\n1,2\n" }), META)).toThrow(/colunas/);
  });
  it("guarda as maiores consultas e páginas por cliques, na ordem, limitadas a 50, com os números do próprio export", () => {
    const s = buildGscExportSnapshot(files(), META);
    expect(s.top?.queries.map((q) => q.key)).toEqual(["casa, em sp", "imóvel"]);
    expect(s.top?.queries[0]).toMatchObject({ clicks: 30, prevClicks: 20, impressions: 100 });
    expect(s.top?.pages[0]?.key).toBe("https://x.test/");
    const many = `Top queries,${H}\n` + Array.from({ length: 80 }, (_, i) => `q${i},${i},0,10,10,0%,0%,1,1`).join("\n");
    expect(buildGscExportSnapshot(files({ queries: many }), META).top?.queries).toHaveLength(50);
  });
  it("IA: as páginas com mais impressões vêm ordenadas, sem as de zero impressão", () => {
    const s = buildGscExportSnapshot(files({ ai: { pages: "Top pages,Last 6 months Impressions,Previous 6 months Impressions\na,5,0\nb,9,2\nc,0,0\n", countries: "Country,Last 6 months Impressions,Previous 6 months Impressions\nBrazil,14,0\n", devices: "Device,Last 6 months Impressions,Previous 6 months Impressions\nMobile,14,0\n" } }), META);
    expect(s.ai?.topPages).toEqual([{ key: "b", impressions: 9, prevImpressions: 2 }, { key: "a", impressions: 5, prevImpressions: 0 }]);
  });
});

describe("parseGscExportSnapshot", () => {
  it("aceita o que o construtor gera e rejeita lixo, outra versão ou tenant malformado", () => {
    const s = buildGscExportSnapshot(files(), META);
    expect(parseGscExportSnapshot(JSON.parse(JSON.stringify(s)))).not.toBeNull();
    expect(parseGscExportSnapshot(null)).toBeNull();
    expect(parseGscExportSnapshot({ ...s, version: 2 })).toBeNull();
    expect(parseGscExportSnapshot({ ...s, current: { clicks: "x" } })).toBeNull();
    expect(parseGscExportSnapshot({ ...s, tenantId: 5 })).toBeNull();
    expect(parseGscExportSnapshot({ ...s, top: { queries: 1, pages: [] } })).toBeNull();
    const { top: _t, ...legacy } = s;
    expect(parseGscExportSnapshot(JSON.parse(JSON.stringify(legacy)))).not.toBeNull(); // snapshot antigo, sem listas, continua válido
  });
});

describe("parseDailySeries", () => {
  it("lê o CSV da aba Datas, ordena por data e converte CTR e números com milhar", () => {
    const out = parseDailySeries("Date,Clicks,Impressions,CTR,Position\n2026-01-02,\"1,200\",20000,6%,7.5\n2026-01-01,10,200,5%,8\n");
    expect(out.map((p) => p.date)).toEqual(["2026-01-01", "2026-01-02"]);
    expect(out[1]).toEqual({ date: "2026-01-02", clicks: 1200, impressions: 20000, ctr: 6, position: 7.5 });
  });
  it("aceita as colunas de comparação do export (usa a primeira de cada métrica)", () => {
    const out = parseDailySeries(`Date,${H}\n2026-01-01,5,4,50,40,10%,10%,3,4\n`);
    expect(out[0]).toMatchObject({ clicks: 5, impressions: 50, position: 3 });
  });
  it("falha com cabeçalho desconhecido, data inválida, data repetida ou série vazia, em vez de chutar", () => {
    expect(() => parseDailySeries("Dia,Cliques\n1,2\n")).toThrow(/cabeçalho/);
    expect(() => parseDailySeries("Date,Clicks,Impressions,CTR,Position\n01/02/2026,1,1,1%,1\n")).toThrow(/data inválida/);
    expect(() => parseDailySeries("Date,Clicks,Impressions,CTR,Position\n2026-01-01,1,1,1%,1\n2026-01-01,2,2,1%,1\n")).toThrow(/repetida/);
    expect(() => parseDailySeries("Date,Clicks,Impressions,CTR,Position\n")).toThrow(/vazia/);
  });
  it("o snapshot guarda a série com a propriedade de origem e o validador a aceita", () => {
    const s = buildGscExportSnapshot(files({ dates: { csv: "Date,Clicks,Impressions,CTR,Position\n2026-01-01,1,10,10%,3\n", property: "sc-domain:x.test" } }), META);
    expect(s.daily).toMatchObject({ property: "sc-domain:x.test", points: [{ date: "2026-01-01", clicks: 1 }] });
    expect(parseGscExportSnapshot(JSON.parse(JSON.stringify(s)))).not.toBeNull();
    expect(parseGscExportSnapshot({ ...s, daily: { property: 1, points: [] } })).toBeNull();
  });
});
