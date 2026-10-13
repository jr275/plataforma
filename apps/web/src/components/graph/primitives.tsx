import type { ReactNode } from "react";
import { VERIFICATION_META, type Verification } from "@/lib/graph/model";
import { cn } from "@/lib/utils";

/** Rótulo de seção monoespaçado, a "voz técnica" do explorador. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("font-mono text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase", className)}>{children}</p>;
}

const TONE = {
  success: "text-success ring-success/35 bg-success/10",
  info: "text-info ring-info/35 bg-info/10",
  warning: "text-warning ring-warning/35 bg-warning/10",
  danger: "text-destructive ring-destructive/35 bg-destructive/10",
  brand: "text-brand ring-brand/40 bg-brand/10",
  neutral: "text-muted-foreground ring-border bg-muted/50",
} as const;

export function Pill({ tone = "neutral", children, className }: { tone?: keyof typeof TONE; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 font-mono text-[10px] font-medium tracking-wide whitespace-nowrap ring-1 ring-inset", TONE[tone], className)}>{children}</span>;
}

export function VerificationPill({ value }: { value: Verification }) {
  const m = VERIFICATION_META[value];
  return <Pill tone={m.tone}>{m.label}</Pill>;
}

export function ToolButton({ active, children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
        active ? "bg-brand/15 text-brand ring-1 ring-inset ring-brand/40" : "text-muted-foreground hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-8 items-center rounded-md bg-muted/60 p-0.5 ring-1 ring-inset ring-border">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 rounded-[5px] px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            o.value === value ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
