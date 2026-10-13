import { describe, expect, it } from "vitest";
import { ALLOWED_TRANSITIONS, EPISTEMIC_STATES, POLICIES, STATE_MEANING, checkTransition, isDirectObservation, isEligible } from "./epistemic";

describe("estados epistemológicos", () => {
  it("todo estado tem semântica documentada", () => {
    for (const s of EPISTEMIC_STATES) expect(STATE_MEANING[s].length).toBeGreaterThan(10);
  });
  it("nenhum estado com fato leva a ABSENT: ausência de evidência não apaga (Open-World)", () => {
    for (const from of EPISTEMIC_STATES) {
      expect(ALLOWED_TRANSITIONS[from]).not.toContain("ABSENT");
      const r = checkTransition({ from, to: "ABSENT", reason: "expiry", evidenceIds: [] });
      expect(r).toMatchObject({ ok: false, code: "to_absent" });
    }
  });
  it("observar pela primeira vez exige evidência; a expiração não", () => {
    expect(checkTransition({ from: "ABSENT", to: "OBSERVED_TRUE", reason: "new_observation", evidenceIds: [] })).toMatchObject({ ok: false, code: "evidence_required" });
    expect(checkTransition({ from: "ABSENT", to: "OBSERVED_TRUE", reason: "new_observation", evidenceIds: ["e1"] })).toEqual({ ok: true });
    expect(checkTransition({ from: "OBSERVED_TRUE", to: "UNKNOWN_STALE", reason: "expiry", evidenceIds: [] })).toEqual({ ok: true });
  });
  it("o motivo precisa combinar com o destino", () => {
    expect(checkTransition({ from: "ABSENT", to: "INFERRED_PROBABLE", reason: "new_observation", evidenceIds: ["e"] })).toMatchObject({ code: "reason_mismatch" });
    expect(checkTransition({ from: "OBSERVED_TRUE", to: "CONFLICTING", reason: "resolution", evidenceIds: ["e"] })).toMatchObject({ code: "reason_mismatch" });
    expect(checkTransition({ from: "ABSENT", to: "INFERRED_PROBABLE", reason: "inference", evidenceIds: ["e"] })).toEqual({ ok: true });
  });
  it("conflito só se resolve por observação com evidência ou vira vencido; não vira inferência nem ausente", () => {
    expect(checkTransition({ from: "CONFLICTING", to: "OBSERVED_TRUE", reason: "resolution", evidenceIds: ["e"] })).toEqual({ ok: true });
    expect(checkTransition({ from: "CONFLICTING", to: "INFERRED_PROBABLE", reason: "inference", evidenceIds: ["e"] })).toMatchObject({ code: "not_allowed" });
  });
  it("uma observação direta nunca nasce de inferência sem passar por revalidação com evidência", () => {
    expect(checkTransition({ from: "INFERRED_PROBABLE", to: "OBSERVED_TRUE", reason: "new_observation", evidenceIds: [] })).toMatchObject({ code: "evidence_required" });
  });
  it("só observação direta é direta; inferência não é", () => {
    expect(EPISTEMIC_STATES.filter(isDirectObservation)).toEqual(["OBSERVED_TRUE", "OBSERVED_FALSE"]);
  });
  it("a política assertiva recusa inferido, conflitante, vencido e ausente; a histórica aceita tudo menos ausente", () => {
    for (const s of ["INFERRED_PROBABLE", "CONFLICTING", "UNKNOWN_STALE", "ABSENT"] as const) expect(isEligible(s, POLICIES.assertive)).toBe(false);
    expect(isEligible("OBSERVED_FALSE", POLICIES.assertive)).toBe(true);
    expect(isEligible("INFERRED_PROBABLE", POLICIES.hedged)).toBe(true);
    expect(POLICIES.hedged.mustLabelInference).toBe(true);
    expect(isEligible("ABSENT", POLICIES.historical)).toBe(false);
    expect(isEligible("UNKNOWN_STALE", POLICIES.historical)).toBe(true);
  });
});
