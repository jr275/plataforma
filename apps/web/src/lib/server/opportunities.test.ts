import { beforeEach, describe, expect, it, vi } from "vitest";

const db = { query: vi.fn() } as never;
vi.mock("./tenant-data", () => ({ loadForTenant: vi.fn(async (fn: (d: never) => Promise<unknown>) => ({ state: "ready", data: await fn(db), origin: undefined })) }));
vi.mock("@plataforma/api", async (orig) => {
  const real = await orig<typeof import("@plataforma/api")>();
  return { ...real, engine: { ...real.engine, searchOpportunities: vi.fn(async () => ({ total: 0, rows: [], byStatus: {} })), listResearchRuns: vi.fn(async () => []), searchEvidence: vi.fn(async () => []), getOpportunity: vi.fn(async () => null), listScoreConfigs: vi.fn(async () => []), listBlueprints: vi.fn(async () => []), loadRoadmap: vi.fn(async () => ({ counts: {}, items: {}, blockers: [], total: 0 })) } };
});

import { engine } from "@plataforma/api";
import { OPPORTUNITY_PAGE_SIZE, loadOpportunities, loadOpportunityDetail, loadRoadmapData, loadTrends, parseOpportunityParams } from "./opportunities";

const mSearch = vi.mocked(engine.searchOpportunities);
beforeEach(() => vi.clearAllMocks());

describe("parseOpportunityParams (defensivo)", () => {
  it("padrões e valores fora da lista voltam ao padrão", () => {
    expect(parseOpportunityParams({})).toEqual({ q: "", status: "", intent: "", eligible: "", priorityKind: "", sort: "priority", page: 1 });
    expect(parseOpportunityParams({ q: "x".repeat(200), status: "aprovada", intent: "inexistente", eligible: "talvez", priority: "geral", sort: "x; DROP TABLE", page: "-4" })).toEqual({ q: "x".repeat(80), status: "", intent: "", eligible: "", priorityKind: "", sort: "priority", page: 1 });
    expect(parseOpportunityParams({ q: [" a "], page: ["2"] }).page).toBe(1); // arrays não são aceitos
    expect(parseOpportunityParams({ page: "99999" }).page).toBe(10_000);
  });
  it("aceita valores válidos (estado, intenção da vertical, elegibilidade, tipo de prioridade, ordenação)", () => {
    expect(parseOpportunityParams({ q: " juros ", status: "eligible", intent: "financing", eligible: "yes", priority: "partial", sort: "feasibility", page: "3" })).toEqual({ q: "juros", status: "eligible", intent: "financing", eligible: "yes", priorityKind: "partial", sort: "feasibility", page: 3 });
  });
});

describe("carregadores: só o `db` do contexto, sem tenant vindo da URL", () => {
  it("a consulta recebe filtros, limite e deslocamento (página - 1) x tamanho", async () => {
    await loadOpportunities(parseOpportunityParams({ status: "scored", eligible: "no", page: "3", tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }));
    expect(mSearch).toHaveBeenCalledOnce();
    expect(mSearch.mock.calls[0]![0]).toBe(db);
    expect(mSearch.mock.calls[0]![1]).toMatchObject({ status: "scored", eligible: false, limit: OPPORTUNITY_PAGE_SIZE, offset: 2 * OPPORTUNITY_PAGE_SIZE, sort: "priority" });
    expect(JSON.stringify(mSearch.mock.calls[0])).not.toMatch(/tenant|bbbbbbbb/i);
  });
  it("detalhe e tendências também só recebem o db", async () => {
    await loadOpportunityDetail("11111111-1111-4111-8111-111111111111");
    expect(vi.mocked(engine.getOpportunity)).toHaveBeenCalledExactlyOnceWith(db, "11111111-1111-4111-8111-111111111111");
    expect(vi.mocked(engine.listBlueprints)).toHaveBeenCalledExactlyOnceWith(db, "11111111-1111-4111-8111-111111111111");
    await loadRoadmapData();
    expect(vi.mocked(engine.loadRoadmap).mock.calls[0]![0]).toBe(db);
    await loadTrends({ kind: "news_item" });
    expect(vi.mocked(engine.searchEvidence).mock.calls.at(-1)![0]).toBe(db);
  });
});
