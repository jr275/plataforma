import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, Ban, CheckCircle2, CircleDashed, CircleSlash, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { labelClass } from "@/components/ui/frame";
import { dataStateMeta, type DataState } from "@/lib/intel/data-state";
import type { GateResult } from "@/lib/intel/blueprint";
import { cn } from "@/lib/utils";

/** Rótulo de origem do dado. Mesmo vocabulário em todas as telas. */
export function DataStateBadge({ state, className }: { state: DataState; className?: string }) {
  const m = dataStateMeta[state];
  return (
    <span title={m.help} className="inline-flex">
      <Badge tone={m.tone} className={className}>{m.label}</Badge>
    </span>
  );
}

/** Barra horizontal de 0–100. O número sempre acompanha a barra. */
export function ScoreBar({ value, tone = "brand", className, label }: { value: number; tone?: "brand" | "danger" | "muted"; className?: string; label: string }) {
  const color = { brand: "bg-brand", danger: "bg-destructive", muted: "bg-muted-foreground/40" }[tone];
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="h-1.5 flex-1 bg-muted">
        <div className={cn("h-full", color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span className="w-7 text-right font-mono text-[11px] tabular-nums">{value}</span>
    </div>
  );
}

const gateMeta: Record<GateResult, { label: string; icon: typeof CheckCircle2; className: string }> = {
  pass: { label: "Aprovado", icon: CheckCircle2, className: "text-success" },
  fail: { label: "Reprovado", icon: XCircle, className: "text-destructive" },
  warning: { label: "Atenção", icon: AlertTriangle, className: "text-warning" },
  not_evaluated: { label: "Não avaliado", icon: CircleDashed, className: "text-muted-foreground" },
};

export function GateIcon({ result, className }: { result: GateResult; className?: string }) {
  const m = gateMeta[result];
  const Icon = m.icon;
  return <Icon role="img" aria-label={m.label} className={cn("size-4 shrink-0", m.className, className)} />;
}
export const gateLabel = (r: GateResult) => gateMeta[r].label;

/** Seção compacta com rótulo mono: o bloco básico dos inspetores. */
export function Section({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("border-t border-border py-4 first:border-t-0 first:pt-0", className)}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className={`${labelClass} text-[10.5px] text-muted-foreground`}>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Painel lateral de detalhe. Em telas largas fica fixo ao lado do conteúdo. */
export function Inspector({ title, subtitle, onClose, children, footer }: { title: string; subtitle?: ReactNode; onClose?: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <aside aria-label={`Detalhe: ${title}`} className="flex max-h-[calc(100dvh-7rem)] flex-col card-cut lg:sticky lg:top-16">
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm leading-snug font-medium text-pretty">{title}</p>
          {subtitle ? <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{subtitle}</div> : null}
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} className="shrink-0 px-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            Fechar<span className="sr-only"> o detalhe</span>
          </button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
      {footer ? <footer className="flex flex-wrap gap-2 border-t border-border px-4 py-3">{footer}</footer> : null}
    </aside>
  );
}

/** Linha de "chave → valor" com o estado do dado ao lado. */
export function Fact({ label, value, state }: { label: string; value: ReactNode; state?: DataState }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-[13px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1.5 text-right">
        <span>{value}</span>
        {state ? <DataStateBadge state={state} /> : null}
      </dd>
    </div>
  );
}

/** Estado vazio / indisponível / bloqueado com o motivo e a ação que destrava. */
export function StateNotice({ state, title, children, action }: { state: "unavailable" | "blocked" | "planned" | "empty"; title: string; children?: ReactNode; action?: ReactNode }) {
  const Icon = { unavailable: CircleSlash, blocked: Ban, planned: CircleDashed, empty: CircleDashed }[state];
  const tone = { unavailable: "text-muted-foreground", blocked: "text-destructive", planned: "text-info", empty: "text-muted-foreground" }[state];
  return (
    <div className="flex items-start gap-3 border border-dashed border-border px-4 py-3.5">
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} aria-hidden="true" />
      <div className="min-w-0 text-[13px]">
        <p className="font-medium">{title}</p>
        {children ? <div className="mt-1 leading-relaxed text-muted-foreground">{children}</div> : null}
        {action ? <div className="mt-2.5">{action}</div> : null}
      </div>
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="text-[13px] text-brand underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{children}</Link>;
}

/** Cabeçalho de coluna ordenável com aria-sort. */
export function SortHeader<T extends string>({ id, label, sort, onSort, className }: { id: T; label: string; sort: { key: T; dir: "asc" | "desc" }; onSort: (k: T) => void; className?: string }) {
  const active = sort.key === id;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={cn("px-3 py-2 text-left font-normal", className)}>
      <button type="button" onClick={() => onSort(id)} className={cn(labelClass, "inline-flex items-center gap-1 text-[10px] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", active ? "text-foreground" : "text-muted-foreground")}>
        {label}
        <span aria-hidden="true" className="w-2">{active ? (sort.dir === "asc" ? "↑" : "↓") : ""}</span>
      </button>
    </th>
  );
}
