import "server-only";
import { TEMPLATE_REGISTRY, combination, eligibility, engine, runtime } from "@plataforma/api";
import type { TenantDb } from "@plataforma/api";
import { AGENT_HEADER, AGENT_PROMPTS, AGENT_PROMPTS_SOURCE, AGENT_PROMPT_VERSION, BLUEPRINT_RECIPES, DEFAULT_ELIGIBILITY_POLICY, DEFAULT_QA_POLICY, RECIPE_RENDERERS, eligibilityCoherence, realEstateCatalog } from "@plataforma/pack-real-estate";
import { activeVertical } from "./vertical";
import { loadForTenant } from "./tenant-data";

// Dados do Control Plane do motor de páginas e dos agentes (ADR-031). SOMENTE LEITURA aqui; as escritas são as ações (engine/actions.ts). Tudo por withTenant, tenant da sessão.
// Nenhum dado de demonstração: sem execução registrada, as telas mostram zero e dizem por quê.
export const PACK_ID = "real-estate";
export const PACK_VERSION = "0.1.0";
export const FILE_PROMPTS = { version: AGENT_PROMPT_VERSION, sourceSha256: AGENT_PROMPTS_SOURCE.sha256, header: AGENT_HEADER, agents: Object.fromEntries(Object.entries(AGENT_PROMPTS).map(([k, v]) => [k, { name: v.name, body: v.body }])) };
export const PIPELINE_VARS = (tenantName: string) => ({ TENANT_NAME: tenantName, DOMAIN_PACK: PACK_ID, SCORE_BRAND: "Índice", EDITORIAL_STYLE: "direto", RICH_MIN: "0.8", MAX_PROPOSALS: "5", SCOPE: "tenant" });
export const PACK_DEPS = {
  eligibility: { verticalId: activeVertical.id, attributes: realEstateCatalog.attributes, defaultPolicy: DEFAULT_ELIGIBILITY_POLICY, coherence: eligibilityCoherence },
  blueprint: { vertical: activeVertical, recipes: BLUEPRINT_RECIPES, templates: TEMPLATE_REGISTRY, attributes: realEstateCatalog.attributes },
  recipeQa: { vertical: activeVertical, recipes: BLUEPRINT_RECIPES, renderers: RECIPE_RENDERERS, qaPolicy: DEFAULT_QA_POLICY, attributes: realEstateCatalog.attributes },
} as const;

export const loadAgentRegistry = () => loadForTenant(async (db) => ({ agents: await runtime.listAgentRegistry(db, PACK_ID), filePromptVersion: AGENT_PROMPT_VERSION, llmConfigured: (process.env.ANTHROPIC_API_KEY ?? "").trim() !== "" }));
export const loadPromptVersions = (agent?: number) => loadForTenant(async (db) => ({ versions: await runtime.listPromptVersions(db, { domainPackId: PACK_ID, ...(agent ? { agent } : {}) }), filePromptVersion: AGENT_PROMPT_VERSION }));
export interface ExecParams { agent: number | null; status: string; page: number }
export const EXEC_PAGE = 30;
export function parseExecParams(raw: Record<string, string | string[] | undefined>): ExecParams {
  const one = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : "");
  const agent = Number.parseInt(one("agent"), 10); const page = Number.parseInt(one("page"), 10);
  const status = one("status");
  return { agent: agent >= 1 && agent <= 8 ? agent : null, status: ["succeeded", "failed", "invalid_output", "timed_out", "cancelled", "not_configured"].includes(status) ? status : "", page: Number.isFinite(page) && page >= 1 ? Math.min(page, 1000) : 1 };
}
export const loadAgentRuns = (p: ExecParams) => loadForTenant((db) => runtime.listAgentRuns(db, { ...(p.agent ? { agent: p.agent } : {}), ...(p.status ? { status: p.status } : {}), limit: EXEC_PAGE, offset: (p.page - 1) * EXEC_PAGE }));
export const loadAgentRun = (id: string) => loadForTenant((db) => runtime.getAgentRun(db, id));
export const loadPipelineRuns = () => loadForTenant((db) => runtime.listPipelineRuns(db, { limit: 50 }));
export const loadPipelineRun = (id: string) => loadForTenant(async (db) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const detail = await runtime.getPipelineRun(db, id); if (!detail) return null;
  return { ...detail, audit: await runtime.listDecisionAudit(db, { pipelineRunId: id }), agentRuns: (await runtime.listAgentRuns(db, { pipelineRunId: id, limit: 100 })).rows };
});
export const loadTopicDiscovery = () => loadForTenant(async (db: TenantDb) => ({ summary: await runtime.topicDiscoverySummary(db), combination: await engineCombinationFilters(db) }));
async function engineCombinationFilters(db: TenantDb) { const l = await combination.listCombinationLog(db, { limit: 1 }); return { total: l.total, byFilter: l.byFilter }; }
export const loadEligibility = (decision: string, gate: string) => loadForTenant((db) => eligibility.listLatestDecisions(db, { ...(decision && (eligibility.DECISIONS as readonly string[]).includes(decision) ? { decision: decision as eligibility.Decision } : {}), ...(gate ? { gate } : {}), limit: 50 }));
export const loadEngineOpportunity = (id: string) => loadForTenant(async (db) => ({ view: await runtime.getEngineView(db, id), detail: await engine.getOpportunity(db, id) }));
export const progressItems = () => engine.ENGINE_PROGRESS;
