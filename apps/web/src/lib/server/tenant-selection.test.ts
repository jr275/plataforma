import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { devIdentity } from "@plataforma/api";

vi.mock("server-only", () => ({}));
import { activeTenantFor } from "./tenant-selection";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const id = (...t: string[]) => devIdentity(t);

describe("activeTenantFor: o único ponto de decisão do tenant", () => {
  it("zero tenants: none (mesmo com uma seleção)", () => {
    expect(activeTenantFor(id())).toEqual({ kind: "none" });
    expect(activeTenantFor(id(), A)).toEqual({ kind: "none" });
  });
  it("um tenant: é ele, autorizado pela identidade", () => expect(activeTenantFor(id(A))).toEqual({ kind: "selected", tenantId: A, source: "only" }));
  it("vários sem seleção: seleção obrigatória", () => expect(activeTenantFor(id(A, B))).toMatchObject({ kind: "selection_required", choices: [A, B], staleSelection: false }));
  it("vários com seleção VÁLIDA (autorizada na identidade): o selecionado, mesmo não sendo o primeiro", () => expect(activeTenantFor(id(A, B), B)).toEqual({ kind: "selected", tenantId: B, source: "explicit" }));
  it("seleção INVÁLIDA (tenant que a identidade não possui, malformado): rejeitada, seleção obrigatória marcada como desatualizada", () => {
    for (const bad of [C, "lixo", `${A};DROP`]) expect(activeTenantFor(id(A, B), bad)).toMatchObject({ kind: "selection_required", staleSelection: true });
  });
  it("com um único tenant, uma seleção de outro tenant é ignorada (nunca obedecida)", () => expect(activeTenantFor(id(A), B)).toEqual({ kind: "selected", tenantId: A, source: "only" }));
});

// TESTE ESTÁTICO: ninguém escolhe tenant pela posição de um array. Só activeTenantFor/pickTenant decidem.
describe("nenhum 'tenantIds[0]' no código de produção", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
  const PATTERN = /tenantIds\s*(\[\s*0\s*\]|\.at\(\s*0\s*\)|\.find\()/;
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (["node_modules", ".next", ".turbo", "dist"].includes(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) files.push(full);
    }
  };
  for (const base of ["apps/web/src", "packages/api/src"]) walk(join(root, base));
  it("varre o código-fonte e não encontra seleção por posição", () => {
    expect(files.length).toBeGreaterThan(50);
    const bad = files.filter((f) => PATTERN.test(readFileSync(f, "utf8"))).map((f) => relative(root, f));
    expect(bad).toEqual([]);
  });
});
