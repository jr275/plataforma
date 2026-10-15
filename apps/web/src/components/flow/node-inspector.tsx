"use client";

import Link from "next/link";
import { CircleAlert, X } from "lucide-react";
import { STATUS_LABEL, type FlowNodeSpec, type RowTone } from "@/lib/flow/model";

const TONE: Record<RowTone, string> = { default: "", good: "text-[color:var(--flow-mint)]", warn: "text-[color:var(--flow-yellow)]", bad: "text-[color:var(--flow-red)]", muted: "text-[color:var(--flow-muted)]" };

/** Painel lateral de uma etapa: só dados reais (entradas, saídas, bloqueios), sem esconder o grafo. */
export function NodeInspector({ node, onClose }: { node: FlowNodeSpec | undefined; onClose: () => void }) {
  if (!node) {
    return (
      <aside aria-label="Inspetor de etapa" className="flow-canvas flex h-full min-h-48 flex-col justify-center gap-2 border-l border-[color:var(--flow-line)] p-5 text-sm">
        <p className="font-medium">Selecione uma etapa</p>
        <p className="text-xs" style={{ color: "var(--flow-muted)" }}>Clique em um nó do fluxo para ver o que entrou, o que saiu, o porquê do estado e o que vem a seguir. Use <kbd className="rounded border border-[color:var(--flow-line)] px-1">Esc</kbd> para voltar ao grafo completo.</p>
      </aside>
    );
  }
  const d = node.detail;
  return (
    <aside aria-label={`Inspetor: ${node.title}`} className="flow-canvas h-full overflow-y-auto border-l border-[color:var(--flow-line)] p-4 text-sm" data-testid="node-inspector">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-wide uppercase" style={{ color: "var(--flow-muted)" }}>Etapa</p>
          <h3 className="text-base leading-tight font-semibold">{node.title}</h3>
          <p className="mt-1 flex items-center gap-1.5 font-mono text-[10px] tracking-wide uppercase" data-status={node.status} style={{ color: "var(--flow-text)" }}>
            <span className="flow-status-dot" style={{ background: `var(--flow-${node.status === "completed" ? "mint" : node.status === "running" ? "cyan" : node.status === "failed" ? "red" : node.status === "blocked" ? "orange" : node.status === "needs_review" || node.status === "queued" ? "yellow" : "muted"})` }} aria-hidden="true" />
            {STATUS_LABEL[node.status]}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar o inspetor e voltar ao grafo" className="grid size-7 shrink-0 place-items-center rounded-md border border-[color:var(--flow-line)] hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-[color:var(--flow-sky)] focus-visible:outline-none"><X className="size-4" aria-hidden="true" /></button>
      </div>

      <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--flow-muted)" }}>{d.purpose}</p>

      {d.blocker ? (
        <div role="note" className="mt-3 flex gap-2 rounded-md border border-[color:var(--flow-line)] bg-white/5 p-2.5 text-xs">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" style={{ color: node.status === "unavailable" || node.status === "skipped" ? "var(--flow-muted)" : "var(--flow-orange)" }} aria-hidden="true" />
          <p>{d.blocker}</p>
        </div>
      ) : null}

      <dl className="mt-3 divide-y divide-[color:var(--flow-line)] text-xs">
        {d.rows.map((r) => (
          <div key={`${r.label}:${r.value}`} className="flex justify-between gap-3 py-1.5">
            <dt style={{ color: "var(--flow-muted)" }}>{r.label}</dt>
            <dd className={`text-right font-medium ${r.tone ? TONE[r.tone] : ""}`}>{r.tone && r.tone !== "default" ? <span className="flow-prop-dot" style={{ background: r.tone === "muted" ? "var(--flow-muted)" : `var(--flow-${r.tone === "good" ? "mint" : r.tone === "warn" ? "yellow" : "red"})` }} aria-hidden="true" /> : null}{r.value}</dd>
          </div>
        ))}
      </dl>

      {d.items && d.items.length > 0 ? (
        <ul className="mt-3 space-y-2 text-xs">
          {d.items.map((it, i) => (
            <li key={`${it.title}:${i}`} className="rounded-md border border-[color:var(--flow-line)] p-2">
              <p className={`font-medium ${it.tone ? TONE[it.tone] : ""}`}>{it.title}</p>
              <p style={{ color: "var(--flow-muted)" }}>{it.text}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {d.downstream.length > 0 ? (
        <p className="mt-3 text-xs"><span style={{ color: "var(--flow-muted)" }}>Alimenta: </span>{d.downstream.join(" · ")}</p>
      ) : null}

      {d.links && d.links.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2 text-xs">
          {d.links.map((l) => (<li key={l.href}><Link href={l.href} className="rounded-md border border-[color:var(--flow-line)] px-2 py-1 underline-offset-2 hover:bg-white/5 hover:underline focus-visible:ring-2 focus-visible:ring-[color:var(--flow-sky)] focus-visible:outline-none">{l.label}</Link></li>))}
        </ul>
      ) : null}
    </aside>
  );
}
