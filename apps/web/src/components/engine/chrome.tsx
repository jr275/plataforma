import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// Cabeçalho e navegação do motor: título compacto, contexto em uma linha, ações à direita e sub-navegação agrupada por finalidade.
export const ENGINE_GROUPS: readonly { label: string; items: readonly (readonly [string, string])[] }[] = [
  { label: "Produção", items: [["/engine", "Visão geral"], ["/engine/pipeline", "Pipeline"], ["/engine/pages", "Páginas"], ["/engine/batches", "Lotes"], ["/engine/deployments", "Deployments"]] },
  { label: "Conhecimento", items: [["/engine/topics", "Tópicos"], ["/engine/eligibility", "Elegibilidade"], ["/engine/templates", "Templates"]] },
  { label: "Runtime", items: [["/engine/agents", "Agentes"], ["/engine/prompts", "Prompts"], ["/engine/executions", "Execuções"], ["/engine/pipelines", "Pipelines"], ["/engine/progress", "Andamento"]] },
];
export const ENGINE_SECTIONS = ENGINE_GROUPS.flatMap((g) => g.items);

export function SubNav({ current }: { current: string }) {
  return (
    <nav aria-label="Seções do motor" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max items-stretch gap-5 border-b border-border">
        {ENGINE_GROUPS.map((g) => (
          <div key={g.label} className="flex items-stretch gap-0.5">
            <span className="eyebrow hidden self-center pr-2 lg:block">{g.label}</span>
            {g.items.map(([href, label]) => {
              const active = href === current;
              return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn("relative -mb-px inline-flex h-9 items-center border-b-2 px-2.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", active ? "border-brand font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{label}</Link>;
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}

export type Crumb = { label: string; href?: string };
export function PageHead({ title, context, crumbs, actions, meta }: { title: ReactNode; context?: ReactNode; crumbs?: readonly Crumb[]; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <header className="space-y-1">
      {crumbs && crumbs.length > 0 ? (
        <nav aria-label="Trilha de navegação"><ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">{crumbs.map((c, i) => <li key={`${c.label}-${i}`} className="flex items-center gap-1">{i > 0 ? <ChevronRight className="size-3" aria-hidden="true" /> : null}{c.href ? <Link href={c.href} className="rounded-sm hover:text-foreground">{c.label}</Link> : <span aria-current="page" className="text-foreground">{c.label}</span>}</li>)}</ol></nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0"><h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">{title}</h1>{meta ? <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">{meta}</div> : null}</div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {context ? <p className="max-w-3xl text-[13px] leading-snug text-muted-foreground">{context}</p> : null}
    </header>
  );
}
