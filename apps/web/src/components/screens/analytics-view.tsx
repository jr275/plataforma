"use client";

import { useMemo, useState } from "react";
import { useAppState } from "@/components/app-state";
import { Badge } from "@/components/ui/badge";
import { ChipGroup } from "@/components/ui/filters";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { analyticsFor, type Range } from "@/data/derive";

const nf = new Intl.NumberFormat("pt-BR");

export function AnalyticsView() {
  const { current } = useAppState();
  const [range, setRange] = useState<"7" | "30" | "90" | "">("30");
  const [cluster, setCluster] = useState("");
  const days = (range || "30") as "7" | "30" | "90";
  const data = useMemo(() => analyticsFor(current, Number(days) as Range, cluster || "todos"), [current, days, cluster]);
  const max = Math.max(...data.series, 1);
  return (
    <div className="space-y-6">
      <PageHeader crumbs={[{ label: "Analytics" }]} title="Analytics" description={`Visibilidade de busca de ${current.workspace.name} por tema.`} badges={<Badge tone="warning" className="h-auto whitespace-normal py-1 text-left">Dados de demonstração gerados localmente: não são medição real</Badge>} />
      <div className="flex flex-col gap-3">
        <ChipGroup label="Período" value={range} onChange={(v) => setRange(v || "30")} allLabel="30 dias" options={[{ value: "7", label: "7 dias" }, { value: "90", label: "90 dias" }]} />
        <ChipGroup label="Filtrar por tema" value={cluster} onChange={setCluster} allLabel="Todos os temas" options={data.clusters.map((c) => ({ value: c, label: c }))} />
      </div>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[{ l: "Impressões (demo)", v: nf.format(data.impressions) }, { l: "Cliques (demo)", v: nf.format(data.clicks) }, { l: "CTR (demo)", v: `${(data.ctr * 100).toFixed(1).replace(".", ",")}%` }].map((m) => (
          <div key={m.l} className="rounded-xl border border-border bg-card p-4"><dt className="text-xs text-muted-foreground">{m.l}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{m.v}</dd></div>
        ))}
      </dl>
      <Panel title={`Impressões no período (${days} dias)`} description="12 faixas de tempo, valores de demonstração.">
        <div role="img" aria-label={`Impressões por faixa de tempo: ${data.series.map((v) => nf.format(v)).join(", ")}`} className="flex h-32 items-end gap-1.5">
          {data.series.map((v, i) => (<div key={i} className="flex-1 rounded-t bg-brand/60" style={{ height: `${Math.max((v / max) * 100, 4)}%` }} />))}
        </div>
      </Panel>
      <Panel title="Por tema" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <caption className="sr-only">Impressões e cliques de demonstração por tema</caption>
            <thead className="text-xs text-muted-foreground"><tr><th scope="col" className="px-4 py-2 font-medium">Tema</th><th scope="col" className="px-4 py-2 text-right font-medium">Consultas</th><th scope="col" className="px-4 py-2 text-right font-medium">Impressões</th><th scope="col" className="px-4 py-2 text-right font-medium">Cliques</th></tr></thead>
            <tbody className="divide-y divide-border">{data.rows.map((r) => (<tr key={r.cluster}><th scope="row" className="px-4 py-2.5 font-normal">{r.cluster}</th><td className="px-4 py-2.5 text-right tabular-nums">{r.queries}</td><td className="px-4 py-2.5 text-right tabular-nums">{nf.format(r.impressions)}</td><td className="px-4 py-2.5 text-right tabular-nums">{nf.format(r.clicks)}</td></tr>))}</tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
