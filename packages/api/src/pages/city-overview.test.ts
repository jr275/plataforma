import { describe, expect, it } from "vitest";
import type { City, ImportRunSummary } from "../ingest/read";
import { CITY_OVERVIEW, buildCityFacts, cityPath, formatInt, renderCityPage, slugify, templateHash, validateTemplate, type CityTemplate, type FactsResult } from "./city-overview";

// Entradas de teste montadas à mão (valores de população copiados da carga real do IBGE de 2026-10-12, só como dados de entrada).
const RUN: ImportRunSummary = { id: "c0000000-0000-4000-8000-000000000001", sourceName: "IBGE", fileName: "ibge-municipios.csv", fileSha256: "a".repeat(64), origin: "real", status: "succeeded", totalRows: 5571, acceptedRows: 5571, rejectedRows: 0, duplicateRows: 0, error: null, startedAt: new Date("2026-10-13T03:08:00Z"), finishedAt: new Date("2026-10-13T03:09:00Z"), createdBy: "t" };
const city = (over: Partial<City>): City => ({ id: "d0000000-0000-4000-8000-000000000001", ibgeCode: "1100015", name: "Alta Floresta D'Oeste", uf: "RO", region: "Norte", population: 22724, populationYear: 2026, sourceRunId: RUN.id, ...over });
const ARIQUEMES = city({ id: "d0000000-0000-4000-8000-000000000002", ibgeCode: "1100023", name: "Ariquemes", population: 109731 });
const ok = (c: City, run = RUN): Extract<FactsResult, { ok: true }> => { const r = buildCityFacts(c, run); if (!r.ok) throw new Error(r.reason); return r; };
const KNOWN = new Set(["/cidades/ro", "/cidades"]);
const render = (c: City, known: ReadonlySet<string> = KNOWN) => { const r = renderCityPage(CITY_OVERVIEW, ok(c), { knownPaths: known }); if (!r.ok) throw new Error(`${r.reason}: ${r.detail}`); return r.page; };

describe("fatos", () => {
  it("cada fato leva fonte, horário da coleta e confiança; população leva o ano", () => {
    const f = ok(city({})).facts;
    expect(f.map((x) => x.key)).toEqual(["ibge_code", "name", "uf", "region", "population", "population_year"]);
    const pop = f.find((x) => x.key === "population")!;
    expect(pop).toMatchObject({ id: "city:1100015:population", value: 22724, asOf: 2026, confidence: "high", source: { name: "IBGE", runId: RUN.id, collectedAt: "2026-10-13" } });
  });
  it("população sem ano NÃO vira fato (sem validade, regra 1)", () => {
    expect(ok(city({ populationYear: null })).facts.map((x) => x.key)).not.toContain("population");
  });
  it("recusa execução de teste, manual, em andamento, falha ou de outra execução", () => {
    expect(buildCityFacts(city({}), { ...RUN, origin: "test" })).toEqual({ ok: false, reason: "origin_not_real" });
    expect(buildCityFacts(city({}), { ...RUN, origin: "manual" })).toEqual({ ok: false, reason: "origin_not_real" });
    expect(buildCityFacts(city({}), { ...RUN, status: "running", finishedAt: null })).toEqual({ ok: false, reason: "run_not_finished" });
    expect(buildCityFacts(city({}), { ...RUN, status: "failed" })).toEqual({ ok: false, reason: "run_not_finished" });
    expect(buildCityFacts(city({}), { ...RUN, id: "e0000000-0000-4000-8000-000000000009" })).toEqual({ ok: false, reason: "run_mismatch" });
  });
});

describe("página de cidade", () => {
  it("URL, título, h1, meta e seções seguem as regras", () => {
    const p = render(city({}));
    expect(p.path).toBe("/cidades/ro/alta-floresta-d-oeste");
    expect(p.canonicalPath).toBe(p.path);
    expect(p.title).toBe("Alta Floresta D'Oeste (RO): população e localização");
    expect(p.h1).toBe("Alta Floresta D'Oeste, RO");
    expect(p.metaDescription).toBe("Alta Floresta D'Oeste (RO), região Norte: estimativa de 22.724 habitantes em 2026, segundo o IBGE. Dados e localização do município.");
    expect(p.metaDescription.length).toBeGreaterThanOrEqual(70);
    expect(p.metaDescription.length).toBeLessThanOrEqual(155);
    expect(p.sections.map((s) => s.heading)).toEqual(["Visão geral", "População", "Localização", "Fonte dos dados"]);
    expect(p.sections[1]!.paragraphs[0]).toBe("Segundo a estimativa do IBGE para 2026, Alta Floresta D'Oeste tem 22.724 habitantes.");
  });

  it("duas cidades geram conteúdo factual diferente (URL, título, meta, texto, fatos)", () => {
    const a = render(city({}));
    const b = render(ARIQUEMES);
    expect(b.path).toBe("/cidades/ro/ariquemes");
    expect(b.title).not.toBe(a.title);
    expect(b.metaDescription).toContain("109.731");
    expect(JSON.stringify(a.sections)).not.toBe(JSON.stringify(b.sections));
    expect(b.factsUsed.map((f) => f.id)).toContain("city:1100023:population");
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it("é determinística: mesma entrada, mesma página, mesmo hash; a versão do template fica registrada", () => {
    const a = render(city({}));
    const b = render(city({}));
    expect(b).toEqual(a);
    expect(a.template).toEqual({ key: "city-overview", version: 1, hash: templateHash(CITY_OVERVIEW) });
    expect(a.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("mudar um dado muda o conteúdo mas NÃO a URL (atualização sem duplicar)", () => {
    const antes = render(city({}));
    const depois = render(city({ population: 23000 }));
    expect(depois.path).toBe(antes.path);
    expect(depois.contentHash).not.toBe(antes.contentHash);
    expect(depois.metaDescription).toContain("23.000");
  });

  it("sem população (ou sem ano) omite a seção, o título e a meta falam só do que existe, e nada é inventado", () => {
    for (const c of [city({ population: null, populationYear: null }), city({ populationYear: null })]) {
      const p = render(c);
      expect(p.sections.map((s) => s.id)).toEqual(["overview", "location", "sources"]);
      expect(p.title).toBe("Alta Floresta D'Oeste (RO): localização");
      expect(p.metaDescription).not.toMatch(/\d{2}\.\d{3}|habitantes/);
      expect(p.factsUsed.map((f) => f.key)).not.toContain("population");
    }
  });

  it("sem região omite a frase da região", () => {
    const p = render(city({ region: null }));
    expect(p.sections[0]!.paragraphs).toEqual(["Alta Floresta D'Oeste é um município de RO."]);
    expect(p.metaDescription).not.toContain("região");
  });

  it("nome longo respeita os limites de título e meta (Vila Bela da Santíssima Trindade)", () => {
    const p = render(city({ ibgeCode: "5105507", name: "Vila Bela da Santíssima Trindade", uf: "MT", region: "Centro-Oeste", population: 17000 }));
    expect(p.title.length).toBeLessThanOrEqual(60);
    expect(p.metaDescription.length).toBeLessThanOrEqual(155);
    expect(p.path).toBe("/cidades/mt/vila-bela-da-santissima-trindade");
  });

  it("links só para destinos que existem; sem destino, sem link", () => {
    expect(render(city({})).links).toEqual([{ path: "/cidades/ro", text: "Cidades de RO" }, { path: "/cidades", text: "Todas as cidades" }]);
    expect(render(city({}), new Set(["/cidades"])).links).toEqual([{ path: "/cidades", text: "Todas as cidades" }]);
    expect(render(city({}), new Set()).links).toEqual([]);
    expect(render(city({}), new Set(["/cidades/sp"])).links).toEqual([]);
  });

  it("a seção de fontes lista cada fato usado com fonte, referência e data da coleta", () => {
    const src = render(city({})).sections.at(-1)!;
    expect(src.heading).toBe("Fonte dos dados");
    expect(src.paragraphs).toContain("População estimada: 22.724. Fonte: IBGE, coletado em 13/10/2026, referência 2026.");
    expect(src.paragraphs).toContain("Código IBGE: 1100015. Fonte: IBGE, coletado em 13/10/2026.");
    expect(src.factIds).toHaveLength(src.paragraphs.length);
  });

  it("todo número do texto vem de um fato: os algarismos das seções estão todos nos valores dos fatos usados", () => {
    const p = render(city({}));
    const text = p.sections.flatMap((s) => s.paragraphs).join(" ");
    const allowed = p.factsUsed.map((f) => (f.key === "population" ? formatInt(f.value as number) : String(f.value))).concat(p.factsUsed.flatMap((f) => (f.asOf !== undefined ? [String(f.asOf)] : [])), ["13/10/2026"]).join(" ");
    for (const n of text.match(/\d[\d./]*/g) ?? []) expect(allowed).toContain(n.replace(/\.$/, ""));
  });
});

describe("recusas", () => {
  it("cidade sem campo obrigatório não renderiza e diz qual", () => {
    const f = ok(city({}));
    const semNome: Extract<FactsResult, { ok: true }> = { ...f, facts: f.facts.filter((x) => x.key !== "name") };
    expect(renderCityPage(CITY_OVERVIEW, semNome, { knownPaths: KNOWN })).toEqual({ ok: false, reason: "missing_required", detail: "faltam os campos obrigatórios: name" });
  });
  it("o template com algarismo literal, token desconhecido ou token fora de requires é inválido e não renderiza", () => {
    const bad = (text: string): CityTemplate => ({ ...CITY_OVERVIEW, sections: [{ id: "x", heading: "X", paragraphs: [{ text, requires: ["name"] }] }] });
    expect(validateTemplate(CITY_OVERVIEW)).toEqual([]);
    expect(validateTemplate(bad("Tem 5 mil habitantes")).join()).toMatch(/algarismo/);
    expect(validateTemplate(bad("{{fact:prefeito}}")).join()).toMatch(/desconhecido/);
    expect(validateTemplate(bad("{{fact:uf}}")).join()).toMatch(/requires/);
    expect(validateTemplate({ ...CITY_OVERVIEW, version: 0 }).join()).toMatch(/version/);
    const r = renderCityPage(bad("Tem 5 mil habitantes"), ok(city({})), { knownPaths: KNOWN });
    expect(r).toMatchObject({ ok: false, reason: "invalid_template" });
  });
  it("trocar o texto do template muda o hash (nova versão é rastreável)", () => {
    expect(templateHash({ ...CITY_OVERVIEW, sourcesHeading: "Origem" })).not.toBe(templateHash(CITY_OVERVIEW));
  });
});

describe("utilidades", () => {
  it("slug sem acento, minúsculo, com hífens; URL com UF em minúsculo", () => {
    expect(slugify("São Paulo")).toBe("sao-paulo");
    expect(slugify("Alta Floresta D'Oeste")).toBe("alta-floresta-d-oeste");
    expect(slugify("  Foz do Iguaçu ")).toBe("foz-do-iguacu");
    expect(cityPath("SP", "São Paulo")).toBe("/cidades/sp/sao-paulo");
  });
  it("formata inteiros no padrão pt-BR", () => {
    expect([0, 999, 1000, 22724, 12345678].map(formatInt)).toEqual(["0", "999", "1.000", "22.724", "12.345.678"]);
  });
});
