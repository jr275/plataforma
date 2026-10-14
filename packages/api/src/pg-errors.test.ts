import { describe, expect, it } from "vitest";
import { PG_UNDEFINED_TABLE, isDatabaseUnavailable, isUndefinedTable } from "./pg-errors";

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

describe("isDatabaseUnavailable (conexão, desligamento e timeout)", () => {
  it("reconhece a classe 08 (conexão), desligamento/recuperação, excesso de conexões e cancelamento por tempo, direto ou em `cause`", () => {
    for (const code of ["08000", "08003", "08006", "08001", "08004", "57P01", "57P02", "57P03", "53300", "57014", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EPIPE"]) {
      expect(isDatabaseUnavailable({ code }), code).toBe(true);
      expect(isDatabaseUnavailable(new Error("embrulho", { cause: { code } })), `${code} em cause`).toBe(true);
    }
  });
  it("reconhece as falhas do driver `pg` que não trazem código (tempo de conexão e conexão encerrada)", () => {
    expect(isDatabaseUnavailable(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(isDatabaseUnavailable(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(isDatabaseUnavailable(new Error("Connection terminated due to connection timeout"))).toBe(true);
  });
  it("NÃO classifica como indisponibilidade: permissão, dado, tabela ausente, violação de unicidade nem erro comum", () => {
    for (const code of ["42501", "42P01", "22012", "23505", "23514", "42703", "P0001", "40001", "40P01"]) expect(isDatabaseUnavailable({ code }), code).toBe(false);
    expect(isDatabaseUnavailable(new Error("boom"))).toBe(false);
    expect(isDatabaseUnavailable(new Error("permission denied for table page"))).toBe(false);
  });
  it("entradas que não são erros dão false e nunca lançam; ciclos e cadeias longas são tolerados", () => {
    for (const v of [undefined, null, "08006", 8006, true, {}, [], { code: 8006 }, { code: "08" }]) expect(isDatabaseUnavailable(v)).toBe(false);
    const a: { cause?: unknown } = {}; a.cause = a;
    expect(isDatabaseUnavailable(a)).toBe(false);
    expect(isDatabaseUnavailable({ cause: { cause: { cause: { cause: { code: "08006" } } } } })).toBe(false); // 5º nível
  });
  it("uma tabela ausente e uma indisponibilidade são categorias disjuntas", () => {
    expect(isUndefinedTable({ code: "08006" })).toBe(false);
    expect(isDatabaseUnavailable({ code: "42P01" })).toBe(false);
  });
});
