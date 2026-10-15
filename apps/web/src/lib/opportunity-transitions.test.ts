import { describe, expect, it } from "vitest";
import { OPPORTUNITY_STATUSES } from "@plataforma/api";
import { TRANSITIONS, isAllowedTransition } from "./opportunity-transitions";

describe("transições de status", () => {
  it("todo status tem uma entrada, e nenhum destino é o próprio status", () => {
    for (const s of OPPORTUNITY_STATUSES) {
      expect(TRANSITIONS[s]).toBeDefined();
      expect(TRANSITIONS[s].every((t) => t.to !== s)).toBe(true);
    }
  });
  it("nenhum clique leva a 'blocked' (o bloqueio vem dos gates)", () => {
    for (const s of OPPORTUNITY_STATUSES) expect(TRANSITIONS[s].some((t) => t.to === "blocked")).toBe(false);
  });
  it("não se pula etapas: candidata não vai direto para pronta", () => {
    expect(isAllowedTransition("candidate", "ready")).toBe(false);
    expect(isAllowedTransition("candidate", "in_review")).toBe(true);
    expect(isAllowedTransition("in_review", "ready")).toBe(true);
  });
  it("descartada só pode ser restaurada (para candidata)", () => {
    expect(TRANSITIONS.dismissed.map((t) => t.to)).toEqual(["candidate"]);
  });
  it("qualquer oportunidade ativa pode ser descartada (reversível)", () => {
    for (const s of OPPORTUNITY_STATUSES.filter((x) => x !== "dismissed")) expect(isAllowedTransition(s, "dismissed")).toBe(true);
  });
});
