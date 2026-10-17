import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// TRAVA: um componente de cliente que alcança, direta ou INDIRETAMENTE, código (não tipo) de @plataforma/api arrasta o pacote inteiro,
// com o driver do banco (`pg`), para o navegador, e a tela quebra ("Can't resolve 'util/types'"). Os testes em Node não enxergam isso.
const SRC = join(__dirname, "..", "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}
const read = (f: string) => readFileSync(f, "utf8");
const isClient = (f: string) => /^\s*["']use client["']/.test(read(f));
const API = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']@plataforma\/api["']/g;

/** Nomes de execução importados da API por um arquivo (tipos ficam de fora; import padrão ou namespace conta como execução). */
export function runtimeApiImports(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(API)) if (!m[1]) out.push(...m[2]!.split(",").map((x) => x.trim()).filter((x) => x && !x.startsWith("type ")));
  if (/import\s+[^;{]*\s+from\s+["']@plataforma\/api["']/.test(src.replace(API, ""))) out.push("(import padrão ou namespace)");
  return out;
}

/** Arquivos locais importados (`@/...` ou relativos), sem os imports só de tipo. */
function localImports(f: string): string[] {
  const out: string[] = [];
  for (const m of read(f).matchAll(/(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/g)) {
    const spec = m[1]!;
    const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(f), spec) : null;
    if (!base) continue;
    const hit = [".ts", ".tsx", "/index.ts", "/index.tsx", ""].map((e) => base + e).find((c) => existsSync(c) && statSync(c).isFile());
    if (hit) out.push(hit);
  }
  return out;
}

/** Arquivos alcançáveis a partir de um componente de cliente que importam execução da API (cadeia incluída). */
export function clientLeaks(entry: string): string[] {
  const leaks: string[] = [];
  const seen = new Set<string>();
  const visit = (f: string, chain: string[]) => {
    if (seen.has(f)) return;
    seen.add(f);
    // Server actions ("use server") viram chamadas remotas: o navegador não recebe o conteúdo do arquivo, então a cadeia termina aqui.
    if (/^\s*["']use server["']/.test(read(f))) return;
    const names = runtimeApiImports(read(f));
    if (names.length > 0) leaks.push(`${[...chain, f].map((x) => x.split("/src/")[1]).join(" → ")}: ${names.join(", ")}`);
    for (const dep of localImports(f)) visit(dep, [...chain, f]);
  };
  visit(entry, []);
  return leaks;
}

describe("fronteira servidor/cliente", () => {
  const clientFiles = walk(SRC).filter(isClient);
  it("encontra os componentes de cliente (a trava não pode passar por não ter olhado nada)", () => {
    expect(clientFiles.length).toBeGreaterThan(5);
  });
  it("nenhum componente de cliente alcança, direta ou indiretamente, código de execução de @plataforma/api (só tipos)", () => {
    const offenders = clientFiles.flatMap((f) => clientLeaks(f));
    expect(offenders).toEqual([]);
  });
  it("o detector funciona: enxerga import de execução, ignora tipo e segue a cadeia", () => {
    expect(runtimeApiImports('import { toBlocks, type PageBlock } from "@plataforma/api";')).toEqual(["toBlocks"]);
    expect(runtimeApiImports('import type { PageBlock } from "@plataforma/api";')).toEqual([]);
    expect(runtimeApiImports('import * as api from "@plataforma/api";')).toEqual(["(import padrão ou namespace)"]);
    // o componente de servidor `SitePage` importa execução da API: se um cliente o alcançasse, o detector acusaria
    expect(clientLeaks(join(SRC, "components", "site", "site-page.tsx")).join(" ")).toContain("toBlocks");
  });
});
