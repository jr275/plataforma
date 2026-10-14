import { describe, expect, it } from "vitest";
import { addNode, connect, executionStates, setLayout, updateConfig, validateDraft, draftToBlueprint } from "@plataforma/api/src/draft";
import { evaluateExperienceGates } from "@plataforma/api/src/engine/experience-gates";
import { autoLayout } from "./elk";
import { NODE_H, NODE_W, needsLayout, provisional, toGraph } from "./graph-adapter";
import { fixtureBlueprint, fixtureDraft, testCtx } from "./test-fixture";

const g = (d = fixtureDraft(), c = testCtx(), stale = false) => { const b = fixtureBlueprint(); return toGraph(d, c, b, evaluateExperienceGates(draftToBlueprint(d, b, c)), stale, validateDraft(d, c)); };

describe("conversão domínio → grafo (projeção, sem estado de negócio próprio)", () => {
  it("um nó de grafo por nó do domínio e uma aresta por conexão, com tipo, rótulo do contrato, estado de execução e validade", () => {
    const d = fixtureDraft(); const x = g(d);
    expect(x.nodes.map((n) => n.id)).toEqual(d.nodes.map((n) => n.id));
    expect(x.edges.map((e) => e.id)).toEqual(d.edges.map((e) => e.id));
    expect(x.edges.every((e) => !e.invalid)).toBe(true);
    const sec = x.nodes.find((n) => n.id === "page_section-1")!;
    expect(sec.data).toMatchObject({ type: "page_section", label: "Seção da página", validity: "ok", exec: { status: "done" } });
    expect(sec.data.summary).toBe("1. overview");
    expect(x.nodes.find((n) => n.data.type === "publication")!.data.exec.status).toBe("blocked");
  });
  it("estados explícitos: gates 'não avaliado' quando invalidados; link sem destino 'indisponível'; erro de configuração aparece no nó", () => {
    expect(g(fixtureDraft(), testCtx(), true).nodes.filter((n) => n.data.type === "quality_gate").every((n) => n.data.exec.status === "not_evaluated")).toBe(true);
    expect(g().nodes.find((n) => n.id === "internal_link-1")!.data.exec.status).toBe("unavailable"); // /cidades/sp não existe no contexto de teste
    const bad = updateConfig(fixtureDraft(), "page_section-1", { order: 0 }); if (!bad.ok) throw new Error();
    const n = g(bad.draft).nodes.find((x) => x.id === "page_section-1")!;
    expect(n.data.validity).toBe("error"); expect(n.data.issues).toBeGreaterThan(0);
  });
  it("posições: as do rascunho valem; nós sem posição recebem provisória em colunas; mover não depende do ELK", () => {
    const d = fixtureDraft(); expect(needsLayout(d)).toBe(true);
    const p = provisional(d); expect(Object.keys(p)).toHaveLength(d.nodes.length);
    expect(p["opportunity-1"]!.x).toBeLessThan(p["publication-1"]!.x);
    const placed = setLayout(d, Object.fromEntries(d.nodes.map((n) => [n.id, { x: 7, y: 8 }])));
    expect(needsLayout(placed)).toBe(false);
    expect(g(placed).nodes.every((n) => n.position.x === 7 && n.position.y === 8)).toBe(true);
  });
  it("o grafo acompanha o domínio: adicionar/conectar muda os nós e as arestas", () => {
    let d = fixtureDraft();
    const a = addNode(d, "internal_link", { path: "/cidades", text: "Todas" }); if (!a.ok) throw new Error(); d = a.draft;
    const c = connect(d, "page_template-1", a.nodeId!); if (!c.ok) throw new Error(); d = c.draft;
    const x = g(d);
    expect(x.nodes.some((n) => n.id === a.nodeId)).toBe(true);
    expect(x.edges.some((e) => e.id === `page_template-1>${a.nodeId}`)).toBe(true);
  });
  it("estado de execução vem do mesmo cálculo do servidor (executionStates)", () => {
    const d = fixtureDraft(); const b = fixtureBlueprint(); const c = testCtx();
    const rep = evaluateExperienceGates(draftToBlueprint(d, b, c));
    const ex = executionStates(d, c, draftToBlueprint(d, b, c), rep, false);
    for (const n of g(d).nodes) expect(n.data.exec).toEqual(ex[n.id]);
  });
});

describe("ELK calcula posições (layout em camadas), sem tocar regras de negócio", () => {
  it("todas as posições existem, respeitam a direção esquerda→direita das conexões e não sobrepõem nós", async () => {
    const d = fixtureDraft(); const l = await autoLayout(d);
    expect(Object.keys(l).sort()).toEqual(d.nodes.map((n) => n.id).sort());
    for (const e of d.edges) expect(l[e.from]!.x, e.id).toBeLessThan(l[e.to]!.x);
    const ns = Object.values(l);
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) { const a = ns[i]!, b = ns[j]!; expect(Math.abs(a.x - b.x) >= NODE_W || Math.abs(a.y - b.y) >= NODE_H, `${i}/${j}`).toBe(true); }
  });
  it("é determinístico e não altera o rascunho recebido", async () => {
    const d = fixtureDraft(); const before = JSON.stringify(d);
    expect(await autoLayout(d)).toEqual(await autoLayout(d));
    expect(JSON.stringify(d)).toBe(before);
  });
});
