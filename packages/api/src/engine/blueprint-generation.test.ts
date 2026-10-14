import { describe, expect, it } from "vitest";
import { TEMPLATE_REGISTRY } from "../pages/registry";
import { GENERATION_START_STATES, generationPreconditions } from "./blueprint-generation";
import { IMPLEMENTED_STATES, PUBLICATION_STATES, STATES, PublicationBlockedError, assertExecutable, canTransition, isPublicationState } from "./lifecycle";

type Opp = { status: string; entityKind: string | null; entityId: string | null };
const OK: Opp = { status: "blueprinted", entityKind: "city", entityId: "c1" };
const BP = { ready: true, templateKey: "city-overview" };
const D = { saved: false, valid: true, hasTemplate: true };
const pre = (o: Opp = OK, bp: { ready: boolean; templateKey: string | null } | null = BP, facts = true, d = D) => generationPreconditions(o, bp, TEMPLATE_REGISTRY, facts, d);

describe("pré-condições da geração", () => {
  it("tudo em ordem: nenhum motivo", () => expect(pre()).toEqual([]));
  it("estados anteriores ao blueprint não geram (elegível exige a exceção de SERP antes)", () => {
    for (const s of ["discovered", "validated", "scored", "eligible", "serp_analyzed", "rejected", "retired"]) expect(pre({ ...OK, status: s }).join(" "), s).toMatch(/blueprinted/);
    for (const s of GENERATION_START_STATES) expect(pre({ ...OK, status: s }), s).toEqual([]);
  });
  it("estados de publicação nunca iniciam geração", () => { for (const s of PUBLICATION_STATES) expect(pre({ ...OK, status: s }).length, s).toBeGreaterThan(0); });
  it("sem blueprint, blueprint reprovado e template inexistente (template_gap) são recusados com o motivo", () => {
    expect(pre(OK, null)).toEqual(["não há blueprint"]);
    expect(pre(OK, { ready: false, templateKey: "city-overview" }).join(" ")).toMatch(/gates reprovados/);
    expect(pre(OK, { ready: true, templateKey: "comparison" }).join(" ")).toMatch(/template_gap/);
    expect(pre(OK, { ready: true, templateKey: null }).join(" ")).toMatch(/template_gap/);
  });
  it("sem cidade real ou sem fatos de importação real não gera", () => {
    expect(pre({ ...OK, entityKind: null, entityId: null }).join(" ")).toMatch(/cidade real/);
    expect(pre(OK, BP, false).join(" ")).toMatch(/fatos reais/);
  });
  it("rascunho salvo inválido ou sem template gerável bloqueia; sem rascunho salvo não bloqueia", () => {
    expect(pre(OK, BP, true, { saved: true, valid: false, hasTemplate: true }).join(" ")).toMatch(/inválido/);
    expect(pre(OK, BP, true, { saved: true, valid: true, hasTemplate: false }).join(" ")).toMatch(/gerável/);
    expect(pre(OK, BP, true, { saved: true, valid: true, hasTemplate: true })).toEqual([]);
  });
  it("devolve TODOS os motivos de uma vez", () => { expect(pre({ status: "scored", entityKind: null, entityId: null }, null, false).length).toBeGreaterThanOrEqual(3); });
});

describe("publicação bloqueada no modelo", () => {
  it("o modelo ainda descreve o ciclo completo, mas nenhuma entrada em etapa pós-QA é executável", () => {
    expect(canTransition("qa", "published")).toBe(true);
    expect(() => assertExecutable("qa", "published")).toThrow(PublicationBlockedError);
    for (const s of PUBLICATION_STATES) { expect(isPublicationState(s)).toBe(true); expect(IMPLEMENTED_STATES).not.toContain(s); }
  });
  it("as etapas executáveis chegam até QA e nenhuma etapa pós-QA está marcada como implementada", () => {
    expect(IMPLEMENTED_STATES).toEqual(expect.arrayContaining(["data_assembled", "evidence_validated", "experience_built", "qa"]));
    expect([...STATES].filter((s) => isPublicationState(s))).toHaveLength(7);
  });
  it("qa → retired e experience_built → qa continuam executáveis (só a publicação é bloqueada)", () => {
    expect(() => assertExecutable("qa", "retired")).not.toThrow();
    expect(() => assertExecutable("experience_built", "qa")).not.toThrow();
  });
});
