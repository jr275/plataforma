import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { STAGE_IDS, TOOLS, computeMetrics, evaluateAll, type OperationalEvidence as Evidence, type ToolInput } from "@plataforma/api";
import { buildOperationsFlow, buildToolRows } from "@/lib/ops/operations-flow";
import type { OperationsData } from "@/lib/server/operations";
import { NEXT_ACTION, OperationsView } from "./operations-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const NOW = new Date("2026-10-17T12:00:00Z");
const ev = (over: Partial<Evidence> = {}): Evidence => ({ id: "e", kind: "execution_record", mode: "live", at: "2026-10-17T11:00:00Z", outcome: "success", ...over });
function data(evidence: Record<string, Evidence[]> = {}, running = false): OperationsData {
  const names = new Set(TOOLS.flatMap((t) => [...t.requiresConfig]));
  const inputs = new Map<string, ToolInput>(TOOLS.map((t) => [t.id, { configPresent: names, evidence: evidence[t.id] ?? [] }]));
  const states = evaluateAll(TOOLS, inputs, NOW);
  return { state: "ready", generatedAt: NOW.toISOString(), flow: buildOperationsFlow(states, { running }), rows: buildToolRows(states), metrics: computeMetrics(TOOLS, STAGE_IDS, states, inputs), running, evidenceSources: ["configuração do ambiente (só presença de nomes)"] };
}
const html = (d: OperationsData) => renderToStaticMarkup(<OperationsView data={d} />);

describe("tela de operações", () => {
  it("sem nenhuma evidência: 0 ferramentas funcionando, com numerador e denominador, e a nota diz que o que não deixou evidência é NOT_TESTED", () => {
    const out = html(data());
    expect(out).toContain(`0 de ${TOOLS.length} registradas`);
    expect(out).toContain("0 de 15 etapas");
    expect(out).toContain("sem base"); // nenhuma checagem real elegível: nunca 0% nem 100%
    expect(out).toContain("NOT_TESTED");
    expect(out).toContain("nunca como funcionando");
  });
  it("lista os 9 status com a contagem, em texto (não só cor)", () => {
    const out = html(data());
    for (const s of ["WORKING", "DEGRADED", "NOT_WORKING", "NOT_CONFIGURED", "NOT_TESTED", "BLOCKED", "MOCK", "DISABLED", "STALE"]) expect(out, s).toContain(`${s} ·`);
  });
  it("falha na importação: aparece NOT_WORKING, o bloqueio das dependentes com a causa raiz e a próxima ação", () => {
    const out = html(data({ "ingest.city-import": [ev({ outcome: "failure", errorCode: "RUN_FAILED", detail: "arquivo corrompido" })] }));
    expect(out).toContain("RUN_FAILED: arquivo corrompido");
    expect(out).toContain("causa raiz: ingest.city-import");
    expect(out).toContain(NEXT_ACTION.BLOCKED);
    expect(out).toMatch(/Problemas críticos<\/p><p[^>]*>[1-9]/);
  });
  it("mock não vira funcionando: aparece como MOCK com o modo explícito", () => {
    const out = html(data({ "generate.city-pages": [ev({ mode: "mock" })] }));
    expect(out).toContain("última execução foi mock");
    expect(out).toContain(">MOCK<");
  });
  it("acesso negado explica o motivo e não mostra nenhum número", () => {
    const out = html({ state: "denied", reason: "unauthenticated" });
    expect(out).toContain("Entre para ver as operações");
    expect(out).not.toContain("Ferramentas funcionando");
  });
  it("acesso negado por falta de escolha de workspace tem texto próprio (não cai em undefined)", () => {
    expect(html({ state: "denied", reason: "tenant_selection_required" })).toContain("Seleção de workspace necessária");
  });
  it("não pede nenhuma decisão: sem formulários, seletores nem campos", () => {
    expect(html(data())).not.toMatch(/<(select|input|form)\b/);
  });
  it("toda ferramenta aparece na tabela, sem exceção", () => {
    const out = html(data());
    for (const t of TOOLS) expect(out, t.id).toContain(t.id);
  });
});
