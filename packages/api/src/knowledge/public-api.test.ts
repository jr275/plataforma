import { describe, expect, it } from "vitest";
import * as api from "../index";

describe("P5: superfície pública", () => {
  it("Knowledge Engineering é exposto só como namespace `knowledge`, sem nomes genéricos na raiz do pacote", () => {
    expect(typeof api.knowledge.BiTemporalStore).toBe("function");
    expect(typeof api.knowledge.checkTransition).toBe("function");
    expect(api.knowledge.EPISTEMIC_STATES).toContain("OBSERVED_TRUE");
    for (const generic of ["interval", "instant", "since", "contains", "overlaps", "UNBOUNDED", "UNKNOWN", "BiTemporalStore", "POLICIES", "validateEntity"]) {
      expect(Object.keys(api)).not.toContain(generic);
    }
  });
  it("a API existente continua exportada (sem regressão)", () => {
    for (const name of ["withTenant", "devIdentity", "runCityImport", "renderCityPage", "listImportRuns", "createAppPool", "createSupabaseAuthenticator"]) expect(Object.keys(api)).toContain(name);
  });
});
