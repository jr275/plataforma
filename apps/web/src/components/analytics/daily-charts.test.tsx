import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GscDailyPoint } from "@plataforma/api";
import { DailyCharts, meanClicks, rolling, weightedPosition } from "./daily-charts";

// Séries de teste montadas à mão (NÃO são dados do cliente).
const pt = (date: string, clicks: number, impressions = 100, position = 5): GscDailyPoint => ({ date, clicks, impressions, ctr: (clicks / impressions) * 100, position });
const week = Array.from({ length: 10 }, (_, i) => pt(`2026-01-${String(i + 1).padStart(2, "0")}`, 10 * (i + 1)));

describe("médias móveis", () => {
  it("usa os últimos 7 DIAS de calendário: no 10º dia entram os dias 4 a 10", () => {
    const r = rolling(week, meanClicks);
    expect(r[9]!.value).toBeCloseTo((40 + 50 + 60 + 70 + 80 + 90 + 100) / 7);
    expect(r[0]!.value).toBe(10);
  });
  it("com um buraco no export, os dias que faltam não entram nem são inventados", () => {
    const gap = [pt("2026-01-01", 10), pt("2026-01-02", 20), pt("2026-01-09", 90)];
    const r = rolling(gap, meanClicks);
    expect(r[2]!.value).toBe(90); // o dia 9 só enxerga a si mesmo: 1 e 2 estão a mais de 6 dias
  });
  it("a posição é ponderada por impressões, não a média simples das posições", () => {
    expect(weightedPosition([pt("2026-01-01", 1, 900, 2), pt("2026-01-02", 1, 100, 12)])).toBeCloseTo((2 * 900 + 12 * 100) / 1000);
  });
});

describe("gráficos de evolução diária", () => {
  const html = (pts: GscDailyPoint[]) => renderToStaticMarkup(<DailyCharts points={pts} />);
  it("resume o período e o maior dia, com datas no formato brasileiro", () => {
    const out = html(week);
    expect(out).toContain("10 dias, de 01/01/2026 a 10/01/2026");
    expect(out).toContain("Maior dia: 10/01/2026, com 100 cliques");
  });
  it("é acessível: cada gráfico é uma imagem com descrição, e diz que o eixo da posição é invertido", () => {
    const out = html(week);
    expect(out.match(/role="img"/g)).toHaveLength(2);
    expect(out).toContain("eixo invertido");
  });
  it("interrompe a linha onde faltam dias (dois trechos, nunca uma ligação por cima do buraco)", () => {
    const out = html([pt("2026-01-01", 10), pt("2026-01-02", 12), pt("2026-01-10", 30), pt("2026-01-11", 31)]);
    expect((out.match(/<polyline/g) ?? []).length).toBe(2 * 3); // clicks: bruto + média = 2 linhas × 2 trechos; posição: 1 linha × 2 trechos
  });
  it("um único dia não quebra o gráfico", () => {
    expect(() => html([pt("2026-01-01", 5)])).not.toThrow();
  });
});
