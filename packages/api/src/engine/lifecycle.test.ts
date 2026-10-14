import { describe, expect, it } from "vitest";
import { LifecycleError, RESCORABLE, STATES, STATE_LABEL, TRANSITIONS, allowedNext, assertTransition, canTransition, canTransitionManually, isState, isTerminal, manualNext } from "./lifecycle";

describe("ciclo de vida: transições válidas e inválidas", () => {
  it("todo estado tem rótulo e entrada na tabela; todo destino é um estado conhecido", () => {
    for (const s of STATES) { expect(STATE_LABEL[s], s).toMatch(/\S/); expect(TRANSITIONS[s], s).toBeDefined(); for (const t of TRANSITIONS[s]) expect(isState(t), `${s} -> ${t}`).toBe(true); }
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...STATES].sort());
  });
  it("a cadeia do mandato é percorrível de ponta a ponta, um passo de cada vez", () => {
    const chain = ["discovered", "validated", "scored", "eligible", "serp_analyzed", "blueprinted", "data_assembled", "evidence_validated", "experience_built", "qa", "published", "indexed", "monitored", "converted", "measured", "learned", "refreshed"] as const;
    for (let i = 0; i < chain.length - 1; i++) expect(canTransition(chain[i]!, chain[i + 1]!), `${chain[i]} -> ${chain[i + 1]}`).toBe(true);
  });
  it("não se pula etapa: nenhum estado alcança outro mais adiante sem passar pelos intermediários", () => {
    const skips: [string, string][] = [["discovered", "scored"], ["validated", "eligible"], ["scored", "serp_analyzed"], ["scored", "blueprinted"], ["blueprinted", "evidence_validated"], ["experience_built", "published"], ["qa", "indexed"], ["discovered", "published"], ["scored", "published"], ["eligible", "published"]];
    for (const [a, b] of skips) expect(canTransition(a as never, b as never), `${a} -> ${b}`).toBe(false);
  });
  it("matriz completa: só as transições da tabela são válidas (19 x 19 pares); permanecer no mesmo estado não é transição", () => {
    let valid = 0;
    for (const a of STATES) for (const b of STATES) {
      const expected = TRANSITIONS[a].includes(b);
      expect(canTransition(a, b), `${a} -> ${b}`).toBe(expected);
      if (expected) valid++;
      if (a === b) expect(canTransition(a, b)).toBe(false);
    }
    expect(valid).toBe(Object.values(TRANSITIONS).reduce((n, l) => n + l.length, 0));
  });
  it("aposentada é terminal; rejeitada só reabre para 'descoberta' (ou aposenta); todo estado não terminal pode ser aposentado", () => {
    expect(isTerminal("retired")).toBe(true);
    expect(allowedNext("retired")).toEqual([]);
    expect([...allowedNext("rejected")].sort()).toEqual(["discovered", "retired"]);
    for (const s of STATES) if (s !== "retired") expect(canTransition(s, "retired"), s).toBe(true);
    for (const s of STATES) if (s !== "retired") expect(isTerminal(s), s).toBe(false);
  });
  it("só 'descoberta' e 'validada' podem ser rejeitadas (rejeitar é decisão de validação, não de execução)", () => {
    expect(STATES.filter((s) => canTransition(s, "rejected")).sort()).toEqual(["discovered", "validated"]);
  });
  it("retornos permitidos são só os de refazer a etapa anterior; o ciclo de aprendizado reentra por 'pontuada'", () => {
    expect(canTransition("qa", "experience_built")).toBe(true);
    expect(canTransition("refreshed", "scored")).toBe(true);
    expect(canTransition("published", "qa")).toBe(false);
    expect(canTransition("measured", "published")).toBe(false);
  });
  it("assertTransition lança LifecycleError com o par inválido e não lança nos válidos", () => {
    expect(() => assertTransition("discovered", "published")).toThrow(LifecycleError);
    try { assertTransition("discovered", "published"); } catch (e) { expect(e).toMatchObject({ code: "INVALID_TRANSITION", from: "discovered", to: "published" }); }
    expect(() => assertTransition("discovered", "validated")).not.toThrow();
  });
  it("estados em que pode haver nova pontuação sem mudar de estado são só os anteriores à construção", () => {
    for (const s of RESCORABLE) expect(["scored", "eligible", "serp_analyzed", "blueprinted"]).toContain(s);
    expect(RESCORABLE).not.toContain("published");
  });
  it("isState recusa valores arbitrários", () => {
    for (const x of ["", "Published", "published ", 1, null, undefined, {}]) expect(isState(x)).toBe(false);
  });
});

describe("dispensa registrada da etapa SERP (ADR-024)", () => {
  it("eligible -> blueprinted existe (sem provedor de SERP) e o caminho normal continua; só voltas de estados posteriores entram em blueprinted sem passar pela SERP", () => {
    expect(canTransition("eligible", "blueprinted")).toBe(true);
    expect(canTransition("eligible", "serp_analyzed")).toBe(true);
    expect(canTransition("serp_analyzed", "blueprinted")).toBe(true);
    for (const s of STATES.filter((x) => !["eligible", "serp_analyzed", "data_assembled"].includes(x))) expect(canTransition(s, "blueprinted"), `${s} -> blueprinted`).toBe(false);
  });
});

describe("transições MANUAIS: só as que não afirmam trabalho feito", () => {
  it("uma pessoa pode aposentar, voltar a 'pontuada' ou reabrir uma rejeitada; nunca marcar SERP, blueprint, dados, publicação ou indexação", () => {
    for (const s of STATES) for (const t of TRANSITIONS[s]) expect(canTransitionManually(s, t), `${s} -> ${t}`).toBe(["retired", "scored", "discovered"].includes(t));
    expect(manualNext("eligible")).toEqual(["scored", "retired"]);
    expect(manualNext("scored")).toEqual(["retired"]);
    expect(manualNext("rejected")).toEqual(["discovered", "retired"]);
    expect(manualNext("qa")).toEqual(["retired"]);
    expect(canTransitionManually("eligible", "serp_analyzed")).toBe(false);
    expect(canTransitionManually("qa", "published")).toBe(false);
    expect(canTransitionManually("scored", "scored")).toBe(false);
  });
});
