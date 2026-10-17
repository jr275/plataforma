import { describe, expect, it } from "vitest";
import { STAGES, STAGE_IDS, TOOLS, computeMetrics, evaluateAll, type Evidence, type ToolInput } from "@plataforma/api";
import { buildOperationsFlow, buildToolRows, stageEdges, summarizeStage } from "./operations-flow";

const NOW = new Date("2026-10-17T12:00:00Z");
const ev = (over: Partial<Evidence> = {}): Evidence => ({ id: "e", kind: "execution_record", mode: "live", at: "2026-10-17T11:00:00Z", outcome: "success", ...over });
const run = (evidence: Record<string, Evidence[]>) => {
  const names = new Set(TOOLS.flatMap((t) => [...t.requiresConfig]));
  const inputs = new Map<string, ToolInput>(TOOLS.map((t) => [t.id, { configPresent: names, evidence: evidence[t.id] ?? [] }]));
  const states = evaluateAll(TOOLS, inputs, NOW);
  return { inputs, states };
};
const healthy: Record<string, Evidence[]> = Object.fromEntries(TOOLS.map((t) => [t.id, [ev({ id: `ok:${t.id}` })]]));

describe("fluxo operacional", () => {
  it("tem um nó por etapa declarada, com ids estáveis e posições distintas", () => {
    const { states } = run({});
    const f = buildOperationsFlow(states, { running: false });
    expect(f.nodes.map((n) => n.id)).toEqual(STAGE_IDS);
    expect(new Set(f.nodes.map((n) => `${n.x},${n.y}`)).size).toBe(f.nodes.length);
  });
  it("etapas ausentes aparecem como 'Não implementada' e NÃO têm nenhuma aresta (não se desenha caminho que não existe)", () => {
    const f = buildOperationsFlow(run({}).states, { running: false });
    for (const s of STAGES.filter((x) => x.implementation === "absent")) {
      const n = f.nodes.find((x) => x.id === s.id)!;
      expect(n.status).toBe("unavailable");
      expect(n.statusLabel).toBe("Não implementada");
      expect(f.edges.some((e) => e.source === s.id || e.target === s.id), s.id).toBe(false);
    }
  });
  it("as arestas vêm das dependências reais entre ferramentas de etapas diferentes", () => {
    const keys = stageEdges().map((e) => `${e.source}>${e.target}`);
    expect(keys).toContain("ingestion>generation");
    expect(keys).toContain("generation>quality_gates");
    expect(keys.some((k) => k.includes("infra"))).toBe(false);
  });
  it("sem nenhuma evidência: nenhuma etapa aparece como concluída e o modo é registro, não ao vivo", () => {
    const f = buildOperationsFlow(run({}).states, { running: false });
    expect(f.nodes.filter((n) => n.status === "completed")).toHaveLength(0);
    expect(f.mode).toBe("recorded");
    expect(buildOperationsFlow(run({}).states, { running: true }).mode).toBe("live");
  });
  it("tudo saudável: só as etapas com ferramenta ficam verificadas; as ausentes e as parciais sem ferramenta continuam não verificadas", () => {
    const { states, inputs } = run(healthy);
    const m = computeMetrics(TOOLS, STAGE_IDS, states, inputs);
    expect([...m.verifiedStages].sort()).toEqual(["generation", "ingestion", "measurement", "quality_gates", "search_intent"].sort());
    expect(m.stageCoverage).toEqual({ numerator: 5, denominator: 15, rate: 5 / 15 });
    expect(m.unverifiedStages).toContain("publishing");
  });
  it("falha na importação: importação NOT_WORKING; geração e gates BLOCKED com a causa raiz da importação; a falha original é preservada", () => {
    const { states } = run({ ...healthy, "ingest.city-import": [ev({ outcome: "failure", errorCode: "RUN_FAILED", detail: "arquivo corrompido" })] });
    expect(states.get("ingest.city-import")).toMatchObject({ status: "NOT_WORKING", reason: "RUN_FAILED: arquivo corrompido" });
    expect(states.get("generate.city-pages")).toMatchObject({ status: "BLOCKED", rootCause: "ingest.city-import" });
    expect(states.get("quality.gates")).toMatchObject({ status: "BLOCKED", rootCause: "ingest.city-import" });
    const f = buildOperationsFlow(states, { running: false });
    expect(f.nodes.find((n) => n.id === "ingestion")).toMatchObject({ status: "failed", statusLabel: "Com falha" });
    expect(f.nodes.find((n) => n.id === "generation")).toMatchObject({ status: "blocked" });
    expect(f.nodes.find((n) => n.id === "generation")!.detail.blocker).toContain("ingest.city-import");
    const rows = buildToolRows(states);
    expect(rows.find((r) => r.id === "ingest.city-import")!.impacts).toContain("generate.city-pages");
    expect(rows.find((r) => r.id === "generate.city-pages")!.rootCause).toBe("ingest.city-import");
  });
  it("banco fora do ar bloqueia importação, geração e gates, e a causa raiz é o banco", () => {
    const { states } = run({ ...healthy, "platform.database": [ev({ outcome: "failure", errorCode: "DB_UNREACHABLE" })] });
    for (const id of ["ingest.city-import", "generate.city-pages", "quality.gates"]) expect(states.get(id), id).toMatchObject({ status: "BLOCKED", rootCause: "platform.database" });
  });
  it("etapa que só funciona por arquivo importado é rotulada 'importado' e não 'funcionando' puro", () => {
    const { states } = run({ "measure.gsc-export": [ev({ mode: "import", kind: "import_snapshot" })] });
    const n = buildOperationsFlow(states, { running: false }).nodes.find((x) => x.id === "measurement")!;
    expect(n.statusLabel).toBe("Funcionando (importado)");
    expect(n.summary).toContain("não é execução real");
  });
  it("etapa parcial sem ferramenta registrada é NOT_TESTED e diz por quê", () => {
    const s = summarizeStage("normalization", run({}).states);
    expect(s.op).toBe("NOT_TESTED");
    expect(s.reason).toContain("sem ferramenta registrada");
  });
  it("configuração ausente aparece como NOT_CONFIGURED com os nomes (nunca valores) das variáveis", () => {
    const inputs = new Map<string, ToolInput>(TOOLS.map((t) => [t.id, { configPresent: new Set<string>(), evidence: [] }]));
    const states = evaluateAll(TOOLS, inputs, NOW);
    expect(states.get("search.gsc-live")).toMatchObject({ status: "NOT_CONFIGURED", reason: "faltam variáveis: GSC_SITE_URL, GSC_SERVICE_ACCOUNT_JSON_BASE64" });
  });
});
