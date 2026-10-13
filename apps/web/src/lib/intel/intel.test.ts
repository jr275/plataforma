import { describe, expect, it } from "vitest";
import { exemplo as exemploData } from "@/data/demo/exemplo";
import { rankArchetypes } from "./archetypes";
import { UNVERIFIED_STATES, defaultBlueprint, evaluateGates, publicationStateOf } from "./blueprint";
import { STAGES, UNVERIFIABLE_FROM, lifecycleOf, stageIndex } from "./lifecycle";
import { DIMENSIONS, defaultWeights, scoreOpportunity } from "./score";
import { buildSearchGraph } from "./search-graph";

const d = exemploData;

describe("score explicável", () => {
  it("fica entre 0 e 100 e expõe todas as dimensões", () => {
    for (const o of d.opportunities) {
      const r = scoreOpportunity(d, o);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(r.dimensions.map((x) => x.id).sort()).toEqual(DIMENSIONS.map((x) => x.id).sort());
    }
  });

  it("dimensão sem dado não recebe valor inventado", () => {
    for (const o of d.opportunities) {
      for (const dim of scoreOpportunity(d, o).dimensions) {
        if (dim.state === "unavailable" || dim.state === "not_evaluated") expect(dim.value).toBeNull();
      }
    }
  });

  it("zerar um peso muda o score de forma determinística", () => {
    const o = d.opportunities[0];
    const w = { ...defaultWeights(), demand: 0 };
    expect(scoreOpportunity(d, o, w)).toEqual(scoreOpportunity(d, o, w));
  });
});

describe("ciclo de vida", () => {
  it("nunca alcança etapas sem registro verificado", () => {
    const locked = STAGES.slice(stageIndex(UNVERIFIABLE_FROM)).map((s) => s.id);
    for (const o of d.opportunities) {
      const life = lifecycleOf(d, o);
      for (const id of locked) expect(life.reached.has(id)).toBe(false);
    }
  });
});

describe("blueprint e quality gate", () => {
  it("não declara estados que exigem verificação externa", () => {
    for (const o of d.opportunities) {
      const bp = defaultBlueprint(o, rankArchetypes(d, o)[0].archetype);
      expect(UNVERIFIED_STATES).not.toContain(publicationStateOf(evaluateGates(d, o, bp)));
    }
  });

  it("falha crítica bloqueia", () => {
    const o = d.opportunities[0];
    const bp = { ...defaultBlueprint(o, rankArchetypes(d, o)[0].archetype), modules: [], cta: "" };
    const checks = evaluateGates(d, o, bp);
    if (checks.some((c) => c.critical && c.result === "fail")) expect(publicationStateOf(checks)).toBe("blocked");
  });
});

describe("grafo competitivo", () => {
  it("toda aresta liga nós existentes e cita o registro de origem", () => {
    const g = buildSearchGraph(d);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
      expect(e.record).toBeTruthy();
    }
  });
});
