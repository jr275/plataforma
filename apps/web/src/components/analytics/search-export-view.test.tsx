import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildGscExportSnapshot } from "@plataforma/api";
import type { GscExportLoaded } from "@/lib/server/gsc-export";
import { SearchExportView } from "./search-export-view";

// Entradas de teste montadas à mão (NÃO são dados do cliente): o parser real as transforma no snapshot que a tela recebe.
const H = "Last 6 months Clicks,Previous 6 months Clicks,Last 6 months Impressions,Previous 6 months Impressions,Last 6 months CTR,Previous 6 months CTR,Last 6 months Position,Previous 6 months Position";
const FILES_BASE = {
  devices: `Device,${H}\nMobile,600,500,6000,5000,10%,10%,2,3\nDesktop,400,500,4000,5000,10%,10%,4,3\n`,
  countries: `Country,${H}\nBrazil,950,950,9500,9500,10%,10%,3,3\n`,
  appearances: `Search Appearance,${H}\nProduct snippets,90,80,900,800,10%,10%,5,5\n`,
  queries: `Top queries,${H}\nq1,300,200,1000,900,30%,22%,1,1\nq2,50,0,400,0,12%,0%,3,0\n`,
  pages: `Top pages,${H}\nhttps://x.test/cidade-a,700,600,5000,4000,14%,15%,3,3\nhttp://x.test/cidade-a,40,0,300,0,13%,0%,5,0\n`,
  filters: "Filter,Value\nSearch type,Web (text-based)\nDate,Last 6 months\n",
};
const AI = { ai: { pages: "Top pages,Last 6 months Impressions,Previous 6 months Impressions\nhttps://x.test/ia-a,50,0\n", countries: "Country,Last 6 months Impressions,Previous 6 months Impressions\nBrazil,50,0\n", devices: "Device,Last 6 months Impressions,Previous 6 months Impressions\nMobile,50,0\n" } };
const FILES = { ...FILES_BASE, ...AI };
const snapshot = (ai = true) => buildGscExportSnapshot(ai ? FILES : FILES_BASE, { property: "https://x.test/", exportedAt: "2026-10-16", tenantId: null });
const html = (loaded: GscExportLoaded) => renderToStaticMarkup(<SearchExportView loaded={loaded} />);
const withDaily = (property: string): GscExportLoaded => ({ state: "ready", snapshot: { ...snapshot(), daily: { property, points: [{ date: "2026-01-01", clicks: 10, impressions: 100, ctr: 10, position: 3 }, { date: "2026-01-02", clicks: 12, impressions: 110, ctr: 10.9, position: 3.1 }] } } });
const LONG = {
  devices: "Device,Clicks,Impressions,CTR,Position\nMobile,600,6000,10%,2\nDesktop,400,4000,10%,4\n",
  queries: "Top queries,Clicks,Impressions,CTR,Position\nlong-q1,300,1000,30%,1\n",
  pages: "Top pages,Clicks,Impressions,CTR,Position\nhttps://x.test/long-a,700,5000,14%,3\n",
  filters: "Filter,Value\nSearch type,Web (text-based)\nDate,Last 16 months\n",
};
const withLong = (): GscExportLoaded => ({ state: "ready", snapshot: buildGscExportSnapshot({ ...FILES, long: LONG }, { property: "https://x.test/", exportedAt: "2026-10-16", tenantId: null }) });
const ready = (ai = true): GscExportLoaded => ({ state: "ready", snapshot: snapshot(ai) });

describe("relatório do Search Console a partir de export", () => {
  it("diz com todas as letras que é importado e não uma conexão ao vivo, com a data do export", () => {
    const out = html(ready());
    expect(out).toContain("Importado");
    expect(out).toContain("não é uma conexão ao vivo");
    expect(out).toContain("16/10/2026");
    expect(out).not.toMatch(/Conectado/);
  });
  it("mostra os totais e as variações calculadas dos registros (cliques 1.000, impressões 10.000, CTR 10,00%)", () => {
    const out = html(ready());
    expect(out).toContain("1.000");
    expect(out).toContain("10.000");
    expect(out).toContain("10,00%");
    expect(out).toContain("vs 6 meses anteriores");
  });
  it("mostra a cobertura das listas ao lado dos rankings (consultas cobrem 35% dos cliques e 14% das impressões)", () => {
    const out = html(ready());
    expect(out).toContain("Cobertura das listas exportadas");
    expect(out).toContain("35,0% dos cliques e 14,0% das impressões");
  });
  it("IA generativa: só impressões, e sem período anterior não há porcentagem inventada", () => {
    const out = html(ready());
    expect(out).toContain("Recursos de IA generativa");
    expect(out).toContain("sem período anterior para comparar");
    expect(html(ready(false))).not.toContain("Recursos de IA generativa");
  });
  it("não pede nenhuma decisão: sem filtros, seletores, campos nem botões", () => {
    expect(html(ready())).not.toMatch(/<(select|input|button|form)\b/);
  });
  it("rankings: páginas e consultas por cliques, com cobertura, variação e 'novo' quando não havia período anterior", () => {
    const out = html(ready());
    expect(out).toContain("Páginas com mais cliques");
    expect(out).toContain("Consultas com mais cliques");
    expect(out).toContain("/cidade-a"); // URL da propriedade aparece só como caminho
    expect(out).toContain("http://x.test/cidade-a"); // fora da propriedade (http) aparece inteira
    expect(out).toContain("+50,0%"); // q1: 300 vs 200
    expect(out).toContain("novo"); // q2 e a página http não tinham período anterior
    expect(out).toContain("35,0% dos cliques"); // consultas: (300+50)/1000
  });
  it("IA: lista as páginas por impressões, sem cliques em nenhuma coluna", () => {
    const out = html(ready());
    expect(out).toContain("Impressões em IA");
    expect(out).toContain("/ia-a");
    expect(out).not.toMatch(/Cliques em IA/);
  });
  it("snapshot antigo, sem listas, continua abrindo (sem as seções de ranking)", () => {
    const legacy: Record<string, unknown> = { ...snapshot() };
    delete legacy.top;
    const out = html({ state: "ready", snapshot: legacy as never });
    expect(out).not.toContain("Páginas com mais cliques");
    expect(out).toContain("Dispositivos");
  });
  it("evolução diária: aparece quando o snapshot traz a série e avisa se a propriedade é outra", () => {
    const same = html(withDaily("https://x.test/"));
    expect(same).toContain("Evolução diária");
    expect(same).not.toContain("não são comparáveis");
    const other = html(withDaily("sc-domain:x.test"));
    expect(other).toContain("Série de sc-domain:x.test");
    expect(other).toContain("não são comparáveis entre elas");
    expect(html(ready())).not.toContain("Evolução diária");
  });
  it("propriedade de domínio: URLs do www aparecem como caminho; http ou outro host aparecem inteiros", () => {
    const base = snapshot();
    const out = html({ state: "ready", snapshot: { ...base, property: "sc-domain:x.test", top: { ...base.top!, pages: [{ ...base.top!.pages[0]!, key: "https://www.x.test/cidade-a" }, { ...base.top!.pages[1]!, key: "http://x.test/cidade-a" }] } } });
    expect(out).toContain(">/cidade-a<");
    expect(out).toContain("http://x.test/cidade-a");
    expect(out).toContain("https://www.x.test");
  });
  it("16 meses: rankings sem a coluna de variação, com período, totais e cobertura próprios", () => {
    const out = html(withLong());
    expect(out).toContain("Páginas com mais cliques em 16 meses");
    expect(out).toContain("Consultas com mais cliques em 16 meses");
    expect(out).toContain("Últimos 16 meses");
    expect(out).toContain("long-q1");
    expect(out).toContain(">/long-a<");
    expect(out).toContain("não traz o período anterior");
    const longSection = out.slice(out.indexOf("Páginas com mais cliques em 16 meses"), out.indexOf("Recursos de IA generativa"));
    expect(longSection).not.toContain("Vs anterior");
    expect(html(ready())).not.toContain("em 16 meses");
  });
  it("avisa quando uma lista bate no teto de 1.000 linhas do export (pode estar incompleta)", () => {
    const base = withLong();
    if (base.state !== "ready" || !base.snapshot.long) throw new Error("fixture");
    const capped = { ...base.snapshot, long: { ...base.snapshot.long, coverage: { ...base.snapshot.long.coverage, pages: { ...base.snapshot.long.coverage.pages, rows: 1000 } } } };
    expect(html({ state: "ready", snapshot: capped })).toContain("O export para em 1.000 linhas");
    expect(html(base)).not.toContain("O export para em");
  });
  it("painéis podem encolher dentro de grades (min-w-0): sem isso uma tabela larga alarga a página inteira no celular", () => {
    const out = html(ready());
    expect(out).toContain('class="card-cut min-w-0"');
    expect(out).toContain("overflow-x-auto"); // a rolagem fica dentro da tabela, não na página
  });
  it("sem export, diz o motivo em vez de simular números", () => {
    for (const state of ["not_loaded", "invalid", "other_tenant"] as const) {
      const out = html({ state });
      expect(out).toContain("Estado");
      expect(out).not.toMatch(/Cliques|Impressões/);
    }
    expect(html({ state: "not_loaded" })).toContain("Nenhum export carregado");
    expect(html({ state: "denied", reason: "unauthenticated" })).toContain("Acesso negado");
    expect(html({ state: "denied", reason: "tenant_selection_required" })).toContain("Acesso negado");
  });
  it("o núcleo é genérico: nenhuma menção a marca ou domínio fixo na tela", () => {
    expect(html(ready())).not.toMatch(/re\/?max/i);
  });
});
