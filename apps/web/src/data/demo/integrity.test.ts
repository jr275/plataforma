import { describe, expect, it } from "vitest";
import { graphFromWorkspace } from "@/lib/graph/from-workspace";
import { DEFAULT_WORKSPACE_ID, DEMO_WORKSPACES } from "../source";

// Integridade das fixtures: toda referência aponta para um registro do MESMO workspace, e o grafo não tem arestas órfãs.
const OFF_DOMAIN = /aurora|cooperativ|cooperado|compra coletiva|rateio|frete|embalage|giro de estoque|RE\/MAX|im[oó]ve(l|is)|corretor/i;

describe.each(DEMO_WORKSPACES.map((d) => [d.workspace.name, d] as const))("workspace %s", (_name, d) => {
  const ids = (list: readonly { id: string }[]) => new Set(list.map((x) => x.id));
  const opp = ids(d.opportunities);
  const ent = ids(d.entities);
  const src = ids(d.sources);
  const know = ids(d.knowledge);
  const missing = (refs: readonly string[], set: Set<string>) => refs.filter((r) => !set.has(r));

  it("não tem ids duplicados", () => {
    const all = [d.opportunities, d.entities, d.sources, d.knowledge, d.pages, d.queries].flat().map((x) => x.id);
    expect(all.length).toBe(new Set(all).size);
  });

  it("oportunidades só referenciam entidades, fontes e conhecimento existentes", () => {
    for (const o of d.opportunities) {
      expect(missing(o.entityIds, ent), o.id).toEqual([]);
      expect(missing(o.sourceIds, src), o.id).toEqual([]);
      expect(missing(o.knowledgeIds, know), o.id).toEqual([]);
    }
  });

  it("entidades, conhecimento, páginas e consultas não têm referências órfãs", () => {
    for (const e of d.entities) expect(missing(e.relatedIds, ent), e.id).toEqual([]);
    for (const k of d.knowledge) {
      expect(src.has(k.sourceId), k.id).toBe(true);
      expect(missing(k.entityIds, ent), k.id).toEqual([]);
    }
    for (const p of d.pages) {
      if (p.opportunityId) expect(opp.has(p.opportunityId), p.id).toBe(true);
      expect(missing(p.entityIds, ent), p.id).toEqual([]);
      expect(missing(p.knowledgeIds, know), p.id).toEqual([]);
    }
    for (const q of d.queries) if (q.opportunityId) expect(opp.has(q.opportunityId), q.id).toBe(true);
    for (const f of d.findings) {
      if (f.opportunityId) expect(opp.has(f.opportunityId), f.id).toBe(true);
      expect(missing(f.entityIds, ent), f.id).toEqual([]);
    }
    for (const g of d.gaps) if (g.opportunityId) expect(opp.has(g.opportunityId), g.id).toBe(true);
  });

  it("a fonte citada em cada entidade existe no workspace", () => {
    const names = new Set(d.sources.map((s) => s.name));
    for (const e of d.entities) {
      const cited = e.attributes.find((a) => a.label === "Fonte")?.value;
      if (cited && !cited.startsWith("ainda sem")) expect(names.has(cited), `${e.id} → ${cited}`).toBe(true);
    }
  });

  it("páginas com gate de fatos aprovado só citam conhecimento verificado", () => {
    for (const p of d.pages) {
      if (p.gates.find((g) => g.name === "Fatos com fonte")?.status !== "pass") continue;
      for (const k of p.knowledgeIds) expect(d.knowledge.find((x) => x.id === k)?.status, `${p.id} → ${k}`).toBe("verified");
    }
  });

  it("o grafo derivado não tem arestas órfãs", () => {
    const g = graphFromWorkspace(d);
    const nodes = new Set(g.nodes.map((n) => n.id));
    for (const edge of g.edges) {
      expect(nodes.has(edge.source), edge.id).toBe(true);
      expect(nodes.has(edge.target), edge.id).toBe(true);
    }
  });

  it("não contém conteúdo de outro domínio", () => {
    expect(JSON.stringify(d)).not.toMatch(OFF_DOMAIN);
  });
});

describe("workspace padrão", () => {
  it("existe entre os workspaces de demonstração", () => {
    expect(DEMO_WORKSPACES.some((d) => d.workspace.id === DEFAULT_WORKSPACE_ID)).toBe(true);
  });
});
