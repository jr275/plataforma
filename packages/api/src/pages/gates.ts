import type { City, ImportRunSummary } from "../ingest/read";
import { buildCityFacts, formatInt, renderCityPage, type CityTemplate, type RenderedPage } from "./city-overview";

// Os seis gates de qualidade da geração de páginas (ADR-020). PUROS: cada gate recebe o conteúdo e o contexto e grava o PRÓPRIO
// resultado (`pass`, `fail` ou `skipped`, sempre com detalhe); nunca há nota composta (regra 5). Um item bloqueado não impede os demais.

export const GATES = ["required_fields", "url_unique", "url_stable", "metadata_valid", "links_resolve", "facts_traceable"] as const;
export type GateName = (typeof GATES)[number];
export interface GateResult { readonly gate: GateName; readonly outcome: "pass" | "fail" | "skipped"; readonly detail: string }

export const TITLE_MAX = 60;
export const META_MIN = 70;
export const META_MAX = 155;

export interface ExistingPage { readonly id: string; readonly versionId: string; readonly path: string; readonly status: "draft" | "blocked"; readonly latestVersion: number; readonly latestHash: string }

export interface GenerationContext {
  readonly template: CityTemplate;
  /** Caminhos que existem no site: só estes podem ser destino de link. */
  readonly knownPaths: ReadonlySet<string>;
  /** `path` → entidade dona (páginas já existentes no tenant e as reservadas por itens anteriores do lote). Mutável de propósito. */
  readonly pathOwners: Map<string, string>;
  readonly titleOwners: Map<string, string>;
  readonly metaOwners: Map<string, string>;
  readonly existingByEntity: ReadonlyMap<string, ExistingPage>;
  /** Links configurados no editor de blueprint (opcional). */
  readonly linkCandidates?: readonly { readonly path: string; readonly text: string }[];
}

export interface ItemEvaluation {
  readonly entityId: string;
  readonly outcome: "generated" | "unchanged" | "blocked";
  /** Sempre os seis, na ordem de GATES. */
  readonly gates: readonly GateResult[];
  readonly page?: RenderedPage;
  readonly existing?: ExistingPage;
}

const pass = (gate: GateName, detail: string): GateResult => ({ gate, outcome: "pass", detail });
const fail = (gate: GateName, detail: string): GateResult => ({ gate, outcome: "fail", detail });
const skipped = (gate: GateName): GateResult => ({ gate, outcome: "skipped", detail: "sem conteúdo para avaliar" });

const NUMBER_TOKEN = /\d[\d./]*/g;
const tokens = (text: string): string[] => (text.match(NUMBER_TOKEN) ?? []).map((t) => t.replace(/[./]+$/, ""));
const formatDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Reconferência INDEPENDENTE do render: todo fato tem fonte e confiança; todo algarismo do texto vem de um fato usado. */
export function checkFactsTraceable(page: RenderedPage): GateResult {
  const problems: string[] = [];
  const allowed = new Set<string>();
  for (const f of page.factsUsed) {
    if (!f.source.name || !f.source.runId || !/^[0-9a-f]{64}$/.test(f.source.sha256) || !/^\d{4}-\d{2}-\d{2}$/.test(f.source.collectedAt)) problems.push(`fato ${f.id} sem fonte completa`);
    if (f.confidence !== "high") problems.push(`fato ${f.id} sem confiança alta`);
    if (f.key === "population" && f.asOf === undefined) problems.push(`fato ${f.id} sem ano de referência`);
    const shown = f.key === "population" ? formatInt(f.value as number) : String(f.value);
    for (const t of tokens(`${shown} ${f.asOf ?? ""} ${formatDate(f.source.collectedAt)}`)) allowed.add(t);
  }
  const prose = [page.title, page.metaDescription, page.h1, ...page.sections.flatMap((s) => [s.heading, ...s.paragraphs])].join("\n");
  const orphan = tokens(prose).filter((t) => !allowed.has(t));
  if (orphan.length > 0) problems.push(`número(s) no texto sem fato de origem: ${[...new Set(orphan)].join(", ")}`);
  const ids = new Set(page.factsUsed.map((f) => f.id));
  for (const s of page.sections) for (const id of s.factIds) if (!ids.has(id)) problems.push(`a seção ${s.id} cita o fato ${id}, que não está em factsUsed`);
  return problems.length > 0 ? fail("facts_traceable", problems.join("; ")) : pass("facts_traceable", `${page.factsUsed.length} fatos com fonte; todo número da prosa vem de um fato`);
}

export function checkMetadata(page: RenderedPage, entityId: string, ctx: Pick<GenerationContext, "titleOwners" | "metaOwners">): GateResult {
  const problems: string[] = [];
  if (page.title.length < 1 || page.title.length > TITLE_MAX) problems.push(`título com ${page.title.length} caracteres (limite ${TITLE_MAX})`);
  if (page.metaDescription.length < META_MIN || page.metaDescription.length > META_MAX) problems.push(`meta com ${page.metaDescription.length} caracteres (de ${META_MIN} a ${META_MAX})`);
  if (page.h1.trim() === "") problems.push("h1 vazio");
  const t = ctx.titleOwners.get(page.title);
  if (t !== undefined && t !== entityId) problems.push("título repetido em outra página do tenant");
  const m = ctx.metaOwners.get(page.metaDescription);
  if (m !== undefined && m !== entityId) problems.push("meta repetida em outra página do tenant");
  return problems.length > 0 ? fail("metadata_valid", problems.join("; ")) : pass("metadata_valid", `título ${page.title.length}, meta ${page.metaDescription.length}, h1 presente, sem repetição`);
}

export function checkLinks(page: RenderedPage, known: ReadonlySet<string>): GateResult {
  const broken = page.links.filter((l) => !known.has(l.path) || !l.path.startsWith("/") || l.path === page.path);
  const dup = page.links.length !== new Set(page.links.map((l) => l.path)).size;
  if (broken.length > 0) return fail("links_resolve", `link(s) para destino inexistente ou inválido: ${broken.map((l) => l.path).join(", ")}`);
  if (dup) return fail("links_resolve", "link repetido");
  return pass("links_resolve", `${page.links.length} link(s), todos para destinos existentes`);
}

/**
 * Avalia UMA cidade: renderiza e aplica os seis gates. Nunca lança por dado ruim: o problema vira resultado de gate. O resultado é
 * `blocked` se qualquer gate falha; senão `unchanged` (mesmo hash da última versão) ou `generated` (conteúdo novo ou alterado).
 */
export function evaluateCity(city: City, run: Pick<ImportRunSummary, "id" | "sourceName" | "origin" | "status" | "fileSha256" | "finishedAt">, ctx: GenerationContext): ItemEvaluation {
  const existing = ctx.existingByEntity.get(city.id);
  const base = { entityId: city.id, ...(existing ? { existing } : {}) };
  const blockedAll = (first: GateResult): ItemEvaluation => ({ ...base, outcome: "blocked", gates: GATES.map((g) => (g === first.gate ? first : skipped(g))) });

  let facts: ReturnType<typeof buildCityFacts>;
  let rendered: ReturnType<typeof renderCityPage> | undefined;
  try {
    facts = buildCityFacts(city, run);
    if (!facts.ok) return blockedAll(fail("required_fields", `origem ou execução inválida: ${facts.reason}`));
    rendered = renderCityPage(ctx.template, facts, { knownPaths: ctx.knownPaths, ...(ctx.linkCandidates ? { linkCandidates: ctx.linkCandidates } : {}) });
  } catch (e) {
    return blockedAll(fail("required_fields", `erro ao renderizar: ${e instanceof Error ? e.message : String(e)}`));
  }
  if (!rendered.ok && rendered.reason !== "meta_out_of_bounds") return blockedAll(fail("required_fields", `${rendered.reason}: ${rendered.detail}`));
  if (!rendered.ok) {
    // Campos obrigatórios e origem estão certos; só o metadado não coube nos limites.
    const gates = GATES.map((g) => (g === "required_fields" ? pass(g, "origem real e campos obrigatórios presentes") : g === "metadata_valid" ? fail(g, rendered!.detail) : skipped(g)));
    return { ...base, outcome: "blocked", gates };
  }
  const page = rendered.page;

  const owner = ctx.pathOwners.get(page.path);
  const gates: GateResult[] = [
    pass("required_fields", "origem real e campos obrigatórios presentes"),
    owner !== undefined && owner !== city.id ? fail("url_unique", `o caminho ${page.path} já pertence a outra entidade`) : pass("url_unique", `${page.path} é única no tenant`),
    existing && existing.path !== page.path ? fail("url_stable", `a cidade já tem a URL ${existing.path} e passaria a ${page.path}: exige redirecionamento (etapa de publicação)`) : pass("url_stable", existing ? "mesma URL da página existente" : "página nova"),
    checkMetadata(page, city.id, ctx),
    checkLinks(page, ctx.knownPaths),
    checkFactsTraceable(page),
  ];
  if (gates.some((g) => g.outcome === "fail")) return { ...base, outcome: "blocked", gates, page };
  const unchanged = existing !== undefined && existing.latestHash === page.contentHash;
  return { ...base, outcome: unchanged ? "unchanged" : "generated", gates, page };
}
