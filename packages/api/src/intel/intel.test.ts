import { describe, expect, it } from "vitest";
import { assertConfigValid, computeScore, SCORE_CONFIG_V1 } from "./score-v1";
import { decideTransition, STAGES } from "./transitions";
import { blueprintHash, GATE_CATEGORIES, gateVerdict, type BlueprintContent, type GateEvaluation } from "./blueprint-gate";
import { BudgetExceededError, cacheKey, memoryCache, RunBudget } from "./provider-runtime";

describe("score v1", () => {
  it("config v1 tem pesos que somam 1 e justificativa em todo fator", () => {
    expect(() => assertConfigValid(SCORE_CONFIG_V1)).not.toThrow();
    expect(SCORE_CONFIG_V1.version).toBe("real_estate.v1");
  });

  it("fator ausente sai do denominador e NÃO vira zero", () => {
    const partial = computeScore({ demand: { value: 0.8, origin: "measured" } });
    expect(partial.total).toBe(80);
    expect(partial.confidence).toBe(0.3);
    const demandAsZero = computeScore({ demand: { value: 0.8, origin: "measured" }, trend: { value: 0, origin: "measured" } });
    expect(demandAsZero.total).not.toBe(partial.total);
    expect(partial.contributions.find((c) => c.factor === "trend")).toMatchObject({ evaluated: false, contribution: null, value: null });
  });

  it("nenhum fator avaliado dá total null, não 0", () => {
    const r = computeScore({});
    expect(r.total).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it("valor null com origem medida conta como não avaliado", () => {
    const r = computeScore({ demand: { value: null, origin: "measured" } });
    expect(r.total).toBeNull();
    expect(r.contributions[0]).toMatchObject({ origin: "not_evaluated", evaluated: false });
  });

  it("dado demo nunca entra no score de produção nem aparece como medido", () => {
    const r = computeScore({ demand: { value: 0.9, origin: "demo" } });
    expect(r.total).toBeNull();
    expect(r.contributions.some((c) => c.origin === "measured")).toBe(false);
    expect(computeScore({ demand: { value: 0.9, origin: "demo" } }, SCORE_CONFIG_V1, { allowDemo: true }).total).toBe(90);
  });

  it("fatores de 'quanto maior pior' são invertidos", () => {
    expect(computeScore({ competition: { value: 1, origin: "measured" } }).total).toBe(0);
    expect(computeScore({ competition: { value: 0, origin: "measured" } }).total).toBe(100);
  });

  it("todo score referencia a versão da configuração", () => {
    expect(computeScore({ demand: { value: 0.5, origin: "measured" } }).configVersion).toBe("real_estate.v1");
  });
});

describe("transições do ciclo de vida", () => {
  it("published e indexed são inalcançáveis a partir de QUALQUER etapa", () => {
    for (const from of STAGES) {
      for (const to of ["published", "indexed"] as const) {
        const d = decideTransition({ from, to, actor: "u1", reason: "x" });
        expect(d).toMatchObject({ ok: false, code: "blocked_target" });
      }
    }
  });

  it("aceita transição válida e registra de/para/quem/quando/motivo", () => {
    const d = decideTransition({ from: "discovered", to: "validated", actor: "u1", reason: "volume medido" }, new Date("2026-10-14T00:00:00Z"));
    expect(d).toEqual({ ok: true, from: "discovered", to: "validated", actor: "u1", reason: "volume medido", at: "2026-10-14T00:00:00.000Z" });
  });

  it("recusa pular etapas e exige motivo e ator", () => {
    expect(decideTransition({ from: "discovered", to: "gate_approved", actor: "u1", reason: "x" })).toMatchObject({ ok: false, code: "invalid_transition" });
    expect(decideTransition({ from: "discovered", to: "validated", actor: "u1", reason: " " })).toMatchObject({ ok: false, code: "missing_reason" });
    expect(decideTransition({ from: "discovered", to: "validated", actor: "", reason: "x" })).toMatchObject({ ok: false, code: "missing_actor" });
  });
});

describe("gate e versões do blueprint", () => {
  const bp: BlueprintContent = { opportunityId: "o1", archetype: "guide", modules: ["faq", "map"], targetQuery: "apartamento à venda em são paulo" };
  const allPass = (hash: string): GateEvaluation => ({
    blueprintHash: hash,
    evaluatedAt: "2026-10-14T00:00:00Z",
    results: GATE_CATEGORIES.map((category) => ({ category, outcome: "pass", reasons: ["ok"], missingData: [], evidence: ["e"] })),
  });

  it("hash é determinístico e independe da ordem das chaves", () => {
    expect(blueprintHash(bp)).toBe(blueprintHash({ targetQuery: bp.targetQuery, modules: bp.modules, archetype: bp.archetype, opportunityId: "o1" }));
  });

  it("aprova só a versão avaliada", () => {
    expect(gateVerdict(bp, allPass(blueprintHash(bp)))).toEqual({ approved: true });
  });

  it("versão alterada nunca herda a aprovação anterior", () => {
    const evaluation = allPass(blueprintHash(bp));
    const changed = { ...bp, modules: ["faq"] };
    expect(gateVerdict(changed, evaluation)).toMatchObject({ approved: false, reason: "stale" });
  });

  it("not_evaluated e blocked nunca contam como aprovado", () => {
    const hash = blueprintHash(bp);
    for (const outcome of ["not_evaluated", "blocked"] as const) {
      const ev = allPass(hash);
      const results = ev.results.map((r, i) => (i === 0 ? { ...r, outcome } : r));
      expect(gateVerdict(bp, { ...ev, results }).approved).toBe(false);
    }
    expect(gateVerdict(bp, null)).toMatchObject({ approved: false, reason: "not_evaluated" });
  });

  it("categoria faltando reprova como incompleto", () => {
    const ev = allPass(blueprintHash(bp));
    expect(gateVerdict(bp, { ...ev, results: ev.results.slice(1) })).toMatchObject({ approved: false, reason: "incomplete" });
  });
});

describe("cache e orçamento", () => {
  it("chave de cache é determinística e independe da ordem dos parâmetros", () => {
    expect(cacheKey("dataforseo", "/x", { a: 1, b: [2, 3] })).toBe(cacheKey("dataforseo", "/x", { b: [2, 3], a: 1 }));
    expect(cacheKey("dataforseo", "/x", { a: 1 })).not.toBe(cacheKey("dataforseo", "/y", { a: 1 }));
  });

  it("limite de requisições por execução é aplicado", () => {
    const b = new RunBudget(2);
    b.reserve();
    b.reserve();
    expect(() => b.reserve()).toThrow(BudgetExceededError);
  });

  it("teto em US$ considera o gasto anterior da unidade", () => {
    const b = new RunBudget(300, 30, 29.99);
    b.reserve();
    b.record({ provider: "dataforseo", endpoint: "/x", cacheKey: "k", cacheHit: false, costUsd: 0.02, ok: true });
    expect(() => b.reserve()).toThrow(/US\$ 30/);
  });

  it("cache hit não soma custo", async () => {
    const b = new RunBudget();
    b.record({ provider: "dataforseo", endpoint: "/x", cacheKey: "k", cacheHit: true, costUsd: 5, ok: true });
    expect(b.summary.costUsd).toBe(0);
    expect(b.summary.cacheHitRate).toBe(1);
    const c = memoryCache();
    await c.set("k", { body: 1, collectedAt: "t", costUsd: 0 });
    expect(await c.get("k")).not.toBeNull();
  });
});
