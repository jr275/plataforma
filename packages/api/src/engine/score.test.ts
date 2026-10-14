import { describe, expect, it } from "vitest";
import { DIMENSIONS, OBJECTIVES, configHash, diffConfigs, validateScoreConfig, type ScoreConfig } from "./score-config";
import { computeScore, sensitivity, validateInput, type ScoreInput } from "./score";
import { TEST_CONFIG, dims, full } from "./test-support/score-fixtures";

const input = (d = dims(), strategic = false): ScoreInput => ({ dimensions: d, strategic });
const cfg = (over: Partial<ScoreConfig>): ScoreConfig => ({ ...TEST_CONFIG, ...over });

describe("configuração do score: validação e versão", () => {
  it("a configuração de teste é válida", () => expect(validateScoreConfig(TEST_CONFIG)).toEqual([]));
  it("recusa pesos inválidos, dimensão repetida em dois objetivos, cobertura fora de 0..1 e esquema desconhecido", () => {
    const bad = [
      cfg({ objectives: { ...TEST_CONFIG.objectives, commercial_value: { ...TEST_CONFIG.objectives.commercial_value, weight: -1 } } }),
      cfg({ objectives: { ...TEST_CONFIG.objectives, execution_feasibility: { ...TEST_CONFIG.objectives.execution_feasibility, dimensions: { ...TEST_CONFIG.objectives.execution_feasibility.dimensions, demand: 2 } } } }),
      cfg({ objectives: { ...TEST_CONFIG.objectives, discovery_opportunity: { ...TEST_CONFIG.objectives.discovery_opportunity, minCoverage: 1.2 } } }),
      cfg({ uncertaintyFactor: 2 }),
      { ...TEST_CONFIG, schema: "x" } as unknown as ScoreConfig,
      cfg({ riskPenalties: { evidence_risk: { threshold: 0.5, multiplier: 0 } } }),
      cfg({ priority: { partialMinObjectives: 4 } }),
    ];
    for (const c of bad) expect(validateScoreConfig(c).length, JSON.stringify(c).slice(0, 80)).toBeGreaterThan(0);
  });
  it("o hash identifica a versão: independe da ordem das chaves e muda com qualquer peso", () => {
    const reordered = JSON.parse(JSON.stringify({ ...TEST_CONFIG, objectives: Object.fromEntries(Object.entries(TEST_CONFIG.objectives).reverse()) })) as ScoreConfig;
    expect(configHash(reordered)).toBe(configHash(TEST_CONFIG));
    expect(configHash(cfg({ uncertaintyFactor: 0.51 }))).not.toBe(configHash(TEST_CONFIG));
  });
  it("diffConfigs lista exatamente o que mudou entre duas versões", () => {
    const b = cfg({ uncertaintyFactor: 0.2, objectives: { ...TEST_CONFIG.objectives, commercial_value: { ...TEST_CONFIG.objectives.commercial_value, dimensions: { ...TEST_CONFIG.objectives.commercial_value.dimensions, demand: 5 } } } });
    expect(diffConfigs(TEST_CONFIG, b)).toEqual([{ path: "objectives.commercial_value.dimensions.demand", from: 3, to: 5 }, { path: "uncertaintyFactor", from: 0.5, to: 0.2 }]);
    expect(diffConfigs(TEST_CONFIG, TEST_CONFIG)).toEqual([]);
  });
});

describe("entrada: erro em vez de correção silenciosa", () => {
  it("valor fora de 0..1, base incoerente e dimensão ausente são recusados", () => {
    expect(() => computeScore(input(dims({ intent: 1.2 })), TEST_CONFIG)).toThrow(/fora de 0..1/);
    expect(() => computeScore(input(dims({ intent: -0.1 })), TEST_CONFIG)).toThrow(/fora de 0..1/);
    const incoherent = { ...dims(), intent: { id: "intent" as const, value: 0.5, basis: "unknown" as const, source: null, note: "x" } };
    expect(validateInput(input(incoherent)).join()).toContain("incoerente");
    const missing = { ...dims() } as Record<string, unknown>; delete missing.intent;
    expect(() => computeScore(input(missing as never), TEST_CONFIG)).toThrow(/dimensão ausente/);
  });
});

describe("dado ausente NUNCA vira valor (política de verdade)", () => {
  it("tudo desconhecido: nenhum objetivo calculável, sem prioridade, todas as dimensões listadas com o que falta", () => {
    const r = computeScore(input(), TEST_CONFIG);
    for (const o of OBJECTIVES) { expect(r.objectives[o].score).toBeNull(); expect(r.objectives[o].adjusted).toBeNull(); }
    expect(r.priority).toMatchObject({ value: null, kind: "none" });
    expect(r.missing.map((m) => m.dimension).sort()).toEqual([...DIMENSIONS].sort());
    expect(r.missing.every((m) => m.needs.length > 0)).toBe(true);
    expect(r.confidence).toBe(0);
    expect(r.eligibility.eligible).toBe(false);
  });
  it("desconhecido NÃO é zero: uma dimensão desconhecida não muda o resultado das conhecidas, ao contrário de um zero", () => {
    const base = { intent: 0.8, business_value: 0.9, buyer_stage: 0.5 };
    const a = computeScore(input(dims({ ...base, demand: null })), TEST_CONFIG).objectives.commercial_value;
    const b = computeScore(input(dims({ ...base })), TEST_CONFIG).objectives.commercial_value;
    expect(a.score).toBe(b.score);
    const c = computeScore(input(dims({ ...base, demand: 0 })), TEST_CONFIG).objectives.commercial_value;
    expect(c.score!).toBeLessThan(a.score!);
  });
  it("cobertura abaixo do mínimo: o objetivo fica desconhecido, com o motivo (não é calculado com poucos dados)", () => {
    const r = computeScore(input(dims({ buyer_stage: 0.9 })), TEST_CONFIG).objectives.commercial_value; // peso 1 de 13
    expect(r.score).toBeNull();
    expect(r.reason).toMatch(/cobertura \d+% abaixo do mínimo/);
  });
});

describe("explicação: contribuições somam o resultado e cada penalidade é registrada", () => {
  it("as contribuições por dimensão somam exatamente o resultado bruto do objetivo", () => {
    const r = computeScore(input(full({ demand: 0.9, intent: 0.7, business_value: 0.2 })), TEST_CONFIG);
    for (const o of OBJECTIVES) { const x = r.objectives[o]; expect(x.contributions.reduce((s, c) => s + c.points, 0)).toBeCloseTo(x.score!, 9); }
  });
  it("risco entra invertido: risco alto reduz a viabilidade; risco baixo a aumenta", () => {
    const high = computeScore(input(full({ cannibalization_risk: 0.9, evidence_risk: 0.1 })), TEST_CONFIG).objectives.execution_feasibility.score!;
    const low = computeScore(input(full({ cannibalization_risk: 0.1, evidence_risk: 0.1 })), TEST_CONFIG).objectives.execution_feasibility.score!;
    expect(low).toBeGreaterThan(high);
  });
  it("incerteza e cobertura geram penalidade explicada; sem perda quando tudo é certo e completo", () => {
    const certain = computeScore(input(full()), TEST_CONFIG);
    expect(certain.penalties).toEqual([]);
    const uncertain = computeScore(input({ ...full(), intent: { id: "intent", value: 0.5, basis: "estimated", source: "t", note: "n", uncertainty: 1 } }), TEST_CONFIG);
    const p = uncertain.penalties.find((x) => x.kind === "uncertainty" && x.objective === "commercial_value")!;
    expect(p.points).toBeGreaterThan(0);
    expect(p.detail).toContain("confiança");
    expect(uncertain.objectives.commercial_value.adjusted!).toBeLessThan(uncertain.objectives.commercial_value.score!);
  });
  it("risco de evidência acima do limiar multiplica a viabilidade e registra a penalidade com a dimensão", () => {
    const r = computeScore(input(full({ evidence_risk: 0.9 })), TEST_CONFIG);
    const p = r.penalties.find((x) => x.kind === "risk" && x.dimension === "evidence_risk")!;
    expect(p.detail).toContain("multiplica a viabilidade por 0.6");
    expect(r.objectives.execution_feasibility.adjusted!).toBeCloseTo(r.objectives.execution_feasibility.score! * 0.6, 6);
    const ok = computeScore(input(full({ evidence_risk: 0.3 })), TEST_CONFIG);
    expect(ok.penalties.some((x) => x.kind === "risk")).toBe(false);
  });
  it("as explicações em texto citam objetivos, prioridade, penalidades e o que falta", () => {
    const r = computeScore(input(dims({ intent: 0.8, business_value: 0.9, buyer_stage: 0.5, conversion_proximity: 0.7, solution_fit: 1, evidence_availability: 0.5, evidence_risk: 0.9, cannibalization_risk: 0.1 }), true), TEST_CONFIG);
    const text = r.explanations.join("\n");
    expect(text).toContain("Valor comercial:");
    expect(text).toContain("Viabilidade de execução:");
    expect(text).toContain("Oportunidade de descoberta: não calculável");
    expect(text).toContain("PARCIAL");
    expect(text).toContain("Penalidade:");
    expect(text).toContain("Sem dado (fora da conta):");
  });
});

describe("o score muda quando a dimensão ou a configuração muda", () => {
  it("monotonia: melhorar uma dimensão favorável aumenta o objetivo; piorar um risco o diminui", () => {
    const at = (v: number) => computeScore(input(full({ business_value: v })), TEST_CONFIG).objectives.commercial_value.adjusted!;
    expect(at(0.9)).toBeGreaterThan(at(0.5));
    expect(at(0.5)).toBeGreaterThan(at(0.1));
    const risk = (v: number) => computeScore(input(full({ competition: v })), TEST_CONFIG).objectives.discovery_opportunity.adjusted!;
    expect(risk(0.1)).toBeGreaterThan(risk(0.9));
  });
  it("mudar o peso de uma dimensão muda o resultado na direção esperada e muda o hash da configuração", () => {
    const d = full({ demand: 0.1, business_value: 0.9 });
    const before = computeScore(input(d), TEST_CONFIG);
    const heavier = cfg({ objectives: { ...TEST_CONFIG.objectives, commercial_value: { ...TEST_CONFIG.objectives.commercial_value, dimensions: { ...TEST_CONFIG.objectives.commercial_value.dimensions, demand: 12 } } } });
    const after = computeScore(input(d), heavier);
    expect(after.objectives.commercial_value.score!).toBeLessThan(before.objectives.commercial_value.score!); // demanda baixa pesa mais
    expect(after.configHash).not.toBe(before.configHash);
  });
  it("zerar o peso de uma dimensão a tira da conta (e das lacunas do objetivo)", () => {
    const c = cfg({ objectives: { ...TEST_CONFIG.objectives, commercial_value: { ...TEST_CONFIG.objectives.commercial_value, dimensions: { ...TEST_CONFIG.objectives.commercial_value.dimensions, demand: 0 } } } });
    const r = computeScore(input(dims({ intent: 0.8, business_value: 0.9 })), c);
    expect(r.objectives.commercial_value.contributions.map((x) => x.dimension)).not.toContain("demand");
    expect(r.objectives.commercial_value.missing).not.toContain("demand");
  });
  it("cenários-limite: tudo 1 (e riscos 0) dá 100; tudo no pior dá 0; valores exatos de borda são aceitos", () => {
    const best = computeScore(input(full({ ...Object.fromEntries(DIMENSIONS.map((d) => [d, 1])), competition: 0, cannibalization_risk: 0, evidence_risk: 0 })), TEST_CONFIG);
    for (const o of OBJECTIVES) expect(best.objectives[o].adjusted).toBeCloseTo(100, 6);
    expect(best.priority).toMatchObject({ kind: "overall" });
    expect(best.priority.value).toBeCloseTo(100, 6);
    const worst = computeScore(input(full({ ...Object.fromEntries(DIMENSIONS.map((d) => [d, 0])), competition: 1, cannibalization_risk: 1, evidence_risk: 1 })), TEST_CONFIG);
    expect(worst.priority.value!).toBeLessThan(0.001);
  });
});

describe("prioridade: geral só com os três objetivos; parcial é rotulada; objetivos distintos", () => {
  const two = dims({ intent: 0.8, business_value: 0.9, conversion_proximity: 0.7, buyer_stage: 0.5, solution_fit: 1, evidence_availability: 0.6, evidence_risk: 0.2, cannibalization_risk: 0.1 });
  it("com dois objetivos: PARCIAL, dizendo o que falta; não pode se passar por geral", () => {
    const p = computeScore(input(two, true), TEST_CONFIG).priority;
    expect(p.kind).toBe("partial");
    expect(p.missingObjectives).toEqual(["discovery_opportunity"]);
    expect(p.note).toContain("PARCIAL");
    expect(p.note).toContain("oportunidade de descoberta");
  });
  it("com um objetivo só (poucos): sem prioridade; com os três: geral", () => {
    expect(computeScore(input(dims({ intent: 0.8, business_value: 0.9, conversion_proximity: 0.7, buyer_stage: 0.5 })), TEST_CONFIG).priority.kind).toBe("none");
    expect(computeScore(input(full()), TEST_CONFIG).priority.kind).toBe("overall");
  });
  it("média geométrica: um objetivo fraco puxa a prioridade para baixo mais do que a média aritmética", () => {
    const strongWeak = computeScore(input(full({ serp_opportunity: 0.05, authority_gap: 0.05, competition: 0.95, citation_potential: 0.05, information_gain: 0.05, intent: 0.95, business_value: 0.95, demand: 0.95, solution_fit: 0.95 })), TEST_CONFIG);
    const o = strongWeak.objectives;
    const arithmetic = (o.commercial_value.adjusted! * 0.4 + o.execution_feasibility.adjusted! * 0.35 + o.discovery_opportunity.adjusted! * 0.25);
    expect(strongWeak.priority.value!).toBeLessThan(arithmetic);
  });
  it("os três objetivos permanecem distinguíveis no resultado (não são fundidos)", () => {
    const r = computeScore(input(full({ demand: 0.9, solution_fit: 0.2, serp_opportunity: 0.6 })), TEST_CONFIG);
    const values = OBJECTIVES.map((o) => r.objectives[o].adjusted);
    expect(new Set(values).size).toBe(3);
  });
});

describe("elegibilidade e recomendação", () => {
  const ok = dims({ intent: 0.9, business_value: 0.9, conversion_proximity: 0.8, buyer_stage: 0.6, solution_fit: 1, evidence_availability: 0.8, evidence_risk: 0.2, cannibalization_risk: 0.1 });
  it("elegível com justificativa estratégica mesmo sem demanda medida, e a recomendação diz o que coletar", () => {
    const r = computeScore(input(ok, true), TEST_CONFIG);
    expect(r.eligibility.eligible).toBe(true);
    expect(r.eligibility.checks.find((c) => c.code === "demand_or_strategic")!.detail).toContain("demanda ainda não medida");
    expect(r.recommendation.code).toBe("proceed_to_serp_analysis");
    expect(r.recommendation.action).toContain("SERP");
  });
  it("sem demanda medida e sem justificativa estratégica: NÃO elegível (volume alto não é pré-requisito, mas nem tudo passa)", () => {
    const r = computeScore(input(ok, false), TEST_CONFIG);
    expect(r.eligibility.eligible).toBe(false);
    expect(r.recommendation.code).toBe("blocked_demand_or_strategic");
  });
  it("risco de evidência acima do máximo bloqueia, mesmo com valor comercial alto", () => {
    const r = computeScore(input(dims({ ...Object.fromEntries(DIMENSIONS.map((d) => [d, undefined])), intent: 1, business_value: 1, conversion_proximity: 1, buyer_stage: 1, demand: 1, solution_fit: 1, evidence_availability: 0.2, evidence_risk: 0.95, cannibalization_risk: 0.1 }), true), TEST_CONFIG);
    expect(r.eligibility.eligible).toBe(false);
    expect(r.eligibility.checks.find((c) => c.code === "evidence_risk_max")!.ok).toBe(false);
  });
  it("canibalização acima do máximo bloqueia e manda ATUALIZAR a página existente; canibalização desconhecida não bloqueia (e é dita)", () => {
    const r = computeScore(input(dims({ intent: 0.9, business_value: 0.9, conversion_proximity: 0.8, buyer_stage: 0.6, solution_fit: 1, evidence_availability: 1, evidence_risk: 0.1, cannibalization_risk: 0.85 }), true), TEST_CONFIG);
    const c = r.eligibility.checks.find((x) => x.code === "cannibalization_max")!;
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("atualize a página existente");
    expect(r.eligibility.eligible).toBe(false);
    const unknown = computeScore(input(dims({ intent: 0.9, business_value: 0.9, conversion_proximity: 0.8, buyer_stage: 0.6, solution_fit: 1, evidence_availability: 1, evidence_risk: 0.1 }), true), TEST_CONFIG);
    expect(unknown.eligibility.checks.find((x) => x.code === "cannibalization_max")).toMatchObject({ ok: true, detail: expect.stringContaining("não medida") });
  });
  it("com os três objetivos calculáveis e elegível: recomenda o blueprint", () => {
    expect(computeScore(input(full({ evidence_risk: 0.1, cannibalization_risk: 0.1, demand: 0.9 }), true), TEST_CONFIG).recommendation.code).toBe("proceed_to_blueprint");
  });
});

describe("análise de sensibilidade", () => {
  it("lista, por peso, o quanto a prioridade varia com ±25%, do maior para o menor impacto", () => {
    const s = sensitivity(input(full({ demand: 0.9, serp_opportunity: 0.1 })), TEST_CONFIG);
    expect(s.baseline).not.toBeNull();
    expect(s.rows.length).toBeGreaterThan(5);
    const swings = s.rows.map((r) => r.swing);
    expect(swings).toEqual([...swings].sort((a, b) => b - a));
    expect(s.min!).toBeLessThanOrEqual(s.baseline!);
    expect(s.max!).toBeGreaterThanOrEqual(s.baseline!);
    expect(s.rows.find((r) => r.kind === "objective")).toBeDefined();
  });
  it("sem prioridade calculável, não há o que perturbar (sem números inventados)", () => {
    expect(sensitivity(input(), TEST_CONFIG)).toMatchObject({ baseline: null, rows: [], stable: true });
  });
  it("não perturba o peso de dimensões desconhecidas (só as que entraram na conta)", () => {
    const s = sensitivity(input(dims({ intent: 0.8, business_value: 0.9, conversion_proximity: 0.7, buyer_stage: 0.5, solution_fit: 1, evidence_availability: 0.6, evidence_risk: 0.2, cannibalization_risk: 0.1 })), TEST_CONFIG);
    expect(s.rows.filter((r) => r.kind === "dimension").map((r) => r.id)).not.toContain("demand");
  });
  it("entrada ruim: erro", () => expect(() => sensitivity(input(dims({ intent: 3 })), TEST_CONFIG)).toThrow());
});

describe("risco de evidência DESCONHECIDO nunca libera a elegibilidade", () => {
  it("sem a dimensão, o gate de risco de evidência reprova (e o motivo diz que é desconhecido)", () => {
    const r = computeScore({ dimensions: full({ evidence_risk: null }), strategic: true }, TEST_CONFIG);
    const c = r.eligibility.checks.find((x) => x.code === "evidence_risk_max")!;
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("desconhecido");
    expect(r.eligibility.eligible).toBe(false);
  });
});
