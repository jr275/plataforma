import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENGINE_PROGRESS, renderProgressMarkdown } from "./progress";

describe("registro de andamento", () => {
  it("'verificado' exige evidência e 'verificado' exige 'implementado'", () => {
    for (const i of ENGINE_PROGRESS) { if (i.verified) { expect(i.evidence, i.id).toBeTruthy(); expect(i.implemented, i.id).toBe(true); } if (!i.verified) expect(i.evidence, i.id).toBeNull(); }
  });
  it("ids únicos e incrementos válidos", () => {
    expect(new Set(ENGINE_PROGRESS.map((i) => i.id)).size).toBe(ENGINE_PROGRESS.length);
    for (const i of ENGINE_PROGRESS) expect(i.increment).toBeGreaterThanOrEqual(1);
  });
  it("o documento do repositório está em dia com o registro (rode scripts/render-progress.sh)", () => {
    const doc = readFileSync(fileURLToPath(new URL("../../../../docs/product/ENGINE_PROGRESS.md", import.meta.url)), "utf8");
    expect(doc).toBe(renderProgressMarkdown(ENGINE_PROGRESS));
  });
});
