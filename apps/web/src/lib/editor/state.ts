import { contentSig, sig, type OpResult, type PageDraft } from "@plataforma/api/src/draft";
import type { DraftEvaluationDTO } from "./types";

// Estado do editor (puro, sem React): rascunho em edição, histórico de desfazer/refazer, seleção, avaliação do servidor e estado de salvamento. O rascunho é o modelo de
// DOMÍNIO; o grafo é só uma projeção dele. Posições de nós NÃO entram no histórico de edição (arrastar não polui o desfazer).
export type SaveStatus = "idle" | "saving" | "saved" | "error" | "conflict";
export interface EditorState {
  readonly draft: PageDraft;
  /** Conteúdo gravado por último (ou o rascunho inicial ainda não salvo) e sua versão (0 = nada gravado). */
  readonly saved: PageDraft; readonly savedVersion: number;
  readonly past: readonly PageDraft[]; readonly future: readonly PageDraft[];
  readonly selection: { readonly nodeId: string | null; readonly edgeId: string | null };
  /** Último erro de operação recusada pelo modelo (ex.: conexão incompatível); some na próxima operação válida. */
  readonly notice: string | null;
  /** Avaliação vinda do SERVIDOR (validação + gates) e a assinatura do conteúdo a que ela se refere. */
  readonly evaluation: DraftEvaluationDTO | null; readonly evaluatedSig: string | null;
  readonly save: { readonly status: SaveStatus; readonly message: string | null };
}
export type Action =
  | { t: "op"; result: OpResult }
  | { t: "undo" } | { t: "redo" }
  | { t: "select"; nodeId?: string | null; edgeId?: string | null }
  | { t: "layout"; layout: PageDraft["layout"] }
  /** Layout inicial automático: vale também para o rascunho salvo (não conta como alteração a salvar). */
  | { t: "init_layout"; layout: PageDraft["layout"] }
  | { t: "evaluated"; sig: string; evaluation: DraftEvaluationDTO }
  | { t: "saving" }
  | { t: "saved"; version: number; draft: PageDraft; evaluation: DraftEvaluationDTO }
  | { t: "save_failed"; status: "error" | "conflict"; message: string }
  | { t: "reload"; draft: PageDraft; version: number; evaluation: DraftEvaluationDTO };
export const HISTORY_LIMIT = 100;

export function initialState(draft: PageDraft, version: number, evaluation: DraftEvaluationDTO | null): EditorState {
  return { draft, saved: draft, savedVersion: version, past: [], future: [], selection: { nodeId: null, edgeId: null }, notice: null, evaluation, evaluatedSig: evaluation ? contentSig(draft) : null, save: { status: version > 0 ? "saved" : "idle", message: null } };
}
const layoutSig = (d: PageDraft) => sig(d.layout);
/** Há algo a salvar (conteúdo OU posições). */
export const isDirty = (s: EditorState): boolean => contentSig(s.draft) !== contentSig(s.saved) || layoutSig(s.draft) !== layoutSig(s.saved);
/** O resultado de gates/validação do servidor ficou desatualizado por uma edição posterior. */
export const isStale = (s: EditorState): boolean => s.evaluatedSig !== contentSig(s.draft);

export function reduce(s: EditorState, a: Action): EditorState {
  switch (a.t) {
    case "op": {
      if (!a.result.ok) return { ...s, notice: a.result.error };
      const next = a.result.draft;
      if (contentSig(next) === contentSig(s.draft) && layoutSig(next) === layoutSig(s.draft)) return { ...s, notice: null };
      const selection = a.result.nodeId ? { nodeId: a.result.nodeId, edgeId: null } : { nodeId: s.selection.nodeId && next.nodes.some((n) => n.id === s.selection.nodeId) ? s.selection.nodeId : null, edgeId: s.selection.edgeId && next.edges.some((e) => e.id === s.selection.edgeId) ? s.selection.edgeId : null };
      return { ...s, draft: next, past: [...s.past, s.draft].slice(-HISTORY_LIMIT), future: [], selection, notice: null, save: s.save.status === "saved" ? { status: "idle", message: null } : s.save };
    }
    case "undo": { if (!s.past.length) return s; const prev = s.past[s.past.length - 1]!; return { ...s, draft: { ...prev, layout: s.draft.layout }, past: s.past.slice(0, -1), future: [s.draft, ...s.future], notice: null, selection: keep(s.selection, prev) }; }
    case "redo": { if (!s.future.length) return s; const nxt = s.future[0]!; return { ...s, draft: { ...nxt, layout: s.draft.layout }, past: [...s.past, s.draft], future: s.future.slice(1), notice: null, selection: keep(s.selection, nxt) }; }
    case "select": return { ...s, selection: { nodeId: a.nodeId ?? null, edgeId: a.edgeId ?? null } };
    case "layout": return { ...s, draft: { ...s.draft, layout: a.layout }, save: s.save.status === "saved" ? { status: "idle", message: null } : s.save };
    case "init_layout": return { ...s, draft: { ...s.draft, layout: a.layout }, saved: { ...s.saved, layout: a.layout } };
    case "evaluated": return { ...s, evaluation: a.evaluation, evaluatedSig: a.sig };
    case "saving": return { ...s, save: { status: "saving", message: null } };
    case "saved": return { ...s, saved: a.draft, savedVersion: a.version, evaluation: a.evaluation, evaluatedSig: contentSig(a.draft), save: { status: "saved", message: `versão ${a.version} salva` } };
    case "save_failed": return { ...s, save: { status: a.status, message: a.message } };
    case "reload": return initialState(a.draft, a.version, a.evaluation);
  }
}
const keep = (sel: EditorState["selection"], d: PageDraft) => ({ nodeId: sel.nodeId && d.nodes.some((n) => n.id === sel.nodeId) ? sel.nodeId : null, edgeId: sel.edgeId && d.edges.some((e) => e.id === sel.edgeId) ? sel.edgeId : null });
