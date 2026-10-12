import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const inputClass =
  "h-9 w-full rounded-lg border border-input bg-card/60 px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

export function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium">{label}</label>
      {children}
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function Dl({ items, className }: { items: readonly { label: string; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("space-y-2.5 text-sm", className)}>
      {items.map((i) => (
        <div key={i.label} className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">{i.label}</dt>
          <dd className="min-w-0 text-right">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
