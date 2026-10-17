"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { KIND_META, RELATION_META, VERIFICATION_META, type GraphEdge, type GraphNode } from "@/lib/graph/model";
import { bounds, type Point } from "@/lib/graph/layout";
import { cn } from "@/lib/utils";
import { DASH, NODE_RADIUS, NodeShape } from "./node-glyph";

/** O layout de força dá coordenadas que diferem na 13ª casa entre o servidor e o navegador; arredondar o que vai para o SVG evita o erro de hidratação sem mudar o desenho. */
const r2 = (n: number): number => Math.round(n * 100) / 100;

export type LabelMode = "auto" | "always" | "minimal";
export type CanvasHandle = { fit: () => void; zoomBy: (f: number) => void; centerOn: (id: string) => void };
type Transform = { x: number; y: number; k: number };

type Props = {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  positions: ReadonlyMap<string, Point>;
  selectedNodeId?: string;
  selectedEdgeId?: string;
  pathSourceId?: string;
  /** Quando definido, tudo fora destes conjuntos fica atenuado. */
  emphasis?: { nodeIds: ReadonlySet<string>; edgeIds: ReadonlySet<string> } | null;
  /** Destaques vindos do agente ou de um caminho: ganham traço animado. */
  flowEdgeIds: ReadonlySet<string>;
  labelMode: LabelMode;
  onSelectNode: (id: string, shift: boolean) => void;
  onSelectEdge: (id: string) => void;
  onExpand: (id: string) => void;
  onBackground: () => void;
  handleRef?: Ref<CanvasHandle>;
};

const MIN_K = 0.2;
const MAX_K = 3.5;

export function GraphCanvas(p: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [t, setT] = useState<Transform>({ x: 400, y: 300, k: 1 });
  const [animate, setAnimate] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const smooth = useCallback((next: Transform) => {
    setAnimate(true);
    setT(next);
    window.setTimeout(() => setAnimate(false), 520);
  }, []);

  const fit = useCallback(() => {
    const b = bounds(p.nodes.map((n) => p.positions.get(n.id)).filter((x): x is Point => !!x));
    if (!b) return smooth({ x: size.w / 2, y: size.h / 2, k: 1 });
    const pad = 80;
    const k = Math.min(MAX_K, Math.max(MIN_K, Math.min((size.w - pad * 2) / Math.max(1, b.maxX - b.minX), (size.h - pad * 2) / Math.max(1, b.maxY - b.minY), 1.4)));
    smooth({ k, x: size.w / 2 - ((b.minX + b.maxX) / 2) * k, y: size.h / 2 - ((b.minY + b.maxY) / 2) * k });
  }, [p.nodes, p.positions, size, smooth]);

  const centerOn = useCallback(
    (id: string) => {
      const pt = p.positions.get(id);
      if (!pt) return;
      const k = Math.max(t.k, 1);
      smooth({ k, x: size.w / 2 - pt.x * k, y: size.h / 2 - pt.y * k });
    },
    [p.positions, size, smooth, t.k],
  );

  const zoomBy = useCallback((f: number) => {
    setT((cur) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, cur.k * f));
      const cx = size.w / 2, cy = size.h / 2;
      return { k, x: cx - ((cx - cur.x) / cur.k) * k, y: cy - ((cy - cur.y) / cur.k) * k };
    });
  }, [size]);

  useImperativeHandle(p.handleRef, () => ({ fit, zoomBy, centerOn }), [fit, zoomBy, centerOn]);

  // Enquadra automaticamente quando o conjunto visível muda (primeira vez ou mudança grande).
  const nodeKey = p.nodes.length;
  useEffect(() => {
    if (size.w < 10) return;
    if (!fitted.current || nodeKey) {
      fitted.current = true;
      fit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reenquadra só quando o número de nós ou o tamanho mudam
  }, [nodeKey, size.w, size.h]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      setT((cur) => {
        const k = Math.min(MAX_K, Math.max(MIN_K, cur.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: mx - ((mx - cur.x) / cur.k) * k, y: my - ((my - cur.y) / cur.k) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest("[data-graph-item]")) return;
    drag.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.moved) setT((cur) => ({ ...cur, x: d.tx + dx, y: d.ty + dy }));
  };
  const onPointerUp = () => {
    if (drag.current && !drag.current.moved) p.onBackground();
    drag.current = null;
  };

  const focusSet = p.emphasis;
  const dimNode = (id: string) => !!focusSet && !focusSet.nodeIds.has(id);
  const dimEdge = (id: string) => !!focusSet && !focusSet.edgeIds.has(id);
  const showNodeLabel = (n: GraphNode) => {
    if (p.labelMode === "always") return true;
    const emphasized = n.id === p.selectedNodeId || n.id === hovered || focusSet?.nodeIds.has(n.id);
    if (p.labelMode === "minimal") return !!emphasized && (n.id === p.selectedNodeId || n.id === hovered);
    if (emphasized) return true;
    if (n.synthetic) return t.k > 1.6;
    return KIND_META[n.kind].layer === "domain" ? t.k > 0.45 : t.k > 1.05;
  };
  const showEdgeLabel = (e: GraphEdge) =>
    p.labelMode !== "minimal" && (p.labelMode === "always" || e.id === p.selectedEdgeId || e.source === hovered || e.target === hovered || p.flowEdgeIds.has(e.id) || (t.k > 1.5 && !dimEdge(e.id)));

  return (
    <div ref={wrapRef} className="graph-grid absolute inset-0 overflow-hidden" style={{ backgroundPosition: `${t.x}px ${t.y}px`, backgroundSize: `${24 * t.k}px ${24 * t.k}px` }}>
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        role="group"
        aria-label={`Grafo com ${p.nodes.length} nós e ${p.edges.length} relações. Use Tab para percorrer os nós e Enter para selecionar.`}
        className="block touch-none select-none cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <defs>
          {(["base", "hot"] as const).map((m) => (
            <marker key={m} id={`arrow-${m}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
              <path d="M0,1 L9,5 L0,9 Z" className={m === "hot" ? "fill-brand" : "fill-muted-foreground/70"} />
            </marker>
          ))}
        </defs>
        <g style={{ transform: `translate(${r2(t.x)}px, ${r2(t.y)}px) scale(${r2(t.k)})`, transition: animate ? "transform 500ms cubic-bezier(.2,.7,.2,1)" : undefined }}>
          <g>
            {p.edges.map((e) => {
              const a = p.positions.get(e.source);
              const b = p.positions.get(e.target);
              const sn = p.nodes.find((n) => n.id === e.source);
              const tn = p.nodes.find((n) => n.id === e.target);
              if (!a || !b || !sn || !tn) return null;
              const dx = b.x - a.x, dy = b.y - a.y;
              const len = Math.hypot(dx, dy) || 1;
              const ra = NODE_RADIUS[sn.kind] + 3, rb = NODE_RADIUS[tn.kind] + 5;
              const x1 = r2(a.x + (dx / len) * ra), y1 = r2(a.y + (dy / len) * ra);
              const x2 = r2(b.x - (dx / len) * rb), y2 = r2(b.y - (dy / len) * rb);
              const hot = p.flowEdgeIds.has(e.id) || e.id === p.selectedEdgeId;
              const dim = dimEdge(e.id);
              const mx = r2((x1 + x2) / 2), my = r2((y1 + y2) / 2);
              let angle = r2((Math.atan2(dy, dx) * 180) / Math.PI);
              if (angle > 90 || angle < -90) angle += 180;
              return (
                <g key={e.id} data-graph-item className={cn("transition-opacity duration-300", dim ? "opacity-15" : "opacity-100")}>
                  <line
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    strokeWidth={hot ? 2 : 1.1}
                    strokeDasharray={p.flowEdgeIds.has(e.id) ? "6 4" : DASH[e.verification]}
                    markerEnd={`url(#arrow-${hot ? "hot" : "base"})`}
                    className={cn(hot ? "stroke-brand" : e.verification === "expired" ? "stroke-destructive/70" : "stroke-muted-foreground/45", p.flowEdgeIds.has(e.id) && "graph-flow")}
                    vectorEffect="non-scaling-stroke"
                  />
                  <line
                    x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={12} className="cursor-pointer stroke-transparent"
                    onClick={(ev) => { ev.stopPropagation(); p.onSelectEdge(e.id); }}
                  >
                    <title>{`${sn.label} ${RELATION_META[e.type].label} ${tn.label} · ${VERIFICATION_META[e.verification].label}`}</title>
                  </line>
                  {showEdgeLabel(e) ? (
                    <text x={mx} y={my - 4} textAnchor="middle" transform={`rotate(${angle} ${mx} ${my})`} className={cn("pointer-events-none font-mono text-[9px] tracking-wide stroke-background [paint-order:stroke]", hot ? "fill-brand" : "fill-muted-foreground")} strokeWidth={3}>
                      {RELATION_META[e.type].label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
          <g>
            {p.nodes.map((n) => {
              const pt = p.positions.get(n.id);
              if (!pt) return null;
              const r = n.synthetic ? NODE_RADIUS[n.kind] * 0.7 : NODE_RADIUS[n.kind];
              const selected = n.id === p.selectedNodeId;
              const pathSource = n.id === p.pathSourceId;
              const dim = dimNode(n.id);
              return (
                <g
                  key={n.id}
                  data-graph-item
                  role="button"
                  tabIndex={0}
                  aria-label={`${KIND_META[n.kind].label}: ${n.label}. ${VERIFICATION_META[n.verification].label}.`}
                  aria-pressed={selected}
                  className={cn("group cursor-pointer outline-none transition-[opacity,transform] duration-500 ease-out", dim ? "opacity-20" : "opacity-100")}
                  style={{ transform: `translate(${r2(pt.x)}px, ${r2(pt.y)}px)` }}
                  onClick={(ev) => { ev.stopPropagation(); p.onSelectNode(n.id, ev.shiftKey); }}
                  onDoubleClick={(ev) => { ev.stopPropagation(); p.onExpand(n.id); }}
                  onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); p.onSelectNode(n.id, ev.shiftKey); } }}
                  onPointerEnter={() => setHovered(n.id)}
                  onPointerLeave={() => setHovered((h) => (h === n.id ? null : h))}
                >
                  {selected || pathSource ? <circle r={r + 8} className={cn("fill-none", pathSource && !selected ? "stroke-info" : "stroke-brand")} strokeWidth={1.5} strokeDasharray={pathSource && !selected ? "3 3" : undefined} vectorEffect="non-scaling-stroke" /> : null}
                  <circle r={r + 6} className="fill-none stroke-ring opacity-0 group-focus-visible:opacity-100" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  <NodeShape kind={n.kind} verification={n.verification} r={r} className={cn(selected && "fill-brand/35")} />
                  {n.verification !== "verified" && !n.synthetic ? (
                    <circle cx={r * 0.85} cy={-r * 0.85} r={2.6} className={cn("stroke-background", { inferred: "fill-info", unverified: "fill-warning", expired: "fill-destructive", verified: "" }[n.verification])} strokeWidth={1.2} />
                  ) : null}
                  {showNodeLabel(n) ? (
                    <text y={r + 14} textAnchor="middle" className={cn("pointer-events-none text-[11px] stroke-background [paint-order:stroke]", selected ? "fill-foreground font-semibold" : "fill-foreground/85")} strokeWidth={3.5}>
                      {n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      <div className="pointer-events-none absolute right-3 bottom-3 font-mono text-[10px] text-muted-foreground tabular-nums" aria-hidden="true">
        {Math.round(t.k * 100)}%
      </div>
    </div>
  );
}
