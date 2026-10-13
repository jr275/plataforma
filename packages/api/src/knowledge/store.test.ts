import { describe, expect, it } from "vitest";
import { POLICIES } from "./epistemic";
import { BiTemporalStore, TenantMismatchError, eligibleVersions, stableStringify, type AssertInput, type FactKey } from "./store";
import { UNKNOWN, instant, interval, since } from "./temporal";

// Fixtures SINTÉTICAS: um atributo "price" de um sujeito qualquer. Nada aqui é dado real nem evidência de desempenho.
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const KEY: FactKey = { tenantId: "t1", subjectId: "s1", attribute: "price" };
const obs = (over: Partial<AssertInput> & Pick<AssertInput, "value" | "validTime">): AssertInput => ({ key: KEY, state: "OBSERVED_TRUE", evidenceIds: ["ev-1"], reason: "new_observation", ...over });
const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { if (!r.ok) throw new Error(JSON.stringify(r)); return r as Extract<T, { ok: true }>; };

describe("tempo de validade × tempo de transação", () => {
  function scenario() {
    const s = new BiTemporalStore({ tenantId: "t1" });
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
    const s = new BiTemporalStore({ tenantId: "t1" });
    const a = must(s.assert(obs({ value: 500, validTime: since(d("2026-01-01")) }), d("2026-01-02")));
    const b = must(s.assert(obs({ value: 500, validTime: since(d("2026-01-01")) }), d("2026-01-03")));
    expect(a.changed).toBe(true);
    expect(b.changed).toBe(false);
    expect(b.version.id).toBe(a.version.id);
    expect(s.history(KEY)).toHaveLength(1);
  });
  it("valores com a mesma estrutura em ordem de chaves diferente são o mesmo valor", () => {
    expect(stableStringify({ a: 1, b: [2, { c: 3, d: 4 }] })).toBe(stableStringify({ b: [2, { d: 4, c: 3 }], a: 1 }));
    const s = new BiTemporalStore({ tenantId: "t1" });
    must(s.assert(obs({ value: { moeda: "BRL", valor: 5 }, validTime: since(d("2026-01-01")) }), d("2026-01-02")));
    expect(must(s.assert(obs({ value: { valor: 5, moeda: "BRL" }, validTime: since(d("2026-01-01")) }), d("2026-01-03"))).changed).toBe(false);
  });
});

describe("Open-World, conflito, vencimento e encerramento", () => {
  it("sem registro o estado é ABSENT (e isso não é falso); evidência negativa é OBSERVED_FALSE", () => {
    const s = new BiTemporalStore({ tenantId: "t1" });
    const q = { validAt: d("2026-06-01"), knownAt: d("2026-06-01") };
    expect(s.stateAt(KEY, q)).toBe("ABSENT");
    must(s.assert(obs({ value: false, state: "OBSERVED_FALSE", validTime: since(d("2026-01-01")) }), d("2026-01-02")));
    expect(s.stateAt(KEY, q)).toBe("OBSERVED_FALSE");
  });
  it("outra fonte discorda: as DUAS versões ficam CONFLICTING, nada é sobrescrito em silêncio", () => {
    const s = new BiTemporalStore({ tenantId: "t1" });
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
    const s = new BiTemporalStore({ tenantId: "t1" });
    must(s.assert(obs({ value: 500, validTime: since(d("2026-01-01")) }), d("2026-01-02")));
    // Corroboração é revalidação; o motivo "conflicting_evidence" seria incoerente para um valor igual e é recusado.
    expect(s.assert(obs({ value: 500, validTime: since(d("2026-01-01")), evidenceIds: ["ev-2"], mode: "concurrent", reason: "conflicting_evidence" }), d("2026-01-03"))).toMatchObject({ ok: false, code: "reason_mismatch" });
    must(s.assert(obs({ value: 500, validTime: since(d("2026-01-01")), evidenceIds: ["ev-2"], mode: "concurrent", reason: "revalidation" }), d("2026-01-03")));
    expect(s.current(KEY, d("2026-01-10")).map((v) => v.state)).toEqual(["OBSERVED_TRUE"]);
    expect([...s.current(KEY, d("2026-01-10"))[0]!.evidenceIds].sort()).toEqual(["ev-1", "ev-2"]); // a cadeia de evidência soma, não encolhe
  });
  it("fato vencido vira UNKNOWN_STALE, a observação antiga continua reconstruível e a política assertiva o recusa", () => {
    const s = new BiTemporalStore({ tenantId: "t1" });
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
    const s = new BiTemporalStore({ tenantId: "t1" });
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
    const s = new BiTemporalStore({ tenantId: "t1" });
    expect(s.assert(obs({ value: 1, validTime: since(d("2026-01-01")), evidenceIds: [] }), d("2026-01-02"))).toMatchObject({ ok: false, code: "evidence_required" });
    expect(s.assert(obs({ value: 1, validTime: since(d("2026-01-01")), reason: "inference" }), d("2026-01-02"))).toMatchObject({ ok: false, code: "reason_mismatch" });
    expect(s.history(KEY)).toEqual([]);
  });
  it("inferência não vira observação sem evidência de revalidação, e é registrada como inferida", () => {
    const s = new BiTemporalStore({ tenantId: "t1" });
    must(s.assert(obs({ value: 7, state: "INFERRED_PROBABLE", reason: "inference", validTime: since(d("2026-01-01")) }), d("2026-01-02")));
    expect(s.stateAt(KEY, { validAt: d("2026-02-01"), knownAt: d("2026-02-01") })).toBe("INFERRED_PROBABLE");
    expect(eligibleVersions(s.current(KEY, d("2026-02-01")), POLICIES.assertive)).toEqual([]);
    expect(eligibleVersions(s.current(KEY, d("2026-02-01")), POLICIES.hedged)).toHaveLength(1);
  });
  it("validade com limite desconhecido ou intervalo inválido é recusada explicitamente", () => {
    const s = new BiTemporalStore({ tenantId: "t1" });
    expect(s.assert(obs({ value: 1, validTime: interval(instant(d("2026-01-01")), UNKNOWN) }), d("2026-01-02"))).toMatchObject({ ok: false, code: "unknown_bound_unsupported" });
    expect(s.assert(obs({ value: 1, validTime: interval(instant(d("2026-02-01")), instant(d("2026-01-01"))) }), d("2026-01-02"))).toMatchObject({ ok: false, code: "invalid_interval" });
  });
  it("só assert de observação direta ou inferência: não se grava CONFLICTING nem UNKNOWN_STALE à mão", () => {
    const s = new BiTemporalStore({ tenantId: "t1" });
    expect(s.assert({ ...obs({ value: 1, validTime: since(d("2026-01-01")) }), state: "CONFLICTING" as never }, d("2026-01-02"))).toMatchObject({ ok: false, code: "invalid_state" });
  });
  it("as versões devolvidas são imutáveis", () => {
    const s = new BiTemporalStore({ tenantId: "t1" });
    const v = must(s.assert(obs({ value: 500, validTime: since(d("2026-01-01")) }), d("2026-01-02"))).version;
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.evidenceIds)).toBe(true);
  });
});

describe("P1: imutabilidade profunda (cópias defensivas de datas e valores)", () => {
  it("alterar a data ou o array que o chamador passou NÃO altera o que foi gravado", () => {
    const s = new BiTemporalStore({ tenantId: "t1" });
    const ev = ["e1"];
    const start = d("2026-01-01");
    const staleAfter = d("2026-06-01");
    const value = { moeda: "BRL", valor: 5 };
    must(s.assert(obs({ value, validTime: since(start), evidenceIds: ev, staleAfter }), d("2026-01-02")));
    start.setUTCFullYear(2000);
    staleAfter.setUTCFullYear(1990);
    ev.push("injetado");
    value.valor = 999;
    const v = s.history(KEY)[0]!;
    expect((v.validTime.start as { at: Date }).at.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(v.staleAfter!.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(v.evidenceIds).toEqual(["e1"]);
    expect(v.value).toEqual({ moeda: "BRL", valor: 5 });
  });
  it("alterar as datas, o intervalo ou o valor DEVOLVIDOS não altera o estado interno", () => {
    const s = new BiTemporalStore({ tenantId: "t1" });
    must(s.assert(obs({ value: { n: 1 }, validTime: since(d("2026-01-01")), staleAfter: d("2026-06-01") }), d("2026-01-02")));
    const v = s.history(KEY)[0]!;
    v.recordedAt.setUTCFullYear(1999);
    v.staleAfter!.setUTCFullYear(1999);
    (v.validTime.start as { at: Date }).at.setUTCFullYear(1999);
    (v.value as { n: number }).n = 42;
    const again = s.history(KEY)[0]!;
    expect(again.recordedAt.toISOString()).toBe("2026-01-02T00:00:00.000Z");
    expect(again.staleAfter!.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect((again.validTime.start as { at: Date }).at.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(again.value).toEqual({ n: 1 });
    expect(Object.isFrozen(again.validTime)).toBe(true);
  });
  it("alterar o `at` (tempo de transação) do chamador depois da gravação não muda o registro", () => {
    const s = new BiTemporalStore({ tenantId: "t1" });
    const at = d("2026-01-02");
    must(s.assert(obs({ value: 1, validTime: since(d("2026-01-01")) }), at));
    at.setUTCFullYear(1980);
    expect(s.history(KEY)[0]!.recordedAt.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });
});

describe("P2: conflito segmentado no tempo", () => {
  it("um conflito iniciado em março NÃO contamina janeiro e fevereiro", () => {
    const s = new BiTemporalStore({ tenantId: "t1" });
    must(s.assert(obs({ value: 1, validTime: since(d("2026-01-01")) }), d("2026-01-02")));
    must(s.assert(obs({ value: 2, validTime: since(d("2026-03-01")), evidenceIds: ["e2"], reason: "conflicting_evidence", mode: "concurrent" }), d("2026-03-02")));
    const at = (day: string) => s.current(KEY, d(day)).map((x) => `${x.value}:${x.state}`).sort();
    expect(at("2026-01-15")).toEqual(["1:OBSERVED_TRUE"]);
    expect(at("2026-02-15")).toEqual(["1:OBSERVED_TRUE"]);
    expect(at("2026-03-15")).toEqual(["1:CONFLICTING", "2:CONFLICTING"]);
    expect(s.stateAt(KEY, { validAt: d("2026-02-15"), knownAt: d("2026-04-01") })).toBe("OBSERVED_TRUE");
    expect(s.stateAt(KEY, { validAt: d("2026-03-15"), knownAt: d("2026-04-01") })).toBe("CONFLICTING");
  });
  it("o trecho novo que ninguém contesta entra como observação normal", () => {
    const s = new BiTemporalStore({ tenantId: "t1" });
    must(s.assert(obs({ value: 1, validTime: interval(instant(d("2026-01-01")), instant(d("2026-03-01"))) }), d("2026-01-02")));
    must(s.assert(obs({ value: 2, validTime: since(d("2026-02-01")), evidenceIds: ["e2"], reason: "conflicting_evidence", mode: "concurrent" }), d("2026-03-05")));
    const at = (day: string) => s.current(KEY, d(day)).map((x) => `${x.value}:${x.state}`).sort();
    expect(at("2026-01-15")).toEqual(["1:OBSERVED_TRUE"]);
    expect(at("2026-02-15")).toEqual(["1:CONFLICTING", "2:CONFLICTING"]); // só fevereiro disputa
    expect(at("2026-06-15")).toEqual(["2:OBSERVED_TRUE"]); // depois de março só a fonte nova fala
  });
  it("repetir a mesma observação concorrente é idempotente", () => {
    const s = new BiTemporalStore({ tenantId: "t1" });
    must(s.assert(obs({ value: 1, validTime: since(d("2026-01-01")) }), d("2026-01-02")));
    const input = obs({ value: 2, validTime: since(d("2026-03-01")), evidenceIds: ["e2"], reason: "conflicting_evidence", mode: "concurrent" });
    must(s.assert(input, d("2026-03-02")));
    const n = s.history(KEY).length;
    expect(must(s.assert(input, d("2026-03-03"))).changed).toBe(false);
    expect(s.history(KEY)).toHaveLength(n);
  });
  it("o conflito pode ser resolvido por observação com evidência de resolução, só no trecho em disputa", () => {
    const s = new BiTemporalStore({ tenantId: "t1" });
    must(s.assert(obs({ value: 1, validTime: since(d("2026-01-01")) }), d("2026-01-02")));
    must(s.assert(obs({ value: 2, validTime: since(d("2026-03-01")), evidenceIds: ["e2"], reason: "conflicting_evidence", mode: "concurrent" }), d("2026-03-02")));
    must(s.assert(obs({ value: 1, validTime: since(d("2026-03-01")), evidenceIds: ["e9"], reason: "resolution" }), d("2026-03-04")));
    expect(s.current(KEY, d("2026-03-15")).map((x) => `${x.value}:${x.state}`)).toEqual(["1:OBSERVED_TRUE"]);
    expect(s.current(KEY, d("2026-01-15")).map((x) => `${x.value}:${x.state}`)).toEqual(["1:OBSERVED_TRUE"]);
  });
});

describe("P3: prazo (staleAfter) em conflitos e em repetições", () => {
  it("conflito não resolvido até o prazo vira UNKNOWN_STALE (as duas versões continuam no histórico)", () => {
    const s = new BiTemporalStore({ tenantId: "t1" });
    must(s.assert(obs({ value: 1, validTime: since(d("2026-01-01")), staleAfter: d("2026-02-01") }), d("2026-01-02")));
    must(s.assert(obs({ value: 2, validTime: since(d("2026-01-01")), evidenceIds: ["e2"], reason: "conflicting_evidence", mode: "concurrent", staleAfter: d("2026-02-01") }), d("2026-01-03")));
    expect(s.expireStale(d("2026-01-20"))).toHaveLength(0);
    expect(s.expireStale(d("2026-06-01"))).toHaveLength(2);
    expect(s.current(KEY, d("2026-06-02")).map((x) => x.state)).toEqual(["UNKNOWN_STALE", "UNKNOWN_STALE"]);
    expect(s.history(KEY).filter((x) => x.state === "CONFLICTING").length).toBeGreaterThanOrEqual(2);
    expect(s.stateAt(KEY, { validAt: d("2026-01-15"), knownAt: d("2026-01-10") })).toBe("CONFLICTING"); // o que se sabia antes
  });
  it("repetir a mesma afirmação com a MESMA evidência e prazo diferente é um refresh: nova versão, prazo antigo preservado no histórico", () => {
    const s = new BiTemporalStore({ tenantId: "t1" });
    must(s.assert(obs({ value: 1, validTime: since(d("2026-01-01")), staleAfter: d("2026-02-01") }), d("2026-01-02")));
    const r = must(s.assert(obs({ value: 1, validTime: since(d("2026-01-01")), staleAfter: d("2026-08-01") }), d("2026-01-30")));
    expect(r.changed).toBe(true);
    expect(s.current(KEY, d("2026-03-01"))[0]!.staleAfter!.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(s.history(KEY).some((v) => v.staleAfter?.toISOString() === "2026-02-01T00:00:00.000Z")).toBe(true);
    expect(s.expireStale(d("2026-03-01"))).toHaveLength(0); // o prazo novo vale
    expect(must(s.assert(obs({ value: 1, validTime: since(d("2026-01-01")), staleAfter: d("2026-08-01") }), d("2026-02-01"))).changed).toBe(false); // e repetir o refresh é idempotente
  });
});

describe("P4: isolamento multi-tenant do repositório", () => {
  const OTHER: FactKey = { ...KEY, tenantId: "t2" };
  it("o repositório é vinculado a um tenant: escrever com chave de outro tenant é recusado e nada é gravado", () => {
    const s = new BiTemporalStore({ tenantId: "t1" });
    expect(s.assert({ ...obs({ value: 1, validTime: since(d("2026-01-01")) }), key: OTHER }, d("2026-01-02"))).toMatchObject({ ok: false, code: "tenant_mismatch" });
    expect(s.endValidity(OTHER, d("2026-04-01"), ["e"], d("2026-04-02"))).toMatchObject({ ok: false, code: "tenant_mismatch" });
    expect(s.history(KEY)).toEqual([]);
  });
  it("ler com chave de outro tenant LANÇA (não devolve vazio em silêncio)", () => {
    const s = new BiTemporalStore({ tenantId: "t1" });
    must(s.assert(obs({ value: 1, validTime: since(d("2026-01-01")) }), d("2026-01-02")));
    for (const read of [() => s.history(OTHER), () => s.current(OTHER, d("2026-02-01")), () => s.query(OTHER, { validAt: d("2026-02-01"), knownAt: d("2026-02-01") }), () => s.stateAt(OTHER, { validAt: d("2026-02-01"), knownAt: d("2026-02-01") })]) {
      expect(read).toThrowError(TenantMismatchError);
    }
  });
  it("dois repositórios de tenants diferentes são independentes, mesmo com a mesma chave lógica", () => {
    const a = new BiTemporalStore({ tenantId: "t1" });
    const b = new BiTemporalStore({ tenantId: "t2" });
    must(a.assert(obs({ value: 500, validTime: since(d("2026-01-01")) }), d("2026-01-02")));
    must(b.assert({ ...obs({ value: 900, validTime: since(d("2026-01-01")) }), key: OTHER }, d("2026-01-02")));
    expect(a.current(KEY, d("2026-02-01")).map((v) => v.value)).toEqual([500]);
    expect(b.current(OTHER, d("2026-02-01")).map((v) => v.value)).toEqual([900]);
  });
  it("exige tenantId na criação", () => {
    expect(() => new BiTemporalStore({ tenantId: " " })).toThrowError(TypeError);
  });
});
