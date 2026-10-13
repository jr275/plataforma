import { KIND_META, type NodeKind, type Verification } from "@/lib/graph/model";
import { cn } from "@/lib/utils";

// Linguagem visual do grafo: a FORMA diz o tipo, a COR diz a camada (domínio, evidência, saída)
// e o TRAÇO diz o estado de verificação. A cor nunca é a única informação.

export const NODE_RADIUS: Record<NodeKind, number> = { organization: 17, entity: 15, place: 15, topic: 15, page: 12, fact: 9, source: 11 };

const LAYER_CLASS = {
  domain: "fill-brand/15 stroke-brand",
  evidence: "fill-info/12 stroke-info",
  output: "fill-muted-foreground/10 stroke-muted-foreground",
} as const;

export const DASH: Record<Verification, string | undefined> = { verified: undefined, inferred: "5 3", unverified: "1.5 3", expired: "6 2 1.5 2" };

export function glyphPath(kind: NodeKind, r: number): string {
  switch (kind) {
    case "organization":
      return `M${-r},${-r * 0.82} h${2 * r} v${1.64 * r} h${-2 * r} Z`;
    case "place":
      return `M0,${-r * 1.15} L${r * 1.15},0 L0,${r * 1.15} L${-r * 1.15},0 Z`;
    case "topic": {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        return `${(Math.cos(a) * r * 1.08).toFixed(2)},${(Math.sin(a) * r * 1.08).toFixed(2)}`;
      });
      return `M${pts.join(" L")} Z`;
    }
    case "page":
      return `M${-r * 0.8},${-r} h${r * 1.1} l${r * 0.5},${r * 0.5} v${r * 1.5} h${-r * 1.6} Z`;
    case "fact":
      return `M0,${-r * 1.1} L${r * 1.05},${r * 0.75} L${-r * 1.05},${r * 0.75} Z`;
    case "source":
    case "entity":
    default:
      return `M${-r},0 a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`;
  }
}

export function NodeShape({ kind, verification, r, className }: { kind: NodeKind; verification: Verification; r: number; className?: string }) {
  const layer = KIND_META[kind].layer;
  return (
    <>
      <path d={glyphPath(kind, r)} strokeWidth={1.5} strokeDasharray={DASH[verification]} className={cn(LAYER_CLASS[layer], verification === "expired" && "stroke-destructive", className)} vectorEffect="non-scaling-stroke" />
      {kind === "source" ? <circle r={r * 0.42} className={cn("fill-info/60")} /> : null}
    </>
  );
}

/** Versão em miniatura para legendas, filtros e listas. */
export function GlyphIcon({ kind, verification = "verified", size = 14, className }: { kind: NodeKind; verification?: Verification; size?: number; className?: string }) {
  const r = 6;
  return (
    <svg width={size} height={size} viewBox="-9 -9 18 18" aria-hidden="true" className={cn("shrink-0 overflow-visible", className)}>
      <NodeShape kind={kind} verification={verification} r={r} />
    </svg>
  );
}

export function DashSample({ verification }: { verification: Verification }) {
  return (
    <svg width="22" height="6" viewBox="0 0 22 6" aria-hidden="true" className="shrink-0">
      <line x1="1" y1="3" x2="21" y2="3" strokeWidth="1.5" strokeDasharray={DASH[verification]} className={verification === "expired" ? "stroke-destructive" : "stroke-foreground/70"} />
    </svg>
  );
}
