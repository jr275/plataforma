import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "./panel";

export type Row = { id: string; href: string; title: string; subtitle?: string; badges?: ReactNode; meta?: ReactNode };

/** Lista padrão das páginas de inventário: cada linha leva ao detalhe. */
export function ResourceList({ rows, empty, count }: { rows: readonly Row[]; empty: ReactNode; count?: string }) {
  return (
    <div>
      <div className="overflow-hidden card-cut">
        {rows.length === 0 ? (
          empty
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={r.href}
                  style={{ paddingBlock: "var(--row-y)" }}
                  className="flex flex-col gap-2 px-4 transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none sm:flex-row sm:items-center sm:gap-4"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.title}</span>
                    {r.subtitle ? <span className="block truncate text-xs text-muted-foreground">{r.subtitle}</span> : null}
                  </span>
                  {r.badges ? <span className="flex flex-wrap items-center gap-1.5">{r.badges}</span> : null}
                  {r.meta ? <span className="text-xs text-muted-foreground sm:w-24 sm:text-right">{r.meta}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {count ? (
        <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
          {count} · dados demonstrativos
        </p>
      ) : null}
    </div>
  );
}

export { EmptyState };
