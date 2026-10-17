import { describe, expect, it } from "vitest";
import { sameShape, type FlowDefinition, type FlowNodeSpec } from "@/lib/flow/model";
import { buildDevDetail, buildDevRun } from "@/lib/dev-fixture";
import { buildPageFlow, buildRunFlow } from "./flow-model";

// Entradas: MOTOR e GATES reais aplicados ao extrato real do IBGE (fixture de desenvolvimento). Os testes conferem que cada status vem de um
// registro e que nada é inventado.
const NOW = new Date("2026-10-15T12:00:00Z");
const page = (kind: "ok" | "blocked" | "no-population", code = "3550308", now = NOW): FlowDefinition => {
  const { detail } = buildDevDetail(code, kind)!;
  return buildPageFlow(detail, detail.versions[0], now);
};
const byId = (d: FlowDefinition, id: string): FlowNodeSpec => d.nodes.find((n) => n.id === id)!;
const GATES = ["required_fields", "url_unique", "url_stable", "metadata_valid", "links_resolve", "facts_traceable"];

describe("fluxo da página: definição", () => {
  it("tem ids únicos e estáveis (mesma forma em qualquer cenário), com as arestas ligando nós que existem", () => {
    const ok = page("ok");
    expect(new Set(ok.nodes.map((n) => n.id)).size).toBe(ok.nodes.length);
    expect(sameShape(ok, page("blocked"))).toBe(true);
    expect(sameShape(ok, page("no-population"))).toBe(true);
    const ids = new Set(ok.nodes.map((n) => n.id));
    for (const e of ok.edges) { expect(ids.has(e.source)).toBe(true); expect(ids.has(e.target)).toBe(true); }
  });
  it("os 6 gates reais são nós paralelos ligados ao juiz, e a publicação não é confundida com a aprovação", () => {
    const d = page("ok");
    for (const g of GATES) { expect(d.edges.some((e) => e.source === "generate" && e.target === `gate:${g}`)).toBe(true); expect(d.edges.some((e) => e.source === `gate:${g}` && e.target === "judge")).toBe(true); }
    expect(d.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(["judge", "publish", "observe", "learn"]));
    expect(d.edges.some((e) => e.source === "judge" && e.target === "publish")).toBe(false); // aprovar ≠ publicar
  });
});

describe("fluxo da página: estados vêm dos registros", () => {
  it("página aprovada: gates passam, veredito PASS com contagem (não nota) e sem remediação ativa", () => {
    const d = page("ok");
    for (const g of GATES) expect(byId(d, `gate:${g}`).status).toBe("completed");
    const judge = byId(d, "judge");
    expect(judge.status).toBe("completed");
    expect(judge.summary).toBe("PASS · 6 de 6 gates");
    expect(judge.progress).toBe(1);
    expect(d.edges.find((e) => e.id === "e:judge-remediation")?.active).toBeFalsy();
    expect(d.mode).toBe("recorded");
  });
  it("URL duplicada: o gate reprova, o juiz dá FAIL com o motivo real e a remediação fica ativa", () => {
    const d = page("blocked");
    expect(byId(d, "gate:url_unique").status).toBe("failed");
    expect(byId(d, "gate:url_unique").detail.blocker).toMatch(/já pertence a outra entidade/);
    const judge = byId(d, "judge");
    expect(judge.status).toBe("failed");
    expect(judge.summary).toMatch(/^FAIL · 1 gate/);
    expect(judge.detail.items?.[0]?.title).toBe("URL única no workspace");
    expect(judge.detail.blocker).toMatch(/reprocesse/);
    expect(d.edges.find((e) => e.id === "e:judge-remediation")).toMatchObject({ active: true, remediation: true });
  });
  it("sem população: módulos omitidos aparecem em Conteúdo (nada inventado)", () => {
    const d = page("no-population");
    const gen = byId(d, "generate");
    expect(gen.summary).toMatch(/omitida/);
    expect(gen.detail.items?.some((i) => /omitid/i.test(i.title))).toBe(true);
  });
  it("fatos coletados há mais de 365 dias pedem revisão (aviso, não bloqueio)", () => {
    const d = page("ok", "3550308", new Date("2028-01-01T00:00:00Z"));
    expect(byId(d, "knowledge").status).toBe("needs_review");
    expect(byId(d, "judge").status).toBe("completed"); // o aviso não derruba o veredito
  });
  it("o que o backend não tem aparece como NÃO IMPLEMENTADO e o que esta geração não usa como NÃO USADO, com o motivo", () => {
    const d = page("ok");
    for (const id of ["publish", "observe", "learn"]) { expect(byId(d, id).status).toBe("unavailable"); expect(byId(d, id).detail.blocker).toBeTruthy(); }
    for (const id of ["intel", "opportunity"]) { expect(byId(d, id).status).toBe("skipped"); expect(byId(d, id).detail.blocker).toMatch(/não participa/); }
  });
  it("sem tentativa registrada, os gates e o juiz ficam ociosos (nunca 'passou' por padrão)", () => {
    const { detail } = buildDevDetail("3550308", "ok")!;
    const d = buildPageFlow({ ...detail, latestAttempt: undefined }, detail.versions[0], NOW);
    for (const g of GATES) expect(byId(d, `gate:${g}`).status).toBe("idle");
    expect(byId(d, "judge").status).toBe("idle");
  });
  it("sem versão aprovada e com dado obrigatório faltando, a falha aparece na origem, não em 'concluída'", () => {
    const { detail } = buildDevDetail("3550308", "ok")!;
    const blocked = { ...detail, latestAttempt: { ...detail.latestAttempt!, outcome: "blocked" as const, gates: detail.latestAttempt!.gates.map((g) => (g.gate === "required_fields" ? { ...g, outcome: "fail" as const, detail: "falta o nome do município" } : { ...g, outcome: "skipped" as const })) }, versions: [] };
    const d = buildPageFlow(blocked, undefined, NOW);
    expect(byId(d, "source").status).toBe("failed");
    expect(byId(d, "knowledge").status).toBe("failed");
    expect(byId(d, "generate").status).toBe("blocked");
    expect(byId(d, "render").status).toBe("blocked");
    expect(byId(d, "judge").status).toBe("failed");
  });
});

describe("integridade: nada inventado", () => {
  const all = (d: FlowDefinition) => JSON.stringify(d);
  it("nenhum nó informa duração, tokens, custo ou porcentagem de conclusão; não existe nota composta", () => {
    for (const d of [page("ok"), page("blocked"), buildRunFlow(buildDevRun(20, new Date(0), NOW))]) {
      for (const n of d.nodes) for (const m of n.metrics ?? []) expect(m.label).not.toMatch(/dura|token|custo|nota|score|tempo/i);
      expect(all(d)).not.toMatch(/"score"|"tokens"|"cost"|"duration"/i);
    }
  });
});

describe("fluxo da execução: ao vivo × registro", () => {
  const start = new Date("2026-10-15T11:59:00Z");
  it("em andamento: progresso = itens registrados / previstos, gates e juiz em execução, piloto na fila, arestas ativas", () => {
    const d = buildRunFlow(buildDevRun(5, start, NOW));
    expect(d.mode).toBe("live");
    const p = byId(d, "process");
    expect(p.status).toBe("running");
    expect(p.progress).toBe(5 / 20);
    expect(p.summary).toBe("5 de 20 cidades registradas");
    expect(byId(d, "judge").status).toBe("running");
    expect(byId(d, "pilot").status).toBe("queued");
    expect(d.edges.filter((e) => e.active).length).toBeGreaterThan(0);
  });
  it("nenhum item registrado ainda: gates na fila e juiz na fila (não 'concluídos')", () => {
    const d = buildRunFlow(buildDevRun(0, start, NOW));
    expect(byId(d, "process").progress).toBe(0);
    expect(byId(d, "gate:url_unique").status).toBe("queued");
    expect(byId(d, "judge").status).toBe("queued");
  });
  it("a falha de um item aparece no gate certo, com o nome da cidade e o motivo", () => {
    const d = buildRunFlow(buildDevRun(6, start, NOW));
    const g = byId(d, "gate:url_unique");
    expect(g.status).toBe("failed");
    expect(g.summary).toMatch(/1 reprovaram/);
    expect(g.detail.items?.[0]?.text).toMatch(/já pertence/);
  });
  it("concluída com uma cidade bloqueada: 'revisão necessária', critério do piloto avaliado, sem arestas animadas, modo registro", () => {
    const d = buildRunFlow(buildDevRun(20, start, NOW));
    expect(d.mode).toBe("recorded");
    expect(byId(d, "process").status).toBe("completed");
    expect(byId(d, "judge").status).toBe("needs_review");
    expect(byId(d, "pilot").status).toBe("completed");
    expect(byId(d, "pilot").summary).toMatch(/^PASS · 19 válidas/);
    expect(d.edges.some((e) => e.active)).toBe(false);
  });
  it("execução que falhou: o processamento e a decisão aparecem como falhos, com o erro registrado", () => {
    const base = buildDevRun(20, start, NOW);
    const failed = { ...base, run: { ...base.run, status: "failed" as const, error: "banco indisponível", finishedAt: NOW } };
    const d = buildRunFlow(failed);
    expect(byId(d, "process").status).toBe("failed");
    expect(byId(d, "process").detail.blocker).toBe("banco indisponível");
    expect(byId(d, "judge").status).toBe("failed");
  });
  it("a mesma definição em todos os instantes: só o estado muda (o grafo não é refeito)", () => {
    expect(sameShape(buildRunFlow(buildDevRun(3, start, NOW)), buildRunFlow(buildDevRun(20, start, NOW)))).toBe(true);
  });
});

describe("layout: o fluxo inteiro cabe e nada se sobrepõe", () => {
  const W = 320, H = 208;
  const flows = (): [string, FlowDefinition][] => [["página aprovada", page("ok")], ["página bloqueada", page("blocked")], ["execução em andamento", buildRunFlow(buildDevRun(5, new Date(0), NOW))], ["execução concluída", buildRunFlow(buildDevRun(20, new Date(0), NOW))]];
  it("todos os cards têm o mesmo tamanho e nenhum cobre outro", () => {
    for (const [name, d] of flows()) {
      for (let i = 0; i < d.nodes.length; i++) for (let j = i + 1; j < d.nodes.length; j++) {
        const a = d.nodes[i]!, b = d.nodes[j]!;
        const overlap = Math.abs(a.x - b.x) < W && Math.abs(a.y - b.y) < H;
        expect(overlap, `${name}: ${a.id} cobre ${b.id}`).toBe(false);
      }
    }
  });
  it("o conjunto cabe numa área compacta (no máximo 6 colunas e 6 linhas de cards)", () => {
    for (const [name, d] of flows()) {
      const xs = d.nodes.map((n) => n.x), ys = d.nodes.map((n) => n.y);
      expect((Math.max(...xs) - Math.min(...xs)) / 380 + 1, name).toBeLessThanOrEqual(6);
      expect((Math.max(...ys) - Math.min(...ys)) / 300 + 1, name).toBeLessThanOrEqual(6);
    }
  });
  it("toda aresta usa alças que existem (saída r/b/tu/ls, entrada l/t/bt) e a remediação volta à fonte pela esquerda", () => {
    for (const [, d] of flows()) for (const e of d.edges) {
      expect(["r", "b", "tu", "ls", undefined]).toContain(e.sourceHandle);
      expect(["l", "t", "bt", undefined]).toContain(e.targetHandle);
    }
    expect(page("blocked").edges.find((e) => e.id === "e:judge-remediation")).toMatchObject({ target: "source", sourceHandle: "ls", targetHandle: "l" });
  });
});
