import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export type Crumb = { label: string; href?: string };

/** Cabeçalho padrão de toda página: trilha, título, descrição e ações. */
export function PageHeader({ crumbs, title, description, actions, badges }: { crumbs?: readonly Crumb[]; title: string; description?: string; actions?: ReactNode; badges?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {crumbs && crumbs.length > 0 ? (
          <nav aria-label="Trilha de navegação" className="mb-2">
            <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {crumbs.map((c, i) => (
                <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                  {i > 0 ? <ChevronRight className="size-3" aria-hidden="true" /> : null}
                  {c.href ? (
                    <Link href={c.href} className="rounded hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{c.label}</Link>
                  ) : (
                    <span aria-current="page" className="text-foreground/80">{c.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        {badges ? <div className="mb-2 flex flex-wrap items-center gap-1.5">{badges}</div> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2 self-start">{actions}</div> : null}
    </header>
  );
}
