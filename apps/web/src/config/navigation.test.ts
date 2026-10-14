import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REAL_DATA_ROUTES, activeNavId, allNavItems, isRealDataRoute, linkedNavItems, navigation, routeMode } from "./navigation";

const APP = path.resolve(__dirname, "../app/(app)");
const pageFor = (href: string) => path.join(APP, href === "/" ? "" : href.replace(/^\//, ""), "page.tsx");

describe("integridade da navegação", () => {
  it("todo item navegável aponta para uma rota que EXISTE (nenhuma rota inventada)", () => {
    for (const i of linkedNavItems) expect(existsSync(pageFor(i.href)), `${i.label} -> ${i.href}`).toBe(true);
  });
  it("nenhuma rota repetida e nenhum id repetido (nada de vários itens para o mesmo placeholder)", () => {
    const hrefs = linkedNavItems.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    const ids = allNavItems.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("itens planejados não têm rota (aparecem desabilitados, com o motivo) e itens reais/demo têm", () => {
    for (const i of allNavItems) {
      if (i.mode === "planned") { expect(i.href, i.label).toBeUndefined(); expect(i.hint, i.label).toMatch(/\S/); }
      else expect(i.href, i.label).toMatch(/^\//);
    }
  });
  it("a hierarquia pedida está presente (com rotas reais onde existem)", () => {
    const labels = allNavItems.map((i) => i.label);
    for (const l of ["Command Center", "Search Intelligence", "Knowledge Graph", "Knowledge Base", "Data Sources", "Oportunidades", "Roadmap", "Tendências e notícias", "Generation Studio", "Content", "Programmatic SEO", "GEO & AI Citations", "Quality & Trust", "Experiments", "Workflows", "Integrations", "Settings"]) expect(labels, l).toContain(l);
  });
  it("as rotas existentes não foram removidas para 'simplificar'", () => {
    const hrefs = linkedNavItems.map((i) => i.href);
    for (const h of ["/", "/ask", "/search-universe", "/opportunities", "/roadmap", "/trends", "/research", "/knowledge", "/entities", "/data-sources", "/data-flow", "/generation", "/pages", "/programmatic", "/agents", "/quality-trust", "/analytics", "/settings", "/cities"]) expect(hrefs, h).toContain(h);
  });
});

describe("modo de dados: real, demonstração ou desenvolvimento", () => {
  it("só as rotas marcadas como reais leem o banco; as derivadas da navegação não divergem", () => {
    expect([...REAL_DATA_ROUTES].sort()).toEqual(["/cities", "/data-flow", "/generation", "/graph", "/integrations", "/opportunities", "/roadmap", "/trends"]);
    for (const r of REAL_DATA_ROUTES) { expect(routeMode(r)).toBe("real"); expect(routeMode(`${r}/abc`)).toBe("real"); }
  });
  it("demonstração é o padrão: nenhuma tela de protótipo se passa por real", () => {
    for (const r of ["/", "/ask", "/entities", "/entities/e1", "/settings", "/qualquer-coisa"]) expect(routeMode(r), r).toBe("demo");
  });
  it("prévias de desenvolvimento têm modo próprio (nunca real)", () => {
    for (const r of ["/dev/preview", "/dev/graph", "/dev/cities"]) { expect(routeMode(r), r).toBe("dev"); expect(isRealDataRoute(r), r).toBe(false); }
  });
  it("prefixo parecido não vira real: /citiesx e /graphs são demonstração", () => {
    expect(routeMode("/citiesx")).toBe("demo");
    expect(routeMode("/graphs")).toBe("demo");
  });
});

describe("item ativo", () => {
  it("o href mais específico vence; rotas dinâmicas ativam o pai; itens planejados nunca ficam ativos", () => {
    expect(activeNavId("/")).toBe("command-center");
    expect(activeNavId("/cities")).toBe("cities");
    expect(activeNavId("/cities/abc")).toBe("cities");
    expect(activeNavId("/graph")).toBe("knowledge-graph");
    expect(activeNavId("/generation/pages/x")).toBe("generation-studio");
    expect(activeNavId("/nao-existe")).toBeUndefined();
    expect(navigation.flatMap((g) => g.items).filter((i) => i.mode === "planned").map((i) => activeNavId(`/${i.id}`))).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});
