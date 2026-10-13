import { describe, expect, it } from "vitest";
import { POLICIES } from "./epistemic";
import { BiTemporalStore, eligibleVersions, stableStringify, type AssertInput, type FactKey } from "./store";
import { UNKNOWN, instant, interval, since } from "./temporal";

// Fixtures SINTÉTICAS: um atributo "price" de um sujeito qualquer. Nada aqui é dado real nem evidência de desempenho.
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const KEY: FactKey = { tenantId: "t1", subjectId: "s1", attribute: "price" };
const obs = (over: Partial<AssertInput> & Pick<AssertInput, "value" | "validTime">): AssertInput => ({ key: KEY, state: "OBSERVED_TRUE", evidenceIds: ["ev-1"], reason: "new_observation", ...over });
const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { if (!r.ok) throw new Error(JSON.stringify(r)); return r as Extract<T, { ok: true }>; };

describe("tempo de validade × tempo de transação", () => {
  function scenario() {
    const s = new BiTemporalStore();
    must(s.assert(obs({ value: 500, validTime: since(d("2026-01-01")) }), d("2026-01-02")));      // registrado em 02/01: vale desde 01/01
    must(s.assert(obs({ value: 480, validTime: since(d("2026-02-01")), evidenceIds: ["ev-2"] }), d("2026-02-02"))); // mudança de preço em 01/02
    return s;
  }
  it("a mudança de valor preserva o valor anterior no seu período de validade", () => {
    const s = scenario();
    const at = (valid: string, known: string) => s.query(KEY, { validAt: d(valid), knownAt: d(known) }).map((v) => v.value);
    expect(at("2026-01-15", "2026-03-01")).toEqual([500]);
    expect(at("2026-02-15", "2026-03-01")).toEqual([480]);
    expect(at("2026-12-31", "2026-03-01")).toEqual([480]);
  });
  it("o sistema reconstrói o que SABIA em um instante passado (transação)", () => {
    const s = scenario();
    // Em 15/01 o sistema ainda não sabia da mudança de 01/02: não havia nada sobre fevereiro.
    expect(s.query(KEY, { validAt: d("2026-02-15"), knownAt: d("2026-01-15") }).map((v) => v.value)).toEqual([500]);
    expect(s.stateAt(KEY, { validAt: d("2025-12-01"), knownAt: d("2026-03-01") })).toBe("ABSENT"); // antes de qualquer validade
  });
  it("correção RETROATIVA não apaga o conhecimento anterior: valid time e transaction time divergem", () => {
    const s = scenario();
    // Em 05/03 descobre-se que, em janeiro, o preço real era 510 (não 500).
    must(s.assert(obs({ value: 510, validTime: interval(instant(d("2026-01-01")), instant(d("2026-02-01"))), evidenceIds: ["ev-3"], reason: "revalidation" }), d("2026-03-05")));
    const q = (known: string) => s.query(KEY, { validAt: d("2026-01-15"), knownAt: d(known) }).map((v) => v.value);
    expect(q("2026-03-01")).toEqual([500]); // o que se sabia ANTES da correção continua reconstruível
    expect(q("2026-03-10")).toEqual([510]); // o que se sabe DEPOIS
    expect(s.query(KEY, { validAt: d("2026-02-15"), knownAt: d("2026-03-10") }).map((v) => v.value)).toEqual([480]); // fevereiro intacto
  });
  it("nada é apagado: o histórico só cresce e as versões antigas ficam com supersededAt", () => {
    const s = scenario();
    const antes = s.history(KEY).length;
    must(s.assert(obs({ value: 510, validTime: interval(instant(d("2026-01-01")), instant(d("2026-02-01"))), evidenceIds: ["ev-3"], reason: "revalidation" }), d("2026-03-05")));
    const h = s.history(KEY);
    expect(h.length).toBeGreaterThan(antes);
    expect(h.filter((v) => v.supersededAt !== null).length).toBeGreaterThan(0);
    expect(h.find((v) => v.value === 500 && v.supersededAt !== null)).toBeDefined();
    expect(h.map((v) => v.version)).toEqual([...h.map((v) => v.version)].sort((a, b) => a - b));
  });
  it("o tempo de transação é monotônico: não aceita data anterior ao último registro", () => {
    const s = scenario();
    expect(s.assert(obs({ value: 1, validTime: since(d("2026-05-01")), evidenceIds: ["x"] }), d("2026-01-01"))).toMatchObject({ ok: false, code: "tx_regression" });
  });
});

describe("idempotência", () => {
  it("repetir a mesma afirmação não cria versão nova", () => {
    const s = new BiTemporalStore();
    const a = must(s.assert(obs({ value: 500, validTime: since(d("2026-01-01")) }), d("2026-01-02")));
    const b = must(s.assert(obs({ value: 500, validTime: since(d("2026-01-01")) }), d("2026-01-03")));
    expect(a.changed).toBe(true);
    expect(b.changed).toBe(false);
    expect(b.version.id).toBe(a.version.id);
    expect(s.history(KEY)).toHaveLength(1);
  });
  it("valores com a mesma estrutura em ordem de chaves diferente são o mesmo valor", () => {
    expect(stableStringify({ a: 1, b: [2, { c: 3, d: 4 }] })).toBe(stableStringify({ b: [2, { d: 4, c: 3 }], a: 1 }));
    const s = new BiTemporalStore();
    must(s.assert(obs({ value: { moeda: "BRL", valor: 5 }, validTime: since(d("2026-01-01")) }), d("2026-01-02")));
    expect(must(s.assert(obs({ value: { valor: 5, moeda: "BRL" }, validTime: since(d("2026-01-01")) }), d("2026-01-03"))).changed).toBe(false);
  });
});

describe("Open-World, conflito, vencimento e encerramento", () => {
  it("sem registro o estado é ABSENT (e isso não é falso); evidência negativa é OBSERVED_FALSE", () => {
    const s = new BiTemporalStore();
    const q = { validAt: d("2026-06-01"), knownAt: d("2026-06-01") };
    expect(s.stateAt(KEY, q)).toBe("ABSENT");
    must(s.assert(obs({ value: false, state: "OBSERVED_FALSE", validTime: since(d("2026-01-01")) }), d("2026-01-02")));
    expect(s.stateAt(KEY, q)).toBe("OBSERVED_FALSE");
  });
  it("outra fonte discorda: as DUAS versões ficam CONFLICTING, nada é sobrescrito em silêncio", () => {
    const s = new BiTemporalStore();
    must(s.assert(obs({ value: 500, validTime: since(d("2026-01-01")) }), d("2026-01-02")));
    must(s.assert(obs({ value: 530, validTime: since(d("2026-01-01")), evidenceIds: ["ev-9"], reason: "conflicting_evidence", mode: "concurrent" }), d("2026-01-03")));
    const now = s.current(KEY, d("2026-01-10"));
    expect(now.map((v) => v.value).sort()).toEqual([500, 530]);
    expect(now.every((v) => v.state === "CONFLICTING")).toBe(true);
    expect(s.stateAt(KEY, { validAt: d("2026-01-10"), knownAt: d("2026-01-02") })).toBe("OBSERVED_TRUE"); // antes do conflito
    expect(eligibleVersions(now, POLICIES.assertive)).toEqual([]);
    expect(eligibleVersions(now, POLICIES.historical)).toHaveLength(2);
  });
  it("valor igual de outra fonte (corroboração) não gera conflito", () => {
    const s = new BiTemporalStore();
    must(s.assert(obs({ value: 500, validTime: since(d("2026-01-01")) }), d("2026-01-02")));
    // Corroboração é revalidação; o motivo "conflicting_evidence" seria incoerente para um valor igual e é recusado.
    expect(s.assert(obs({ value: 500, validTime: since(d("2026-01-01")), evidenceIds: ["ev-2"], mode: "concurrent", reason: "conflicting_evidence" }), d("2026-01-03"))).toMatchObject({ ok: false, code: "reason_mismatch" });
    must(s.assert(obs({ value: 500, validTime: since(d("2026-01-01")), evidenceIds: ["ev-2"], mode: "concurrent", reason: "revalidation" }), d("2026-01-03")));
    expect(s.current(KEY, d("2026-01-10")).map((v) => v.state)).toEqual(["OBSERVED_TRUE"]);
    expect([...s.current(KEY, d("2026-01-10"))[0]!.evidenceIds].sort()).toEqual(["ev-1", "ev-2"]); // a cadeia de evidência soma, não encolhe
  });
  it("fato vencido vira UNKNOWN_STALE, a observação antiga continua reconstruível e a política assertiva o recusa", () => {
    const s = new BiTemporalStore();
    must(s.assert(obs({ value: 500, validTime: since(d("2026-01-01")), staleAfter: d("2026-02-01") }), d("2026-01-02")));
    expect(s.expireStale(d("2026-01-20"))).toHaveLength(0); // ainda dentro do prazo
    expect(s.expireStale(d("2026-02-05"))).toHaveLength(1);
    expect(s.expireStale(d("2026-02-06"))).toHaveLength(0); // idempotente
    expect(s.stateAt(KEY, { validAt: d("2026-02-10"), knownAt: d("2026-03-01") })).toBe("UNKNOWN_STALE");
    expect(s.stateAt(KEY, { validAt: d("2026-02-10"), knownAt: d("2026-01-25") })).toBe("OBSERVED_TRUE");
    expect(eligibleVersions(s.current(KEY, d("2026-02-10")), POLICIES.assertive)).toEqual([]);
    // Revalidar com evidência volta a OBSERVED_TRUE sem apagar o vencimento no histórico.
    must(s.assert(obs({ value: 500, validTime: since(d("2026-01-01")), evidenceIds: ["ev-7"], reason: "revalidation" }), d("2026-02-20")));
    expect(s.stateAt(KEY, { validAt: d("2026-02-25"), knownAt: d("2026-03-01") })).toBe("OBSERVED_TRUE");
    expect(s.history(KEY).some((v) => v.state === "UNKNOWN_STALE")).toBe(true);
  });
  it("encerrar a vigência (tombstone) fecha a validade sem declarar inexistência nem mudar o estado", () => {
    const s = new BiTemporalStore();
    must(s.assert(obs({ value: 500, validTime: since(d("2026-01-01")) }), d("2026-01-02")));
    const r = s.endValidity(KEY, d("2026-04-01"), ["ev-end"], d("2026-04-02"));
    expect(r.ok).toBe(true);
    expect(s.stateAt(KEY, { validAt: d("2026-03-01"), knownAt: d("2026-05-01") })).toBe("OBSERVED_TRUE");
    expect(s.stateAt(KEY, { validAt: d("2026-04-15"), knownAt: d("2026-05-01") })).toBe("ABSENT"); // fora da vigência: sem afirmação, não "falso"
    expect(s.stateAt(KEY, { validAt: d("2026-04-15"), knownAt: d("2026-04-01") })).toBe("OBSERVED_TRUE"); // o que se sabia antes
    expect(s.endValidity(KEY, d("2026-04-01"), [], d("2026-04-03"))).toMatchObject({ ok: false, code: "evidence_required" });
    expect(s.endValidity({ ...KEY, attribute: "nada" }, d("2026-04-01"), ["e"], d("2026-04-03"))).toMatchObject({ ok: false, code: "nothing_to_close" });
  });
});

describe("recusas e isolamento", () => {
  it("transição inválida é recusada e nada é gravado", () => {
    const s = new BiTemporalStore();
    expect(s.assert(obs({ value: 1, validTime: since(d("2026-01-01")), evidenceIds: [] }), d("2026-01-02"))).toMatchObject({ ok: false, code: "evidence_required" });
    expect(s.assert(obs({ value: 1, validTime: since(d("2026-01-01")), reason: "inference" }), d("2026-01-02"))).toMatchObject({ ok: false, code: "reason_mismatch" });
    expect(s.history(KEY)).toEqual([]);
  });
  it("inferência não vira observação sem evidência de revalidação, e é registrada como inferida", () => {
    const s = new BiTemporalStore();
    must(s.assert(obs({ value: 7, state: "INFERRED_PROBABLE", reason: "inference", validTime: since(d("2026-01-01")) }), d("2026-01-02")));
    expect(s.stateAt(KEY, { validAt: d("2026-02-01"), knownAt: d("2026-02-01") })).toBe("INFERRED_PROBABLE");
    expect(eligibleVersions(s.current(KEY, d("2026-02-01")), POLICIES.assertive)).toEqual([]);
    expect(eligibleVersions(s.current(KEY, d("2026-02-01")), POLICIES.hedged)).toHaveLength(1);
  });
  it("validade com limite desconhecido ou intervalo inválido é recusada explicitamente", () => {
    const s = new BiTemporalStore();
    expect(s.assert(obs({ value: 1, validTime: interval(instant(d("2026-01-01")), UNKNOWN) }), d("2026-01-02"))).toMatchObject({ ok: false, code: "unknown_bound_unsupported" });
    expect(s.assert(obs({ value: 1, validTime: interval(instant(d("2026-02-01")), instant(d("2026-01-01"))) }), d("2026-01-02"))).toMatchObject({ ok: false, code: "invalid_interval" });
  });
  it("só assert de observação direta ou inferência: não se grava CONFLICTING nem UNKNOWN_STALE à mão", () => {
    const s = new BiTemporalStore();
    expect(s.assert({ ...obs({ value: 1, validTime: since(d("2026-01-01")) }), state: "CONFLICTING" as never }, d("2026-01-02"))).toMatchObject({ ok: false, code: "invalid_state" });
  });
  it("chaves de tenants diferentes não se enxergam", () => {
    const s = new BiTemporalStore();
    must(s.assert(obs({ value: 500, validTime: since(d("2026-01-01")) }), d("2026-01-02")));
    const other: FactKey = { ...KEY, tenantId: "t2" };
    expect(s.current(other, d("2026-02-01"))).toEqual([]);
    expect(s.history(other)).toEqual([]);
    expect(s.stateAt(other, { validAt: d("2026-02-01"), knownAt: d("2026-02-01") })).toBe("ABSENT");
  });
  it("as versões devolvidas são imutáveis", () => {
    const s = new BiTemporalStore();
    const v = must(s.assert(obs({ value: 500, validTime: since(d("2026-01-01")) }), d("2026-01-02"))).version;
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.evidenceIds)).toBe(true);
  });
});
