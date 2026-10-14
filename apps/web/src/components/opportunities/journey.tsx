import Link from "next/link";
import { ArrowRight } from "lucide-react";
export type JourneyStep = "detail" | "serp" | "blueprint" | "template" | "preview" | "gates";
/** Navigation only: an active step never implies completion or approval. */
export function OpportunityJourney({ id, active, base = "/opportunities" }: { id: string; active: JourneyStep; base?: string }) {
  const detail = `${base}/${id}`;
  const steps = [{ id: "discover", label: "Descoberta", href: base }, { id: "detail", label: "Detalhe e score", href: detail }, { id: "serp", label: "SERP", href: base.startsWith("/dev") ? `${detail}/blueprint#serp` : `${detail}/serp` }, { id: "blueprint", label: "Blueprint", href: `${detail}/blueprint#fluxo` }, { id: "template", label: "Template", href: `${detail}/blueprint#template` }, { id: "preview", label: "Prévia", href: `${detail}/blueprint#previa` }, { id: "gates", label: "Gates", href: `${detail}/blueprint#gates` }];
  return <nav aria-label="Jornada da oportunidade" className="overflow-x-auto rounded-lg border border-border bg-card"><ol className="flex min-w-max items-center p-2">{steps.map((s, index) => <li key={s.id} className="flex items-center"><Link href={s.href} aria-current={active === s.id ? "step" : undefined} className={`inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-xs ${active === s.id ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:bg-muted"}`}><span className="font-mono text-[10px] opacity-60">{String(index + 1).padStart(2, "0")}</span>{s.label}</Link>{index < steps.length - 1 ? <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" /> : null}</li>)}</ol></nav>;
}
