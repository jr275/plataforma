"use client";

import { cn } from "@/lib/utils";

/** Barra de abas: células com borda, rótulo em maiúsculas; a ativa fica em azul sólido. role=tablist, setas do teclado. */
export function Tabs<T extends string>({ label, tabs, value, onChange }: { label: string; tabs: readonly { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" aria-label={label} className="flex overflow-x-auto border border-border bg-card">
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
            "h-11 min-w-max flex-1 shrink-0 border-r border-border px-4 font-mono text-[11px] font-medium tracking-[0.08em] uppercase transition-colors last:border-r-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
            value === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {t.label}
          {t.count !== undefined ? <span className={cn("ml-2 tabular-nums", value === t.id ? "text-primary-foreground/80" : "text-muted-foreground/70")}>{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
