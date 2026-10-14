import { describe, expect, it } from "vitest";
import { investigate, type InvestigationInput } from "./investigation";
import { computeScore } from "./score";
import { TEST_CONFIG, full } from "./test-support/score-fixtures";
import { TEST_VERTICAL as V } from "./test-support/vertical.fixture";

const score = (over = {}, strategic = true) => computeScore({ dimensions: full({ demand: null, serp_opportunity: null, authority_gap: null, competition: null, citation_potential: null, information_gain: null, pipeline_potential: null, ...over }), strategic }, TEST_CONFIG);
const base = (o: Partial<InvestigationInput> = {}): InvestigationInput => ({ status: "eligible", score: score(), evidence: [{ adapter: "bcb-sgs", role: "signal" }, { adapter: "bcb-sgs", role: "requirement" }, { adapter: "ibge-news", role: "signal" }], blueprint: null, serpWaiver: null, ...o });

describe("investigate: o que sei, de onde, o que falta, o que bloqueia, próximo passo", () => {
  it("sabe contar objetivos, dimensões e fontes; lista o que falta com a necessidade exata", () => {
    const r = investigate(base(), V);
    expect(r.known.join(" ")).toMatch(/2 de 3 objetivos/);
    expect(r.known.join(" ")).toContain("3 evidência(s)");
    expect(r.sources).toEqual([{ adapter: "bcb-sgs", count: 2 }, { adapter: "ibge-news", count: 1 }]);
    expect(r.missing.length).toBe(7);
    expect(r.missing.join(" ")).toContain("volume de busca");
  });
  it("elegível sem blueprint: próxima ação real = gerar o blueprint", () => {
    expect(investigate(base(), V).next).toMatchObject({ kind: "action", label: "Gerar o blueprint" });
  });
  it("blueprint pronto vindo de 'elegível': o passo é DECIDIR a exceção de SERP (que não autoriza publicação)", () => {
    const r = investigate(base({ blueprint: { version: 1, ready: true, blockers: [] } }), V);
    expect(r.next).toMatchObject({ kind: "decision", label: "Registrar a exceção de SERP" });
    expect(r.next.detail).toContain("não autoriza publicação");
    expect(r.lane).toBe("awaiting_blueprint");
  });
  it("blueprint reprovado: bloqueado, com os bloqueios legíveis", () => {
    const r = investigate(base({ blueprint: { version: 1, ready: false, blockers: ["template:guide"] } }), V);
    expect(r.next.kind).toBe("blocked");
    expect(r.blockers).toEqual([{ key: "template:guide", label: 'Falta template para a experiência "Guia"' }]);
  });
  it("com blueprint e exceção de SERP vigente: pronta para construir, MAS a pendência de SERP continua listada", () => {
    const r = investigate(base({ status: "blueprinted", blueprint: { version: 1, ready: true, blockers: [] }, serpWaiver: { reviewed: false } }), V);
    expect(r.lane).toBe("ready");
    expect(r.blockers.map((b) => b.key)).toContain("serp_waiver");
    expect(r.next.detail).toContain("decisão do dono");
    expect(investigate(base({ status: "blueprinted", blueprint: { version: 1, ready: true, blockers: [] }, serpWaiver: { reviewed: true } }), V).blockers).toEqual([]);
  });
  it("não elegível: bloqueios da elegibilidade; sem score: aguardando; encerradas: nada a fazer", () => {
    const weak = score({ demand: null }, false);
    const r = investigate(base({ status: "scored", score: weak }), V);
    expect(r.lane).toBe("needs_work");
    expect(r.blockers.map((b) => b.key)).toContain("eligibility:demand_or_strategic");
    expect(investigate(base({ status: "validated", score: null }), V).next.label).toBe("Aguardando score");
    expect(investigate(base({ status: "retired" }), V).next.label).toBe("Encerrada");
    expect(investigate(base({ status: "rejected" }), V).next.label).toBe("Rejeitada");
  });
});
