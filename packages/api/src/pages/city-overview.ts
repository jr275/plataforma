import { createHash } from "node:crypto";
import type { City, ImportRunSummary } from "../ingest/read";

// Template "city-overview" e seu renderizador (ADR-019). PURO: sem rede, relógio, banco nem LLM. Mesma versão do template + mesmos
// fatos = mesma página, byte a byte. Número só entra por token `{{fact:chave}}` ligado a um fato com fonte e validade (regra 1).
// Nada de termo de imóvel aqui (regra 10): é um panorama geral da cidade.

export type FactKey = "name" | "uf" | "region" | "population" | "population_year" | "ibge_code";
export const FACT_KEYS: readonly FactKey[] = ["name", "uf", "region", "population", "population_year", "ibge_code"];

export interface Fact {
  /** `city:<ibge>:<chave>`: estável entre execuções. */
  readonly id: string;
  readonly key: FactKey;
  readonly value: string | number;
  /** Ano de referência (validade) quando o fato tem uma; obrigatório para a população. */
  readonly asOf?: number;
  readonly source: { readonly name: string; readonly runId: string; readonly sha256: string; readonly collectedAt: string };
  readonly confidence: "high";
}

export type FactsResult = { ok: true; facts: readonly Fact[]; cityId: string; ibgeCode: string; uf: string } | { ok: false; reason: "origin_not_real" | "run_not_finished" | "run_mismatch" };

/** Fatos de uma cidade a partir de `city` + a execução que a gravou. Só dado REAL de uma execução concluída gera fato. */
export function buildCityFacts(city: City, run: Pick<ImportRunSummary, "id" | "sourceName" | "origin" | "status" | "fileSha256" | "finishedAt">): FactsResult {
  if (run.id !== city.sourceRunId) return { ok: false, reason: "run_mismatch" };
  if (run.origin !== "real") return { ok: false, reason: "origin_not_real" };
  if (run.status === "running" || run.status === "failed" || !run.finishedAt) return { ok: false, reason: "run_not_finished" };
  const source = { name: run.sourceName, runId: run.id, sha256: run.fileSha256, collectedAt: run.finishedAt.toISOString().slice(0, 10) };
  const mk = (key: FactKey, value: string | number, asOf?: number): Fact => ({ id: `city:${city.ibgeCode}:${key}`, key, value, ...(asOf !== undefined ? { asOf } : {}), source, confidence: "high" });
  const facts: Fact[] = [mk("ibge_code", city.ibgeCode), mk("name", city.name), mk("uf", city.uf)];
  if (city.region) facts.push(mk("region", city.region));
  // Sem ano de referência o número não tem validade: não vira fato (regra 1).
  if (city.population !== null && city.populationYear !== null) {
    facts.push(mk("population", city.population, city.populationYear), mk("population_year", city.populationYear));
  }
  return { ok: true, facts, cityId: city.id, ibgeCode: city.ibgeCode, uf: city.uf };
}

// ---- template ------------------------------------------------------------------------------------------------------------

interface TemplateParagraph { readonly text: string; readonly requires: readonly FactKey[] }
interface TemplateSection { readonly id: string; readonly heading: string; readonly paragraphs: readonly TemplateParagraph[] }
export interface CityTemplate {
  readonly key: "city-overview";
  readonly version: number;
  /** Campos sem os quais a página NÃO é gerada. */
  readonly required: readonly FactKey[];
  readonly sections: readonly TemplateSection[];
  readonly sourcesHeading: string;
}

export const CITY_OVERVIEW: CityTemplate = {
  key: "city-overview",
  version: 1,
  required: ["name", "uf", "ibge_code"],
  sections: [
    { id: "overview", heading: "Visão geral", paragraphs: [
      { text: "{{fact:name}} é um município de {{fact:uf}}.", requires: ["name", "uf"] },
      { text: "Está na região {{fact:region}} do Brasil.", requires: ["region"] },
    ] },
    { id: "population", heading: "População", paragraphs: [
      { text: "Segundo a estimativa do IBGE para {{fact:population_year}}, {{fact:name}} tem {{fact:population}} habitantes.", requires: ["name", "population", "population_year"] },
    ] },
    { id: "location", heading: "Localização", paragraphs: [
      { text: "O código de {{fact:name}} no IBGE é {{fact:ibge_code}}, e o município pertence à unidade da federação {{fact:uf}}.", requires: ["name", "ibge_code", "uf"] },
    ] },
  ],
  sourcesHeading: "Fonte dos dados",
};

const TOKEN = /\{\{fact:([a-z_]+)\}\}/g;

/** Hash estável da definição (sha256 do JSON). Registrado em cada página: prova de qual versão a gerou. */
export function templateHash(t: CityTemplate): string {
  return createHash("sha256").update(JSON.stringify(t)).digest("hex");
}

/** Erros do template (lista vazia = válido). Recusa algarismo no texto literal: número só entra por token com fato. */
export function validateTemplate(t: CityTemplate): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(t.version) || t.version < 1) errors.push("version deve ser inteiro >= 1");
  const literal = (s: string) => s.replace(TOKEN, "");
  const check = (where: string, text: string, requires?: readonly FactKey[]) => {
    if (/\d/.test(literal(text))) errors.push(`${where}: algarismo no texto literal (use um token {{fact:...}})`);
    for (const m of text.matchAll(TOKEN)) {
      const key = m[1] as FactKey;
      if (!FACT_KEYS.includes(key)) errors.push(`${where}: token desconhecido "${key}"`);
      else if (requires && !requires.includes(key)) errors.push(`${where}: o token "${key}" não está em requires`);
    }
  };
  for (const s of t.sections) {
    check(`seção ${s.id} (título)`, s.heading);
    for (const p of s.paragraphs) check(`seção ${s.id}`, p.text, p.requires);
  }
  check("fontes (título)", t.sourcesHeading);
  return errors;
}

// ---- renderização ---------------------------------------------------------------------------------------------------------

export interface RenderedSection { readonly id: string; readonly heading: string; readonly paragraphs: readonly string[]; readonly factIds: readonly string[] }
export interface RenderedPage {
  readonly path: string;
  readonly canonicalPath: string;
  readonly title: string;
  readonly metaDescription: string;
  readonly h1: string;
  readonly sections: readonly RenderedSection[];
  readonly links: readonly { readonly path: string; readonly text: string }[];
  readonly factsUsed: readonly Fact[];
  readonly template: { readonly key: string; readonly version: number; readonly hash: string };
  readonly cityId: string;
  readonly ibgeCode: string;
  /** sha256 da projeção factual do conteúdo (sem datas de coleta nem identificadores de execução): idêntico enquanto os fatos e o texto não mudam. */
  readonly contentHash: string;
}
export type RenderResult = { ok: true; page: RenderedPage } | { ok: false; reason: "missing_required" | "invalid_template" | "meta_out_of_bounds"; detail: string };

export function slugify(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export const cityPath = (uf: string, name: string): string => `/cidades/${uf.toLowerCase()}/${slugify(name)}`;

/** Número inteiro no padrão pt-BR (22724 → "22.724"), sem depender de ICU. */
export const formatInt = (n: number): string => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const formatDate = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export const showFact = (f: Fact): string => (f.key === "population" ? formatInt(f.value as number) : String(f.value));
const show = showFact;

const LABELS: Record<FactKey, string> = { name: "Nome", uf: "UF", region: "Região", population: "População estimada", population_year: "Ano da estimativa", ibge_code: "Código IBGE" };
/** Rótulos dos fatos, reutilizados pelo catálogo de blocos (ADR-040). */
export const FACT_LABELS: Readonly<Record<FactKey, string>> = LABELS;
const TITLE_MAX = 60;
const META_MIN = 70;
const META_MAX = 155;

export interface RenderContext {
  /** Caminhos que EXISTEM no site (por exemplo `/cidades/sp`). Só estes viram link; sem destino, sem link. */
  readonly knownPaths: ReadonlySet<string>;
}

export function renderCityPage(template: CityTemplate, factsResult: Extract<FactsResult, { ok: true }>, ctx: RenderContext): RenderResult {
  const problems = validateTemplate(template);
  if (problems.length > 0) return { ok: false, reason: "invalid_template", detail: problems.join("; ") };
  const byKey = new Map<FactKey, Fact>(factsResult.facts.map((f) => [f.key, f]));
  const missing = template.required.filter((k) => !byKey.has(k));
  if (missing.length > 0) return { ok: false, reason: "missing_required", detail: `faltam os campos obrigatórios: ${missing.join(", ")}` };

  const name = byKey.get("name")!.value as string;
  const uf = byKey.get("uf")!.value as string;
  const used = new Map<string, Fact>();
  const fill = (text: string, ids: Set<string>): string => text.replace(TOKEN, (_m, k: FactKey) => { const f = byKey.get(k)!; used.set(f.id, f); ids.add(f.id); return show(f); });

  const sections: RenderedSection[] = [];
  for (const s of template.sections) {
    const ids = new Set<string>();
    const paragraphs = s.paragraphs.filter((p) => p.requires.every((k) => byKey.has(k))).map((p) => fill(p.text, ids));
    if (paragraphs.length > 0) sections.push({ id: s.id, heading: s.heading, paragraphs, factIds: [...ids] });
  }
  // Fontes: uma linha por fato usado, com fonte, referência e data da coleta (proveniência no próprio conteúdo).
  const usedFacts = [...used.values()];
  sections.push({
    id: "sources",
    heading: template.sourcesHeading,
    paragraphs: usedFacts.map((f) => `${LABELS[f.key]}: ${show(f)}. Fonte: ${f.source.name}, coletado em ${formatDate(f.source.collectedAt)}${f.asOf !== undefined && f.key !== "population_year" ? `, referência ${f.asOf}` : ""}.`),
    factIds: usedFacts.map((f) => f.id),
  });

  const hasPop = byKey.has("population");
  const titles = [`${name} (${uf}): ${hasPop ? "população e localização" : "localização"}`, `${name} (${uf})`];
  const title = titles.find((t) => t.length <= TITLE_MAX) ?? titles[1]!;
  const region = byKey.get("region")?.value as string | undefined;
  const pop = byKey.get("population");
  const metas = [
    `${name} (${uf})${region ? `, região ${region}` : ""}${pop ? `: estimativa de ${formatInt(pop.value as number)} habitantes em ${pop.asOf}, segundo o IBGE` : ""}. Dados e localização do município.`,
    `${name} (${uf})${pop ? `: ${formatInt(pop.value as number)} habitantes em ${pop.asOf} (IBGE)` : ""}. Dados e localização do município.`,
    `${name} (${uf}): dados e localização do município, com a fonte de cada informação.`,
  ];
  const metaDescription = metas.find((m) => m.length >= META_MIN && m.length <= META_MAX);
  if (!metaDescription) return { ok: false, reason: "meta_out_of_bounds", detail: `nenhuma variante de meta ficou entre ${META_MIN} e ${META_MAX} caracteres` };

  const linkCandidates = [{ path: `/cidades/${uf.toLowerCase()}`, text: `Cidades de ${uf}` }, { path: "/cidades", text: "Todas as cidades" }];
  const links = linkCandidates.filter((l) => ctx.knownPaths.has(l.path));

  const path = cityPath(uf, name);
  // Projeção FACTUAL para o hash (idempotência, ADR-020): sem data de coleta, execução nem hash do arquivo de origem (que mudariam a
  // cada reimportação ou por uma única linha alterada em outra cidade). Só o que define o conteúdo: texto, fatos (id, valor, ano) e versão.
  const body = {
    path, title, metaDescription, h1: `${name}, ${uf}`,
    sections: sections.filter((s) => s.id !== "sources"),
    links,
    facts: usedFacts.map((f) => ({ id: f.id, value: f.value, asOf: f.asOf ?? null })),
    template: { key: template.key, version: template.version },
  };
  const page: RenderedPage = {
    path, canonicalPath: path, title, metaDescription, h1: body.h1, sections, links, factsUsed: usedFacts,
    template: { key: template.key, version: template.version, hash: templateHash(template) },
    cityId: factsResult.cityId, ibgeCode: factsResult.ibgeCode,
    contentHash: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
  };
  return { ok: true, page };
}
