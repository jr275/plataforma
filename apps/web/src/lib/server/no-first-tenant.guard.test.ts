import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guarda estática (F2): nenhum código de servidor do web escolhe o tenant "por posição". A única regra é activeTenantFor/pickTenant.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("o tenant nunca é escolhido por posição", () => {
  it("nenhum arquivo de apps/web/src usa tenantIds[0] nem tenantIds.at(", () => {
    const root = join(__dirname, "..", "..");
    const offenders = sources(root).filter((f) => /tenantIds\s*\[\s*0\s*\]|tenantIds\s*\.at\s*\(/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
