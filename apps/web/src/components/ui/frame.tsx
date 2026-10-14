import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Rótulo pequeno em versalete (seções, colunas, metadados). A fonte mono fica reservada a dados, IDs e métricas. */
export const labelClass = "text-[11px] font-medium tracking-[0.06em] uppercase";

/** Figura com legenda discreta: o recipiente do conteúdo principal de uma tela (diagramas, mapas, prévias). */
export function Frame({ fig, caption, children, className, bodyClassName, dots = false }: { fig?: string; caption: string; children: ReactNode; className?: string; bodyClassName?: string; dots?: boolean }) {
  return (
    <figure className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      <figcaption className="flex items-baseline gap-2 border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
        {fig ? <span className="font-mono text-[11px] tabular-nums text-muted-foreground/80">Fig. {fig}</span> : null}
        <span className="font-medium text-foreground/85">{caption}</span>
      </figcaption>
      <div className={cn(dots && "dot-grid", "p-4", bodyClassName)}>{children}</div>
    </figure>
  );
}
