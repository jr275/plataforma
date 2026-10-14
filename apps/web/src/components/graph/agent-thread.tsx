import Link from "next/link";
import type { graph } from "@plataforma/api";
import { Badge } from "@/components/ui/badge";
import { BasisChip } from "./inspector";

/** Linha do tempo de uma investigação: passos executados, achados com a natureza de cada valor e citações (links para a evidência). */
export function AgentThread({ runs, pending }: { runs: readonly graph.GraphToolResult[]; pending: boolean }) {
  return (
    <ol className="space-y-3" aria-label="Investigações executadas" aria-live="polite" aria-busy={pending}>
      {runs.map((r, i) => (
        <li key={`${r.tool}-${r.ref}-${i}`} className="rounded-lg border border-border bg-muted/40 p-3 text-xs" data-testid="agent-run">
          <header className="flex flex-wrap items-center gap-2">
            <strong className="text-[13px]">{r.title}</strong>
            <Badge tone={r.ok ? "success" : "danger"}>{r.ok ? "Concluída" : "Falhou"}</Badge>
            <Badge tone="outline">somente leitura</Badge>
          </header>
          <ol className="mt-2 space-y-0.5 text-muted-foreground" aria-label="Passos">
            {r.steps.map((s, n) => (<li key={n} className="flex items-start gap-1.5"><span aria-hidden="true">{s.status === "done" ? "✓" : "✕"}</span><span className={s.status === "failed" ? "text-destructive" : undefined}>{s.label}<span className="sr-only">{s.status === "done" ? " (feito)" : " (falhou)"}</span></span></li>))}
          </ol>
          {r.findings.length > 0 ? (
            <dl className="mt-2.5 divide-y divide-border">
              {r.findings.map((f, n) => (
                <div key={n} className="flex items-start justify-between gap-3 py-1.5">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="flex min-w-0 flex-col items-end gap-1 text-right"><span className="break-words">{f.href && f.href.startsWith("/") ? <Link href={f.href} className="underline underline-offset-2">{f.value || f.label}</Link> : f.value}</span><BasisChip basis={f.basis} /></dd>
                </div>
              ))}
            </dl>
          ) : null}
          {r.error ? <p role="alert" className="mt-2 text-destructive">{r.error}</p> : null}
          {r.citations.length > 0 ? (
            <p className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2"><span className="text-muted-foreground">Evidência:</span>{r.citations.filter((c) => c.href.startsWith("/")).map((c) => (<Link key={c.href} href={c.href} className="underline underline-offset-2">{c.label}</Link>))}</p>
          ) : null}
        </li>
      ))}
      {pending ? <li className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground" role="status">Executando a ferramenta…</li> : null}
    </ol>
  );
}
