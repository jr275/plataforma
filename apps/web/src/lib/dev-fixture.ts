import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CITY_OVERVIEW, GATES, classifyCityRows, evaluateCity, parseCsv, type City, type GateResult, type ImportRunSummary, type PageDetail, type PageVersionView, type RenderedPage } from "@plataforma/api";

// FIXTURE DE DESENVOLVIMENTO (nunca em produção): aplica o MOTOR REAL (render + gates) ao extrato REAL do IBGE versionado em
// db/test-fixtures/generation/. Nada é persistido e nenhum dado é inventado; serve para inspecionar a interface sem login nem banco.
const CSV = path.resolve(process.cwd(), "../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv");
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" } as const;
const RUN: ImportRunSummary = { id: "00000000-0000-4000-8000-000000000000", sourceName: "IBGE", fileName: "sp-ibge-2026-10-12.csv", fileSha256: "0".repeat(64), origin: "real", status: "succeeded", totalRows: 645, acceptedRows: 645, rejectedRows: 0, duplicateRows: 0, error: null, startedAt: new Date("2026-10-12T00:00:00Z"), finishedAt: new Date("2026-10-12T00:00:00Z"), createdBy: "fixture" };

export type DevCase = "ok" | "blocked" | "no-population";
export interface DevCity { code: string; name: string; population: number }

function cities(): City[] {
  const { rows } = classifyCityRows(parseCsv(readFileSync(CSV, "utf8")), MAPPING);
  return rows.flatMap((r) => (r.city ? [{ id: `00000000-0000-4000-8000-${r.city.ibgeCode.padStart(12, "0")}`, ibgeCode: r.city.ibgeCode, name: r.city.name, uf: r.city.uf, region: r.city.region, population: r.city.population, populationYear: r.city.populationYear, sourceRunId: RUN.id }] : []));
}

export function topCities(n = 20): DevCity[] {
  return cities().filter((c) => c.population !== null).sort((a, b) => b.population! - a.population! || (a.ibgeCode < b.ibgeCode ? -1 : 1)).slice(0, n).map((c) => ({ code: c.ibgeCode, name: c.name, population: c.population! }));
}

export function buildDevDetail(code: string, kind: DevCase): { detail: PageDetail; note: string } | undefined {
  let city = cities().find((c) => c.ibgeCode === code);
  if (!city) return undefined;
  if (kind === "no-population") city = { ...city, population: null, populationYear: null };
  const ctx = { template: CITY_OVERVIEW, knownPaths: new Set<string>(), pathOwners: new Map<string, string>(), titleOwners: new Map<string, string>(), metaOwners: new Map<string, string>(), existingByEntity: new Map() };
  if (kind === "blocked") ctx.pathOwners.set(`/cidades/${city.uf.toLowerCase()}/${city.name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`, "outra-entidade");
  const ev = evaluateCity(city, RUN, ctx);
  const gates: GateResult[] = [...ev.gates];
  const page: RenderedPage | undefined = ev.page;
  const versions: PageVersionView[] = page ? [{ id: `fixture-v1-${city.ibgeCode}`, version: 1, runId: RUN.id, contentHash: page.contentHash, content: page, templateKey: page.template.key, templateVersion: page.template.version, createdAt: new Date() }] : [];
  const detail: PageDetail = {
    page: { id: `fixture-${city.ibgeCode}`, entityId: city.id, path: page?.path ?? "", status: ev.outcome === "blocked" ? "blocked" : "draft", latestVersion: 1, updatedAt: new Date(), cityName: city.name, uf: city.uf, region: city.region, population: city.population, populationYear: city.populationYear },
    versions,
    latestAttempt: { runId: RUN.id, startedAt: new Date(), outcome: ev.outcome, gates: gates.length === GATES.length ? gates : [], error: null },
  };
  const note = kind === "blocked" ? "Caso de teste: a URL foi marcada como já pertencente a outra entidade para exercitar o gate url_unique." : kind === "no-population" ? "Caso de teste: a população desta cidade foi REMOVIDA da entrada para exercitar a omissão de seção." : "Caso real: motor e gates aplicados ao extrato do IBGE; resultado não persistido.";
  return { detail, note };
}

/** Linhas da lista (as 20 maiores populações de SP) para a visão de lista da prévia; nada persistido. */
export function devListRows(): import("@plataforma/api").PageListItem[] {
  return cities().filter((c) => c.population !== null).sort((a, b) => b.population! - a.population! || (a.ibgeCode < b.ibgeCode ? -1 : 1)).slice(0, 20).map((c) => {
    const d = buildDevDetail(c.ibgeCode, "ok");
    return d!.detail.page;
  });
}
