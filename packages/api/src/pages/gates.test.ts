import { describe, expect, it } from "vitest";
import type { City, ImportRunSummary } from "../ingest/read";
import { CITY_OVERVIEW, cityPath, renderCityPage } from "./city-overview";
import { GATES, checkFactsTraceable, checkLinks, checkMetadata, evaluateCity, type ExistingPage, type GenerationContext } from "./gates";

// Entradas montadas à mão para os gates. Os valores de população são do IBGE (2026-10-12), usados só como entrada.
const RUN: ImportRunSummary = { id: "c0000000-0000-4000-8000-000000000001", sourceName: "IBGE", fileName: "f.csv", fileSha256: "a".repeat(64), origin: "real", status: "succeeded", totalRows: 1, acceptedRows: 1, rejectedRows: 0, duplicateRows: 0, error: null, startedAt: new Date("2026-10-13T03:08:00Z"), finishedAt: new Date("2026-10-13T03:09:00Z"), createdBy: "t" };
const city = (over: Partial<City> = {}): City => ({ id: "d0000000-0000-4000-8000-000000000001", ibgeCode: "3550308", name: "São Paulo", uf: "SP", region: "Sudeste", population: 11911337, populationYear: 2026, sourceRunId: RUN.id, ...over });
const ctx = (over: Partial<GenerationContext> = {}): GenerationContext => ({ template: CITY_OVERVIEW, knownPaths: new Set(), pathOwners: new Map(), titleOwners: new Map(), metaOwners: new Map(), existingByEntity: new Map(), ...over });
const page = (c = city(), known: ReadonlySet<string> = new Set()) => {
  const f = renderCityPage(CITY_OVERVIEW, (() => { const r = import_facts(c); return r; })(), { knownPaths: known });
  if (!f.ok) throw new Error(f.reason);
  return f.page;
};
import { buildCityFacts } from "./city-overview";
function import_facts(c: City) { const r = buildCityFacts(c, RUN); if (!r.ok) throw new Error(r.reason); return r; }
const outcomes = (gs: readonly { gate: string; outcome: string }[]) => Object.fromEntries(gs.map((g) => [g.gate, g.outcome]));

describe("avaliação de uma cidade: sempre os seis gates, na ordem, cada um com o próprio resultado", () => {
  it("cidade válida e nova: todos passam e o desfecho é `generated`", () => {
    const ev = evaluateCity(city(), RUN, ctx());
    expect(ev.gates.map((g) => g.gate)).toEqual([...GATES]);
    expect(ev.gates.every((g) => g.outcome === "pass" && g.detail.length > 0)).toBe(true);
    expect(ev.outcome).toBe("generated");
    expect(ev.page?.path).toBe("/cidades/sp/sao-paulo");
  });
  it("mesmo hash da última versão: `unchanged`; hash diferente: `generated`", () => {
    const p = page();
    const ex = (hash: string): ExistingPage => ({ id: "p1", versionId: "v1", path: p.path, status: "draft", latestVersion: 1, latestHash: hash });
    expect(evaluateCity(city(), RUN, ctx({ existingByEntity: new Map([[city().id, ex(p.contentHash)]]) })).outcome).toBe("unchanged");
    expect(evaluateCity(city(), RUN, ctx({ existingByEntity: new Map([[city().id, ex("0".repeat(64))]]) })).outcome).toBe("generated");
  });
  it("required_fields: origem de teste ou manual bloqueia, e os demais gates ficam `skipped` com detalhe", () => {
    for (const origin of ["test", "manual"] as const) {
      const ev = evaluateCity(city(), { ...RUN, origin }, ctx());
      expect(ev.outcome).toBe("blocked");
      expect(outcomes(ev.gates)).toEqual({ required_fields: "fail", url_unique: "skipped", url_stable: "skipped", metadata_valid: "skipped", links_resolve: "skipped", facts_traceable: "skipped" });
      expect(ev.gates[0]!.detail).toMatch(/origin_not_real/);
      expect(ev.page).toBeUndefined();
    }
  });
  it("required_fields: execução de origem não terminada ou de outra execução bloqueia", () => {
    expect(evaluateCity(city(), { ...RUN, status: "failed" }, ctx()).gates[0]!.detail).toMatch(/run_not_finished/);
    expect(evaluateCity(city({ sourceRunId: "e0000000-0000-4000-8000-000000000009" }), RUN, ctx()).gates[0]!.detail).toMatch(/run_mismatch/);
  });
  it("url_unique: o caminho já pertence a outra entidade", () => {
    const ev = evaluateCity(city(), RUN, ctx({ pathOwners: new Map([["/cidades/sp/sao-paulo", "outra-entidade"]]) }));
    expect(ev.outcome).toBe("blocked");
    expect(outcomes(ev.gates).url_unique).toBe("fail");
    expect(outcomes(ev.gates).required_fields).toBe("pass");
    // o mesmo caminho pertencendo à PRÓPRIA entidade (reprocessamento) não é duplicata
    expect(outcomes(evaluateCity(city(), RUN, ctx({ pathOwners: new Map([["/cidades/sp/sao-paulo", city().id]]) })).gates).url_unique).toBe("pass");
  });
  it("url_stable: a cidade já tem página e o caminho mudaria (nome alterado) bloqueia, em vez de criar segunda URL", () => {
    const ex: ExistingPage = { id: "p1", versionId: "v1", path: "/cidades/sp/nome-antigo", status: "draft", latestVersion: 1, latestHash: "0".repeat(64) };
    const ev = evaluateCity(city(), RUN, ctx({ existingByEntity: new Map([[city().id, ex]]) }));
    expect(ev.outcome).toBe("blocked");
    expect(ev.gates.find((g) => g.gate === "url_stable")).toMatchObject({ outcome: "fail" });
    expect(ev.gates.find((g) => g.gate === "url_stable")!.detail).toMatch(/redirecionamento/);
  });
  it("metadata_valid: título ou meta repetidos em outra página bloqueiam", () => {
    const p = page();
    const ev = evaluateCity(city(), RUN, ctx({ titleOwners: new Map([[p.title, "outra"]]) }));
    expect(outcomes(ev.gates).metadata_valid).toBe("fail");
    expect(ev.outcome).toBe("blocked");
    expect(outcomes(evaluateCity(city(), RUN, ctx({ metaOwners: new Map([[p.metaDescription, "outra"]]) })).gates).metadata_valid).toBe("fail");
  });
  it("metadata_valid: nome absurdamente longo (120 caracteres) é bloqueado sem lançar exceção", () => {
    const ev = evaluateCity(city({ name: "x".repeat(120) }), RUN, ctx());
    expect(ev.outcome).toBe("blocked");
    expect(ev.gates.map((g) => g.gate)).toEqual([...GATES]);
    expect(outcomes(ev.gates).metadata_valid).toBe("fail");
  });
  it("metadata_valid: confere limites de título, meta e h1 diretamente", () => {
    const p = page();
    const empty = { titleOwners: new Map<string, string>(), metaOwners: new Map<string, string>() };
    expect(checkMetadata(p, "x", empty).outcome).toBe("pass");
    expect(checkMetadata({ ...p, title: "t".repeat(61) }, "x", empty).outcome).toBe("fail");
    expect(checkMetadata({ ...p, metaDescription: "curta" }, "x", empty).outcome).toBe("fail");
    expect(checkMetadata({ ...p, h1: " " }, "x", empty).outcome).toBe("fail");
  });
  it("links_resolve: link para destino que não existe é detectado (e destino conhecido passa)", () => {
    const comLink = page(city(), new Set(["/cidades/sp"]));
    expect(comLink.links).toHaveLength(1);
    expect(checkLinks(comLink, new Set(["/cidades/sp"])).outcome).toBe("pass");
    expect(checkLinks(comLink, new Set()).outcome).toBe("fail");
    expect(checkLinks(comLink, new Set()).detail).toMatch(/\/cidades\/sp/);
    expect(checkLinks({ ...comLink, links: [{ path: comLink.path, text: "si mesma" }] }, new Set([comLink.path])).outcome).toBe("fail");
    expect(checkLinks({ ...comLink, links: [comLink.links[0]!, comLink.links[0]!] }, new Set(["/cidades/sp"])).outcome).toBe("fail");
  });
  it("facts_traceable: número na prosa sem fato de origem, ou fato sem fonte, é detectado", () => {
    const p = page();
    expect(checkFactsTraceable(p).outcome).toBe("pass");
    const inventado = { ...p, sections: [{ ...p.sections[0]!, paragraphs: [...p.sections[0]!.paragraphs, "Tem 999 bairros."] }, ...p.sections.slice(1)] };
    expect(checkFactsTraceable(inventado)).toMatchObject({ outcome: "fail" });
    expect(checkFactsTraceable(inventado).detail).toMatch(/999/);
    const semFonte = { ...p, factsUsed: p.factsUsed.map((f, i) => (i === 0 ? { ...f, source: { ...f.source, sha256: "x" } } : f)) };
    expect(checkFactsTraceable(semFonte).detail).toMatch(/sem fonte completa/);
    const semAno = { ...p, factsUsed: p.factsUsed.map((f) => (f.key === "population" ? { ...f, asOf: undefined } : f)) };
    expect(checkFactsTraceable(semAno).detail).toMatch(/sem ano/);
  });
  it("o caminho vem da regra de URL e é o mesmo da página renderizada", () => {
    expect(page().path).toBe(cityPath("SP", "São Paulo"));
  });
});
