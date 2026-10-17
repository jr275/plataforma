import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Superfície padrão de conteúdo: título, ação opcional e corpo. Substitui "cards" soltos. */
export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("card-cut min-w-0", className)}>
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 pr-12">
        <div className="min-w-0">
          <h2 className="font-mono text-xs font-semibold tracking-[0.09em] uppercase">{title}</h2>
          {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </header>
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
