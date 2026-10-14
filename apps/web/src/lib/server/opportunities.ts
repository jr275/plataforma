import "server-only";
import { TEMPLATE_REGISTRY, engine, isUndefinedTable, previewCityPage, type CityPreview, type engine as E } from "@plataforma/api";
import { activeVertical, researchAdapters } from "./vertical";
import { loadForTenant } from "./tenant-data";

// Dados da área "Oportunidades" (ADR-023). Só funções tipadas de packages/api, sempre por withTenant. SOMENTE LEITURA aqui; as escritas são as ações.
export const OPPORTUNITY_PAGE_SIZE = 25;
export interface OpportunityParams { q: string; status: "" | E.LifecycleState; intent: string; eligible: "" | "yes" | "no"; priorityKind: "" | "overall" | "partial" | "none"; sort: E.OpportunitySort; page: number }

export function parseOpportunityParams(raw: Record<string, string | string[] | undefined>): OpportunityParams {
  const one = (k: string) => { const v = raw[k]; return typeof v === "string" ? v : ""; };
  const status = one("status");
  const intent = one("intent");
  const kind = one("priority");
  const sort = one("sort");
  const page = Number.parseInt(one("page"), 10);
  return {
    q: one("q").trim().slice(0, 80),
    status: engine.isState(status) ? status : "",
    intent: activeVertical.intents.some((i) => i.id === intent) ? intent : "",
    eligible: one("eligible") === "yes" ? "yes" : one("eligible") === "no" ? "no" : "",
    priorityKind: (engine.PRIORITY_KINDS as readonly string[]).includes(kind) ? (kind as OpportunityParams["priorityKind"]) : "",
    sort: (engine.SORTS as readonly string[]).includes(sort) ? (sort as E.OpportunitySort) : "priority",
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 10_000) : 1,
  };
}

export interface OpportunitiesData { list: E.OpportunityList; runs: E.ResearchRunRow[]; evidenceCount: number }
export const loadOpportunities = (p: OpportunityParams) => loadForTenant<OpportunitiesData>(async (db) => {
  const list = await engine.searchOpportunities(db, {
    q: p.q || undefined, status: p.status || undefined, intent: p.intent || undefined,
    eligible: p.eligible === "" ? undefined : p.eligible === "yes", priorityKind: p.priorityKind || undefined,
    sort: p.sort, limit: OPPORTUNITY_PAGE_SIZE, offset: (p.page - 1) * OPPORTUNITY_PAGE_SIZE,
  });
  const runs = await engine.listResearchRuns(db, 5);
  const evidenceCount = (await engine.searchEvidence(db, { limit: 200 })).length;
  return { list, runs, evidenceCount };
});

export interface OpportunityDetailData { detail: E.OpportunityDetail | null; configs: engine.ActiveConfig[]; blueprints: E.BlueprintRecord[]; investigation: E.Investigation | null; serpWaiver: E.SerpWaiver | null }

/** Resumo operacional + exceção de SERP vigente, calculados (puro) a partir do que foi lido. */
export function summarize(detail: E.OpportunityDetail | null, blueprints: readonly E.BlueprintRecord[]): { investigation: E.Investigation | null; serpWaiver: E.SerpWaiver | null } {
  if (!detail) return { investigation: null, serpWaiver: null };
  const serpWaiver = engine.findSerpWaiver(detail.events);
  const latest = blueprints[0];
  return {
    serpWaiver,
    investigation: engine.investigate({ status: detail.status, score: detail.scores[0]?.result ?? null, evidence: detail.evidence.map((e) => ({ adapter: e.evidence.adapter, role: e.role as "signal" | "requirement" })), blueprint: latest ? { version: latest.version, ready: latest.ready, blockers: latest.report.blockers.map((b) => b.key) } : null, serpWaiver: serpWaiver ? { reviewed: serpWaiver.reviewed } : null }, activeVertical),
  };
}
export const loadOpportunityDetail = (id: string) => loadForTenant<OpportunityDetailData>(async (db) => {
  const detail = await engine.getOpportunity(db, id);
  const configs = await engine.listScoreConfigs(db, activeVertical.id);
  const blueprints = await engine.listBlueprints(db, id);
  return { detail, configs, blueprints, ...summarize(detail, blueprints) };
});

export type EditorLoad = { readonly state: E.DraftState } | { readonly unavailable: string };
export type PagesLoad = { readonly rows: readonly E.OpportunityPageRecord[] } | { readonly unavailable: string };
export interface BlueprintPageData extends OpportunityDetailData { preview: CityPreview | null; editor: EditorLoad; pages?: PagesLoad }
/** Dados da página de blueprint: o detalhe, as versões, a exceção de SERP e a prévia da experiência (renderizada agora, não persistida). */
export async function blueprintPageData(db: import("@plataforma/api").TenantDb, id: string): Promise<BlueprintPageData> {
  const detail = await engine.getOpportunity(db, id);
  const configs = await engine.listScoreConfigs(db, activeVertical.id);
  const blueprints = await engine.listBlueprints(db, id);
  const bp = blueprints[0]?.blueprint;
  const preview = bp && bp.template.status === "selected" && bp.entity?.kind === "city" ? await previewCityPage(db, bp.entity.id) : null;
  // O editor é carregado POR ÚLTIMO: se a migration 0010 ainda não existe neste banco, só o editor fica indisponível (o resto da página continua).
  let editor: EditorLoad = { unavailable: "Gere o blueprint para editar o rascunho." };
  if (blueprints[0]) {
    try { editor = { state: await engine.loadPageDraft(db, id, { vertical: activeVertical, templates: TEMPLATE_REGISTRY }) }; }
    catch (e) { editor = { unavailable: isUndefinedTable(e) ? "A tabela do rascunho ainda não existe neste banco: a migration 0010 precisa ser aplicada." : "Não foi possível carregar o rascunho agora." }; if (!isUndefinedTable(e)) throw e; }
  }
  // As páginas geradas vêm da migration 0012; se ela ainda não existe neste banco, só esta seção fica indisponível.
  let pages: PagesLoad = { rows: [] };
  try { pages = { rows: await engine.listOpportunityPages(db, id) }; }
  catch (e) { if (!isUndefinedTable(e)) throw e; pages = { unavailable: "A tabela da ligação oportunidade-página ainda não existe neste banco: a migration 0012 precisa ser aplicada." }; }
  return { detail, configs, blueprints, preview, editor, pages, ...summarize(detail, blueprints) };
}
export const loadBlueprintPage = (id: string) => loadForTenant<BlueprintPageData>((db) => blueprintPageData(db, id));

export interface ScoreConfigData { configs: engine.ActiveConfig[] }
export const loadScoreConfigs = () => loadForTenant<ScoreConfigData>(async (db) => {
  const configs = await engine.listScoreConfigs(db, activeVertical.id);
  return { configs };
});

export interface TrendsData { evidence: E.EvidenceRow[]; runs: E.ResearchRunRow[] }
export const loadTrends = (f: { kind?: string; adapter?: string }) => loadForTenant<TrendsData>(async (db) => ({
  evidence: await engine.searchEvidence(db, { ...f, limit: 100 }),
  runs: await engine.listResearchRuns(db, 10),
}));

export const researchAdapterInfo = researchAdapters.map((a) => ({ id: a.id, label: a.label, provider: a.provider, kind: a.kind, docsUrl: a.docsUrl, terms: a.terms }));

export const loadRoadmapData = () => loadForTenant<E.Roadmap>((db) => engine.loadRoadmap(db, activeVertical));
