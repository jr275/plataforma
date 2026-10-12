import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// TESTE ESTÁTICO (lê o texto do código-fonte; não executa nada nem fala com o banco). Impõe a regra do ADR-013:
// só packages/api/src/tenant-context.ts define o contexto de tenant, e só com is_local = true; só os autenticadores
// criam uma VerifiedIdentity. NÃO prova isolamento: prova que nenhum outro arquivo do repositório tenta estabelecê-lo.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CONTEXT_FILE = "packages/api/src/tenant-context.ts";
const IDENTITY_FILES = new Set(["packages/api/src/identity.ts", "packages/api/src/dev-identity.ts"]);

const CONTEXT_PATTERNS: RegExp[] = [
  /set_config/i,
  /\bapp\.tenant_id\b/i,
  /\bset\s+(?:local\s+|session\s+)?app\./i,
  /\breset\s+app\./i,
];
const IDENTITY_PATTERN = /\bverifiedIdentity\s*\(/;

function violations(text: string, file: string): string[] {
  const found: string[] = [];
  if (file !== CONTEXT_FILE) for (const p of CONTEXT_PATTERNS) if (p.test(text)) found.push(`${file}: ${p}`);
  if (!IDENTITY_FILES.has(file) && IDENTITY_PATTERN.test(text)) found.push(`${file}: ${IDENTITY_PATTERN}`);
  return found;
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next" || name === ".turbo") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) && !/\.(test|spec)\.[a-z]+$/.test(name)) out.push(full);
    }
  };
  for (const group of ["packages", "apps"]) {
    for (const pkg of readdirSync(join(repoRoot, group))) {
      const src = join(repoRoot, group, pkg, "src");
      try {
        if (statSync(src).isDirectory()) walk(src);
      } catch {
        // pacote sem src
      }
    }
  }
  return out;
}

describe("guarda estática do contexto de tenant", () => {
  it("controle positivo: o detector acusa cada forma proibida (senão o teste seria vazio)", () => {
    expect(violations("SELECT set_config('app.tenant_id', 'x', false)", "apps/web/src/a.ts").length).toBeGreaterThan(0);
    expect(violations("await db.query('SET LOCAL app.tenant_id = 1')", "apps/web/src/a.ts").length).toBeGreaterThan(0);
    expect(violations("SET app.tenant_id = '1'", "apps/web/src/a.ts").length).toBeGreaterThan(0);
    expect(violations("RESET app.tenant_id", "apps/web/src/a.ts").length).toBeGreaterThan(0);
    expect(violations("verifiedIdentity({ userId: 'u', tenantIds: [] })", "apps/web/src/a.ts").length).toBeGreaterThan(0);
    expect(violations("const x = 1", "apps/web/src/a.ts")).toEqual([]);
  });

  it("encontra arquivos para varrer", () => {
    const files = sourceFiles().map((f) => relative(repoRoot, f));
    expect(files).toContain(CONTEXT_FILE);
    expect(files.length).toBeGreaterThan(5);
  });

  it("nenhum outro arquivo de packages/*/src ou apps/*/src define o contexto de tenant nem cria identidades", () => {
    const all = sourceFiles().flatMap((f) => violations(readFileSync(f, "utf8"), relative(repoRoot, f)));
    expect(all).toEqual([]);
  });

  it("o ponto único usa exatamente uma chamada, sempre com is_local = true", () => {
    const text = readFileSync(join(repoRoot, CONTEXT_FILE), "utf8");
    const calls = text.match(/set_config\s*\(/gi) ?? [];
    expect(calls.length).toBe(1);
    expect(text).toMatch(/set_config\('app\.tenant_id', \$1, true\)/);
    expect(text).not.toMatch(/\bset\s+(?:local\s+|session\s+)?app\./i);
  });
});
