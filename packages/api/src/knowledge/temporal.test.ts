import { describe, expect, it } from "vitest";
import { UNBOUNDED, UNKNOWN, contains, instant, interval, leftOf, overlaps, rightOf, sameInterval, since, validateInterval } from "./temporal";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("intervalo semiaberto [início, fim)", () => {
  it("o início é incluído e o fim é excluído", () => {
    const i = interval(instant(d("2026-01-01")), instant(d("2026-02-01")));
    expect(contains(i, d("2025-12-31"))).toBe(false);
    expect(contains(i, d("2026-01-01"))).toBe(true);
    expect(contains(i, d("2026-01-31"))).toBe(true);
    expect(contains(i, d("2026-02-01"))).toBe(false);
  });
  it("intervalos adjacentes não se sobrepõem", () => {
    const a = interval(instant(d("2026-01-01")), instant(d("2026-02-01")));
    const b = interval(instant(d("2026-02-01")), instant(d("2026-03-01")));
    expect(overlaps(a, b)).toBe(false);
    expect(overlaps(a, interval(instant(d("2026-01-31")), instant(d("2026-03-01"))))).toBe(true);
  });
  it("`unbounded` significa desde sempre (início) ou em vigor (fim)", () => {
    expect(contains(since(d("2026-01-01")), d("2099-01-01"))).toBe(true);
    expect(contains(interval(UNBOUNDED, instant(d("2026-01-01"))), d("1990-01-01"))).toBe(true);
  });
  it("limite desconhecido dá 'unknown', nunca verdadeiro ou falso por padrão; mas o que já está fora é falso", () => {
    const i = interval(instant(d("2026-01-01")), UNKNOWN);
    expect(contains(i, d("2026-06-01"))).toBe("unknown");
    expect(contains(i, d("2025-06-01"))).toBe(false);
    expect(overlaps(i, since(d("2026-01-01")))).toBe("unknown");
  });
  it("valida: início < fim e datas válidas", () => {
    expect(validateInterval(interval(instant(d("2026-02-01")), instant(d("2026-01-01")))).join()).toMatch(/anterior/);
    expect(validateInterval(interval(instant(d("2026-01-01")), instant(d("2026-01-01")))).length).toBe(1);
    expect(validateInterval(interval(instant(new Date("x")), UNBOUNDED)).join()).toMatch(/inválida/);
    expect(validateInterval(since(d("2026-01-01")))).toEqual([]);
  });
  it("partes à esquerda e à direita ao cortar um intervalo", () => {
    const a = since(d("2026-01-01"));
    const cut = interval(instant(d("2026-02-01")), instant(d("2026-03-01")));
    expect(sameInterval(leftOf(a, cut)!, interval(instant(d("2026-01-01")), instant(d("2026-02-01"))))).toBe(true);
    expect(sameInterval(rightOf(a, cut)!, since(d("2026-03-01")))).toBe(true);
    expect(leftOf(cut, a)).toBeUndefined();
    expect(rightOf(cut, a)).toBeUndefined();
    expect(leftOf(interval(instant(d("2026-02-10")), instant(d("2026-02-20"))), cut)).toBeUndefined();
  });
});
