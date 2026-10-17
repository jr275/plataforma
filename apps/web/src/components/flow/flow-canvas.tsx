"use client";

import { useMemo } from "react";
import { Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow, type Edge, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { STATUS_LABEL, type FlowDefinition, type FlowEdgeSpec, type FlowStatus } from "@/lib/flow/model";
import { StageNode, type StageNodeType } from "./stage-node";

// Definida fora do componente: identidade estável (o React Flow recria nós se o objeto muda).
const NODE_TYPES: NodeTypes = { stage: StageNode };

const MINIMAP_COLOR: Record<FlowStatus, string> = {
  completed: "#00f0a0", running: "#00e5ff", queued: "#ffe45c", failed: "#ff3d5a", blocked: "#ff8a3d", needs_review: "#ffe45c",
  skipped: "#6b7099", cancelled: "#6b7099", idle: "#6b7099", unavailable: "#3a3e66",
};

export type FlowTheme = "dark" | "line";

function toEdge(e: FlowEdgeSpec, theme: FlowTheme): Edge {
  const line = theme === "line";
  const color = e.remediation ? (line ? "#d1203d" : "#ff3d5a") : e.active ? (line ? "#1f47ff" : "#00e5ff") : line ? "#12132b" : "#9aa0c8";
  return {
    id: e.id, source: e.source, target: e.target,
    sourceHandle: e.sourceHandle ?? "r", targetHandle: e.targetHandle ?? "l",
    ...(e.remediation ? { pathOptions: { offset: 70, borderRadius: 0 } } : {}),
    // Tema Linha: conectores em ângulo reto, como no diagrama de referência; tema escuro: curvas.
    type: line || e.remediation ? "step" : "default", animated: e.active === true,
    label: e.label, labelStyle: { fill: color, fontSize: 11, fontWeight: 600 }, labelBgStyle: { fill: line ? "#efecfd" : "#12132b" }, labelBgPadding: [6, 3], labelBgBorderRadius: 4,
    style: { stroke: color, strokeWidth: e.active ? 2 : 1.4, strokeDasharray: line && !e.active && !e.remediation && !e.muted ? undefined : "6 6", opacity: e.muted ? 0.4 : 0.9 },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
    focusable: false,
  };
}

export interface FlowCanvasProps {
  definition: FlowDefinition;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Etapas que combinam com o filtro; as demais ficam esmaecidas. `undefined` = sem filtro. */
  matchIds?: ReadonlySet<string>;
  /** Etapas enquadradas na primeira exibição (o resto fica a um pan de distância; "Ajustar" enquadra tudo). */
  focusIds?: readonly string[];
  height?: number;
  theme?: FlowTheme;
}

/**
 * O grafo é a DEFINIÇÃO do fluxo com o ESTADO por cima. A chave do React Flow é o id da definição: atualizações de estado trocam só os dados
 * dos nós (viewport, zoom e seleção são preservados); só uma definição diferente reinicia o canvas.
 */
export function FlowCanvas({ definition, selectedId, onSelect, matchIds, focusIds, height = 780, theme = "dark" }: FlowCanvasProps) {
  const nodes = useMemo<StageNodeType[]>(
    () => definition.nodes.map((spec) => ({
      id: spec.id, type: "stage", position: { x: spec.x, y: spec.y }, draggable: false, connectable: false,
      // Dimensões aproximadas: o modo controlado não devolve as medidas ao objeto, e o minimapa só desenha nós com tamanho. Não afeta o layout.
      initialWidth: 320, initialHeight: 208,
      ariaLabel: `${spec.title}: ${STATUS_LABEL[spec.status]}${spec.summary ? `. ${spec.summary}` : ""}`,
      data: { spec, selected: spec.id === selectedId, dim: matchIds ? !matchIds.has(spec.id) : false },
    })),
    [definition.nodes, selectedId, matchIds],
  );
  const edges = useMemo(() => definition.edges.map((e) => toEdge(e, theme)), [definition.edges, theme]);

  return (
    <div className="flow-canvas" style={{ height: `min(${height}px, 72vh)` }} data-testid="flow-canvas">
      <ReactFlow
        key={definition.id}
        nodes={nodes} edges={edges} nodeTypes={NODE_TYPES}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable
        onNodeClick={(_, n) => onSelect(n.id)} onPaneClick={() => onSelect(null)}
        colorMode={theme === "line" ? "light" : "dark"} minZoom={0.1} maxZoom={1.6}
        fitView fitViewOptions={{ padding: 0.06, maxZoom: 0.95, ...(focusIds ? { nodes: focusIds.map((id) => ({ id })) } : {}) }}
        aria-label={`Fluxo: ${definition.title}`}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color={theme === "line" ? "rgb(18 19 43 / 0.2)" : "rgb(255 255 255 / 0.14)"} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap className="max-sm:hidden" position="top-right" pannable zoomable nodeColor={(n) => MINIMAP_COLOR[(n.data as { spec?: { status?: FlowStatus } } | undefined)?.spec?.status ?? "idle"]} nodeStrokeWidth={0} nodeBorderRadius={6} maskColor="rgb(11 12 31 / 0.7)" />
      </ReactFlow>
    </div>
  );
}
