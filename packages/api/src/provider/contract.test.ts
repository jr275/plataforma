import { describe, expect, it } from "vitest";
import { RunBudget, BudgetExceededError, UNIT_CAP_USD, DEFAULT_MAX_REQUESTS_PER_RUN } from "./budget";
import { cacheKeyFor, canonicalJson, missingEnv, notConfigured, providerError } from "./contract";

describe("chave de cache determinística", () => {
  it("não depende da ordem das chaves, em nenhum nível", () => {
    expect(cacheKeyFor("p", "e", { a: 1, b: { y: 2, x: [1, { d: 4, c: 3 }] } })).toBe(cacheKeyFor("p", "e", { b: { x: [1, { c: 3, d: 4 }], y: 2 }, a: 1 }));
  });
  it("muda com provedor, endpoint ou qualquer parâmetro", () => {
    const k = cacheKeyFor("p", "e", { q: "x" });
    expect(cacheKeyFor("p2", "e", { q: "x" })).not.toBe(k);
    expect(cacheKeyFor("p", "e2", { q: "x" })).not.toBe(k);
    expect(cacheKeyFor("p", "e", { q: "y" })).not.toBe(k);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
  it("omite undefined e preserva a ordem dos arrays", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });
});
describe("credenciais por nome", () => {
  it("lista as ausentes sem ler valores e trata vazio como ausente", () => {
    expect(missingEnv({ A: "x", B: "  ", C: undefined }, ["A", "B", "C"])).toEqual(["B", "C"]);
    const r = notConfigured("dataforseo", ["DATAFORSEO_LOGIN"]);
    expect(r.state).toBe("provider_not_configured");
    expect(JSON.stringify(r)).not.toMatch(/password|secret/i);
  });
  it("o erro de provedor trunca a mensagem", () => { expect(providerError("p", "http", "x".repeat(900)).message).toHaveLength(300); });
});
describe("orçamento", () => {
  it("usa o teto de US$ 50 e 500 requisições por padrão", () => { expect(RunBudget.create().limits).toMatchObject({ capUsd: UNIT_CAP_USD, maxRequests: DEFAULT_MAX_REQUESTS_PER_RUN, spentBeforeUsd: 0 }); expect(UNIT_CAP_USD).toBe(50); expect(DEFAULT_MAX_REQUESTS_PER_RUN).toBe(500); });
  it("recusa a requisição seguinte ao limite por execução", () => {
    const b = RunBudget.create({ maxRequests: 2 });
    b.reserve(); b.reserve();
    expect(() => b.reserve()).toThrow(BudgetExceededError);
    expect(b.usage.remainingRequests).toBe(0);
  });
  it("recusa quando o gasto já gravado mais o estimado passaria do teto", () => {
    const b = RunBudget.create({ spentBeforeUsd: 49.99 });
    expect(() => b.reserve(0.02)).toThrow(/teto/);
    b.reserve(0.005);
    b.settle(0.006);
    expect(b.usage.costUsd).toBe(0.006);
    expect(() => b.reserve(0.005)).toThrow(BudgetExceededError);
  });
  it("o custo real liquidado conta para a próxima reserva", () => {
    const b = RunBudget.create({ capUsd: 1 });
    b.reserve(); b.settle(0.9);
    expect(() => b.reserve(0.2)).toThrow(/teto/);
  });
  it("não aceita limites inválidos", () => { expect(() => RunBudget.create({ maxRequests: 0 })).toThrow(RangeError); expect(() => RunBudget.create({ capUsd: 0 })).toThrow(RangeError); });
});
