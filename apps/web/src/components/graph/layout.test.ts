import { describe, expect, it } from "vitest";
import type { graph } from "@plataforma/api";
import { VIEW, layoutRadial } from "./layout";

const sum = (kind: graph.GraphNodeKind, key: string, label = key): graph.GraphNodeSummary => ({ ref: `${kind}:${key}`, kind, label, detail: null });
const city = (i: number) => sum("city", `d0000000-0000-4000-8000-${String(i).padStart(12, "0")}`, `Cidade ${i}`);
const expansion = (n: number, extra: graph.GraphNodeSummary[] = []): graph.GraphExpansion => {
  const center = sum("uf", "SP");
  const neighbors = [...extra, ...Array.from({ length: n }, (_, i) => city(i + 1))];
  return { center, neighbors, edges: neighbors.map((x) => ({ from: x.ref, to: center.ref, kind: "belongs_to_uf", label: "pertence à UF", basis: "source_column" as const })), totals: {}, shown: {}, truncated: false };
};
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("disposição radial pura", () => {
  it("o centro fica no meio do desenho e só existem os nós da expansão (nenhum inventado)", () => {
    const { nodes, edges } = layoutRadial(expansion(5, [sum("region", "Sudeste")]));
    expect(nodes).toHaveLength(7);
    expect(nodes[0]).toMatchObject({ ref: "uf:SP", isCenter: true, x: VIEW.width / 2, y: VIEW.height / 2 });
    expect(edges).toHaveLength(6);
    expect(new Set(nodes.map((n) => n.ref)).size).toBe(nodes.length);
  });
  it("é determinística e tudo cabe no desenho, para qualquer quantidade de vizinhos", () => {
    for (const n of [0, 1, 8, 24, 36, 37, 48, 96]) {
      const a = layoutRadial(expansion(n, [sum("region", "Sudeste")]));
      const b = layoutRadial(expansion(n, [sum("region", "Sudeste")]));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      for (const p of a.nodes) { expect(Number.isFinite(p.x) && Number.isFinite(p.y), `n=${n}`).toBe(true); expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(VIEW.width); expect(p.y).toBeGreaterThan(0); expect(p.y).toBeLessThan(VIEW.height); }
    }
  });
  it("nenhum par de nós se sobrepõe (distância mínima), mesmo com 96 cidades", () => {
    for (const n of [8, 36, 96]) {
      const { nodes } = layoutRadial(expansion(n, [sum("region", "Sudeste"), sum("region", "Sul")]));
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) expect(dist(nodes[i]!, nodes[j]!), `n=${n} ${nodes[i]!.ref} x ${nodes[j]!.ref}`).toBeGreaterThan(17);
    }
  });
  it("vizinhos que não são cidades ficam no anel interno; cidades no externo (dois anéis alternados quando são muitas)", () => {
    const small = layoutRadial(expansion(10, [sum("region", "Sudeste")]));
    const c = small.nodes[0]!;
    expect(Math.round(dist(c, small.nodes.find((n) => n.kind === "region")!))).toBe(120);
    expect(new Set(small.nodes.filter((n) => n.kind === "city").map((n) => Math.round(dist(c, n))))).toEqual(new Set([210]));
    const many = layoutRadial(expansion(60));
    expect(new Set(many.nodes.filter((n) => n.kind === "city").map((n) => Math.round(dist(many.nodes[0]!, n))))).toEqual(new Set([195, 245]));
  });
  it("rótulos só nas 24 primeiras cidades quando há muitas (o resto fica no título e na lista)", () => {
    const { nodes } = layoutRadial(expansion(60));
    expect(nodes.filter((n) => n.kind === "city" && n.showLabel)).toHaveLength(24);
    expect(layoutRadial(expansion(10)).nodes.every((n) => n.showLabel)).toBe(true);
  });
  it("arestas com ponta fora da expansão são descartadas (nunca se desenha uma relação sem os dois nós)", () => {
    const e = expansion(2);
    const { edges } = layoutRadial({ ...e, edges: [...e.edges, { from: "city:fantasma", to: "uf:SP", kind: "belongs_to_uf", label: "x", basis: "source_column" }] });
    expect(edges).toHaveLength(2);
  });
  it("rótulos longos são encurtados", () => {
    const e = expansion(0, [sum("page", "p1", "/cidades/sp/sao-bernardo-do-campo")]);
    const p = layoutRadial({ ...e, edges: [] }).nodes[1]!;
    expect(p.shortLabel.length).toBeLessThanOrEqual(14);
    expect(p.label).toBe("/cidades/sp/sao-bernardo-do-campo");
  });
});
