import { describe, expect, it } from "vitest";
import { PG_UNDEFINED_TABLE, isUndefinedTable } from "./pg-errors";

describe("isUndefinedTable (SQLSTATE 42P01)", () => {
  it("reconhece o código, direto ou na cadeia de `cause`", () => {
    expect(PG_UNDEFINED_TABLE).toBe("42P01");
    expect(isUndefinedTable({ code: "42P01" })).toBe(true);
    expect(isUndefinedTable(Object.assign(new Error("x"), { code: "42P01" }))).toBe(true);
    expect(isUndefinedTable(new Error("externo", { cause: { code: "42P01" } }))).toBe(true);
    expect(isUndefinedTable({ cause: { cause: { cause: { code: "42P01" } } } })).toBe(true); // 3 níveis
  });
  it("NÃO classifica como migrations pendentes erros independentes", () => {
    for (const code of ["22012", "42703", "42501", "23505", "08006", "08001", "57P01", "ECONNREFUSED", "ETIMEDOUT", "42P07", "42P02"]) expect(isUndefinedTable({ code })).toBe(false);
  });
  it("entradas que não são erros de banco dão false e nunca lançam", () => {
    for (const v of [undefined, null, "42P01", 42, true, {}, [], new Error("relation \"x\" does not exist"), { code: 42 }, { code: "42p01" }]) expect(isUndefinedTable(v)).toBe(false);
  });
  it("só segue a cadeia até 4 níveis e tolera ciclos", () => {
    const a: { code?: string; cause?: unknown } = {}; a.cause = a; // ciclo
    expect(isUndefinedTable(a)).toBe(false);
    expect(isUndefinedTable({ cause: { cause: { cause: { cause: { code: "42P01" } } } } })).toBe(false); // 5º nível
  });
  it("a mensagem do erro não influencia a classificação", () => {
    expect(isUndefinedTable(new Error('relation "plataforma.page" does not exist'))).toBe(false);
  });
});
