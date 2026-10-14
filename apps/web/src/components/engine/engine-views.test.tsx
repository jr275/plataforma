import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async (orig) => ({ ...(await orig<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }) }));
vi.mock("@/app/(app)/engine/actions", () => ({ activatePromptAction: async () => null, cancelPipelineAction: async () => null, registerPromptAction: async () => null, rollbackPromptAction: async () => null, runPagePipelineAction: async () => null, syncRegistryAction: async () => null }));
import { agents, engine } from "@plataforma/api";
import type { Loaded } from "@/lib/server/tenant-data";
import { AgentRegistryView, EligibilityInspectorView, EngineOverview, ExecutionMonitorView, OutputInspectorView, PipelineRunDetailView, PipelineRunsView, PromptVersionsView, TopicDiscoveryView } from "./engine-views";

// As estruturas abaixo são FIXTURES DE TESTE (formas dos registros que o banco devolve), nunca dados exibidos em produção: o objetivo é provar que cada estado é rotulado e que nada é simulado.
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const ready = <T,>(data: T): Loaded<T> => ({ state: "ready", data, origin: undefined });
const T = new Date("2026-10-14T12:00:00Z");
const defs = agents.AGENT_DEFINITIONS.map((definition) => ({ definition, version: null, model: null, runs: 0, byStatus: {}, lastRunAt: null, activePrompt: null }));
const run = (over: object = {}) => ({ id: "r1", seq: 1, agent: 5, agentName: "Eligibility Explainer", promptVersion: "file-abc", promptVersionId: null, model: "m", status: "succeeded", attempts: 1, subjectKind: "decision", subjectRef: "d1", pipelineRunId: null, correlationId: "c1", durationMs: 1200, failureKind: null, transientRetries: 0, errorCount: 0, createdAt: T, ...over });
const prun = (over: object = {}) => ({ id: "p1", pipeline: "page" as const, correlationId: "page-1", opportunityId: "o1", mode: "real" as const, status: "BLOCKED" as const, finalOutcome: "BLOCKED" as const, summary: "a decisão de elegibilidade é RESEARCH_REQUIRED", params: {}, cancelRequested: false, createdBy: "u", createdAt: T, finishedAt: T, ...over });
const step = (over: object = {}) => ({ id: "s1", stepKey: "eligibility", kind: "engine" as const, agent: null, status: "SUCCEEDED" as const, attempts: 1, idempotencyKey: "k", agentRunId: null, result: null, error: null, startedAt: T, finishedAt: T, ...over });

describe("estados em que a tela não tem dados", () => {
  it.each(["not_configured", "unauthenticated", "no_tenant", "not_migrated", "db_unavailable", "auth_unavailable", "error"] as const)("%s explica o motivo e não mostra dado algum", (state) => {
    const loaded = (state === "not_configured" ? { state, missing: "banco" } : { state }) as Loaded<never>;
    const out = html(<AgentRegistryView loaded={loaded} />);
    expect(out).toContain("Estado"); expect(out).not.toContain("data-testid=\"agent-registry\"");
    expect(html(<PipelineRunsView loaded={loaded} />)).not.toContain("pipeline-runs");
  });
});

describe("registro de agentes e prompts", () => {
  it("lista os 8 agentes, diz que não há execução e que o LLM está ausente (bloqueio externo), sem simular nada", () => {
    const out = html(<AgentRegistryView loaded={ready({ agents: defs, filePromptVersion: "a".repeat(64), llmConfigured: false })} />);
    expect(out.match(/data-testid="agent-registry"/g)).toHaveLength(1);
    for (const d of agents.AGENT_DEFINITIONS) { expect(out).toContain(d.slug); expect(out).toContain(d.codeAuthority.slice(0, 30)); }
    expect(out).toContain("(nenhuma registrada)"); expect(out).toContain("ANTHROPIC_API_KEY"); expect(out).toContain("não espelhada ainda");
  });
  it("prompts: sem versões mostra o registro vazio e o arquivo do pack; versões mostram estado, mudança e regressão não executada", () => {
    expect(html(<PromptVersionsView loaded={ready({ versions: [], filePromptVersion: "b".repeat(64) })} />)).toContain("Registro vazio");
    const v = { id: "v1", agent: 5, domainPackId: "real-estate", version: "cp-1", status: "DRAFT" as const, body: "x {{ELIGIBILITY_DECISION_JSON}}", bodySha256: "c".repeat(64), placeholders: ["ELIGIBILITY_DECISION_JSON"], source: "control_plane" as const, changeLog: "ajuste de tom", regression: null, createdBy: "u", createdAt: T, activatedAt: null, deprecatedAt: null };
    const out = html(<PromptVersionsView loaded={ready({ versions: [v], filePromptVersion: "b".repeat(64) })} />);
    expect(out).toContain("Rascunho"); expect(out).toContain("ajuste de tom"); expect(out).toContain("não executada"); expect(out).toContain("Ativar esta versão"); expect(out).toContain("Rollback");
  });
});

describe("monitor e inspetor de execuções: falha, saída inválida, tempo e não configurado são estados distintos", () => {
  it("o monitor rotula cada estado com texto e a classe da falha", () => {
    const rows = [run(), run({ id: "r2", status: "invalid_output", failureKind: "invalid_output", attempts: 3 }), run({ id: "r3", status: "timed_out", failureKind: "timeout", transientRetries: 2 }), run({ id: "r4", status: "not_configured", attempts: 0 })];
    const out = html(<ExecutionMonitorView loaded={ready({ total: 4, byStatus: { succeeded: 1, invalid_output: 1, timed_out: 1, not_configured: 1 }, rows })} params={{ agent: null, status: "", page: 1 }} pageSize={30} />);
    for (const t of ["Sucesso", "Saída inválida", "Tempo esgotado", "Não configurado (bloqueio externo)", "saída inválida após as correções", "tempo esgotado"]) expect(out).toContain(t);
    expect(out).toContain('data-status="invalid_output"'); expect(out).toContain("/engine/executions/r2");
  });
  it("sem execuções: estado vazio explícito, não uma tabela inventada", () => {
    const out = html(<ExecutionMonitorView loaded={ready({ total: 0, byStatus: {}, rows: [] })} params={{ agent: 3, status: "", page: 1 }} pageSize={30} />);
    expect(out).toContain("Nenhuma execução registrada"); expect(out).not.toContain("exec-table");
  });
  it("o inspetor de execução não configurada explica que não houve chamada nem saída; o de saída inválida mostra os erros", () => {
    const base = { ...run({ status: "not_configured", attempts: 0 }), promptSha256: "d".repeat(64), input: { a: 1 }, output: null, errors: ["variáveis ausentes: ANTHROPIC_API_KEY"], usage: {}, createdBy: "u" };
    const nc = html(<OutputInspectorView loaded={ready(base)} />);
    expect(nc).toContain("NÃO CONFIGURADA"); expect(nc).toContain("nenhuma saída válida");
    const bad = html(<OutputInspectorView loaded={ready({ ...base, status: "invalid_output", errors: ["tentativa 1: intents.0: Unrecognized key"], failureKind: "invalid_output" })} />);
    expect(bad).toContain("Saída inválida"); expect(bad).toContain("Unrecognized key"); expect(bad).not.toContain("NÃO CONFIGURADA");
    expect(html(<OutputInspectorView loaded={ready(null)} />)).toContain("Execução não encontrada");
  });
});

describe("pipeline: real, simulação de teste, bloqueio, decisão final e auditoria", () => {
  const detail = (run: object, steps: object[], audit: object[] = []) => ready({ run: prun(run) as never, steps: steps as never, audit: audit as never, agentRuns: [] });
  it("execução real bloqueada: mostra o bloqueio externo do agente e a decisão do Quality Gate; sem faixa de simulação", () => {
    const out = html(<PipelineRunDetailView loaded={detail({}, [step(), step({ id: "s2", stepKey: "explain", kind: "agent", agent: 5, status: "BLOCKED", error: "provider_not_configured: ANTHROPIC_API_KEY", agentRunId: "r9" }), step({ id: "s3", stepKey: "blueprint", status: "BLOCKED", error: "decisão RESEARCH_REQUIRED: o blueprint só nasce de READY_FOR_BLUEPRINT" })], [{ id: "a1", pipelineRunId: "p1", subjectKind: "page", subjectRef: "o1", decision: "BLOCKED", decidedBy: "code", recommendation: null, recommendationApplied: true, reason: "a decisão de elegibilidade é RESEARCH_REQUIRED", evidenceRefs: [], agentRunId: null, createdBy: "u", createdAt: T }])} />);
    expect(out).toContain("Execução real"); expect(out).not.toContain("LLM ROTEIRIZADO"); expect(out).toContain("Quality Gate: Bloqueada"); expect(out).toContain("Bloqueio:"); expect(out).toContain("provider_not_configured"); expect(out).toContain("decidido por código"); expect(out).toContain("/engine/executions/r9");
  });
  it("simulação de teste é rotulada em destaque; aprovada diz que nada foi publicado", () => {
    const out = html(<PipelineRunDetailView loaded={detail({ mode: "test_simulation", status: "SUCCEEDED", finalOutcome: "APPROVED", summary: "todos os gates de QA passaram; apto à revisão humana (nada foi publicado)" }, [step()])} />);
    expect(out).toContain("SIMULAÇÃO DE TESTE"); expect(out).toContain("LLM ROTEIRIZADO"); expect(out).toContain("nada publicado"); expect(out).toContain("nada foi publicado");
  });
  it("aguardando revisão humana é distinto de bloqueada e de aprovada; a lista de execuções mostra o modo de cada uma", () => {
    const out = html(<PipelineRunsView loaded={ready([prun({ status: "NEEDS_REVIEW", finalOutcome: "NEEDS_REVIEW" }), prun({ id: "p2", mode: "test_simulation", status: "SUCCEEDED", finalOutcome: "APPROVED" })] as never)} />);
    expect(out).toContain("Aguardando revisão humana"); expect(out).toContain("Precisa de revisão humana"); expect(out).toContain("SIMULAÇÃO DE TESTE"); expect(out).toContain("Execução real");
  });
  it("execução em andamento oferece cancelar; terminada não", () => {
    expect(html(<PipelineRunDetailView loaded={detail({ status: "RUNNING", finalOutcome: null, finishedAt: null, summary: null }, [])} />)).toContain("Cancelar execução");
    expect(html(<PipelineRunDetailView loaded={detail({}, [])} />)).not.toContain("Cancelar execução");
  });
});

describe("tópicos, elegibilidade e andamento", () => {
  it("descoberta: contagens reais; sem tópicos mostra estado vazio", () => {
    const empty = html(<TopicDiscoveryView loaded={ready({ summary: { total: 0, byStatus: {}, byPattern: {}, intentModeled: 0, byDemand: {}, withParent: 0 }, combination: { total: 0, byFilter: {} } })} />);
    expect(empty).toContain("Nenhum tópico gerado"); expect(empty).toContain("Nenhuma poda registrada");
    const full = html(<TopicDiscoveryView loaded={ready({ summary: { total: 645, byStatus: { scored: 645 }, byPattern: { "topic-city-overview": 645 }, intentModeled: 10, byDemand: { HYPOTHESIS: 10 }, withParent: 0 }, combination: { total: 3, byFilter: { F4: 2 } } })} />);
    expect(full).toContain("645"); expect(full).toContain("hipótese: 10"); expect(full).toContain("F4");
  });
  it("elegibilidade: a decisão aparece com os bloqueios; nota ausente é traço, não zero", () => {
    const row = { id: "d1", opportunityId: "o1", topicId: "t1", decision: "DATA_REQUIRED", eligible: false, policyVersion: 1, gateResults: {}, gateDetails: {}, blockingReasons: [], missingRequirements: ["G5_uniqueness: mais 2 bloco(s)"], scores: {}, totalScore: null, weightCoverage: null, evidenceRefs: [], recommendedAction: "x", evaluatedAt: T, snapshotHash: "h", referenceTime: T, primaryQuery: "Pindorama (SP)", status: "scored", family: "04-cidade" };
    const out = html(<EligibilityInspectorView loaded={ready({ total: 1, byDecision: { DATA_REQUIRED: 1 }, rows: [row] as never })} decision="" />);
    expect(out).toContain("DATA_REQUIRED"); expect(out).toContain("G5_uniqueness"); expect(out).toContain("/engine/opportunities/o1"); expect(out).toMatch(/<td class="pr-3 tabular-nums">—<\/td>/);
  });
  it("o andamento mostra os quatro estados distintos de cada item do registro", () => {
    const out = html(<EngineOverview progress={engine.ENGINE_PROGRESS} registry={{ state: "db_unavailable" }} />);
    for (const i of engine.ENGINE_PROGRESS) expect(out).toContain(`data-progress="${i.id}"`);
    expect(out).toContain("implementado"); expect(out).toContain("bloqueado externamente"); expect(out).toContain("verificado");
  });
});
