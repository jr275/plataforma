import { Code2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Rótulo em fonte monoespaçada e maiúscula (o "vocabulário" de rótulos da interface). */
export const labelClass = "font-mono text-[11px] font-medium tracking-[0.08em] uppercase";

/** Figura enquadrada com legenda `[ fig. N — legenda ]`: o recipiente padrão do conteúdo principal de cada tela. */
export function Frame({ fig, caption, children, className, bodyClassName, dots = false }: { fig?: string; caption: string; children: ReactNode; className?: string; bodyClassName?: string; dots?: boolean }) {
  return (
    <figure className={cn("card-cut", className)}>
      <figcaption className="flex items-center gap-3 border-b border-border px-3 py-2">
        <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center border border-border text-muted-foreground">
          <Code2 className="size-3" />
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <span className="font-mono text-[11px] tracking-wide text-muted-foreground">
          [ {fig ? `fig. ${fig} — ` : ""}
          {caption} ]
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <span aria-hidden="true" className="size-6 shrink-0" />
      </figcaption>
      <div className={cn(dots && "dot-grid", "p-4", bodyClassName)}>{children}</div>
    </figure>
  );
}
