"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Background, BackgroundVariant, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, applyNodeChanges, useReactFlow, type Connection, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { CONTRACTS, canConnectTypes, type PageDraft } from "@plataforma/api/src/draft";
import type { Graph, GraphNodeData } from "@/lib/editor/graph-adapter";
import { NODE_W } from "@/lib/editor/graph-adapter";
import { EXEC_DOT, EXEC_LABEL, EXEC_TONE } from "./status";

// Canvas do editor (React Flow). Controlado pelo DOMÍNIO: nós e arestas saem do rascunho; toda alteração volta como OPERAÇÃO do modelo (que valida) e nunca altera o grafo direto.
function StepNode({ data, selected }: NodeProps<Node<GraphNodeData>>) {
  return (
    <div data-node={data.id} data-type={data.type} data-status={data.exec.status} data-validity={data.validity} style={{ width: NODE_W }}
      className={`border px-3 py-2 text-left ${EXEC_TONE[data.exec.status]} ${selected ? "ring-2 ring-ring" : ""} ${data.validity === "error" ? "outline outline-2 outline-destructive" : ""}`}>
      <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-muted-foreground" />
      <div className="flex items-center gap-1.5"><span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${EXEC_DOT[data.exec.status]}`} /><span className="truncate font-mono text-[10.5px] font-semibold tracking-wide uppercase">{data.label}</span>{data.issues > 0 ? <span className="ml-auto font-mono text-[10px] text-destructive" title="Problemas de validação">{data.issues}!</span> : null}</div>
      {data.summary ? <p className="mt-0.5 truncate font-mono text-[11px]">{data.summary}</p> : null}
      <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-muted-foreground">{data.exec.detail}</p>
      <p className="mt-0.5 font-mono text-[9.5px] tracking-wide uppercase">{EXEC_LABEL[data.exec.status]}</p>
      <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-muted-foreground" />
    </div>
  );
}
const nodeTypes = { step: StepNode };

export function EditorCanvas({ graph, draft, selectedNode, selectedEdge, onSelect, onConnect, onDeleteNodes, onDeleteEdges, onMove, fitSignal }: {
  graph: Graph; draft: PageDraft; selectedNode: string | null; selectedEdge: string | null;
  onSelect: (s: { nodeId: string | null; edgeId: string | null }) => void;
  onConnect: (from: string, to: string) => void; onDeleteNodes: (ids: string[]) => void; onDeleteEdges: (ids: string[]) => void;
  onMove: (positions: Record<string, { x: number; y: number }>) => void; fitSignal: number;
}) {
  const rf = useReactFlow();
  // Em modo controlado o React Flow devolve medidas (dimensions) e posições por `onNodesChange`; guardamos esse estado de APRESENTAÇÃO aqui e o sincronizamos com o domínio
  // (que decide quais nós existem, seus dados e posições gravadas). Nada de negócio mora neste estado.
  const [rfNodes, setRfNodes] = useState<Node<GraphNodeData>[]>([]);
  const [src, setSrc] = useState<{ g: Graph["nodes"]; s: string | null } | null>(null);
  if (src === null || src.g !== graph.nodes || src.s !== selectedNode) {
    // Ajuste de estado durante a renderização (padrão do React para derivar estado de props): preserva as medidas já feitas pelo React Flow.
    setSrc({ g: graph.nodes, s: selectedNode });
    setRfNodes((prev) => { const by = new Map(prev.map((n) => [n.id, n])); return graph.nodes.map((n) => ({ ...(by.get(n.id) ?? {}), id: n.id, type: "step", position: n.position, data: n.data, selected: n.id === selectedNode, deletable: CONTRACTS[n.data.type].removable, ariaLabel: `${n.data.label} ${n.data.summary}: ${EXEC_LABEL[n.data.exec.status]}. ${n.data.exec.detail}` })); });
  }
  useEffect(() => { if (fitSignal > 0) void rf.fitView({ padding: 0.1, minZoom: 0.45, duration: 250 }); }, [fitSignal, rf]);
  const types = useMemo(() => new Map(draft.nodes.map((n) => [n.id, n.type])), [draft.nodes]);
  const nodes = rfNodes;
  const edges: Edge[] = useMemo(() => graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, selected: e.id === selectedEdge, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 }, style: { strokeWidth: 1.25, ...(e.invalid ? { stroke: "var(--destructive)" } : {}) }, animated: false })), [graph.edges, selectedEdge]);
  const isValid = useCallback((c: Connection | Edge) => { const a = types.get(c.source), b = types.get(c.target); return !!a && !!b && c.source !== c.target && canConnectTypes(a, b); }, [types]);
  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.1, minZoom: 0.45 }} minZoom={0.15} maxZoom={1.6}
      nodesDraggable nodesConnectable elementsSelectable proOptions={{ hideAttribution: true }} deleteKeyCode={["Backspace", "Delete"]}
      isValidConnection={isValid}
      onNodesChange={(chs) => setRfNodes((ns) => applyNodeChanges(chs, ns))}
      onNodeDragStop={(_, n, all) => { const pos: Record<string, { x: number; y: number }> = {}; for (const x of all.length ? all : [n]) pos[x.id] = { x: Math.round(x.position.x), y: Math.round(x.position.y) }; onMove(pos); }}
      onConnect={(c) => c.source && c.target && onConnect(c.source, c.target)}
      onNodeClick={(_, n) => onSelect({ nodeId: n.id, edgeId: null })} onEdgeClick={(_, e) => onSelect({ nodeId: null, edgeId: e.id })} onPaneClick={() => onSelect({ nodeId: null, edgeId: null })}
      onBeforeDelete={async ({ nodes: ns, edges: es }) => { if (ns.length) onDeleteNodes(ns.map((n) => n.id)); else if (es.length) onDeleteEdges(es.map((e) => e.id)); return false; }}>
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeStrokeWidth={2} />
    </ReactFlow>
  );
}
