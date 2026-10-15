import { describe, expect, it } from "vitest";
import { devIdentity } from "./dev-identity";
import { pickTenant } from "./tenant-selection";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const id = (...t: string[]) => devIdentity(t);

describe("seleção do tenant ativo (sem 'o primeiro da lista')", () => {
  it("identidade sem tenant: none, mesmo com uma preferência", () => {
    expect(pickTenant(id(), undefined)).toEqual({ kind: "none" });
    expect(pickTenant(id(), A)).toEqual({ kind: "none" });
  });
  it("um único tenant: é ele (autorizado pela identidade); a preferência não o muda nem o amplia", () => {
    expect(pickTenant(id(A), undefined)).toEqual({ kind: "selected", tenantId: A, source: "only" });
    expect(pickTenant(id(A), B)).toEqual({ kind: "selected", tenantId: A, source: "only" }); // preferência de outro tenant é ignorada, nunca obedecida
    expect(pickTenant(id(A), "lixo")).toEqual({ kind: "selected", tenantId: A, source: "only" });
  });
  it("vários tenants sem escolha: seleção obrigatória (nunca o primeiro), com as opções da identidade", () => {
    expect(pickTenant(id(A, B), undefined)).toEqual({ kind: "selection_required", choices: [A, B], staleSelection: false });
    expect(pickTenant(id(A, B), null)).toMatchObject({ kind: "selection_required", staleSelection: false });
    expect(pickTenant(id(A, B), "")).toMatchObject({ kind: "selection_required", staleSelection: false });
    expect(pickTenant(id(A, B), "   ")).toMatchObject({ kind: "selection_required", staleSelection: false });
  });
  it("vários tenants com escolha autorizada: o escolhido (inclusive o que não é o primeiro); a ordem da claim não importa", () => {
    expect(pickTenant(id(A, B), B)).toEqual({ kind: "selected", tenantId: B, source: "explicit" });
    expect(pickTenant(id(B, A), B)).toEqual({ kind: "selected", tenantId: B, source: "explicit" });
    expect(pickTenant(id(A, B), B.toUpperCase())).toEqual({ kind: "selected", tenantId: B, source: "explicit" }); // normalizado como a claim
  });
  it("escolha NÃO autorizada (outro tenant, malformada): seleção obrigatória marcada como desatualizada, nunca obedecida", () => {
    for (const bad of [C, "lixo", `${A}x`]) expect(pickTenant(id(A, B), bad)).toEqual({ kind: "selection_required", choices: [A, B], staleSelection: true });
  });
  it("preferência que não é texto (corrompida) é tratada como ausente: seleção obrigatória, nunca o primeiro", () => {
    for (const bad of [42, {}, [A], true]) expect(pickTenant(id(A, B), bad)).toEqual({ kind: "selection_required", choices: [A, B], staleSelection: false });
  });
  it("a escolha antiga de um tenant removido da claim deixa de valer (a claim é a verdade)", () => {
    expect(pickTenant(id(A, B), B)).toMatchObject({ kind: "selected", tenantId: B });
    expect(pickTenant(id(A, C), B)).toMatchObject({ kind: "selection_required", staleSelection: true });
  });
});
