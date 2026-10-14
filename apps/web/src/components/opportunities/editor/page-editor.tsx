"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { Loader2, Redo2, Save, Undo2, Workflow, CheckCheck, Maximize2 } from "lucide-react";
import { CONTRACTS, connect, contentSig, diffDrafts, disconnect, draftToBlueprint, executionStates, removeNode, validateDraft, type Change, type DraftContext, type PageDraft } from "@plataforma/api/src/draft";
import type { Blueprint } from "@plataforma/api/src/engine/blueprint";
import type { DraftPreview } from "@plataforma/api";
import { Button } from "@/components/ui/button";
import { Frame } from "@/components/ui/frame";
import { inputClass } from "@/components/ui/field";
import { Tabs } from "@/components/ui/tabs";
import { ADDABLE, addWired, defaultConfigFor } from "@/lib/editor/defaults";
import { autoLayout } from "@/lib/editor/elk";
import { needsLayout, toGraph } from "@/lib/editor/graph-adapter";
import { initialState, isDirty, isStale, reduce, type Action, type EditorState } from "@/lib/editor/state";
import type { ActionResult, DraftEvaluationDTO } from "@/lib/editor/types";
import { EditorCanvas } from "./editor-canvas";
import { Inspector } from "./inspector";
import { HistoryPanel, IssuesPanel, NodeList, PreviewPane } from "./panels";
import { DIRTY_LABEL, SAVE_LABEL } from "./status";

export interface HistoryVersion { readonly version: number; readonly createdAt: Date | string; readonly createdBy: string; readonly valid: boolean; readonly errors: number; readonly warnings: number; readonly changes: readonly Change[]; readonly note: string | null }
export interface EditorActions {
  save(input: { opportunityId: string; draft: unknown; baseVersion: number; note?: string }): Promise<ActionResult<{ version: number; created: boolean; evaluation: DraftEvaluationDTO }>>;
  evaluate(input: { opportunityId: string; draft: unknown }): Promise<ActionResult<DraftEvaluationDTO>>;
  preview(input: { opportunityId: string; draft: unknown }): Promise<ActionResult<DraftPreview | null>>;
}
export interface PageEditorProps {
  opportunityId: string; ctx: DraftContext; base: Blueprint; actions: EditorActions;
  initial: { draft: PageDraft; version: number; evaluation: DraftEvaluationDTO; versions: readonly HistoryVersion[] };
  /** "dev": bancada de desenvolvimento (banco descartável, sem login). */
  harness?: "dev";
}
type Tab = "issues" | "list" | "preview" | "history";

export function PageEditor(props: PageEditorProps) {
  return <ReactFlowProvider><EditorInner {...props} /></ReactFlowProvider>;
}

function EditorInner({ opportunityId, ctx, base, actions, initial, harness }: PageEditorProps) {
  const [state, dispatch] = useReducer(reduce, undefined, () => initialState(initial.draft, initial.version, initial.evaluation));
  const ref = useRef<EditorState>(state);
  useEffect(() => { ref.current = state; });
  const rf = useReactFlow();
  const [tab, setTab] = useState<Tab>("issues");
  const [splitPreview, setSplitPreview] = useState(false);
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [fit, setFit] = useState(0);
  const [versions, setVersions] = useState<readonly HistoryVersion[]>(initial.versions);
  const [addType, setAddType] = useState<string>(ADDABLE[0] ?? "");
  const [busy, setBusy] = useState<null | "validate" | "preview" | "layout">(null);
  const [preview, setPreview] = useState<{ sig: string; data: DraftPreview | null } | undefined>(undefined);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [validateMsg, setValidateMsg] = useState<string | null>(null);

  const apply = useCallback((f: (d: PageDraft) => ReturnType<typeof connect>) => dispatch({ t: "op", result: f(ref.current.draft) } as Action), []);
  const validation = useMemo(() => validateDraft(state.draft, ctx), [state.draft, ctx]);
  const stale = isStale(state);
  const report = state.evaluation?.gates ?? null;
  const bp = useMemo(() => draftToBlueprint(state.draft, base, ctx), [state.draft, base, ctx]);
  const exec = useMemo(() => executionStates(state.draft, ctx, bp, report, stale), [state.draft, ctx, bp, report, stale]);
  const graph = useMemo(() => toGraph(state.draft, ctx, base, report, stale, validation), [state.draft, ctx, base, report, stale, validation]);
  const dirty = isDirty(state);
  const sig = contentSig(state.draft);

  // Layout automático SÓ na primeira abertura, para nós sem posição (nunca sobrescreve posições existentes).
  const [first] = useState(initial.draft);
  useEffect(() => { if (needsLayout(first)) void autoLayout(first).then((l) => { dispatch({ t: "init_layout", layout: { ...l, ...ref.current.draft.layout } }); setFit((n) => n + 1); }).catch(() => undefined); }, [first]);
  // Nós novos sem posição ficam abaixo do conjunto atual (provisório visível), sem mexer nos demais.
  useEffect(() => { const d = state.draft; const missing = d.nodes.filter((n) => !d.layout[n.id]); if (!missing.length || needsLayout(initial.draft) && Object.keys(d.layout).length === 0) return; const maxY = Math.max(0, ...Object.values(d.layout).map((p) => p.y)); dispatch({ t: "layout", layout: { ...d.layout, ...Object.fromEntries(missing.map((n, i) => [n.id, { x: 40 + i * 24, y: maxY + 110 + i * 24 }])) } }); }, [state.draft, initial.draft]);
  useEffect(() => { const h = (e: BeforeUnloadEvent) => { if (isDirty(ref.current)) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h); }, []);

  const save = async () => {
    const s = ref.current; dispatch({ t: "saving" });
    try {
      const r = await actions.save({ opportunityId, draft: s.draft, baseVersion: s.savedVersion });
      if (!r.ok) { dispatch({ t: "save_failed", status: r.kind === "conflict" ? "conflict" : "error", message: r.message }); return; }
      dispatch({ t: "saved", version: r.data.version, draft: s.draft, evaluation: r.data.evaluation });
      if (r.data.created) setVersions((v) => [{ version: r.data.version, createdAt: new Date(), createdBy: "você", valid: r.data.evaluation.validation.valid, errors: r.data.evaluation.validation.errors, warnings: r.data.evaluation.validation.warnings, changes: diffDrafts(s.saved, s.draft), note: null }, ...v]);
    } catch { dispatch({ t: "save_failed", status: "error", message: "Falha de rede ao salvar. O rascunho continua na tela; tente de novo." }); }
  };
  const validate = async () => {
    const s = ref.current; setBusy("validate"); setValidateMsg(null);
    try { const r = await actions.evaluate({ opportunityId, draft: s.draft }); if (r.ok) { dispatch({ t: "evaluated", sig: contentSig(s.draft), evaluation: r.data }); setTab("issues"); } else setValidateMsg(r.message); } catch { setValidateMsg("Falha de rede ao validar."); } finally { setBusy(null); }
  };
  const refreshPreview = async () => {
    const s = ref.current; setBusy("preview"); setPreviewError(null);
    try { const r = await actions.preview({ opportunityId, draft: s.draft }); if (r.ok) setPreview({ sig: contentSig(s.draft), data: r.data }); else setPreviewError(r.message); } catch { setPreviewError("Falha de rede ao renderizar a prévia."); } finally { setBusy(null); }
  };
  const organize = async () => { setBusy("layout"); try { const l = await autoLayout(ref.current.draft); dispatch({ t: "layout", layout: l }); setFit((n) => n + 1); } finally { setBusy(null); } };
  const add = () => { const t = addType as (typeof ADDABLE)[number]; dispatch({ t: "op", result: addWired(ref.current.draft, t, ctx) }); };
  const addDisabled = !addType || !defaultConfigFor(addType as never, state.draft, ctx).ok;
  const addReason = addType ? (() => { const r = defaultConfigFor(addType as never, state.draft, ctx); return r.ok ? null : r.reason; })() : null;

  const sel = state.selection;
  const issuesTab = (
    <IssuesPanel issues={[...validation.issues, ...(state.evaluation?.validation.issues.filter((i) => i.code === "base_outdated") ?? [])]} stale={stale} evaluatedAt={state.evaluation ? "server" : "never"} errors={validation.errors} warnings={validation.warnings} onFocus={(id) => { dispatch({ t: "select", nodeId: id }); const n = rf.getNode(id); if (n) void rf.setCenter(n.position.x + 110, n.position.y + 40, { zoom: 1, duration: 250 }); }} />
  );
  const tabs: readonly { id: Tab; label: string; count?: number }[] = [{ id: "issues", label: "Validação", count: validation.errors + validation.warnings }, { id: "list", label: "Lista de nós", count: state.draft.nodes.length }, { id: "preview", label: "Prévia" }, { id: "history", label: "Histórico", count: versions.length }];
  const tb = "inline-flex min-h-10 rounded-md items-center gap-1.5 border border-border bg-card px-2.5 text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="space-y-4" data-testid="page-editor" data-harness={harness ?? "app"}>
      <Frame fig="3" caption="editor visual da experiência da página" bodyClassName="p-0">
        <div role="toolbar" aria-label="Ações do editor" className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <button type="button" className={tb} onClick={() => dispatch({ t: "undo" })} disabled={!state.past.length} aria-label="Desfazer"><Undo2 className="size-3.5" aria-hidden="true" />Desfazer</button>
          <button type="button" className={tb} onClick={() => dispatch({ t: "redo" })} disabled={!state.future.length} aria-label="Refazer"><Redo2 className="size-3.5" aria-hidden="true" />Refazer</button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <label className="sr-only" htmlFor="add-type">Tipo de nó a adicionar</label>
          <select id="add-type" value={addType} onChange={(e) => setAddType(e.target.value)} className={`${inputClass} !h-8 !w-auto`}>{ADDABLE.map((t) => (<option key={t} value={t}>{CONTRACTS[t].label}</option>))}</select>
          <button type="button" className={tb} onClick={add} disabled={addDisabled} title={addReason ?? undefined}>Adicionar nó</button>
          <button type="button" className={tb} onClick={() => void organize()} disabled={busy === "layout"}><Workflow className="size-3.5" aria-hidden="true" />Organizar (ELK)</button>
          <button type="button" className={tb} onClick={() => setFit((n) => n + 1)}><Maximize2 className="size-3.5" aria-hidden="true" />Ajustar à tela</button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <button type="button" className={tb} onClick={() => void validate()} disabled={busy === "validate"} aria-busy={busy === "validate"}>{busy === "validate" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <CheckCheck className="size-3.5" aria-hidden="true" />}Validar no servidor</button>
          <Button type="button" onClick={() => void save()} disabled={!dirty || state.save.status === "saving"} aria-busy={state.save.status === "saving"}>{state.save.status === "saving" ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <Save data-icon="inline-start" aria-hidden="true" />}Salvar rascunho</Button>
          <button type="button" className={tb} aria-pressed={splitPreview} onClick={() => { setSplitPreview((open) => !open); if (!splitPreview && preview === undefined) void refreshPreview(); }}>Editor + prévia</button>
          <span role="status" aria-live="polite" data-testid="save-status" data-status={state.save.status} data-dirty={dirty} className={`ml-auto font-mono text-[10.5px] tracking-wide uppercase ${state.save.status === "error" || state.save.status === "conflict" ? "text-destructive" : "text-muted-foreground"}`}>{dirty && state.save.status !== "saving" && state.save.status !== "error" && state.save.status !== "conflict" ? DIRTY_LABEL : SAVE_LABEL[state.save.status]}{state.savedVersion > 0 ? ` · v${state.savedVersion}` : " · sem versão salva"}</span>
        </div>
        {state.notice ? <p role="alert" data-testid="notice" className="border-b border-border bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{state.notice}</p> : null}
        {validateMsg ? <p role="alert" className="border-b border-border bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{validateMsg}</p> : null}
        {state.save.message && (state.save.status === "error" || state.save.status === "conflict") ? <p role="alert" data-testid="save-error" className="border-b border-border bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{state.save.message}{state.save.status === "conflict" ? <> <button type="button" onClick={() => window.location.reload()} className="underline underline-offset-2">Recarregar</button></> : null}</p> : null}
        <div className={`grid ${splitPreview ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1fr)_22rem]"}`}>
          <div className="h-[26rem] border-b border-border lg:h-[38rem] lg:border-r lg:border-b-0" data-testid="editor-canvas" aria-label="Canvas do editor. Use a Lista de nós para navegar por teclado."><EditorCanvas graph={graph} draft={state.draft} selectedNode={sel.nodeId} selectedEdge={sel.edgeId} fitSignal={fit}
            onSelect={(s) => dispatch({ t: "select", ...s })} onConnect={(a, b) => apply((d) => connect(d, a, b))} onDeleteNodes={(ids) => { for (const id of ids) apply((d) => removeNode(d, id)); }} onDeleteEdges={(ids) => { for (const id of ids) apply((d) => disconnect(d, id)); }}
            onMove={(pos) => dispatch({ t: "layout", layout: { ...ref.current.draft.layout, ...pos } })} /></div>
          {splitPreview ? <aside aria-label="Prévia ao lado do editor" className="min-w-0 max-h-[38rem] overflow-y-auto bg-muted/20 p-3"><div role="group" aria-label="Largura da prévia" className="mb-3 flex gap-2">{(["desktop", "mobile"] as const).map((v) => <button key={v} type="button" className={tb} aria-pressed={viewport === v} onClick={() => setViewport(v)}>{v === "desktop" ? "Desktop" : "Mobile · 375 px"}</button>)}</div><div className={`mx-auto transition-[max-width] ${viewport === "mobile" ? "max-w-[375px]" : "max-w-full"}`}><PreviewPane preview={preview?.data} stale={preview !== undefined && preview.sig !== sig} pending={busy === "preview"} error={previewError} onRefresh={() => void refreshPreview()} /></div></aside> : null}
          <aside aria-label="Inspector" className={`max-h-[38rem] overflow-y-auto p-3 ${splitPreview ? "border-t border-border xl:col-span-2" : ""}`}><Inspector key={sel.nodeId ?? sel.edgeId ?? "none"} draft={state.draft} ctx={ctx} base={bp} nodeId={sel.nodeId} edgeId={sel.edgeId} exec={exec} issues={validation.issues} apply={apply} onSelect={(id) => dispatch({ t: "select", nodeId: id })} /></aside>
        </div>
      </Frame>
      <p className="text-xs text-muted-foreground">Editar o rascunho <strong>não gera, não indexa e não publica</strong> nenhuma página. Alterar um nó invalida os resultados dos gates até a próxima validação no servidor. A publicação segue bloqueada: {validation.publication.reasons.join("; ")}.{harness === "dev" ? " (Bancada de desenvolvimento: banco descartável, sem login.)" : ""}</p>
      <Tabs label="Painéis do editor" tabs={tabs} value={tab} onChange={setTab} />
      <div id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="border border-border bg-card p-4">
        {tab === "issues" ? issuesTab : tab === "list" ? <NodeList draft={state.draft} exec={exec} validity={validation.nodeValidity} selected={sel.nodeId} onSelect={(id) => dispatch({ t: "select", nodeId: id })} onRemoveEdge={(id) => apply((d) => disconnect(d, id))} />
          : tab === "preview" ? <PreviewPane preview={preview?.data} stale={preview !== undefined && preview.sig !== sig} pending={busy === "preview"} error={previewError} onRefresh={() => void refreshPreview()} />
          : <HistoryPanel versions={versions} />}
      </div>
    </div>
  );
}
