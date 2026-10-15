"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { WorkspaceData } from "@/data/demo/types";
import { SG_COLUMNS, buildSearchGraph, type SGNode } from "@/lib/intel/search-graph";
import { cn } from "@/lib/utils";
import { DataStateBadge, Inspector, Section, StateNotice } from "@/components/intel/primitives";

/**
 * Grafo em colunas (cluster → consulta → oportunidade → observação/entidade/fonte). Ao focar um nó, só ele e os vizinhos
 * diretos ficam acesos; o inspetor lista cada relação com a origem do registro.
 */
export function SearchGraph({ data, cluster }: { data: WorkspaceData; cluster?: string }) {
  const graph = useMemo(() => buildSearchGraph(data, cluster), [data, cluster]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const focus = graph.nodes.find((n) => n.id === focusId) ?? null;
  const related = useMemo(() => {
    if (!focusId) return null;
    const ids = new Set([focusId]);
    for (const e of graph.edges) {
      if (e.from === focusId) ids.add(e.to);
      if (e.to === focusId) ids.add(e.from);
    }
    return ids;
  }, [focusId, graph.edges]);
  const focusEdges = focusId ? graph.edges.filter((e) => e.from === focusId || e.to === focusId) : [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  if (graph.nodes.length === 0) return <StateNotice state="empty" title="Nenhuma relação registrada para este recorte." />;

  return (
    <div className={cn("grid grid-cols-1 gap-4", focus ? "lg:grid-cols-[minmax(0,1fr)_340px]" : "")}>
      <div className="min-w-0 overflow-x-auto card-cut">
        <div className="grid min-w-[960px] grid-cols-6 divide-x divide-border">
          {SG_COLUMNS.map((col) => {
            const nodes = graph.nodes.filter((n) => n.kind === col.kind);
            return (
              <div key={col.kind} className="flex min-w-0 flex-col">
                <p className="border-b border-border bg-muted/40 px-2.5 py-2 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
                  {col.label} <span className="tabular-nums">({nodes.length})</span>
                </p>
                <ul className="flex flex-col gap-1 p-1.5">
                  {nodes.length === 0 ? <li className="px-1.5 py-2 text-xs text-muted-foreground">Nenhum registro</li> : null}
                  {nodes.map((n) => (
                    <li key={n.id}>
                      <NodeButton node={n} active={n.id === focusId} dim={related ? !related.has(n.id) : false} onClick={() => setFocusId(n.id === focusId ? null : n.id)} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          {graph.edges.length} relações, todas gravadas no dataset. Nenhuma aresta é inferida para completar o desenho.
        </p>
      </div>

      {focus ? (
        <Inspector title={focus.label} subtitle={<><span className="font-mono text-[11px] text-muted-foreground">{focus.meta}</span><DataStateBadge state="demo" /></>} onClose={() => setFocusId(null)}>
          <Section title={`Relações (${focusEdges.length})`}>
            <ul className="flex flex-col gap-3">
              {focusEdges.map((e) => {
                const other = byId.get(e.from === focus.id ? e.to : e.from)!;
                return (
                  <li key={e.id} className="text-[13px]">
                    <p>
                      <span className="font-mono text-[11px] text-brand">{e.from === focus.id ? e.relation : `← ${e.relation}`}</span>{" "}
                      <button type="button" onClick={() => setFocusId(other.id)} className="text-left font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{other.label}</button>
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{e.meaning}</p>
                    <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">{e.source} · registro {e.record}</p>
                  </li>
                );
              })}
            </ul>
          </Section>
          {focus.href ? <Section title="Abrir"><Link href={focus.href} className="text-[13px] text-brand hover:underline">Ver registro completo →</Link></Section> : null}
        </Inspector>
      ) : null}
    </div>
  );
}

const kindDot: Record<SGNode["kind"], string> = {
  cluster: "bg-foreground",
  query: "bg-info",
  opportunity: "bg-brand",
  finding: "bg-warning",
  entity: "bg-success",
  source: "bg-muted-foreground",
};

function NodeButton({ node, active, dim, onClick }: { node: SGNode; active: boolean; dim: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex w-full items-start gap-1.5 border px-2 py-1.5 text-left text-xs leading-snug transition-[opacity,background-color] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        active ? "border-brand bg-brand/10" : "border-transparent hover:bg-accent",
        dim && "opacity-30",
      )}
    >
      <span aria-hidden="true" className={cn("mt-1 size-1.5 shrink-0", kindDot[node.kind])} />
      <span className="min-w-0 text-pretty">{node.label}</span>
    </button>
  );
}
