import { describe, expect, it } from "vitest";
import { importMode, redact, runEvidence, type RunLike } from "./evidence";

const run = (over: Partial<RunLike> = {}): RunLike => ({ id: "r1", status: "succeeded", startedAt: new Date("2026-10-17T10:00:00Z"), finishedAt: new Date("2026-10-17T10:05:00Z"), error: null, ...over });

describe("redact", () => {
  it("remove URL de conexão, e-mail e token longo da mensagem", () => {
    const out = redact("falha em postgresql://user:senha@host:5432/db por ana@exemplo.com com abcdefghijklmnopqrstuvwxyz0123456789ABCD");
    expect(out).not.toContain("senha");
    expect(out).not.toContain("ana@exemplo.com");
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789ABCD");
    expect(out).toContain("[url]");
  });
  it("limita o tamanho", () => { expect(redact("x ".repeat(500), 50).length).toBeLessThanOrEqual(50); });
});

describe("runEvidence", () => {
  it("ignora execução em andamento (não é evidência terminal)", () => {
    expect(runEvidence("run", [run({ status: "running", finishedAt: null })])).toEqual([]);
  });
  it("sucesso, parcial e falha viram os resultados certos, com data de término e id rastreável", () => {
    const [ok, partial, fail] = runEvidence("run", [run({ id: "a" }), run({ id: "b", status: "partial" }), run({ id: "c", status: "failed", error: "banco indisponível" })]);
    expect(ok).toMatchObject({ id: "run:a", outcome: "success", mode: "live", kind: "execution_record", at: "2026-10-17T10:05:00.000Z" });
    expect(partial).toMatchObject({ outcome: "partial" });
    expect(fail).toMatchObject({ outcome: "failure", errorCode: "RUN_FAILED", detail: "banco indisponível" });
  });
  it("sem término registrado usa o início", () => {
    expect(runEvidence("run", [run({ finishedAt: null, status: "failed" })])[0]!.at).toBe("2026-10-17T10:00:00.000Z");
  });
  it("a mensagem de erro de uma falha passa pela redação", () => {
    const [f] = runEvidence("run", [run({ status: "failed", error: "conexão negada em postgres://u:p@h/db" })]);
    expect(f!.detail).not.toContain("u:p@h");
  });
  it("origem da importação define o modo: real = live, teste = simulado, manual = importação", () => {
    expect([importMode("real"), importMode("test"), importMode("manual")]).toEqual(["live", "simulated", "import"]);
  });
});
