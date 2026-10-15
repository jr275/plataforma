import { describe, expect, it } from "vitest";
import { countByStatus, matchingNodeIds, sameShape, type FlowDefinition, type FlowNodeSpec, type FlowStatus } from "./model";

const spec = (id: string, status: FlowStatus, title = id, summary?: string): FlowNodeSpec => ({ id, kind: "gate", title, description: "", status, summary, x: 0, y: 0, detail: { purpose: "", rows: [], downstream: [] } });
const def = (nodes: FlowNodeSpec[], edges: { id: string }[] = []): FlowDefinition => ({ id: "d", title: "t", mode: "recorded", nodes, edges: edges.map((e) => ({ id: e.id, source: "a", target: "b" })) });

describe("modelo do fluxo", () => {
  const nodes = [spec("a", "completed", "Fatos"), spec("b", "failed", "URL única", "a rota já existe"), spec("c", "completed", "Meta"), spec("d", "unavailable", "Publicação")];
  it("conta por estado", () => { expect(countByStatus(nodes)).toEqual({ completed: 2, failed: 1, unavailable: 1 }); });
  it("filtra por estado, por texto (título e resumo) e pelos dois juntos", () => {
    expect([...matchingNodeIds(nodes, new Set(["completed"]), "")]).toEqual(["a", "c"]);
    expect([...matchingNodeIds(nodes, new Set(), "url")]).toEqual(["b"]);
    expect([...matchingNodeIds(nodes, new Set(), "ROTA")]).toEqual(["b"]);
    expect([...matchingNodeIds(nodes, new Set(["completed"]), "meta")]).toEqual(["c"]);
    expect(matchingNodeIds(nodes, new Set(), "").size).toBe(4);
  });
  it("reconhece a mesma forma mesmo quando o estado mudou, e a forma diferente quando o grafo mudou", () => {
    expect(sameShape(def(nodes, [{ id: "e1" }]), def(nodes.map((n) => ({ ...n, status: "idle" as const })), [{ id: "e1" }]))).toBe(true);
    expect(sameShape(def(nodes), def(nodes.slice(0, 3)))).toBe(false);
    expect(sameShape(def(nodes, [{ id: "e1" }]), def(nodes, [{ id: "e2" }]))).toBe(false);
  });
});
