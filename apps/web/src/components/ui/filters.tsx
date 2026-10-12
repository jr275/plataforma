"use client";

import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function SearchField({ value, onChange, placeholder, label, className }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; className?: string }) {
  return (
    <label className={cn("relative block", className)}>
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-lg border border-input bg-card/60 pr-2.5 pl-8 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
      />
    </label>
  );
}

export function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "h-7 rounded-md border px-2.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        pressed ? "border-brand/40 bg-brand/15 text-brand" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Grupo de seleção única. `""` significa "todos". */
export function ChipGroup<T extends string>({ label, value, onChange, options, allLabel = "Todos" }: { label: string; value: T | ""; onChange: (v: T | "") => void; options: readonly { value: T; label: string }[]; allLabel?: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <Chip pressed={value === ""} onClick={() => onChange("")}>{allLabel}</Chip>
      {options.map((o) => (
        <Chip key={o.value} pressed={value === o.value} onClick={() => onChange(value === o.value ? "" : o.value)}>
          {o.label}
        </Chip>
      ))}
    </div>
  );
}

export const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
