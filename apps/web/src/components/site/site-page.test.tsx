import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CITY_OVERVIEW, buildCityFacts, renderCityPage, type RenderedPage } from "@plataforma/api";
import { SitePage } from "./site-page";

// Entradas montadas à mão (NÃO são dados de produção): a cadeia sob teste é a real (fatos → template → blocos → HTML).
const RUN = { id: "c0000000-0000-4000-8000-000000000001", sourceName: "IBGE", origin: "real" as const, status: "succeeded" as const, fileSha256: "a".repeat(64), finishedAt: new Date("2026-10-12T10:00:00Z") };
const CITY = { id: "d0000000-0000-4000-8000-000000000001", ibgeCode: "3550308", name: "São Paulo", uf: "SP", region: "Sudeste", population: 11451999, populationYear: 2024, sourceRunId: RUN.id };
function page(): RenderedPage {
  const f = buildCityFacts(CITY, RUN);
  if (!f.ok) throw new Error(f.reason);
  const r = renderCityPage(CITY_OVERVIEW, f, { knownPaths: new Set(["/cidades/sp", "/cidades"]) });
  if (!r.ok) throw new Error(r.detail);
  return r.page;
}
const html = (p: RenderedPage, linkMode?: "preview" | "live") => renderToStaticMarkup(<SitePage page={p} linkMode={linkMode} />);

describe("SitePage", () => {
  it("tem exatamente um h1, com os títulos de seção como h2, e os landmarks esperados", () => {
    const out = html(page());
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).not.toMatch(/<h3/);
    expect(out).toContain('aria-label="Trilha de navegação"');
    expect(out).toContain("<footer");
    expect(out).toContain('data-testid="rendered-article"');
  });
  it("mostra o texto da página exatamente uma vez, sem nada acrescentado", () => {
    const p = page();
    const out = html(p).replace(/&#x27;/g, "'");
    for (const para of p.sections.flatMap((s) => s.paragraphs)) expect(out.split(para.replace(/&/g, "&amp;")).length - 1, para).toBe(1);
  });
  it("a tabela de dados traz o id do fato em cada linha e o valor formatado", () => {
    const out = html(page());
    expect(out).toContain('data-fact-id="city:3550308:population"');
    expect(out).toContain("11.451.999");
    expect(out).toContain("ref. 2024");
    expect(out).toContain("<caption");
  });
  it("na prévia os links NÃO navegam (viram texto com o caminho); no modo live viram links", () => {
    const preview = html(page());
    expect(preview).not.toMatch(/<a /);
    expect(preview).toContain("/cidades/sp");
    const live = html(page(), "live");
    expect(live).toContain('href="/cidades/sp"');
    expect(live).toContain('href="/cidades"');
  });
  it("o layout reage ao contêiner (quadro desktop ou celular), não à janela", () => {
    const out = html(page());
    expect(out).toContain("@container");
    expect(out).toContain("@xl:");
  });
  it("usa os tokens do site e não os do produto", () => {
    const out = html(page());
    expect(out).toContain("--site-fg");
    expect(out).toContain("var(--site-");
    expect(out).not.toMatch(/var\(--(brand|primary|background|foreground)\)/);
  });
  it("FALHA FECHADA: uma página com marcação no texto NÃO é renderizada; aparece o motivo", () => {
    const p = page();
    const bad: RenderedPage = { ...p, sections: p.sections.map((s, i) => (i === 1 ? { ...s, paragraphs: ["<script>alert(1)</script>"] } : s)) };
    const out = html(bad);
    expect(out).toContain('data-testid="site-blocked"');
    expect(out).toContain("bloqueada pelo catálogo");
    expect(out).toContain("marcação");
    expect(out).not.toContain("<script>");
    expect(out).not.toMatch(/<h1/);
  });
  it("TRAVA: nenhum componente do site pode usar HTML livre", () => {
    const dir = __dirname;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".tsx") && !x.endsWith(".test.tsx"))) {
      expect(readFileSync(join(dir, f), "utf8"), f).not.toContain("dangerouslySetInnerHTML");
    }
  });
});
