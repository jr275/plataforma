"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAppState } from "@/components/app-state";
import { Badge } from "@/components/ui/badge";
import { ChipGroup } from "@/components/ui/filters";
import { PageHeader } from "@/components/ui/page-header";
import { DataStateBadge, Inspector, Section, StateNotice } from "@/components/intel/primitives";
import { cn } from "@/lib/utils";
import { levelTone } from "@/lib/opportunity";
import { SearchGraph } from "./search-graph";

type View = "queries" | "graph";

export function SerpExplorer() {
  const { current } = useAppState();
  const [view, setView] = useState<View | "">("queries");
  const [cluster, setCluster] = useState("");
  const [queryId, setQueryId] = useState<string | null>(null);
  const clusters = useMemo(() => [...new Set(current.queries.map((q) => q.cluster))], [current]);
  const queries = current.queries.filter((q) => !cluster || q.cluster === cluster);
  const selected = queries.find((q) => q.id === queryId) ?? null;
  const opp = selected?.opportunityId ? current.opportunities.find((o) => o.id === selected.opportunityId) : undefined;
  const competition = current.findings.filter((f) => f.section === "Concorrência" && f.opportunityId && f.opportunityId === selected?.opportunityId);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        crumbs={[{ label: "Search Intelligence" }, { label: "SERP Explorer" }]}
        title="SERP Explorer"
        description="Consultas do universo de buscas e as relações registradas entre elas, oportunidades, observações de concorrência, entidades e fontes."
        badges={<><Badge tone="warning">Parcial</Badge><DataStateBadge state="demo" /></>}
      />
      <StateNotice state="unavailable" title="Nenhum provedor de SERP conectado.">
        Posições, formatos de resultado (snippet, PAA, vídeo, local) e domínios ranqueados não são exibidos porque nada foi observado. As observações de concorrência abaixo são editoriais e estão rotuladas como tal.
      </StateNotice>

      <div className="flex flex-wrap items-center gap-3 card-cut p-3">
        <div role="tablist" aria-label="Visualização" className="flex border border-border">
          {(["queries", "graph"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cn("h-7 px-3 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
              {v === "queries" ? "Consultas" : "Grafo competitivo"}
            </button>
          ))}
        </div>
        <ChipGroup label="Cluster" value={cluster} onChange={setCluster} options={clusters.map((c) => ({ value: c, label: c }))} allLabel="Todos os clusters" />
      </div>

      {view === "graph" ? (
        <SearchGraph data={current} cluster={cluster || undefined} />
      ) : (
        <div className={cn("grid grid-cols-1 gap-4", selected ? "lg:grid-cols-[minmax(0,1fr)_360px]" : "")}>
          <div className="min-w-0 overflow-x-auto card-cut">
            <table className="w-full min-w-[720px] text-[13px]">
              <caption className="sr-only">Consultas do universo de buscas</caption>
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  {["Consulta", "Cluster", "Intenção", "Demanda", "Tendência", "SERP"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2 text-left font-mono text-[10px] font-normal tracking-[0.08em] text-muted-foreground uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {queries.map((q) => (
                  <tr key={q.id} aria-selected={q.id === queryId} className={cn("border-b border-border last:border-b-0 hover:bg-accent/50", q.id === queryId && "bg-brand/10 hover:bg-brand/10")}>
                    <td className="px-3 py-2.5">
                      <button type="button" onClick={() => setQueryId(q.id === queryId ? null : q.id)} className="text-left font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{q.text}</button>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{q.cluster}</td>
                    <td className="px-3 py-2.5">{q.intent}</td>
                    <td className="px-3 py-2.5"><Badge tone={levelTone[q.demand]}>{q.demand}</Badge></td>
                    <td className="px-3 py-2.5 text-muted-foreground">{q.trend}</td>
                    <td className="px-3 py-2.5"><DataStateBadge state="unavailable" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected ? (
            <Inspector title={selected.text} subtitle={<><Badge tone="outline">{selected.intent}</Badge><DataStateBadge state="demo" /></>} onClose={() => setQueryId(null)}>
              <Section title="Resultado da busca">
                <StateNotice state="unavailable" title="SERP não observada">Conecte um provedor de SERP para ver formatos e domínios desta consulta.</StateNotice>
              </Section>
              <Section title="Oportunidade ligada">
                {opp ? <Link href={`/opportunities/${opp.id}`} className="text-[13px] font-medium text-brand hover:underline">{opp.title}</Link> : <p className="text-[13px] text-muted-foreground">Nenhuma. Esta consulta ainda não sustenta uma oportunidade.</p>}
              </Section>
              <Section title="Observações de concorrência">
                {competition.length ? (
                  <ul className="flex flex-col gap-2 text-[13px]">{competition.map((f) => <li key={f.id}><p className="font-medium">{f.title}</p><p className="text-xs text-muted-foreground">{f.summary}</p></li>)}</ul>
                ) : <p className="text-[13px] text-muted-foreground">Nenhuma observação registrada.</p>}
              </Section>
            </Inspector>
          ) : null}
        </div>
      )}
    </div>
  );
}
