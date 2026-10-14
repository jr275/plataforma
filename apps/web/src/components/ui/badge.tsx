import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
  brand: "bg-brand/10 text-brand ring-1 ring-inset ring-brand/20",
  success: "bg-success/10 text-success ring-1 ring-inset ring-success/20",
  warning: "bg-warning/10 text-warning ring-1 ring-inset ring-warning/25",
  danger: "bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20",
  info: "bg-info/10 text-info ring-1 ring-inset ring-info/20",
  outline: "text-muted-foreground ring-1 ring-inset ring-border",
} as const;

export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-[11px] font-medium leading-none whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}

/** Ponto de estado com rótulo acessível (a cor nunca é a única informação). */
export function StatusDot({ tone, label }: { tone: "success" | "warning" | "danger" | "idle"; label: string }) {
  const color = { success: "bg-success", warning: "bg-warning", danger: "bg-destructive", idle: "bg-muted-foreground/50" }[tone];
  return <span role="img" aria-label={label} className={cn("inline-block size-2 shrink-0 rounded-full", color)} />;
}
