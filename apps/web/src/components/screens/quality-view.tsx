"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, Clock } from "lucide-react";
import { useAppState } from "@/components/app-state";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Tabs } from "@/components/ui/tabs";
import { levelTone } from "@/lib/opportunity";
import { cn } from "@/lib/utils";
import { knowledgeLabel, knowledgeTone } from "./knowledge-views";
import { healthLabel, healthTone } from "./sources-views";

const gateIcon = { pass: { I: CircleCheck, c: "text-success", l: "Passou" }, fail: { I: CircleAlert, c: "text-destructive", l: "Falhou" }, pending: { I: Clock, c: "text-muted-foreground", l: "Pendente" } } as const;
type Tab = "gates" | "provenance" | "freshness";

export function QualityView() {
  const { current } = useAppState();
  const [tab, setTab] = useState<Tab>("gates");
  const sourceName = new Map(current.sources.map((s) => [s.id, s.name]));
  const unverified = current.knowledge.filter((k) => k.status !== "verified");
  return (
    <div className="space-y-6">
      <PageHeader crumbs={[{ label: "Quality & Trust" }]} title="Qualidade e confiança" description={`Gates, procedência e atualidade em ${current.workspace.name}. Cada gate grava o próprio resultado; não existe nota composta.`} badges={<Badge tone="warning">Resultados de demonstração</Badge>} />
      <Tabs label="Seções de qualidade" value={tab} onChange={setTab} tabs={[{ id: "gates", label: "Gates", count: current.gates.length }, { id: "provenance", label: "Procedência", count: current.knowledge.length }, { id: "freshness", label: "Atualidade", count: current.sources.length }]} />
      <div id="tabpanel" role="tabpanel">
        {tab === "gates" ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Gates do workspace">
              <ul className="divide-y divide-border">{current.gates.map((g) => { const { I, c, l } = gateIcon[g.status]; return (<li key={g.id} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0"><I className={cn("mt-0.5 size-4 shrink-0", c)} aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{g.name}</span><span className="block text-xs text-muted-foreground">{g.detail}</span></span><span className={cn("text-xs font-medium", c)}>{l}</span></li>); })}</ul>
            </Panel>
            <Panel title="Gates por página">
              <ul className="space-y-3">{current.pages.map((p) => (<li key={p.id} className="text-sm"><Link href={`/pages/${p.id}`} className="font-medium hover:underline">{p.title}</Link><span className="mt-1 flex flex-wrap gap-1.5">{p.gates.map((g) => (<Badge key={g.name} tone={g.status === "pass" ? "success" : g.status === "fail" ? "danger" : "outline"}>{g.name}: {gateIcon[g.status].l}</Badge>))}</span></li>))}</ul>
            </Panel>
          </div>
        ) : null}
        {tab === "provenance" ? (
          <Panel title="Procedência dos fatos" description="Cada fato aponta para uma fonte, com confiança e validade." bodyClassName="p-0">
            <ul className="divide-y divide-border">{current.knowledge.map((k) => (
              <li key={k.id}><Link href={`/knowledge/${k.id}`} className="flex flex-col gap-1.5 px-4 py-3 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none sm:flex-row sm:items-center sm:gap-4">
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{k.title}</span><span className="block truncate text-xs text-muted-foreground">Fonte: {sourceName.get(k.sourceId) ?? k.sourceId}</span></span>
                <span className="flex gap-1.5"><Badge tone={levelTone[k.confidence]}>Confiança {k.confidence}</Badge><Badge tone={knowledgeTone[k.status]}>{knowledgeLabel[k.status]}</Badge></span>
              </Link></li>))}</ul>
          </Panel>
        ) : null}
        {tab === "freshness" ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Fontes" bodyClassName="p-0"><ul className="divide-y divide-border">{current.sources.map((s) => (<li key={s.id}><Link href={`/data-sources/${s.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"><span className="min-w-0 flex-1 truncate text-sm">{s.name}</span><Badge tone={healthTone[s.health]}>{healthLabel[s.health]}</Badge><span className="w-24 text-right text-xs text-muted-foreground">{s.freshness}</span></Link></li>))}</ul></Panel>
            <Panel title="Fatos que pedem atenção" description="Em revisão ou expirados.">
              {unverified.length === 0 ? <p className="text-sm text-muted-foreground">Todos os fatos estão verificados e dentro da validade.</p> : <ul className="space-y-2.5">{unverified.map((k) => (<li key={k.id} className="flex items-start justify-between gap-3 text-sm"><Link href={`/knowledge/${k.id}`} className="hover:underline">{k.title}</Link><Badge tone={knowledgeTone[k.status]}>{knowledgeLabel[k.status]}</Badge></li>))}</ul>}
            </Panel>
          </div>
        ) : null}
      </div>
    </div>
  );
}
