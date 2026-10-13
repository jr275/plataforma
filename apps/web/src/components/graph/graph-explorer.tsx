"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { CircleAlert, Filter, Maximize, Minus, Plus, RotateCcw, Route, Search, X } from "lucide-react";
import { useAppState } from "@/components/app-state";
import type { Claim } from "@/lib/agent/ag-ui";
import { detectIntent, type AgentIntent } from "@/lib/agent/mock-graph-agent";
import { densify, graphFromWorkspace } from "@/lib/graph/from-workspace";
import { computeLayout, type Point } from "@/lib/graph/layout";
import { KIND_META, type GraphEdge, type HistoryEntry, type KnowledgeGraph } from "@/lib/graph/model";
import { filterGraph, indexGraph, neighbors, searchNodes, shortestPath, type GraphFilters } from "@/lib/graph/query";
import { cn } from "@/lib/utils";
import { AgentPanel } from "./agent-panel";
import { GraphCanvas, type CanvasHandle, type LabelMode } from "./graph-canvas";
import { activeFilterCount, allFilters, GraphFilterRail, GraphLegend } from "./graph-filters";
import { GraphInspector, type Selection } from "./graph-inspector";
import { GlyphIcon } from "./node-glyph";
import { Pill, Segmented, ToolButton } from "./primitives";
import { useAgentRun, type Decision } from "./use-agent-run";

type Scenario = "normal" | "dense" | "loading" | "empty" | "error";
type Layer = "domain" | "evidence" | "all";
type Highlight = { nodeIds: string[]; edgeIds: string[] } | null;

const CONTROLS = [
  { id: "in", label: "Aproximar", icon: Plus },
  { id: "out", label: "Afastar", icon: Minus },
  { id: "fit", label: "Enquadrar tudo", icon: Maximize },
  { id: "reset", label: "Recolher expansões", icon: RotateCcw },
] as const;

const LAYER_KINDS: Record<Layer, (k: keyof typeof KIND_META) => boolean> = {
  domain: (k) => KIND_META[k].layer === "domain",
  evidence: (k) => KIND_META[k].layer !== "output",
  all: () => true,
};

export function GraphExplorer() {
  const { current } = useAppState();
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [filters, setFilters] = useState<GraphFilters>(allFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [layer, setLayer] = useState<Layer>("evidence");
  const [focusDepth, setFocusDepth] = useState<"0" | "1" | "2">("0");
  const [labelMode, setLabelMode] = useState<LabelMode>("auto");
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const [selection, setSelection] = useState<Selection>(null);
  const [pathMode, setPathMode] = useState(false);
  const [path, setPath] = useState<{ from: string; to: string; nodeIds: string[]; edgeIds: string[] } | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Highlight>(null);
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<"inspector" | "agent">("inspector");
  const [edgeOverrides, setEdgeOverrides] = useState<Record<string, Partial<GraphEdge>>>({});
  const [sessionNotes, setSessionNotes] = useState<Record<string, HistoryEntry[]>>({});
  const canvas = useRef<CanvasHandle>(null);
  const [layoutCache] = useState(() => new Map<string, Point>());

  // Grafo base + alterações aprovadas nesta sessão (apenas em memória, nunca persistidas).
  const graph: KnowledgeGraph = useMemo(() => {
    const base = graphFromWorkspace(current);
    const g = scenario === "dense" ? densify(base) : base;
    return { ...g, edges: g.edges.map((e) => (edgeOverrides[e.id] ? { ...e, ...edgeOverrides[e.id] } : e)) };
  }, [current, scenario, edgeOverrides]);
  const index = useMemo(() => indexGraph(graph), [graph]);

  const selectedNodeId = selection?.type === "node" ? selection.id : undefined;
  const effectiveLayer: Layer = scenario === "dense" && layer === "evidence" ? "domain" : layer;

  const visible = useMemo(() => {
    const filtered = filterGraph(graph, filters);
    const forced = new Set<string>([...revealed, ...(highlight?.nodeIds ?? []), ...(path?.nodeIds ?? []), ...(selectedNodeId ? [selectedNodeId] : [])]);
    let nodes = filtered.nodes.filter((n) => LAYER_KINDS[effectiveLayer](n.kind) || forced.has(n.id));
    if (focusDepth !== "0" && selectedNodeId) {
      const keep = new Set([selectedNodeId]);
      let frontier = [selectedNodeId];
      for (let d = 0; d < Number(focusDepth); d++) {
        frontier = frontier.flatMap((id) => neighbors(index, id)).filter((id) => !keep.has(id));
        frontier.forEach((id) => keep.add(id));
      }
      nodes = filtered.nodes.filter((n) => keep.has(n.id));
    }
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: filtered.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
  }, [graph, filters, effectiveLayer, revealed, highlight, path, selectedNodeId, focusDepth, index]);

  const positions = useMemo(() => {
    const next = computeLayout(visible.nodes, visible.edges, layoutCache);
    next.forEach((p, id) => layoutCache.set(id, p));
    return next;
  }, [visible, layoutCache]);

  const emphasis = useMemo(() => {
    if (highlight) return { nodeIds: new Set(highlight.nodeIds), edgeIds: new Set(highlight.edgeIds) };
    if (path) return { nodeIds: new Set(path.nodeIds), edgeIds: new Set(path.edgeIds) };
    if (selection?.type === "node") {
      const inc = index.incident.get(selection.id) ?? [];
      return { nodeIds: new Set([selection.id, ...neighbors(index, selection.id)]), edgeIds: new Set(inc.map((e) => e.id)) };
    }
    if (selection?.type === "edge") {
      const e = index.edgeById.get(selection.id);
      return e ? { nodeIds: new Set([e.source, e.target]), edgeIds: new Set([e.id]) } : null;
    }
    return null;
  }, [highlight, path, selection, index]);
  const flowEdgeIds = useMemo(() => new Set([...(highlight?.edgeIds ?? []), ...(path?.edgeIds ?? [])]), [highlight, path]);

  const agent = useAgentRun(setHighlight);

  const tracePath = useCallback(
    (from: string, to: string) => {
      const found = shortestPath(index, from, to);
      setPathMode(false);
      if (!found) {
        setPath(null);
        setPathError(`Não há caminho entre ${index.byId.get(from)?.label} e ${index.byId.get(to)?.label} no grafo atual.`);
        return;
      }
      setPathError(null);
      setHighlight(null);
      setPath({ from, to, ...found });
      setSelection({ type: "node", id: to });
    },
    [index],
  );

  const selectNode = useCallback(
    (id: string, shift = false) => {
      if ((pathMode || shift) && selectedNodeId && selectedNodeId !== id) return tracePath(selectedNodeId, id);
      setSelection({ type: "node", id });
      setPanel("inspector");
      if (!path?.nodeIds.includes(id)) setPath(null);
      setHighlight(null);
      setPathError(null);
    },
    [pathMode, selectedNodeId, tracePath, path],
  );

  const selectAndCenter = useCallback((id: string) => {
    if (!visible.nodes.some((n) => n.id === id)) setRevealed((r) => new Set([...r, id]));
    selectNode(id);
    requestAnimationFrame(() => canvas.current?.centerOn(id));
  }, [selectNode, visible.nodes]);

  const expand = useCallback((id: string) => {
    setRevealed((r) => new Set([...r, id, ...neighbors(index, id)]));
  }, [index]);

  const clearAll = () => {
    setSelection(null);
    setPath(null);
    setHighlight(null);
    setPathMode(false);
    setPathError(null);
  };

  const runAgent = (prompt: string, intent?: AgentIntent) => {
    setPanel("agent");
    const resolved = intent ?? detectIntent(prompt);
    const subject = selectedNodeId ? index.byId.get(selectedNodeId) : undefined;
    void agent.run(
      { prompt, intent: resolved, graph, selectedId: selectedNodeId, pathEnds: path ? [path.from, path.to] : undefined },
      resolved === "path" && path ? `${index.byId.get(path.from)?.label} → ${index.byId.get(path.to)?.label}` : subject?.label,
    );
  };

  function runControl(id: (typeof CONTROLS)[number]["id"]) {
    if (id === "in") canvas.current?.zoomBy(1.25);
    else if (id === "out") canvas.current?.zoomBy(0.8);
    else if (id === "fit") canvas.current?.fit();
    else { setRevealed(new Set()); clearAll(); }
  }

  const decide = (turnId: string, decision: Decision) => {
    if (decision === "pending") return;
    const turn = agent.turns.find((t) => t.id === turnId);
    agent.decide(turnId, decision);
    if (decision !== "approved" || !turn?.proposal) return;
    const change = turn.proposal.change;
    const note: HistoryEntry = { when: "agora (sessão)", actor: "Você · aprovação", text: "" };
    if (change.kind === "verify_edge") {
      setEdgeOverrides((o) => ({ ...o, [change.edgeId]: { verification: "verified", provenance: "curation" } }));
      const e = index.edgeById.get(change.edgeId);
      if (e) for (const id of [e.source, e.target]) setSessionNotes((s) => ({ ...s, [id]: [{ ...note, text: "Relação marcada como verificada por curadoria (somente nesta sessão)." }, ...(s[id] ?? [])] }));
    } else {
      setSessionNotes((s) => ({ ...s, [change.nodeId]: [{ ...note, text: "Revalidação solicitada (somente nesta sessão; nenhuma tarefa foi criada no backend)." }, ...(s[change.nodeId] ?? [])] }));
    }
  };

  const focusClaim = (c: Claim) => {
    const nodeIds = [...new Set([...c.nodeIds, ...c.edgeIds.flatMap((id) => { const e = index.edgeById.get(id); return e ? [e.source, e.target] : []; }), ...(selectedNodeId ? [selectedNodeId] : [])])];
    setHighlight({ nodeIds, edgeIds: [...c.edgeIds] });
    if (c.nodeIds[0]) requestAnimationFrame(() => canvas.current?.centerOn(c.nodeIds[0]));
  };

  const counts = useMemo(() => {
    const kinds: Record<string, number> = {};
    const relations: Record<string, number> = {};
    graph.nodes.forEach((n) => (kinds[n.kind] = (kinds[n.kind] ?? 0) + 1));
    graph.edges.forEach((e) => (relations[e.type] = (relations[e.type] ?? 0) + 1));
    return { kinds, relations };
  }, [graph]);

  const results = useMemo(() => searchNodes(graph, query), [graph, query]);
  const nFilters = activeFilterCount(filters);
  const contextLabel = selectedNodeId ? index.byId.get(selectedNodeId)?.label : undefined;

  const inspector = (
    <GraphInspector
      index={index}
      selection={selection}
      sessionNotes={sessionNotes}
      path={path}
      pathMode={pathMode}
      onSelectNode={selectAndCenter}
      onSelectEdge={(id) => setSelection({ type: "edge", id })}
      onExpand={expand}
      onCenter={(id) => canvas.current?.centerOn(id)}
      onTracePath={() => setPathMode((m) => !m)}
      onAsk={() => runAgent(`Explique as relações relevantes de ${contextLabel}.`, "explain")}
    />
  );
  const agentPanel = (
    <AgentPanel
      turns={agent.turns}
      running={agent.running}
      index={index}
      contextLabel={contextLabel}
      hasPath={!!path}
      onRun={runAgent}
      onCancel={agent.cancel}
      onClear={() => { agent.clear(); setHighlight(null); }}
      onDecide={decide}
      onFocusClaim={focusClaim}
      onSelectNode={selectAndCenter}
    />
  );

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[620px] flex-col overflow-hidden rounded-lg bg-card ring-1 ring-border">
      {/* Barra de investigação */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="graph-search" className="sr-only">Buscar nó no grafo</label>
          <input
            id="graph-search"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="graph-search-results"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0] && !e.nativeEvent.isComposing && e.keyCode !== 229) { selectAndCenter(results[0].id); setQuery(""); }
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Buscar entidade, fato, fonte…"
            className="h-8 w-full rounded-md bg-muted/50 pr-2 pl-8 text-[13px] text-foreground ring-1 ring-inset ring-border outline-none placeholder:text-muted-foreground focus:ring-ring"
          />
          {results.length ? (
            <ul id="graph-search-results" role="listbox" className="absolute top-9 right-0 left-0 z-30 max-h-72 overflow-y-auto rounded-md bg-popover p-1 shadow-xl ring-1 ring-border">
              {results.map((n) => (
                <li key={n.id} role="option" aria-selected={false}>
                  <button type="button" onClick={() => { selectAndCenter(n.id); setQuery(""); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                    <GlyphIcon kind={n.kind} verification={n.verification} />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{n.label}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{KIND_META[n.kind].label}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <ToolButton active={filtersOpen || nFilters > 0} onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>
          <Filter className="size-3.5" aria-hidden="true" /> Filtros{nFilters ? <span className="font-mono text-[10px]">· {nFilters}</span> : null}
        </ToolButton>
        <Segmented label="Camadas visíveis" value={effectiveLayer} onChange={setLayer} options={[{ value: "domain", label: "Domínio" }, { value: "evidence", label: "+ Evidências" }, { value: "all", label: "Tudo" }]} />
        <Segmented label="Profundidade do foco" value={focusDepth} onChange={setFocusDepth} options={[{ value: "0", label: "Sem foco" }, { value: "1", label: "Foco 1" }, { value: "2", label: "Foco 2" }]} />
        <Segmented label="Rótulos" value={labelMode} onChange={setLabelMode} options={[{ value: "minimal", label: "Mín." }, { value: "auto", label: "Auto" }, { value: "always", label: "Todos" }]} />
        <ToolButton active={pathMode} disabled={!selectedNodeId} onClick={() => setPathMode((m) => !m)} title="Selecione um nó e depois o destino (ou Shift + clique)">
          <Route className="size-3.5" aria-hidden="true" /> Caminho
        </ToolButton>
        <div className="ml-auto flex items-center gap-2">
          <Pill tone="warning">dados demonstrativos</Pill>
          <label htmlFor="graph-scenario" className="sr-only">Estado demonstrado</label>
          <select id="graph-scenario" value={scenario} onChange={(e) => { setScenario(e.target.value as Scenario); clearAll(); setRevealed(new Set()); layoutCache.clear(); }} className="h-8 rounded-md bg-muted/50 px-2 text-[12px] text-foreground ring-1 ring-inset ring-border outline-none focus:ring-ring">
            <option value="normal">Estado: normal</option>
            <option value="dense">Estado: grafo denso</option>
            <option value="loading">Estado: carregando</option>
            <option value="empty">Estado: vazio</option>
            <option value="error">Estado: erro</option>
          </select>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Área do grafo */}
        <section aria-label="Grafo de conhecimento" className="relative min-w-0 flex-1 bg-background">
          {scenario === "loading" ? (
            <GraphSkeleton />
          ) : scenario === "error" ? (
            <StateMessage tone="error" title="Não foi possível carregar o grafo" text="A consulta ao grafo falhou (estado de erro demonstrativo). Nenhum dado foi alterado." action={{ label: "Tentar novamente", onClick: () => setScenario("normal") }} />
          ) : scenario === "empty" || visible.nodes.length === 0 ? (
            <StateMessage
              title={scenario === "empty" ? "Este espaço ainda não tem grafo" : "Nenhum nó corresponde aos filtros"}
              text={scenario === "empty" ? "Conecte uma fonte e modele entidades para que fatos e relações apareçam aqui." : "Afrouxe os filtros ou mude a camada visível para trazer nós de volta."}
              action={scenario === "empty" ? { label: "Ver grafo de exemplo", onClick: () => setScenario("normal") } : { label: "Limpar filtros", onClick: () => { setFilters(allFilters()); setFocusDepth("0"); } }}
            />
          ) : (
            <GraphCanvas
              handleRef={canvas}
              nodes={visible.nodes}
              edges={visible.edges}
              positions={positions}
              selectedNodeId={selectedNodeId}
              selectedEdgeId={selection?.type === "edge" ? selection.id : undefined}
              pathSourceId={pathMode ? selectedNodeId : undefined}
              emphasis={emphasis}
              flowEdgeIds={flowEdgeIds}
              labelMode={labelMode}
              onSelectNode={selectNode}
              onSelectEdge={(id) => { setSelection({ type: "edge", id }); setPanel("inspector"); }}
              onExpand={expand}
              onBackground={clearAll}
            />
          )}

          {filtersOpen ? (
            <div className="absolute inset-y-0 left-0 z-20">
              <GraphFilterRail filters={filters} onChange={setFilters} counts={counts} onClose={() => setFiltersOpen(false)} />
            </div>
          ) : null}

          <div className="pointer-events-none absolute top-3 right-3 left-3 z-10 flex flex-wrap items-start justify-end gap-2">
            {highlight || path ? (
              <div className="pointer-events-auto flex items-center gap-2 rounded-md bg-card/95 py-1 pr-1 pl-2.5 text-[12px] ring-1 ring-brand/40 backdrop-blur">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
                {highlight ? `Destaque do agente · ${highlight.edgeIds.length} relações` : `Caminho · ${path!.edgeIds.length} passos`}
                <button type="button" onClick={() => { setHighlight(null); setPath(null); }} aria-label="Remover destaque" className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : null}
            {pathError ? (
              <p role="alert" className="pointer-events-auto rounded-md bg-card/95 px-2.5 py-1.5 text-[12px] text-warning ring-1 ring-warning/40">{pathError}</p>
            ) : null}
          </div>

          {scenario === "normal" || scenario === "dense" ? (
            <>
              <div className="pointer-events-none absolute bottom-3 left-3 z-10 hidden max-w-[70%] md:block"><GraphLegend /></div>
              <div className="absolute right-3 bottom-8 z-10 flex flex-col overflow-hidden rounded-md bg-card/95 ring-1 ring-border backdrop-blur">
                {CONTROLS.map((b) => (
                  <button key={b.id} type="button" onClick={() => runControl(b.id)} aria-label={b.label} title={b.label} className="grid size-8 place-items-center border-b border-border text-muted-foreground last:border-0 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset">
                    <b.icon className="size-3.5" aria-hidden="true" />
                  </button>
                ))}
              </div>
              <p className="pointer-events-none absolute top-3 left-3 z-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                {visible.nodes.length}/{graph.nodes.length} nós · {visible.edges.length}/{graph.edges.length} relações
              </p>
            </>
          ) : null}
        </section>

        {/* Painéis contextuais: lado a lado em telas muito largas, em abas nas demais. */}
        <div className="hidden w-[360px] shrink-0 border-l border-border 2xl:block">{inspector}</div>
        <div className="hidden w-[380px] shrink-0 border-l border-border 2xl:block">{agentPanel}</div>
        <div className="hidden w-[360px] shrink-0 flex-col border-l border-border md:flex 2xl:hidden">
          <div role="tablist" aria-label="Painel contextual" className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
            {(["inspector", "agent"] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={panel === id}
                onClick={() => setPanel(id)}
                className={cn("flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring", panel === id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {id === "inspector" ? "Inspetor" : "Agente"}
                {id === "agent" && agent.running ? <span aria-label="em execução" className="size-1.5 animate-pulse rounded-full bg-brand" /> : null}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">{panel === "inspector" ? inspector : <div className="h-full [&>div>header]:hidden">{agentPanel}</div>}</div>
        </div>
      </div>

      {/* Telas estreitas: painel em gaveta inferior. */}
      <div className="flex h-[46%] shrink-0 flex-col border-t border-border md:hidden">
        <div role="tablist" aria-label="Painel contextual" className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
          {(["inspector", "agent"] as const).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={panel === id} onClick={() => setPanel(id)} className={cn("h-7 rounded-md px-2.5 text-[12.5px] font-medium", panel === id ? "bg-muted text-foreground" : "text-muted-foreground")}>
              {id === "inspector" ? "Inspetor" : "Agente"}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">{panel === "inspector" ? inspector : agentPanel}</div>
      </div>
    </div>
  );
}

function GraphSkeleton() {
  const pts = [[-160, -60], [-40, -120], [90, -70], [170, 40], [40, 90], [-110, 80], [-10, 0]];
  return (
    <div role="status" aria-label="Carregando grafo" className="graph-grid absolute inset-0 grid place-items-center">
      <svg width="420" height="300" viewBox="-210 -150 420 300" aria-hidden="true" className="animate-pulse">
        {pts.map(([x, y], i) => <line key={`l${i}`} x1={-10} y1={0} x2={x} y2={y} className="stroke-muted-foreground/25" strokeDasharray="4 4" />)}
        {pts.map(([x, y], i) => <circle key={`c${i}`} cx={x} cy={y} r={i === 6 ? 18 : 11} className="fill-muted stroke-border" />)}
      </svg>
      <p className="absolute bottom-1/4 font-mono text-[11px] text-muted-foreground">Calculando layout e carregando relações…</p>
    </div>
  );
}

function StateMessage({ title, text, tone, action }: { title: string; text: string; tone?: "error"; action: { label: string; onClick: () => void } }) {
  return (
    <div className="graph-grid absolute inset-0 grid place-items-center p-6" role={tone === "error" ? "alert" : undefined}>
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-lg bg-card/95 p-6 text-center ring-1 ring-border">
        {tone === "error" ? <CircleAlert className="size-6 text-destructive" aria-hidden="true" /> : <GlyphIcon kind="topic" verification="unverified" size={24} />}
        <p className="text-[15px] font-semibold text-foreground">{title}</p>
        <p className="text-[13px] leading-relaxed text-pretty text-muted-foreground">{text}</p>
        <button type="button" onClick={action.onClick} className="mt-1 inline-flex h-8 items-center rounded-md bg-brand px-3 text-[12.5px] font-medium text-brand-foreground hover:bg-brand/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          {action.label}
        </button>
      </div>
    </div>
  );
}
