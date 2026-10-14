import { describe, expect, it } from "vitest";
import { validateDraft, CONTRACTS } from "@plataforma/api/src/draft";
import { ADDABLE, addWired, defaultConfigFor } from "./defaults";
import { fixtureDraft, testCtx } from "./test-fixture";

describe("o que pode ser adicionado e com qual configuração inicial", () => {
  it("só tipos addable e não singleton; fixos nunca aparecem", () => {
    expect([...ADDABLE].sort()).toEqual(["data_source", "evidence_requirement", "internal_link", "page_section", "structured_data"]);
    for (const t of ["opportunity", "page_template", "quality_gate", "publication", "seo_metadata", "entity", "search_intent"] as const) expect(ADDABLE).not.toContain(t);
    expect(CONTRACTS.page_template.addable).toBe(true); // singleton: tem de ser trocado, não adicionado
  });
  it("configuração inicial é sempre válida pelo contrato (a disponibilidade da fonte é outra verificação) e vem do contexto real; sem opção livre, explica por quê", () => {
    const c = testCtx(); const d = fixtureDraft();
    expect(defaultConfigFor("page_section", d, c)).toMatchObject({ ok: false, reason: expect.stringContaining("seções do template já estão") });
    expect(defaultConfigFor("structured_data", d, c)).toMatchObject({ ok: false });
    expect(defaultConfigFor("data_source", d, c)).toMatchObject({ ok: true, config: { source: "bcb-sgs" } }); // city_import já está no rascunho
    expect(defaultConfigFor("evidence_requirement", d, c)).toMatchObject({ ok: true, config: { requirementId: "inventory" } });
    for (const t of ["data_source", "evidence_requirement", "internal_link"] as const) {
      const r = addWired(d, t, c); if (!r.ok) throw new Error(r.error);
      expect(validateDraft(r.draft, c).issues.filter((i) => i.severity === "error" && i.nodeId === r.nodeId && i.code !== "requirement_unmet"), t).toEqual([]);
    }
  });
  it("seção nova segue a ordem e usa a seção livre do template; sem template, não adiciona", () => {
    const c = testCtx(); let d = fixtureDraft();
    d = { ...d, nodes: d.nodes.filter((n) => n.id !== "page_section-2"), edges: d.edges.filter((e) => !e.id.includes("page_section-2")) };
    expect(defaultConfigFor("page_section", d, c)).toEqual({ ok: true, config: { sectionId: "population", order: 2, enabled: true, onMissing: "omit" } });
    const noT = { ...d, nodes: d.nodes.map((n) => (n.type === "page_template" ? { ...n, config: { templateKey: "" } } : n)) };
    expect(defaultConfigFor("page_section", noT, c)).toMatchObject({ ok: false, reason: expect.stringContaining("template") });
  });
  it("adicionar já faz as ligações obrigatórias ao template (seção, link e dados estruturados); sem opção livre, recusa com o motivo", () => {
    const c = testCtx(); const d = fixtureDraft();
    const r = addWired(d, "internal_link", c); if (!r.ok) throw new Error(r.error);
    expect(r.draft.edges.some((e) => e.id === `page_template-1>${r.nodeId}`)).toBe(true);
    expect(addWired(d, "page_section", c)).toMatchObject({ ok: false });
    expect(addWired(d, "publication", c)).toMatchObject({ ok: false });
  });
});
