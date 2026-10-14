import { describe, expect, it } from "vitest";
import { STATES, assertExecutable, canTransition, isPublicationState, type LifecycleState } from "../engine/lifecycle";
import { planTransitions } from "./store";
import { DECISIONS } from "./types";

describe("plano de transições (mapeamento dos estados da especificação para a máquina existente)", () => {
  const target = { READY_FOR_BLUEPRINT: "eligible", DATA_REQUIRED: "scored", RESEARCH_REQUIRED: "scored", REJECTED: "rejected" } as const;
  it("todo plano é uma cadeia de arestas VÁLIDAS e executáveis, termina no estado-alvo e nunca toca a publicação", () => {
    for (const d of DECISIONS) for (const from of STATES) {
      const plan = planTransitions(from, d);
      if (plan === null) continue;
      let cur: LifecycleState = from;
      for (const next of plan) { expect(canTransition(cur, next), `${d}: ${cur} -> ${next}`).toBe(true); expect(() => assertExecutable(cur, next)).not.toThrow(); expect(isPublicationState(next)).toBe(false); cur = next; }
      expect(cur, `${d} de ${from}`).toBe(plan.length === 0 && from === target[d] ? from : target[d]);
    }
  });
  it("estados avançados (blueprint em diante) não regridem: o plano é nulo", () => {
    for (const from of ["serp_analyzed", "blueprinted", "data_assembled", "evidence_validated", "experience_built", "qa", "published", "indexed", "retired"] as const) for (const d of DECISIONS) expect(planTransitions(from, d), `${from}/${d}`).toBeNull();
  });
  it("trajetos típicos", () => {
    expect(planTransitions("discovered", "READY_FOR_BLUEPRINT")).toEqual(["validated", "scored", "eligible"]);
    expect(planTransitions("discovered", "DATA_REQUIRED")).toEqual(["validated", "scored"]);
    expect(planTransitions("discovered", "REJECTED")).toEqual(["validated", "rejected"]);
    expect(planTransitions("scored", "REJECTED")).toEqual(["rejected"]);
    expect(planTransitions("eligible", "RESEARCH_REQUIRED")).toEqual(["scored"]);
    expect(planTransitions("rejected", "DATA_REQUIRED")).toEqual(["discovered", "validated", "scored"]);
    expect(planTransitions("scored", "DATA_REQUIRED")).toEqual([]);
  });
});
