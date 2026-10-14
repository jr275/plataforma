import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const pathname = "/cities";
vi.mock("next/navigation", async (orig) => ({ ...(await orig<typeof import("next/navigation")>()), usePathname: () => pathname }));

import { allNavItems } from "@/config/navigation";
import { BrandMark } from "./brand-mark";
import { ModeBanner } from "./mode-banner";
import { SidebarContent } from "./sidebar-nav";
import { ModeBadge } from "./topbar";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("marca: não afirma nada sobre os dados", () => {
  it("não diz 'protótipo' nem 'dados fictícios' (isso é decisão do modo da tela, não da marca)", () => {
    const out = html(<BrandMark />);
    expect(out).not.toMatch(/prot[oó]tipo|fict[ií]cios/i);
    expect(out).toContain("Search &amp; Knowledge OS");
  });
});

describe("navegação lateral: cada item diz o que é", () => {
  const out = () => html(<SidebarContent />);
  it("itens distinguem tenant e demo; planejados abrem diálogo de dependências, sem rota fictícia", () => {
    const o = out();
    expect(o).toContain('aria-label="dados do tenant"');
    expect(o).toContain(">demo<");
    expect(o).toContain(">em breve<");
    const planned = o.match(/<button type="button" aria-haspopup="dialog"[^>]*>/g) ?? [];
    expect(planned).toHaveLength(allNavItems.filter((i) => i.mode === "planned").length);
    for (const p of planned) expect(p).toContain("title=");
    for (const label of ["Workflows", "Visibilidade em IA", "Experimentos"]) expect(o).toContain(label);
    expect(o).not.toMatch(/href="\/(workflows|experiments|policies)"/);
  });
  it("marca o item da rota atual (aria-current) e agrupa pela hierarquia pedida", () => {
    const o = out();
    expect(o).toMatch(/aria-current="page"[^>]*>(?:(?!<\/a>)[\s\S])*Cidades/);
    for (const g of ["Inteligência", "Inteligência de busca", "Conhecimento", "Fábrica de experiências", "Qualidade e GEO", "Performance", "Sistema"]) expect(o).toContain(g);
    for (const l of ["Visão geral", "Grafo de conhecimento", "Evidências e fontes", "Geração de páginas", "Integrações", "Configurações"]) expect(o).toContain(l);
  });
  it("legenda: dado real versus demonstração", () => {
    const o = out();
    expect(o).toContain("Rotas conectadas ao tenant");
    expect(o).toContain("Protótipo com dados fictícios");
  });
  it("recolhida: os itens ficam acessíveis por nome e pelo modo, sem a legenda", () => {
    const o = html(<SidebarContent collapsed />);
    expect(o).toContain("Grafo de conhecimento (dados do tenant)");
    expect(o).not.toContain("Rotas conectadas ao tenant");
  });
});

describe("indicador de modo e faixa de demonstração", () => {
  it("badge: real, demonstração e fixture têm textos e modos distintos", () => {
    const real = html(<ModeBadge mode="real" />);
    expect(real).toContain('data-mode="real"');
    expect(real).toContain("Workspace");
    expect(html(<ModeBadge mode="demo" />)).toContain("Demonstração");
    expect(html(<ModeBadge mode="dev" />)).toContain("Fixture de desenvolvimento");
  });
  it("faixa: telas de demonstração dizem que os dados são fictícios, só do navegador, e que NÃO são do tenant autenticado", () => {
    const o = html(<ModeBanner mode="demo" />);
    expect(o).toContain('data-testid="mode-banner"');
    expect(o).toContain("fictícios");
    expect(o).toContain("só neste navegador");
    expect(o).toContain("Não são do tenant autenticado");
    expect(o).toContain('href="/cities"');
  });
  it("faixa: fixture de desenvolvimento é identificada; tela com dado real não mostra faixa nenhuma", () => {
    expect(html(<ModeBanner mode="dev" />)).toContain("Fixture de desenvolvimento");
    expect(html(<ModeBanner mode="real" />)).toBe("");
  });
});
