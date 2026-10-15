import { describe, expect, it } from "vitest";
import { OG_SIZE, ogTitle, pageOgResponse } from "./page-og";

describe("título da imagem OG", () => {
  it("mantém o título curto como está e normaliza espaços", () => {
    expect(ogTitle("São Paulo (SP): população e localização")).toBe("São Paulo (SP): população e localização");
    expect(ogTitle("  Campinas   (SP) \n ")).toBe("Campinas (SP)");
  });
  it("corta títulos longos em uma palavra inteira, com reticências, sem passar do limite", () => {
    const t = ogTitle("palavra ".repeat(40), 60);
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t.endsWith("…")).toBe(true);
    expect(t).not.toMatch(/palav…$/);
  });
  it("sem espaços para cortar, corta no limite", () => { expect(ogTitle("x".repeat(200), 50)).toHaveLength(50); });
});

describe("resposta da imagem OG (next/og)", () => {
  it("é um PNG 1200×630, privado e sem cache", async () => {
    const res = pageOgResponse({ title: "São Paulo (SP): população e localização", city: "São Paulo", uf: "SP", path: "/cidades/sp/sao-paulo", status: "draft", template: "city-overview", version: 1 });
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(bytes.buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([OG_SIZE.width, OG_SIZE.height]);
  });
});
