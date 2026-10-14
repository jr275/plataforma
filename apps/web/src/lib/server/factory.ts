import "server-only";
import { architecture, factory, qa, runtime } from "@plataforma/api";
import { BLUEPRINT_RECIPES, RECIPE_RENDERERS } from "@plataforma/pack-real-estate";
import { TEMPLATE_REGISTRY } from "@plataforma/api";
import { loadForTenant } from "./tenant-data";

// Dados da Fábrica de páginas (ADR-032). SOMENTE LEITURA; as escritas são ações do servidor. Toda lista é paginada e filtrada NO BANCO; nada é buscado inteiro para filtrar no cliente.
export const PAGE_SIZE = 25;
export interface PageParams { q: string; stage: "" | factory.PageStage; family: string; template: string; qa: string; deployment: string; editorial: "" | "agent7" | "template"; archetype: string; cluster: string; eligibility: "" | "approval" | "publication" | "indexing" | "not_indexing" | "no_gate"; linkFailure: boolean; conflict: boolean; page: number }
export function parsePageParams(raw: Record<string, string | string[] | undefined>): PageParams {
  const one = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : "");
  const stage = one("stage"); const ed = one("editorial"); const page = Number.parseInt(one("page"), 10);
  return { q: one("q").trim().slice(0, 80), stage: (factory.PAGE_STAGES as readonly string[]).includes(stage) ? (stage as factory.PageStage) : "", family: one("family").slice(0, 80), template: one("template").slice(0, 80), qa: ["QA_PASSED", "QA_FAILED", "QA_INCOMPLETE"].includes(one("qa")) ? one("qa") : "", deployment: factory.DEPLOYMENT_STATUSES.includes(one("deployment") as never) ? one("deployment") : "", editorial: ed === "agent7" || ed === "template" ? ed : "", archetype: /^T(0[1-9]|1[0-2])$/.test(one("archetype")) ? one("archetype") : "", cluster: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(one("cluster")) ? one("cluster") : "", eligibility: (["approval", "publication", "indexing", "not_indexing", "no_gate"] as const).find((x) => x === one("eligibility")) ?? "", linkFailure: one("linkFailure") === "1", conflict: one("conflict") === "1", page: Number.isFinite(page) && page >= 1 ? Math.min(page, 10_000) : 1 };
}
export const loadFactoryOverview = (days: number) => loadForTenant(async (db) => ({ metrics: await factory.factoryMetrics(db, { periodDays: days }), stages: await factory.pipelineStages(db) }));
export const loadStages = () => loadForTenant(async (db) => ({ stages: await factory.pipelineStages(db), metrics: await factory.factoryMetrics(db) }));
export const loadPages = (p: PageParams) => loadForTenant(async (db) => ({
  list: await factory.listPages(db, { ...(p.q ? { q: p.q } : {}), ...(p.stage ? { stage: p.stage } : {}), ...(p.family ? { family: p.family } : {}), ...(p.template ? { template: p.template } : {}), ...(p.qa ? { qa: p.qa } : {}), ...(p.deployment ? { deployment: p.deployment } : {}), ...(p.editorial ? { editorial: p.editorial } : {}), ...(p.archetype ? { archetype: p.archetype } : {}), ...(p.cluster ? { cluster: p.cluster } : {}), ...(p.eligibility ? { eligibility: p.eligibility } : {}), ...(p.linkFailure ? { linkFailure: true } : {}), ...(p.conflict ? { conflict: true } : {}), limit: PAGE_SIZE, offset: (p.page - 1) * PAGE_SIZE }),
  facets: await factory.pageFacets(db),
}));
export interface PageDetail { row: factory.PageRow; view: runtime.EngineView; approvals: factory.ApprovalRecord[]; deployments: Awaited<ReturnType<typeof factory.listPageDeployments>>; recipes: qa.RecipeRecord[]; architecture: architecture.StoredArchitecture | null }
export const loadPageDetail = (id: string) => loadForTenant<PageDetail | null>(async (db) => {
  const row = await factory.getPageRow(db, id); if (!row) return null;
  const view = (await runtime.getEngineView(db, id))!;
  return { row, view, approvals: await factory.listApprovals(db, id), deployments: await factory.listPageDeployments(db, id), recipes: view.recipes as qa.RecipeRecord[], architecture: await architecture.getStoredArchitecture(db, id) };
});
/** Clusters, política de links e perfis: SOMENTE LEITURA (a análise é uma ação explícita do servidor). */
export const loadClusters = () => loadForTenant(async (db) => ({ clusters: await architecture.listClusters(db), linkPolicy: (await architecture.getLinkPolicy(db)).policy, archetypes: architecture.ARCHETYPE_CATALOG.map((a) => ({ id: a.id, name: a.name, version: a.version })) }));
export const loadBatches = () => loadForTenant(async (db) => ({ batches: await factory.listBatches(db), facets: await factory.pageFacets(db), llmConfigured: (process.env.ANTHROPIC_API_KEY ?? "").trim() !== "" }));
export const loadBatch = (id: string) => loadForTenant((db) => factory.getBatchView(db, id));
export const loadDeployments = (status: string) => loadForTenant(async (db) => ({ list: await factory.listDeployments(db, status ? { status } : {}), approved: await factory.listPages(db, { stage: "approved", limit: 100 }), config: factory.vercelConfig(process.env as factory.VercelEnv) }));
export const loadDeployment = (id: string) => loadForTenant((db) => factory.getDeployment(db, id));

/** Inspetor de templates e módulos: o contrato de renderização do pack (receitas, módulos, dependências de dados, slots editoriais, regras de visibilidade). Estático (vem do código do pack), sem banco. */
export function templateInspector() {
  return BLUEPRINT_RECIPES.map((r) => ({
    family: r.family, pageType: r.pageType, archetype: r.archetype, templateId: r.templateId, hasUrlRule: r.urlFor({ name: "Exemplo", qualifier: "SP", sourceKey: "x" }) !== null,
    templateAvailable: TEMPLATE_REGISTRY.some((t) => t.key === r.templateId), hasRenderer: RECIPE_RENDERERS.some((x) => x.family === r.family),
    modules: r.modules.map((m) => ({ moduleId: m.moduleId, minItems: m.minItems, onMissing: m.onMissing, fields: m.fields.map((f) => ({ field: f.field, attribute: f.attribute })), visibility: m.onMissing === "remove" ? `omitido quando houver menos de ${m.minItems} campo(s) com fato` : `mostra aviso de insuficiência quando houver menos de ${m.minItems} campo(s) com fato` })),
    schemaTypes: r.schemaTypes, claims: r.claims, moduleRequirements: r.moduleRequirements, kpis: r.kpis, refreshTrigger: r.refreshTrigger, maxAgeDays: r.maxAgeDays, patterns: r.defaultPatterns,
    editorialSlots: "um slot de narrativa por parágrafo de módulo renderizado; o Agente 7 só preenche slots existentes, com referências de fatos do slot, e nunca cria módulos",
  }));
}
