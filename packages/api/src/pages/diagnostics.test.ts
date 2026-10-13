import { describe, expect, it } from "vitest";
import type { City, ImportRunSummary } from "../ingest/read";
import { CITY_OVERVIEW, buildCityFacts, renderCityPage } from "./city-overview";
import { ageInDays, describeOmissions, reviewFacts } from "./diagnostics";

const RUN: ImportRunSummary = { id: "c0000000-0000-4000-8000-000000000001", sourceName: "IBGE", fileName: "f.csv", fileSha256: "a".repeat(64), origin: "real", status: "succeeded", totalRows: 1, acceptedRows: 1, rejectedRows: 0, duplicateRows: 0, error: null, startedAt: new Date("2026-10-13T03:08:00Z"), finishedAt: new Date("2026-10-13T03:09:00Z"), createdBy: "t" };
const city = (over: Partial<City> = {}): City => ({ id: "d0000000-0000-4000-8000-000000000001", ibgeCode: "3550308", name: "São Paulo", uf: "SP", region: "Sudeste", population: 11911337, populationYear: 2026, sourceRunId: RUN.id, ...over });
const page = (c: City) => { const f = buildCityFacts(c, RUN); if (!f.ok) throw new Error(f.reason); const r = renderCityPage(CITY_OVERVIEW, f, { knownPaths: new Set() }); if (!r.ok) throw new Error(r.reason); return r.page; };

describe("omissões por fato ausente (nada é inventado)", () => {
  it("página completa: nenhuma omissão", () => expect(describeOmissions(page(city()))).toEqual([]));
  it("sem população: a seção População sai inteira e o relatório diz quais fatos faltaram", () => {
    const o = describeOmissions(page(city({ population: null, populationYear: null })));
    expect(o).toEqual([{ sectionId: "population", heading: "População", wholeSection: true, missing: ["population", "population_year"] }]);
  });
  it("população sem ano também omite a seção, e só o ano aparece como faltando junto da população", () => {
    const o = describeOmissions(page(city({ populationYear: null })));
    expect(o[0]).toMatchObject({ sectionId: "population", wholeSection: true });
    expect(o[0]!.missing).toContain("population");
  });
  it("sem região: só um PARÁGRAFO da Visão geral sai, a seção continua", () => {
    expect(describeOmissions(page(city({ region: null })))).toEqual([{ sectionId: "overview", heading: "Visão geral", wholeSection: false, missing: ["region"] }]);
  });
});

describe("revisão de fatos por idade (aviso, não gate)", () => {
  it("calcula a idade em dias a partir da data de coleta e de um `today` informado", () => {
    expect(ageInDays("2026-10-13", new Date("2026-10-13T23:00:00Z"))).toBe(0);
    expect(ageInDays("2026-10-13", new Date("2026-10-20T00:00:00Z"))).toBe(7);
    expect(ageInDays("2025-10-13", new Date("2026-10-13T00:00:00Z"))).toBe(365);
  });
  it("marca `review` só acima do limite explícito", () => {
    const p = page(city());
    expect(reviewFacts(p, new Date("2026-12-01T00:00:00Z")).every((r) => !r.review)).toBe(true);
    const old = reviewFacts(p, new Date("2027-11-01T00:00:00Z"));
    expect(old.every((r) => r.review)).toBe(true);
    expect(reviewFacts(p, new Date("2026-12-01T00:00:00Z"), 10).every((r) => r.review)).toBe(true);
  });
});
