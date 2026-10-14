import Link from "next/link";
import type { graph } from "@plataforma/api";
import { VIEW, layoutRadial, type PlacedNode } from "./layout";
import { EDGE_BASIS_LABEL, KIND_LABEL } from "./kinds";

const STROKE: Record<graph.GraphNodeKind, string> = { city: "stroke-foreground", uf: "stroke-info", region: "stroke-brand", page: "stroke-warning" };

function Shape({ node }: { node: PlacedNode }) {
  const c = `${STROKE[node.kind]} fill-card`;
  const w = node.isCenter ? 1.6 : 1;
  if (node.kind === "region") return <polygon points="0,-12 12,0 0,12 -12,0" className={c} strokeWidth={1.5 * w} transform={`scale(${node.isCenter ? 1.5 : 1})`} />;
  if (node.kind === "uf") return <rect x={-10} y={-10} width={20} height={20} rx={5} className={c} strokeWidth={1.5 * w} transform={`scale(${node.isCenter ? 1.5 : 1})`} />;
  if (node.kind === "page") return <rect x={-8} y={-10} width={16} height={20} rx={2.5} className={c} strokeWidth={1.5 * w} transform={`scale(${node.isCenter ? 1.5 : 1})`} />;
  return <circle r={node.isCenter ? 15 : 9} className={c} strokeWidth={1.5 * w} />;
}

/** Vizinhança de um nó em SVG renderizado no servidor. Cada nó é um link (a seleção é a URL). Só desenha o que a expansão trouxe. */
export function GraphCanvas({ expansion, hrefFor }: { expansion: graph.GraphExpansion; hrefFor: (ref: string) => string }) {
  const { nodes, edges } = layoutRadial(expansion);
  const ncity = expansion.neighbors.filter((n) => n.kind === "city").length;
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-card">
      <svg viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} role="img" aria-labelledby="graph-title graph-desc" className="h-auto w-full" data-testid="graph-canvas">
        <title id="graph-title">{`Vizinhança de ${expansion.center.label}`}</title>
        <desc id="graph-desc">{`${expansion.neighbors.length} entidade(s) relacionada(s) a ${KIND_LABEL[expansion.center.kind]} ${expansion.center.label}, ligadas por ${edges.length} relação(ões) reais. A lista completa está logo abaixo.`}</desc>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="fill-muted-foreground" /></marker>
          <marker id="arrow-link" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="fill-brand" /></marker>
        </defs>
        <g aria-hidden="true">
          {edges.map((e, i) => {
            const dx = e.to.x - e.from.x;
            const dy = e.to.y - e.from.y;
            const len = Math.hypot(dx, dy) || 1;
            const pad = e.to.isCenter ? 20 : 13;
            const link = e.basis === "recorded_link";
            return <line key={`${e.from.ref}-${e.to.ref}-${i}`} x1={e.from.x} y1={e.from.y} x2={e.to.x - (dx / len) * pad} y2={e.to.y - (dy / len) * pad} strokeWidth={1.2} strokeDasharray={link ? "5 4" : undefined} className={link ? "stroke-brand" : "stroke-muted-foreground/60"} markerEnd={link ? "url(#arrow-link)" : "url(#arrow)"} />;
          })}
        </g>
        {nodes.map((n) => (
          <Link key={n.ref} href={hrefFor(n.ref)} aria-current={n.isCenter ? "true" : undefined} aria-label={`${KIND_LABEL[n.kind]} ${n.label}${n.detail ? `, ${n.detail}` : ""}${n.isCenter ? " (selecionada)" : ""}`}>
            <g transform={`translate(${n.x} ${n.y})`} className="cursor-pointer outline-none [&:focus-visible_*]:stroke-ring">
              <title>{`${KIND_LABEL[n.kind]}: ${n.label}${n.detail ? ` · ${n.detail}` : ""}`}</title>
              <Shape node={n} />
              {n.showLabel ? <text y={n.isCenter ? 32 : 22} textAnchor="middle" className={`fill-foreground ${n.isCenter ? "text-[15px] font-semibold" : "text-[12px]"}`} style={{ paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 3 }}>{n.shortLabel}</text> : null}
            </g>
          </Link>
        ))}
      </svg>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><circle r="6" className="fill-card stroke-foreground" strokeWidth="1.5" /></svg>cidade</span>
        <span className="inline-flex items-center gap-1.5"><svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><rect x="-6" y="-6" width="12" height="12" rx="3" className="fill-card stroke-info" strokeWidth="1.5" /></svg>UF</span>
        <span className="inline-flex items-center gap-1.5"><svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><polygon points="0,-7 7,0 0,7 -7,0" className="fill-card stroke-brand" strokeWidth="1.5" /></svg>região</span>
        <span className="inline-flex items-center gap-1.5"><svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><rect x="-5" y="-7" width="10" height="14" rx="2" className="fill-card stroke-warning" strokeWidth="1.5" /></svg>página</span>
        <span className="inline-flex items-center gap-1.5"><svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" strokeWidth="1.5" className="stroke-muted-foreground/60" /></svg>{EDGE_BASIS_LABEL.source_column}</span>
        <span className="inline-flex items-center gap-1.5"><svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" strokeWidth="1.5" strokeDasharray="5 4" className="stroke-brand" /></svg>{EDGE_BASIS_LABEL.recorded_link}</span>
        {ncity > 24 ? <span className="ml-auto">Rótulos só nas 24 maiores; passe o mouse ou use a lista abaixo.</span> : null}
      </figcaption>
    </figure>
  );
}
