import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, Ban, CheckCircle2, CircleDashed, CircleDot, Clock, FlaskConical, Info, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Linguagem visual do motor: um vocabulário de estados (sucesso, execução, espera, bloqueio, falha), tipografia com números tabulares, hierarquia por peso e cor (não por caixas) e superfícies discretas.
// A cor nunca é a única informação: todo estado tem ícone e texto.
export type State = "ok" | "run" | "wait" | "block" | "fail" | "info" | "idle" | "sim";
const STATE: Record<State, { icon: LucideIcon; text: string; dot: string; bg: string }> = {
  ok: { icon: CheckCircle2, text: "text-state-ok", dot: "bg-state-ok", bg: "bg-state-ok/10" },
  run: { icon: CircleDot, text: "text-state-run", dot: "bg-state-run", bg: "bg-state-run/10" },
  wait: { icon: Clock, text: "text-muted-foreground", dot: "bg-muted-foreground/50", bg: "bg-muted" },
  block: { icon: AlertTriangle, text: "text-state-block", dot: "bg-state-block", bg: "bg-state-block/10" },
  fail: { icon: XCircle, text: "text-state-fail", dot: "bg-state-fail", bg: "bg-state-fail/10" },
  info: { icon: Info, text: "text-state-run", dot: "bg-state-run", bg: "bg-state-run/10" },
  idle: { icon: CircleDashed, text: "text-muted-foreground", dot: "bg-border", bg: "bg-transparent" },
  sim: { icon: FlaskConical, text: "text-state-block", dot: "bg-state-block", bg: "bg-state-block/10" },
};
export const stateDot = (s: State) => STATE[s].dot;
export const stateText = (s: State) => STATE[s].text;
export function toneToState(t: string): State { return ({ success: "ok", info: "run", warning: "block", danger: "fail", neutral: "idle", outline: "idle", brand: "info" } as Record<string, State>)[t] ?? "idle"; }

/** Estado compacto: ícone + rótulo. `quiet` remove o fundo (para tabelas densas). */
export function Pill({ state, children, quiet = false, className }: { state: State; children: ReactNode; quiet?: boolean; className?: string }) {
  const S = STATE[state]; const Icon = S.icon;
  return <span className={cn("inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11.5px] font-medium leading-none", S.text, quiet ? "px-0" : S.bg, className)}><Icon className="size-3.5 shrink-0" aria-hidden="true" />{children}</span>;
}
export function Tag({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cn("inline-flex h-[20px] items-center whitespace-nowrap rounded-md border border-border px-1.5 text-[11px] leading-none text-muted-foreground", className)}>{children}</span>;
}
/** Simulação e execução real nunca se confundem: faixa e selo próprios. */
export function ModeTag({ mode }: { mode: "real" | "test_simulation" }) {
  return mode === "real" ? <Pill state="ok" quiet>Execução real</Pill> : <Pill state="sim">Simulação de teste</Pill>;
}

/** Dica explicativa acessível (hover e foco). Não substitui rótulos importantes. */
export function Tip({ text, children, id }: { text: string; children?: ReactNode; id: string }) {
  return (
    <span className="tip">
      <button type="button" aria-describedby={id} className="inline-flex items-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2">{children ?? <Info className="size-3.5" aria-hidden="true" />}<span className="sr-only">Explicação</span></button>
      <span role="tooltip" id={id}>{text}</span>
    </span>
  );
}

export interface Seg { readonly label: string; readonly n: number; readonly state: State }
const SEG_BG: Record<State, string> = { ok: "bg-state-ok", run: "bg-state-run", wait: "bg-muted-foreground/35", block: "bg-state-block", fail: "bg-state-fail", info: "bg-state-run", idle: "bg-border", sim: "bg-state-block" };
/** Barra segmentada proporcional ao TOTAL real (sem animação). Cada segmento tem rótulo acessível. */
export function Meter({ segs, total, height = "h-1.5", className }: { segs: readonly Seg[]; total?: number; height?: string; className?: string }) {
  const t = total ?? segs.reduce((s, x) => s + x.n, 0);
  return (
    <div role="img" aria-label={t === 0 ? "sem itens" : segs.filter((x) => x.n > 0).map((x) => `${x.label}: ${x.n}`).join(", ")} className={cn("flex w-full overflow-hidden rounded-full bg-muted", height, className)}>
      {t > 0 ? segs.filter((x) => x.n > 0).map((x) => <span key={x.label} title={`${x.label}: ${x.n}`} className={cn("h-full border-r border-card last:border-r-0", SEG_BG[x.state])} style={{ width: `${(x.n / t) * 100}%` }} />) : null}
    </div>
  );
}
export function Legend({ segs }: { segs: readonly Seg[] }) {
  return <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{segs.map((s) => <li key={s.label} className="inline-flex items-center gap-1.5"><span className={cn("size-2 rounded-full", SEG_BG[s.state])} aria-hidden="true" /><span>{s.label}</span><span className="num font-medium text-foreground">{s.n.toLocaleString("pt-BR")}</span></li>)}</ul>;
}

/** Número em destaque com rótulo discreto: a hierarquia vem do tamanho e do peso, não de uma caixa. */
export function Kpi({ label, value, sub, href, tone, tip, size = "md" }: { label: ReactNode; value: ReactNode; sub?: ReactNode; href?: string; tone?: State; tip?: ReactNode; size?: "md" | "lg" }) {
  const v = <span className={cn("num block font-semibold tracking-tight", size === "lg" ? "text-3xl" : "text-xl", tone ? stateText(tone) : "")}>{value}</span>;
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">{label}{tip}</p>
      {href ? <Link href={href} className="rounded-sm hover:underline underline-offset-4">{v}</Link> : v}
      {sub ? <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

/** Seção sem caixa pesada: título forte, descrição curta e conteúdo; `flush` tira o recuo do conteúdo (tabelas). */
export function Section({ title, description, action, children, id, className, flush = false }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; id?: string; className?: string; flush?: boolean }) {
  return (
    <section id={id} className={cn("surface overflow-hidden", className)}>
      <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2.5">
        <div className="min-w-0"><h2 className="text-[13px] font-semibold leading-5 tracking-tight">{title}</h2>{description ? <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p> : null}</div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className={flush ? "" : "px-4 pb-4"}>{children}</div>
    </section>
  );
}
export function Empty({ title, hint, icon: Icon = Ban, action }: { title: string; hint?: string; icon?: LucideIcon; action?: ReactNode }) {
  return <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center"><span className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></span><p className="text-sm font-medium">{title}</p>{hint ? <p className="max-w-md text-xs leading-snug text-muted-foreground">{hint}</p> : null}{action}</div>;
}
export function Note({ state = "info", children }: { state?: State; children: ReactNode }) {
  const S = STATE[state]; const Icon = S.icon;
  return <p role="note" className={cn("flex items-start gap-2 rounded-lg px-3 py-2 text-xs leading-snug", S.bg)}><Icon className={cn("mt-px size-3.5 shrink-0", S.text)} aria-hidden="true" /><span>{children}</span></p>;
}
export function Skeleton({ className }: { className?: string }) { return <div aria-hidden="true" className={cn("skeleton", className)} />; }
export function PageSkeleton() {
  return <div role="status" aria-label="Carregando" className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-10 w-full" /><div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div><Skeleton className="h-64 w-full" /></div>;
}
/** Linha rótulo/valor para detalhes (sem tabela). */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid grid-cols-[8.5rem_1fr] gap-3 border-t border-border py-1.5 text-xs first:border-0 sm:grid-cols-[10rem_1fr]"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-words">{children}</dd></div>;
}
export const fmt = (n: number): string => n.toLocaleString("pt-BR");
