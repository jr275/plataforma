import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async (orig) => ({ ...(await orig<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }) }));
vi.mock("@/app/(app)/engine/factory-actions", () => ({ cancelBatchAction: async () => null, confirmBatchAction: async () => null, createDeploymentAction: async () => null, decidePagesAction: async () => null, planBatchAction: async () => null, refreshDeploymentAction: async () => null, startBatchAction: async () => null, verifyDeploymentAction: async () => null }));
import { factory } from "@plataforma/api";
import type { Loaded } from "@/lib/server/tenant-data";
import { FactoryOverview, PagesView, PipelineView, stageState } from "./factory-views";
import { BatchDetailView, DeploymentDetailView, DeploymentsView, TemplateInspectorView } from "./factory-views2";

// FIXTURES DE TESTE (formas dos registros que o banco devolve), nunca exibidas em produção: provam rótulos, estados distintos, "não instrumentado" ≠ zero e o que cada tela promete.
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const ready = <T,>(data: T): Loaded<T> => ({ state: "ready", data, origin: undefined });
const T = new Date("2026-10-14T12:00:00Z");
const values = Object.fromEntries(factory.METRICS.map((m) => [m.id, m.id === "pages_indexed" ? { state: "not_instrumented" as const, reason: "Sem Search Console conectado" } : { state: "available" as const, value: 7, previous: m.kind === "period_events" ? 4 : null }]));
const metrics = { asOf: T, periodDays: 7, values } as factory.FactoryMetrics;
const stage = (over: Partial<factory.StageView> = {}): factory.StageView => ({ id: "eligibility", n: 7, label: "Eligibility", unit: "tópicos", source: "eligibility_decision", definition: "def", instrumented: true, note: null, total: 10, completed: 4, running: 0, waiting: 0, blocked: 6, failed: 0, skipped: 0, avgDurationMs: null, successRate: 0.4, lastUpdate: T, reasons: [{ reason: "DATA_REQUIRED", count: 6 }], ...over });
const row = (over: Partial<factory.PageRow> = {}): factory.PageRow => ({ opportunityId: "o1", topicId: "t".repeat(64), primaryQuery: "Guarulhos", family: "04-cidade", intent: "informational", lifecycle: "qa", stage: "awaiting_approval", entity: "Guarulhos", title: "Guarulhos: dados", h1: "Guarulhos", url: "/cidades/sp/guarulhos", templateId: "city-overview", blueprintStatus: "COMPLETE", recipeVersion: 2, blocksFilled: 5, blocksInsufficient: 1, editorial: "agent7", qaOutcome: "QA_PASSED", approval: null, deploymentStatus: null, deploymentTarget: null, publishedVersion: null, updatedAt: T, ...over });
const params = { q: "", stage: "" as const, family: "", template: "", qa: "", deployment: "", editorial: "" as const, page: 1 };

describe("visão geral", () => {
  it("mostra os seis estados distintos, cada métrica com fonte e escopo, e a indexação como NÃO instrumentada (nunca zero)", () => {
    const out = html(<FactoryOverview loaded={ready({ metrics, stages: [stage()] })} days={7} />);
    for (const id of ["opportunities_eligible", "blueprints_created", "pages_generated", "pages_approved", "pages_published", "pages_indexed"]) expect(out).toContain(`data-step="${id}"`);
    expect(out).toContain('data-value="not_instrumented"'); expect(out).toContain("Sem Search Console conectado"); expect(out).toContain("Fonte:"); expect(out).toContain("Escopo:"); expect(out).toContain("+3 vs período anterior (4)");
    expect(out.match(/data-metric="/g)!.length).toBeGreaterThanOrEqual(20);
  });
  it("estado indisponível explica o motivo em vez de números", () => expect(html(<FactoryOverview loaded={{ state: "db_unavailable" } as Loaded<never>} days={7} />)).not.toContain("data-metric"));
});

describe("pipeline", () => {
  it("o estado visual de cada etapa distingue falha, execução, bloqueio, espera, conclusão, vazio e não instrumentada", () => {
    expect(stageState(stage({ failed: 1 })).label).toBe("com falhas"); expect(stageState(stage({ failed: 0, running: 2, blocked: 0 })).label).toBe("em execução"); expect(stageState(stage()).label).toBe("com bloqueios");
    expect(stageState(stage({ blocked: 0, completed: 4, total: 10, waiting: 6 })).label).toBe("aguardando"); expect(stageState(stage({ blocked: 0, completed: 10, waiting: 0 })).label).toBe("concluída"); expect(stageState(stage({ total: 0, completed: 0, blocked: 0 })).label).toBe("sem itens"); expect(stageState(stage({ instrumented: false })).label).toBe("não instrumentada");
  });
  it("a etapa aberta mostra contagens, motivos e entrada/saída; sem etapa escolhida pede para escolher", () => {
    const s = [stage({ id: "topic_discovery", n: 4, label: "Topic Discovery", total: 10, completed: 10, blocked: 0 }), stage()];
    const open = html(<PipelineView loaded={ready({ stages: s, metrics })} selected="eligibility" />);
    expect(open).toContain('data-testid="stage-counts"'); expect(open).toContain("DATA_REQUIRED"); expect(open).toContain("Entrada:"); expect(open).toContain("Saída:"); expect(open).toContain("40%");
    expect(html(<PipelineView loaded={ready({ stages: s, metrics })} selected="" />)).toContain("Escolha uma etapa");
  });
});

describe("lista de páginas", () => {
  it("separa candidata, gerada, aprovada e publicada, mostra blocos sem dado e versão publicada; seleção ligada ao formulário de lote", () => {
    const rows = [row(), row({ opportunityId: "o2", stage: "published", approval: "APPROVED", deploymentStatus: "VERIFIED", deploymentTarget: "production", publishedVersion: 2 }), row({ opportunityId: "o3", stage: "candidate", title: null, url: null, recipeVersion: null, blocksFilled: null, blocksInsufficient: null, qaOutcome: null, editorial: null })];
    const out = html(<PagesView loaded={ready({ list: { total: 3, byStage: { awaiting_approval: 1, published: 1, candidate: 1 }, rows }, facets: { families: ["04-cidade"], templates: ["city-overview"] } })} params={params} pageSize={25} />);
    expect(out).toContain("Aguardando aprovação (1)"); expect(out).toContain("Publicada (1)"); expect(out).toContain("Candidata (1)"); expect(out).toContain("publicada v2"); expect(out).toContain("1 sem dado"); expect(out).toContain("URL ainda não definida");
    expect(out.match(/form="decide-form"/g)).toHaveLength(3); expect(out).toContain('id="decide-form"');
  });
  it("sem resultado: estado vazio; paginação só aparece quando há próxima/anterior", () => {
    const empty = html(<PagesView loaded={ready({ list: { total: 0, byStage: {}, rows: [] }, facets: { families: [], templates: [] } })} params={params} pageSize={25} />); expect(empty).toContain("Nenhuma página com esses filtros");
    const many = html(<PagesView loaded={ready({ list: { total: 60, byStage: {}, rows: [row()] }, facets: { families: [], templates: [] } })} params={{ ...params, page: 2 }} pageSize={25} />); expect(many).toContain("← Anterior"); expect(many).toContain("Próxima →"); expect(many).toContain("Página 2 de 3");
  });
});

const counters = { selected: 10, eligible: 4, notEligible: { blocked: 0, dataPending: 6, alreadyDone: 0 }, pending: 0, running: 1, approved: 1, awaitingHuman: 1, blocked: 0, failed: 1, cancelled: 0 };
const batch = (over: Partial<factory.BatchRecord> = {}): factory.BatchRecord => ({ id: "b1", name: "Lote", status: "RUNNING", mode: "test_simulation", config: { ...factory.DEFAULT_CONFIG, target: "production" }, estimate: { candidates: 10, eligible: 4, blocked: 0, dataPending: 6, alreadyDone: 0, estimatedBatches: 1, awaitingSerp: 1, externalDependencies: ["ANTHROPIC_API_KEY ausente"], cost: { available: false, reason: "Sem metodologia de custo" } }, cancelRequested: false, createdBy: "u", createdAt: T, confirmedBy: "u", confirmedAt: T, startedAt: T, finishedAt: null, ...over });
describe("lote", () => {
  const view = (b = batch(), c = counters): factory.BatchView => ({ batch: b, counters: c, byStage: {}, elapsedMs: 10_000, ratePerMinute: null, etaMs: null, recent: [], errors: [{ opportunityId: "o9", error: "falha no passo recipe_qa", attempts: 1 }], blockReasons: [{ reason: "decisão RESEARCH_REQUIRED", count: 6 }], awaiting: [{ opportunityId: "o8", reason: "aguardando SERP" }] });
  it("os contadores vêm do estado e somam: cada item em uma caixa; simulação é rotulada; sem ritmo/estimativa quando não há base", () => {
    const out = html(<BatchDetailView loaded={ready(view())} />);
    for (const l of ["Candidatos selecionados", "Elegíveis para geração", "Aguardando geração", "Em geração", "QA aprovado", "Aguardando intervenção humana", "Bloqueadas", "Falhas", "Canceladas"]) expect(out).toContain(`data-counter="${l}"`);
    expect(out).toContain("SIMULAÇÃO DE TESTE"); expect(out).toContain("PRODUÇÃO (exigiu autorização)"); expect(out).toContain("Base insuficiente"); expect(out).toContain("Só com 5+ desfechos"); expect(out).toContain("não animado"); expect(out).toContain("falha no passo recipe_qa"); expect(out).toContain("Sem metodologia de custo");
    expect(counters.pending + counters.running + counters.approved + counters.awaitingHuman + counters.blocked + counters.failed + counters.cancelled).toBe(counters.eligible);
  });
  it("controles por estado: planejado confirma (e pede a frase em produção), em execução cancela, concluído retoma", () => {
    expect(html(<BatchDetailView loaded={ready(view(batch({ status: "PLANNED", confirmedAt: null, confirmedBy: null, startedAt: null })))} />)).toContain("AUTORIZO PRODUÇÃO");
    expect(html(<BatchDetailView loaded={ready(view(batch({ status: "RUNNING" })))} />)).toContain("Cancelar");
    const done = html(<BatchDetailView loaded={ready(view(batch({ status: "COMPLETED", finishedAt: T })))} />); expect(done).toContain("Retomar / retentar"); expect(done).not.toContain(">Cancelar<");
  });
});

describe("deployment center", () => {
  const dep = (over: Partial<factory.DeploymentRecord> = {}): factory.DeploymentRecord => ({ id: "d1", provider: "vercel", projectRef: "p", target: "preview", status: "READY", providerDeploymentId: "dpl_1", url: "https://x.vercel.app", gitBranch: "main", gitCommit: "abc1234", batchId: "b1", authorizedBy: null, error: null, createdBy: "u", createdAt: T, updatedAt: T, pages: 2, ...over });
  it("sem credenciais: bloqueio externo com o que falta; estados distintos (pronto ≠ verificado ≠ falhou) e contagem por estado", () => {
    const out = html(<DeploymentsView loaded={ready({ list: { total: 3, byStatus: { READY: 1, VERIFIED: 1, FAILED: 1 }, rows: [dep(), dep({ id: "d2", status: "VERIFIED" }), dep({ id: "d3", status: "FAILED", error: "build" })] }, approved: { total: 0, rows: [] }, config: { configured: false, missing: ["VERCEL_TOKEN", "VERCEL_PROJECT"] } })} status="" />);
    expect(out).toContain("bloqueado: integração não configurada"); expect(out).toContain("VERCEL_TOKEN, VERCEL_PROJECT"); expect(out).toContain("Pronto (não verificado)"); expect(out).toContain("Verificado"); expect(out).toContain("Falhou"); expect(out).toContain("Nenhuma página aprovada");
  });
  it("com credenciais presentes avisa que presente não prova integração; página aprovada aparece para envio com destino preview por padrão", () => {
    const out = html(<DeploymentsView loaded={ready({ list: { total: 0, byStatus: {}, rows: [] }, approved: { total: 1, rows: [row({ stage: "approved", approval: "APPROVED" })] }, config: { configured: true, token: "x", project: "p", teamId: null } })} status="" />);
    expect(out).toContain("não prova"); expect(out).toContain("Guarulhos: dados"); expect(out).toContain("Preview (padrão)"); expect(out).toContain("Nenhum deployment registrado");
  });
  it("o detalhe mostra a linha do tempo com a ORIGEM de cada estado e o botão de verificar só para deployment pronto", () => {
    const g = { deployment: dep(), events: [{ status: "READY" as const, providerState: "READY", source: "poll", detail: {}, at: T }, { status: "QUEUED" as const, providerState: null, source: "request", detail: {}, at: T }], pages: [{ opportunityId: "o1", recipeId: "r1", path: "/cidades/sp/guarulhos", httpStatus: 200, verifiedAt: T }, { opportunityId: "o2", recipeId: "r2", path: "/x", httpStatus: null, verifiedAt: null }] };
    const out = html(<DeploymentDetailView loaded={ready(g)} />); expect(out).toContain("consulta ao provedor"); expect(out).toContain("pedido"); expect(out).toContain("HTTP 200 · verificada"); expect(out).toContain("Verificar URLs"); expect(out).toContain("Consultar a Vercel");
    const v = html(<DeploymentDetailView loaded={ready({ ...g, deployment: dep({ status: "VERIFIED" }) })} />); expect(v).not.toContain("Verificar URLs"); expect(v).not.toContain("Consultar a Vercel");
  });
});

describe("inspetor de templates", () => {
  it("mostra o contrato, a lacuna de template e que o LLM só preenche slots", () => {
    const item = { family: "13-comparacao", pageType: "comparação", archetype: "comparison", templateId: "city-comparison", hasUrlRule: false, templateAvailable: false, hasRenderer: true, modules: [{ moduleId: "comparacao", minItems: 1, onMissing: "remove" as const, fields: [{ field: "population", attribute: "city.population" }, { field: "city_name", attribute: null }], visibility: "omitido quando houver menos de 1 campo(s) com fato" }], schemaTypes: ["Dataset"], claims: [{ claimType: "população", sourceClass: "IBGE", attribute: "city.population" }], moduleRequirements: ["comparison-table"], kpis: ["clicks"], refreshTrigger: "novo ano", maxAgeDays: 800, patterns: { title: "{city_name}", h1: "{city_name}", meta: "m" }, editorialSlots: "um slot de narrativa por parágrafo; o Agente 7 nunca cria módulos" };
    const out = html(<TemplateInspectorView items={[item]} />);
    expect(out).toContain("lacuna de template"); expect(out).toContain("URL ainda não definida"); expect(out).toContain("population ← city.population"); expect(out).toContain("city_name ← entidade"); expect(out).toContain("nunca cria módulos"); expect(out).toContain("omitido quando houver menos");
  });
});
