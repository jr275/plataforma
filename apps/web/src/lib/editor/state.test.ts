import { describe, expect, it } from "vitest";
import { addNode, connect, contentSig, removeNode, setLayout, updateConfig, type OpResult, type PageDraft } from "@plataforma/api/src/draft";
import { HISTORY_LIMIT, initialState, isDirty, isStale, reduce, type Action, type EditorState } from "./state";
import { fixtureDraft } from "./test-fixture";

const EVAL = { validation: { issues: [], nodeValidity: {}, errors: 0, warnings: 0, valid: true, publication: { publishable: false as const, reasons: ["x"] } }, gates: { gates: [], ready: true, blockers: [] } };
const run = (s: EditorState, ...a: Action[]) => a.reduce(reduce, s);
const op = (r: OpResult): Action => ({ t: "op", result: r });
/** Aplica uma operação construída a partir do rascunho ATUAL (como o editor faz ao despachar). */
const step = (s: EditorState, f: (d: PageDraft) => OpResult): EditorState => reduce(s, op(f(s.draft)));
const start = () => initialState(fixtureDraft(), 0, EVAL);

describe("estado do editor: edição, desfazer/refazer e seleção", () => {
  it("operação válida entra no histórico, limpa o 'refazer' e marca como sujo; recusada só registra o aviso e não muda nada", () => {
    let s = start();
    expect(isDirty(s)).toBe(false);
    const d = s.draft;
    s = run(s, op(updateConfig(d, "page_section-1", { order: 7 })));
    expect(s.past).toHaveLength(1); expect(isDirty(s)).toBe(true); expect(s.notice).toBeNull();
    const before = s.draft;
    s = run(s, op(connect(s.draft, "opportunity-1", "page_section-1")));
    expect(s.draft).toBe(before);
    expect(s.notice).toContain("incompatível");
    expect(s.past).toHaveLength(1);
    s = run(s, op(updateConfig(s.draft, "page_section-1", { order: 8 })));
    expect(s.notice).toBeNull();
  });
  it("desfazer e refazer restauram o conteúdo (e só ele); posições ficam como estão; editar depois de desfazer descarta o futuro", () => {
    let s = start();
    s = step(s, (d) => updateConfig(d, "page_section-1", { order: 5 }));
    s = run(s, { t: "layout", layout: { "opportunity-1": { x: 9, y: 9 } } });
    s = step(s, (d) => updateConfig(d, "page_section-2", { order: 6 }));
    const after = s.draft;
    s = run(s, { t: "undo" });
    expect(s.draft.nodes.find((n) => n.id === "page_section-2")!.config.order).toBe(2);
    expect(s.draft.layout["opportunity-1"]).toEqual({ x: 9, y: 9 });
    s = run(s, { t: "undo" });
    expect(contentSig(s.draft)).toBe(contentSig(start().draft));
    expect(isDirty(s)).toBe(true); // a posição ainda difere do salvo
    s = run(s, { t: "redo" }, { t: "redo" });
    expect(contentSig(s.draft)).toBe(contentSig(after));
    s = run(s, { t: "undo" });
    s = step(s, (d) => updateConfig(d, "page_section-1", { order: 4 }));
    expect(s.future).toHaveLength(0);
    expect(run(start(), { t: "undo" }).past).toHaveLength(0); // nada a desfazer: não quebra
    expect(run(start(), { t: "redo" })).toEqual(start());
  });
  it("histórico tem limite", () => {
    let s = start();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) s = run(s, op(updateConfig(s.draft, "page_section-1", { order: (i % 90) + 2 })));
    expect(s.past.length).toBe(HISTORY_LIMIT);
  });
  it("adicionar seleciona o novo nó; remover limpa a seleção do nó removido; desfazer devolve o nó", () => {
    let s = start();
    s = run(s, op(addNode(s.draft, "internal_link", { path: "/cidades", text: "Todas" })));
    const id = s.selection.nodeId!;
    expect(id).toMatch(/^internal_link-/);
    s = run(s, op(removeNode(s.draft, id)));
    expect(s.selection.nodeId).toBeNull();
    s = run(s, { t: "undo" });
    expect(s.draft.nodes.some((n) => n.id === id)).toBe(true);
  });
  it("operação sem efeito (mesmo conteúdo) não suja nem entra no histórico", () => {
    const s0 = start();
    const s = run(s0, op(setLayout(s0.draft, {}) ? { ok: true, draft: s0.draft } : { ok: false, error: "x" }));
    expect(s.past).toHaveLength(0); expect(isDirty(s)).toBe(false);
  });
});

describe("invalidação e salvamento", () => {
  it("avaliação do servidor vale só para o conteúdo avaliado: qualquer edição a torna obsoleta (stale); reavaliar a atualiza", () => {
    let s = start();
    expect(isStale(s)).toBe(false);
    s = run(s, op(updateConfig(s.draft, "page_section-1", { order: 5 })));
    expect(isStale(s)).toBe(true);
    s = run(s, { t: "evaluated", sig: contentSig(s.draft), evaluation: EVAL });
    expect(isStale(s)).toBe(false);
    s = run(s, { t: "layout", layout: { "entity-1": { x: 1, y: 1 } } });
    expect(isStale(s)).toBe(false); // mover não invalida resultado nenhum
  });
  it("estados de salvamento: salvando → salvo (limpa o sujo, guarda a versão); erro e conflito mantêm o rascunho e o sujo; editar depois de salvo volta a 'idle'", () => {
    let s = start();
    s = run(s, op(updateConfig(s.draft, "page_section-1", { order: 5 })), { t: "saving" });
    expect(s.save.status).toBe("saving");
    s = run(s, { t: "save_failed", status: "conflict", message: "mudou" });
    expect(s.save).toEqual({ status: "conflict", message: "mudou" }); expect(isDirty(s)).toBe(true);
    s = run(s, { t: "save_failed", status: "error", message: "falha" });
    expect(s.save.status).toBe("error"); expect(isDirty(s)).toBe(true);
    s = run(s, { t: "saved", version: 1, draft: s.draft, evaluation: EVAL });
    expect(s).toMatchObject({ savedVersion: 1, save: { status: "saved" } }); expect(isDirty(s)).toBe(false); expect(isStale(s)).toBe(false);
    s = run(s, op(updateConfig(s.draft, "page_section-1", { order: 6 })));
    expect(s.save.status).toBe("idle"); expect(isDirty(s)).toBe(true);
  });
  it("recarregar substitui tudo pelo que o servidor devolveu (recuperação)", () => {
    const d: PageDraft = setLayout(fixtureDraft(), { "opportunity-1": { x: 3, y: 4 } });
    const s = run(start(), op(updateConfig(start().draft, "page_section-1", { order: 5 })), { t: "reload", draft: d, version: 4, evaluation: EVAL });
    expect(s.draft).toBe(d); expect(s.savedVersion).toBe(4); expect(s.past).toHaveLength(0); expect(isDirty(s)).toBe(false);
  });
});
