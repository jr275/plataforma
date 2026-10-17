import { describe, expect, it } from "vitest";
import { OPERATIONAL_STATUSES, computeMetrics, evaluateAll, evaluateTool, topoOrder, type Evidence, type ToolDefinition, type ToolInput, type ToolState } from "./operational-status";
import { STAGE_IDS, STAGES, TOOLS } from "./registry";

const NOW = new Date("2026-10-17T12:00:00Z");
const H = 3_600_000;
const iso = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * H).toISOString();
const def = (over: Partial<ToolDefinition> = {}): ToolDefinition => ({ id: "t", name: "t", stage: "s", provider: null, capability: "c", criticality: "critical", requiresConfig: [], dependsOn: [], freshMs: 24 * H, enabled: true, ...over });
const ev = (over: Partial<Evidence> = {}): Evidence => ({ id: "e1", kind: "execution_record", mode: "live", at: iso(1), outcome: "success", ...over });
const input = (evidence: Evidence[] = [], cfg: string[] = []): ToolInput => ({ configPresent: new Set(cfg), evidence });
const evalOne = (d: ToolDefinition, i: ToolInput, up: Record<string, Partial<ToolState> & { status: ToolState["status"] }> = {}) =>
  evaluateTool(d, i, new Map(Object.entries(up).map(([k, v]) => [k, { id: k, reason: "", rootCause: null, blockedBy: [], evidence: null, mode: null, ...v } as ToolState])), NOW);

describe("precedência do status", () => {
  it("DISABLED vence tudo, inclusive configuração ausente e falha", () => {
    expect(evalOne(def({ enabled: false, disabledReason: "não implementada", requiresConfig: ["X"] }), input([ev({ outcome: "failure" })])).status).toBe("DISABLED");
  });
  it("NOT_CONFIGURED lista só NOMES das variáveis que faltam", () => {
    const s = evalOne(def({ requiresConfig: ["A", "B"] }), input([], ["A"]));
    expect(s.status).toBe("NOT_CONFIGURED");
    expect(s.reason).toBe("faltam variáveis: B");
  });
  it("sem evidência é NOT_TESTED (nunca WORKING por padrão)", () => {
    expect(evalOne(def(), input()).status).toBe("NOT_TESTED");
  });
  it("sucesso recente e real é WORKING", () => {
    expect(evalOne(def(), input([ev()])).status).toBe("WORKING");
  });
  it("uma falha RECENTE não é escondida por um sucesso mais antigo", () => {
    const s = evalOne(def(), input([ev({ id: "ok", at: iso(10) }), ev({ id: "ko", at: iso(1), outcome: "failure", errorCode: "HTTP_503", detail: "provedor fora" })]));
    expect(s.status).toBe("NOT_WORKING");
    expect(s.reason).toBe("HTTP_503: provedor fora");
    expect(s.evidence?.id).toBe("ko");
  });
  it("um sucesso mais novo que uma falha antiga volta a WORKING", () => {
    expect(evalOne(def(), input([ev({ id: "ko", at: iso(10), outcome: "failure" }), ev({ id: "ok", at: iso(1) })])).status).toBe("WORKING");
  });
  it("sucesso fora da janela de frescor é STALE, com a idade no motivo", () => {
    const s = evalOne(def({ freshMs: 24 * H }), input([ev({ at: iso(30) })]));
    expect(s.status).toBe("STALE");
    expect(s.reason).toContain("30 h");
  });
  it("mock, simulação e replay são MOCK e nunca contam como funcionamento real", () => {
    for (const mode of ["mock", "simulated", "replay"] as const) expect(evalOne(def(), input([ev({ mode })])).status).toBe("MOCK");
  });
  it("resultado parcial é DEGRADED; bloqueado por fator externo é BLOCKED", () => {
    expect(evalOne(def(), input([ev({ outcome: "partial", detail: "1 de 3 cidades falhou" })])).status).toBe("DEGRADED");
    expect(evalOne(def(), input([ev({ outcome: "blocked", detail: "aguarda autorização" })])).status).toBe("BLOCKED");
  });
  it("importação é WORKING com o motivo dizendo que não é sincronização", () => {
    const s = evalOne(def(), input([ev({ mode: "import", kind: "import_snapshot" })]));
    expect(s.status).toBe("WORKING");
    expect(s.reason).toContain("não é sincronização");
    expect(s.mode).toBe("import");
  });
});

describe("propagação de falhas", () => {
  const defs = [def({ id: "a" }), def({ id: "b", dependsOn: ["a"] }), def({ id: "c", dependsOn: ["b"] })];
  it("a dependente fica BLOCKED com a causa raiz da ferramenta que falhou, e a falha original é preservada", () => {
    const m = evaluateAll(defs, new Map([["a", input([ev({ outcome: "failure", errorCode: "AUTH" })])], ["b", input([ev()])], ["c", input([ev()])]]), NOW);
    expect(m.get("a")!.status).toBe("NOT_WORKING");
    expect(m.get("b")!).toMatchObject({ status: "BLOCKED", rootCause: "a", blockedBy: ["a"] });
    expect(m.get("c")!).toMatchObject({ status: "BLOCKED", rootCause: "a", blockedBy: ["b"] });
  });
  it("dependência NOT_TESTED não bloqueia: a dependente fica NOT_TESTED por falta de evidência própria", () => {
    const m = evaluateAll(defs, new Map([["a", input([], [])]]), NOW);
    expect(m.get("a")!.status).toBe("NOT_TESTED");
    expect(m.get("b")!.status).toBe("NOT_TESTED"); // dependência NOT_TESTED não bloqueia: avisa, não impede
  });
  it("dependência NOT_CONFIGURED bloqueia a dependente", () => {
    const m = evaluateAll([def({ id: "a", requiresConfig: ["X"] }), def({ id: "b", dependsOn: ["a"] })], new Map([["b", input([ev()])]]), NOW);
    expect(m.get("b")).toMatchObject({ status: "BLOCKED", rootCause: "a" });
  });
  it("ciclo, dependência desconhecida e id repetido são erro de definição", () => {
    expect(() => topoOrder([def({ id: "a", dependsOn: ["b"] }), def({ id: "b", dependsOn: ["a"] })])).toThrow(/ciclo/);
    expect(() => topoOrder([def({ id: "a", dependsOn: ["zzz"] })])).toThrow(/desconhecida/);
    expect(() => topoOrder([def({ id: "a" }), def({ id: "a" })])).toThrow(/repetidos/);
  });
});

describe("métricas com numerador e denominador", () => {
  const defs = [def({ id: "a", stage: "s1" }), def({ id: "b", stage: "s1" }), def({ id: "c", stage: "s2" }), def({ id: "d", stage: "s3", enabled: false })];
  const inputs = new Map([["a", input([ev()])], ["b", input([ev({ outcome: "failure" })])], ["c", input([ev({ mode: "mock" })])]]);
  const states = evaluateAll(defs, inputs, NOW);
  const m = computeMetrics(defs, ["s1", "s2", "s3", "s4"], states, inputs);
  it("conta todos os status e não esconde nenhuma ferramenta", () => {
    expect(m.totalTools).toBe(4);
    expect(m.byStatus).toMatchObject({ WORKING: 1, NOT_WORKING: 1, MOCK: 1, DISABLED: 1 });
    expect(Object.values(m.byStatus).reduce((s, n) => s + n, 0)).toBe(4);
  });
  it("cobertura de ferramentas: WORKING ÷ todas (desabilitadas no denominador) e à parte só as habilitadas", () => {
    expect(m.toolVerificationCoverage).toEqual({ numerator: 1, denominator: 4, rate: 0.25 });
    expect(m.enabledToolCoverage).toEqual({ numerator: 1, denominator: 3, rate: 1 / 3 });
  });
  it("etapa só é verificada se TODAS as ferramentas habilitadas dela estão WORKING; etapas sem ferramenta contam como não verificadas", () => {
    expect(m.verifiedStages).toEqual([]);
    expect(m.unverifiedStages).toEqual(["s1", "s2", "s3", "s4"]);
    expect(m.stageCoverage).toEqual({ numerator: 0, denominator: 4, rate: 0 });
  });
  it("etapa com evidência só de IMPORTAÇÃO não é verificada (a ferramenta fica WORKING, a etapa não)", () => {
    const d = [def({ id: "a", stage: "s1" })];
    const i = new Map([["a", input([ev({ mode: "import", kind: "import_snapshot" })])]]);
    const st = evaluateAll(d, i, NOW);
    expect(st.get("a")!.status).toBe("WORKING");
    expect(computeMetrics(d, ["s1"], st, i).stageCoverage).toEqual({ numerator: 0, denominator: 1, rate: 0 });
    const i2 = new Map([["a", input([ev({ mode: "sandbox" })])]]);
    expect(computeMetrics(d, ["s1"], evaluateAll(d, i2, NOW), i2).stageCoverage.numerator).toBe(1);
  });
  it("taxa de sucesso de integração só considera checagens reais (live ou sandbox)", () => {
    expect(m.integrationSuccessRate).toEqual({ numerator: 1, denominator: 2, rate: 0.5 }); // a (ok) e b (falha); o mock de c não entra
  });
  it("sem checagem elegível a taxa é null, nunca 100% nem 0%", () => {
    const e = new Map<string, ToolInput>();
    const mm = computeMetrics([def()], ["s"], evaluateAll([def()], e, NOW), e);
    expect(mm.integrationSuccessRate).toEqual({ numerator: 0, denominator: 0, rate: null });
  });
});

describe("registro real", () => {
  it("é um grafo válido, sem ciclo, e toda ferramenta de etapa usa uma etapa declarada", () => {
    expect(() => topoOrder(TOOLS)).not.toThrow();
    for (const t of TOOLS) expect(t.stage === "infra" || STAGE_IDS.includes(t.stage), t.id).toBe(true);
  });
  it("sem nenhuma evidência, NENHUMA ferramenta aparece como WORKING e a cobertura é 0 (nada verificado por padrão)", () => {
    const inputs = new Map<string, ToolInput>(TOOLS.map((t) => [t.id, input([], [...t.requiresConfig])]));
    const states = evaluateAll(TOOLS, inputs, NOW);
    expect([...states.values()].filter((s) => s.status === "WORKING")).toHaveLength(0);
    expect(computeMetrics(TOOLS, STAGE_IDS, states, inputs).stageCoverage.numerator).toBe(0);
  });
  it("as etapas ausentes não têm ferramenta (o buraco é declarado, não escondido)", () => {
    for (const s of STAGES.filter((x) => x.implementation === "absent")) expect(TOOLS.some((t) => t.stage === s.id), s.id).toBe(false);
    expect(OPERATIONAL_STATUSES).toHaveLength(9);
  });
});
