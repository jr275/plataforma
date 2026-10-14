import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parsePrompts, renderGenerated } from "./agent-prompts-parse";
import { AGENT_HEADER, AGENT_PROMPTS, AGENT_PROMPTS_SOURCE } from "./agent-prompts.generated";

const md = readFileSync(fileURLToPath(new URL("../prompts/02_prompts_agentes_runtime.md", import.meta.url)), "utf8");
describe("prompts dos agentes (arquivo 02_prompts_agentes_runtime.md)", () => {
  it("o TypeScript gerado está em dia com o arquivo (rode scripts/gen-agent-prompts.sh)", () => {
    expect(readFileSync(fileURLToPath(new URL("./agent-prompts.generated.ts", import.meta.url)), "utf8")).toBe(renderGenerated(parsePrompts(md)));
    expect(AGENT_PROMPTS_SOURCE.sha256).toBe(parsePrompts(md).sourceSha256);
  });
  it("8 agentes na ordem do arquivo, com o papel declarado", () => {
    expect(Object.values(AGENT_PROMPTS).map((a) => a.name)).toEqual(["Inventory Summarizer", "Topic Proposer", "Intent Modeler", "Combination Reviewer", "Eligibility Explainer", "Blueprint Writer", "Editorial", "QA Verifier"]);
    expect(AGENT_PROMPTS[5]!.purpose).toMatch(/Não pode alterar a decisão|não pode alterar/i);
  });
  it("as regras duras R1–R8 e o limite de papel estão no cabeçalho comum", () => {
    for (const t of ["R1 ", "R3 ", "R5 ", "NÃO decide elegibilidade", "DATA_PENDING", "Responda somente com JSON válido"]) expect(AGENT_HEADER).toContain(t);
  });
  it("as variáveis dos prompts são exatamente as que o orquestrador preenche", () => {
    const vars = new Set([...AGENT_HEADER.matchAll(/\{\{([A-Z0-9_]+)\}\}/g), ...Object.values(AGENT_PROMPTS).flatMap((a) => [...a.body.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)])].map((m) => m[1]));
    expect([...vars].sort()).toEqual(["ATTRIBUTE_CATALOG_JSON", "BLUEPRINT_DRAFT_JSON", "COMBINATION_GROUPS_JSON", "COMPILED_RECIPE_JSON", "DOMAIN_PACK", "EDITORIAL_STYLE", "ELIGIBILITY_DECISION_JSON", "ENTITY_CONTEXT_JSON", "MAX_PROPOSALS", "PAGE_QA_BUNDLE_JSON", "RICH_MIN", "SCOPE", "SCORE_BRAND", "TENANT_NAME", "TOPICS_AND_DEMAND_JSON"]);
  });
});
