"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useAppState } from "@/components/app-state";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/panel";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import type { Finding } from "@/data/demo/types";
import { cn } from "@/lib/utils";

type Section = "todas" | Finding["section"];

export function ResearchView() {
  const { current } = useAppState();
  const [section, setSection] = useState<Section>("todas");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const sections: Section[] = ["todas", "Mercado", "Concorrência", "Lacunas"];
  const count = (s: Section) => (s === "todas" ? current.findings.length : current.findings.filter((f) => f.section === s).length);
  const shown = current.findings.filter((f) => section === "todas" || f.section === section);
  const entityLabel = new Map(current.entities.map((e) => [e.id, e.label]));
  const toggle = (id: string) => setOpen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-6">
      <PageHeader crumbs={[{ label: "Research" }]} title="Research" description={`Achados de pesquisa de demonstração em ${current.workspace.name}: o que o mercado pede, como a concorrência responde e onde faltam fatos.`} badges={<Badge tone="warning">Achados fictícios</Badge>} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {sections.map((s) => (
          <button key={s} type="button" onClick={() => setSection(s)} aria-pressed={section === s} className={cn("rounded-xl border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", section === s ? "border-brand/40 bg-brand/10" : "border-border bg-card hover:bg-accent/50")}>
            <span className="block text-xs text-muted-foreground">{s === "todas" ? "Todos os achados" : s}</span>
            <span className="mt-1 block text-xl font-semibold tabular-nums">{count(s)}</span>
          </button>
        ))}
      </div>
      <Tabs label="Seções de pesquisa" value={section} onChange={setSection} tabs={sections.map((s) => ({ id: s, label: s === "todas" ? "Todas" : s, count: count(s) }))} />
      <div id="tabpanel" role="tabpanel" className="space-y-3">
        {shown.length === 0 ? <EmptyState title="Nenhum achado nesta seção" hint="Quando houver pesquisa registrada, ela aparece aqui." /> : null}
        {shown.map((f) => (
          <article key={f.id} className="card-cut">
            <button type="button" onClick={() => toggle(f.id)} aria-expanded={open.has(f.id)} className="flex w-full items-start gap-3 p-4 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><Badge tone={f.section === "Lacunas" ? "warning" : f.section === "Mercado" ? "brand" : "info"}>{f.section}</Badge></span>
                <span className="mt-1.5 block text-sm font-medium">{f.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{f.summary}</span>
              </span>
              <ChevronDown className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", open.has(f.id) && "rotate-180")} aria-hidden="true" />
            </button>
            {open.has(f.id) ? (
              <div className="space-y-3 border-t border-border p-4 text-sm">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Evidências (demonstração)</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 marker:text-muted-foreground">{f.evidence.map((e) => (<li key={e}>{e}</li>))}</ul>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {f.entityIds.map((id) => (<Link key={id} href={`/entities/${id}`} className="inline-flex"><Badge tone="outline" className="h-6 px-2 text-xs hover:text-foreground">{entityLabel.get(id) ?? id}</Badge></Link>))}
                  {f.opportunityId ? <Link href={`/opportunities/${f.opportunityId}`} className={buttonVariants({ size: "sm", variant: "outline" })}>Abrir oportunidade</Link> : null}
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
