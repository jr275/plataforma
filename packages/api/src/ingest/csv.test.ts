import { describe, expect, it } from "vitest";
import { CsvParseError, detectDelimiter, parseCsv } from "./csv";

describe("leitor de CSV", () => {
  it("lê cabeçalho e linhas simples, com LF ou CRLF, e ignora a quebra final", () => {
    expect(parseCsv("a,b\n1,2\n3,4\n").rows).toEqual([["1", "2"], ["3", "4"]]);
    expect(parseCsv("a,b\r\n1,2\r\n3,4").rows).toEqual([["1", "2"], ["3", "4"]]);
    expect(parseCsv("a,b\r1,2\r3,4").rows).toHaveLength(2);
  });

  it("remove o BOM e apara o cabeçalho, mas não as células", () => {
    const p = parseCsv("﻿ a , b \n x , y ");
    expect(p.header).toEqual(["a", "b"]);
    expect(p.rows).toEqual([[" x ", " y "]]);
  });

  it("entende aspas, aspas escapadas, separador e quebra de linha dentro das aspas", () => {
    const p = parseCsv('nome,obs\n"Alta Floresta D\'Oeste","disse ""oi"", e saiu"\n"Linha\ndupla",x');
    expect(p.rows).toEqual([["Alta Floresta D'Oeste", 'disse "oi", e saiu'], ["Linha\ndupla", "x"]]);
  });

  it("detecta ; e tab pelo cabeçalho e aceita o separador explícito", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(detectDelimiter("a,b;c")).toBe(",");
    expect(parseCsv("a;b\n1;2").rows).toEqual([["1", "2"]]);
    expect(parseCsv("a,b\n1,2", { delimiter: ";" }).header).toEqual(["a,b"]);
  });

  it("células vazias e linhas totalmente vazias: as vazias são células, as linhas em branco não são registros", () => {
    expect(parseCsv("a,b,c\n1,,3\n\n,,\n").rows).toEqual([["1", "", "3"], ["", "", ""]]);
  });

  it("aspas que nunca fecham viram erro com a linha", () => {
    const e = (() => { try { parseCsv('a,b\n1,"abc\n2,3'); } catch (x) { return x as CsvParseError; } })();
    expect(e).toBeInstanceOf(CsvParseError);
    expect(e?.reason).toBe("unterminated_quote");
    expect(e?.line).toBe(2);
  });

  it("arquivo vazio e excesso de linhas são erros explícitos", () => {
    expect(() => parseCsv("")).toThrowError(CsvParseError);
    expect(() => parseCsv("\n\n")).toThrowError(/vazio/);
    expect(() => parseCsv("a\n1\n2\n3", { maxRows: 2 })).toThrowError(/mais de 2/);
    expect(parseCsv("a\n1\n2", { maxRows: 2 }).rows).toHaveLength(2);
  });
});
