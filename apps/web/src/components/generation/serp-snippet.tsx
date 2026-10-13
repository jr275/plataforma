import type { RenderedPage } from "@plataforma/api";
import { META_MAX, META_MIN, TITLE_MAX } from "@plataforma/api";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

const counter = (n: number, ok: boolean) => <span className={cn("tabular-nums", ok ? "text-muted-foreground" : "font-medium text-destructive")}>{n}</span>;

/** Como o resultado apareceria numa busca, com os contadores de caracteres dos limites de título e meta. */
export function SerpSnippet({ page }: { page: RenderedPage }) {
  const t = page.title.length;
  const m = page.metaDescription.length;
  return (
    <Panel title="Resultado de busca (prévia)" description="Título, URL e descrição como o buscador os leria.">
      <div className="rounded-lg border border-border bg-white p-3 text-neutral-900">
        <p className="truncate text-xs text-emerald-700">{page.path}</p>
        <p className="mt-0.5 text-[17px] leading-snug text-blue-700">{page.title}</p>
        <p className="mt-1 text-[13px] leading-snug text-neutral-600">{page.metaDescription}</p>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div><dt className="text-muted-foreground">Título</dt><dd>{counter(t, t >= 1 && t <= TITLE_MAX)} / {TITLE_MAX}</dd></div>
        <div><dt className="text-muted-foreground">Meta descrição</dt><dd>{counter(m, m >= META_MIN && m <= META_MAX)} ({META_MIN} a {META_MAX})</dd></div>
        <div className="col-span-2"><dt className="text-muted-foreground">Canonical</dt><dd className="font-mono break-all">{page.canonicalPath} <span className="text-muted-foreground">(caminho relativo; o domínio entra na publicação)</span></dd></div>
      </dl>
    </Panel>
  );
}
