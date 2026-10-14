import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
export const labelClass = "text-[11px] font-medium tracking-[0.06em] uppercase";
/** Shared operational surface; fig and dots remain accepted for existing callers. */
export function Frame({ caption, children, className, bodyClassName }: { fig?: string; caption: string; children: ReactNode; className?: string; bodyClassName?: string; dots?: boolean }) {
  return <figure className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}><figcaption className="border-b border-border px-4 py-3 text-[13px] font-semibold">{caption}</figcaption><div className={cn("p-4", bodyClassName)}>{children}</div></figure>;
}
