import { describe, expect, it } from "vitest";
import { LANES, LANE_LABEL, classify, describeBlocker } from "./roadmap";
import { TEST_VERTICAL as V } from "./test-support/vertical.fixture";

const base = { status: "eligible" as const, eligible: true as boolean | null, ready: null as boolean | null, blueprintBlockers: null as string[] | null, failedEligibility: [] as string[] };

describe("roadmap: a faixa e os bloqueios que a explicam (puro)", () => {
  it("com blueprint pronto E etapa de SERP resolvida: 'pronta para construir'; a exceção de SERP vigente continua como pendência visível", () => {
    expect(classify({ ...base, status: "blueprinted", ready: true })).toEqual({ lane: "ready", blockers: [] });
    expect(classify({ ...base, status: "blueprinted", ready: true, serpWaiverPending: true })).toEqual({ lane: "ready", blockers: ["serp_waiver"] });
  });
  it("blueprint pronto mas ainda 'elegível': NÃO está pronta; falta a SERP (analisar ou registrar a exceção)", () => {
    expect(classify({ ...base, status: "eligible", ready: true })).toEqual({ lane: "awaiting_blueprint", blockers: ["serp_pending"] });
    expect(classify({ ...base, status: "serp_analyzed", ready: true })).toEqual({ lane: "awaiting_blueprint", blockers: [] });
  });
  it("blueprint reprovado: 'bloqueada', com os bloqueios do blueprint sem repetição", () => {
    expect(classify({ ...base, ready: false, blueprintBlockers: ["template:guide", "evidence:x", "template:guide"] })).toEqual({ lane: "blocked", blockers: ["template:guide", "evidence:x"] });
    expect(classify({ ...base, ready: false, blueprintBlockers: null })).toEqual({ lane: "blocked", blockers: [] });
  });
  it("elegível sem blueprint: aguarda o blueprint (também em 'SERP analisada'); nunca pronta", () => {
    expect(classify(base).lane).toBe("awaiting_blueprint");
    expect(classify({ ...base, status: "serp_analyzed" }).lane).toBe("awaiting_blueprint");
  });
  it("não elegível (ou elegibilidade desconhecida): 'ainda não elegível', com a verificação que falhou como bloqueio", () => {
    expect(classify({ ...base, status: "scored", eligible: false, failedEligibility: ["demand_or_strategic", "evidence_risk_max"] })).toEqual({ lane: "needs_work", blockers: ["eligibility:demand_or_strategic", "eligibility:evidence_risk_max"] });
    expect(classify({ ...base, status: "scored", eligible: null }).lane).toBe("needs_work");
    expect(classify({ ...base, status: "scored", eligible: true }).lane).toBe("needs_work"); // elegível no score, mas o estado ainda não acompanhou
  });
  it("as quatro faixas têm rótulo", () => {
    expect(LANES).toHaveLength(4);
    for (const l of LANES) expect(LANE_LABEL[l]).toMatch(/\S/);
  });
});

describe("describeBlocker: cada família de bloqueio vira texto legível, com o rótulo da vertical", () => {
  it("elegibilidade, template, experiência, evidência, dados e bloqueios simples", () => {
    expect(describeBlocker("eligibility:demand_or_strategic", V)).toContain("demanda medida");
    expect(describeBlocker("eligibility:commercial_value_min", V)).toContain("Valor comercial");
    expect(describeBlocker("eligibility:execution_feasibility_min", V)).toContain("Viabilidade");
    expect(describeBlocker("eligibility:codigo_novo", V)).toBe("Elegibilidade: codigo_novo");
    expect(describeBlocker("template:guide", V)).toBe('Falta template para a experiência "Guia"');
    expect(describeBlocker("template_entity:directory", V)).toContain('"Diretório"');
    expect(describeBlocker("experience:ranking", V)).toContain("ainda não é suportada");
    expect(describeBlocker("evidence:inventory", V)).toBe("Falta evidência crítica: Estoque da loja");
    expect(describeBlocker("facts:city", V)).toContain("dados da entidade");
    expect(describeBlocker("cannibalization", V)).toContain("Canibalização");
    expect(describeBlocker("serp_pending", V)).toContain("não autoriza publicação");
    expect(describeBlocker("serp_waiver", V)).toContain("não foi revisada");
    expect(describeBlocker("path_conflict", V)).toContain("já usado");
    expect(describeBlocker("chave-desconhecida", V)).toBe("chave-desconhecida");
    expect(describeBlocker("template:inexistente", V)).toContain('"inexistente"'); // sem rótulo na vertical: mostra o id, nunca inventa
  });
});
