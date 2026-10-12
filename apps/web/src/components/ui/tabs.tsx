"use client";

import { cn } from "@/lib/utils";

/** Abas simples e acessíveis (role=tablist, setas do teclado). O conteúdo é do chamador. */
export function Tabs<T extends string>({ label, tabs, value, onChange }: { label: string; tabs: readonly { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t, i) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          id={`tab-${t.id}`}
          aria-selected={value === t.id}
          aria-controls="tabpanel"
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            const next = e.key === "ArrowRight" ? tabs[(i + 1) % tabs.length] : e.key === "ArrowLeft" ? tabs[(i - 1 + tabs.length) % tabs.length] : undefined;
            if (next) {
              e.preventDefault();
              onChange(next.id);
              document.getElementById(`tab-${next.id}`)?.focus();
            }
          }}
          className={cn(
            "-mb-px h-9 shrink-0 border-b-2 px-3 text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            value === t.id ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
          {t.count !== undefined ? <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
