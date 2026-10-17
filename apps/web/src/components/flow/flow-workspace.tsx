"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { STATUS_ORDER, labelOf, type FlowDefinition, type FlowNodeSpec } from "@/lib/flow/model";
import { FlowCanvas } from "./flow-canvas";
import { NodeInspector } from "./node-inspector";

/** A etapa que o produto abre sozinho: o que está acontecendo agora, senão o que falhou, senão o que pede revisão. Nada é escolhido pelo usuário. */
const ATTENTION: readonly FlowNodeSpec["status"][] = ["running", "failed", "blocked", "needs_review"];
export function defaultFocus(nodes: readonly FlowNodeSpec[]): string | null {
  for (const s of ATTENTION) { const n = nodes.find((x) => x.status === s && x.kind !== "gate"); if (n) return n.id; }
  for (const s of ATTENTION) { const n = nodes.find((x) => x.status === s); if (n) return n.id; }
  return null;
}

/**
 * Espaço de trabalho do fluxo: grafo + inspetor lado a lado, sem escolhas a fazer. O tema é um só, não há busca nem filtro, e a etapa que
 * importa (em execução, que falhou ou que pede revisão) já abre com o porquê. Clicar em outra etapa só troca o que é mostrado. `mode` diz se
 * o fluxo é uma execução ao vivo ou o registro de uma tentativa: um registro nunca é apresentado como execução ao vivo.
 */
export function FlowWorkspace({ definition, banner, focusIds, height = 780 }: { definition: FlowDefinition; banner?: string; focusIds?: readonly string[]; height?: number }) {
  // `undefined` = o usuário ainda não escolheu nada: segue a etapa em foco calculada a cada atualização (acompanha a execução ao vivo).
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  // Contagem pelos rótulos EXIBIDOS (na ordem dos estados): o resumo nunca contradiz o que os cartões mostram.
  const summary = useMemo(() => {
    const m = new Map<string, number>();
    const order = [...definition.nodes].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
    for (const n of order) m.set(labelOf(n), (m.get(labelOf(n)) ?? 0) + 1);
    return [...m].map(([l, c]) => `${l} ${c}`).join(" · ");
  }, [definition.nodes]);
  const selectedId = picked === undefined ? defaultFocus(definition.nodes) : picked;
  const selected = definition.nodes.find((n) => n.id === selectedId);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => { if (e.key === "Escape") setPicked(null); };

  return (
    <section aria-label={`Fluxo de produção: ${definition.title}`} className="overflow-hidden rounded-lg border border-border" data-flow-theme="line" onKeyDown={onKeyDown}>
      <header className="flow-canvas flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[color:var(--flow-line)] px-3 py-2">
        <h2 className="font-mono text-[11px] font-semibold tracking-[0.08em] uppercase">Fluxo de produção</h2>
        <span className="flow-chip" data-mode={definition.mode} role="status">
          {definition.mode === "live" ? <><span className="flow-status-dot mr-1.5" style={{ ["--accent" as string]: "var(--flow-cyan)", animation: "flow-pulse 1.4s ease-in-out infinite" }} aria-hidden="true" />AO VIVO · atualiza a cada 3 s</> : "REGISTRO · estado da última tentativa"}
        </span>
        {banner ? <span className="flow-chip" style={{ color: "var(--flow-yellow)" }}>{banner}</span> : null}
        <p className="ml-auto text-[11px]" style={{ color: "var(--flow-muted)" }} aria-label="Resumo dos estados">
          {summary}
        </p>
      </header>
      <div className={selected ? "grid lg:grid-cols-[minmax(0,1fr)_21rem]" : undefined}>
        <FlowCanvas definition={definition} selectedId={selectedId} onSelect={(id) => setPicked(id)} focusIds={focusIds} height={height} theme="line" />
        {selected ? <div style={{ height: `min(${height}px, 70vh)` }} className="max-lg:h-auto!"><NodeInspector node={selected} onClose={() => setPicked(null)} /></div> : null}
      </div>
      {definition.mode === "recorded" ? null : <p className="flow-canvas border-t border-[color:var(--flow-line)] px-3 py-1.5 text-[11px]" style={{ color: "var(--flow-muted)" }}>Os números vêm do banco a cada atualização. Nada é animado por conta própria: se a execução não avançar, a tela não muda.</p>}
    </section>
  );
}
