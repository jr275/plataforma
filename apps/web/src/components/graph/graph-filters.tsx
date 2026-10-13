"use client";

import { X } from "lucide-react";
import { KIND_META, NODE_KINDS, PROVENANCE_META, PROVENANCES, RELATION_META, RELATION_TYPES, VERIFICATION_META, VERIFICATIONS } from "@/lib/graph/model";
import type { GraphFilters } from "@/lib/graph/query";
import { cn } from "@/lib/utils";
import { DashSample, GlyphIcon } from "./node-glyph";
import { Eyebrow } from "./primitives";

export const allFilters = (): GraphFilters => ({
  kinds: new Set(NODE_KINDS),
  relations: new Set(RELATION_TYPES),
  provenances: new Set(PROVENANCES),
  verifications: new Set(VERIFICATIONS),
});

export function activeFilterCount(f: GraphFilters): number {
  return NODE_KINDS.length - f.kinds.size + RELATION_TYPES.length - f.relations.size + PROVENANCES.length - f.provenances.size + VERIFICATIONS.length - f.verifications.size;
}

function toggle<T>(set: ReadonlySet<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

function Check({ checked, onChange, children, count }: { checked: boolean; onChange: () => void; children: React.ReactNode; count?: number }) {
  return (
    <label className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1.5 text-[12.5px] text-foreground/90 hover:bg-accent/60 has-focus-visible:ring-2 has-focus-visible:ring-ring">
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
      <span aria-hidden="true" className={cn("grid size-3.5 place-items-center rounded-[3px] ring-1 ring-inset", checked ? "bg-brand ring-brand" : "ring-input")}>
        {checked ? <span className="size-1.5 rounded-[1px] bg-brand-foreground" /> : null}
      </span>
      <span className={cn("flex min-w-0 flex-1 items-center gap-2", !checked && "text-muted-foreground")}>{children}</span>
      {count !== undefined ? <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{count}</span> : null}
    </label>
  );
}

export function GraphFilterRail({ filters, onChange, counts, onClose }: { filters: GraphFilters; onChange: (f: GraphFilters) => void; counts: { kinds: Record<string, number>; relations: Record<string, number> }; onClose: () => void }) {
  return (
    <aside aria-label="Filtros do grafo" className="flex h-full w-64 flex-col border-r border-border bg-card/95 backdrop-blur">
      <div className="flex h-11 items-center justify-between border-b border-border px-3">
        <Eyebrow>Filtros</Eyebrow>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onChange(allFilters())} className="rounded px-1.5 py-0.5 text-[11.5px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            Limpar
          </button>
          <button type="button" onClick={onClose} aria-label="Fechar filtros" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3">
        <fieldset className="flex flex-col gap-0.5">
          <legend className="mb-1.5"><Eyebrow>Tipo de nó</Eyebrow></legend>
          {NODE_KINDS.map((k) => (
            <Check key={k} checked={filters.kinds.has(k)} onChange={() => onChange({ ...filters, kinds: toggle(filters.kinds, k) })} count={counts.kinds[k] ?? 0}>
              <GlyphIcon kind={k} />
              {KIND_META[k].plural}
            </Check>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-0.5">
          <legend className="mb-1.5"><Eyebrow>Verificação</Eyebrow></legend>
          {VERIFICATIONS.map((v) => (
            <Check key={v} checked={filters.verifications.has(v)} onChange={() => onChange({ ...filters, verifications: toggle(filters.verifications, v) })}>
              <DashSample verification={v} />
              {VERIFICATION_META[v].label}
            </Check>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-0.5">
          <legend className="mb-1.5"><Eyebrow>Proveniência</Eyebrow></legend>
          {PROVENANCES.map((v) => (
            <Check key={v} checked={filters.provenances.has(v)} onChange={() => onChange({ ...filters, provenances: toggle(filters.provenances, v) })}>
              {PROVENANCE_META[v].label}
            </Check>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-0.5">
          <legend className="mb-1.5"><Eyebrow>Relação</Eyebrow></legend>
          {RELATION_TYPES.filter((r) => (counts.relations[r] ?? 0) > 0).map((r) => (
            <Check key={r} checked={filters.relations.has(r)} onChange={() => onChange({ ...filters, relations: toggle(filters.relations, r) })} count={counts.relations[r]}>
              <span className="font-mono text-[11.5px]">{RELATION_META[r].label}</span>
            </Check>
          ))}
        </fieldset>
      </div>
    </aside>
  );
}

/** Legenda compacta: ensina a gramática visual (forma = tipo, traço = verificação). */
export function GraphLegend() {
  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md bg-card/90 px-2.5 py-2 ring-1 ring-border backdrop-blur" aria-label="Legenda">
      {NODE_KINDS.map((k) => (
        <span key={k} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <GlyphIcon kind={k} size={12} />
          {KIND_META[k].label}
        </span>
      ))}
      <span aria-hidden="true" className="h-3 w-px bg-border" />
      {VERIFICATIONS.map((v) => (
        <span key={v} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <DashSample verification={v} />
          {VERIFICATION_META[v].label}
        </span>
      ))}
    </div>
  );
}
