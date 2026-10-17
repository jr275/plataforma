import { describe, expect, it } from "vitest";
import { WCAG_AA_TEXT, contrastRatio, luminance } from "./contrast";
import { SITE_TEXT_PAIRS, SITE_TOKENS, siteStyle } from "./tokens";

describe("contraste", () => {
  it("calcula os extremos conhecidos (preto sobre branco = 21:1; igual = 1:1)", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
  });
  it("recusa cor mal formada em vez de chutar", () => {
    expect(() => contrastRatio("azul", "#fff")).toThrow(/inválida/);
  });
});

describe("tokens do site", () => {
  it.each(SITE_TEXT_PAIRS)("%s sobre %s tem contraste mínimo de 4,5:1 (WCAG AA)", (fg, bg) => {
    expect(contrastRatio(SITE_TOKENS[fg], SITE_TOKENS[bg])).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
  });
  it("todos os tokens viram variáveis CSS com o prefixo do site (sem vazar para o produto)", () => {
    expect(Object.keys(siteStyle).every((k) => k.startsWith("--site-"))).toBe(true);
    expect(Object.keys(siteStyle)).toHaveLength(Object.keys(SITE_TOKENS).length);
  });
});
