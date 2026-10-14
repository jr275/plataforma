import { beforeEach, describe, expect, it, vi } from "vitest";
import { logServerError } from "./log";

// Só o console é mockado (fronteira). O formato e a extração de tipo e código são a lógica REAL.
const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
beforeEach(() => log.mockClear());
const line = () => String(log.mock.calls[0]?.[0]);

describe("logServerError: registra só o tipo e o código, nunca a mensagem", () => {
  it("erro com código: tipo, código e escopo", () => {
    logServerError("tenant-query", Object.assign(new TypeError("falha com postgresql://u:SEGREDO@h/d"), { code: "08006" }));
    expect(log).toHaveBeenCalledOnce();
    expect(line()).toBe("[plataforma:tenant-query] falha do servidor: tipo=TypeError codigo=08006");
    expect(line()).not.toMatch(/SEGREDO|postgresql:/);
  });
  it("o código pode estar na cadeia de `cause`, até 4 níveis", () => {
    logServerError("x", new Error("externo", { cause: { cause: { code: "57P01" } } }));
    expect(line()).toContain("codigo=57P01");
    log.mockClear();
    logServerError("x", { cause: { cause: { cause: { cause: { code: "57P01" } } } } }); // 5º nível: ignorado
    expect(line()).not.toContain("codigo=");
  });
  it("sem código: não inventa um", () => {
    logServerError("x", new Error("boom"));
    expect(line()).toBe("[plataforma:x] falha do servidor: tipo=Error");
  });
  it("valores que não são erros nunca lançam e não vazam o conteúdo", () => {
    for (const v of [undefined, null, "texto com SEGREDO", 42, {}, [], Object.create(null)]) {
      expect(() => logServerError("x", v)).not.toThrow();
    }
    expect(log.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("SEGREDO");
  });
  it("ciclo em `cause` termina", () => {
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(() => logServerError("x", a)).not.toThrow();
  });
});
