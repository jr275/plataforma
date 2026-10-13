"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CircleAlert, CircleCheck, CircleDashed, Clock } from "lucide-react";
import { useAppState } from "@/components/app-state";
import { Badge, StatusDot } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Frame, labelClass } from "@/components/ui/frame";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/panel";
import { Tabs } from "@/components/ui/tabs";
import { buildPipeline, entityGroups as groupEntities } from "@/data/derive";
import type { GateStatus, Opportunity, SourceHealth } from "@/data/demo/types";
import { levelTone, statusLabel, statusTone } from "@/lib/opportunity";
import { cn } from "@/lib/utils";

const healthLook: Record<SourceHealth, { tone: "success" | "warning" | "danger" | "idle"; label: string }> = {
  pending: { tone: "idle", label: "Simulada" },
  ok: { tone: "success", label: "Saudável" },
  stale: { tone: "warning", label: "Desatualizada" },
  error: { tone: "danger", label: "Com erro" },
};
const gateLook: Record<GateStatus, { Icon: typeof CircleCheck; className: string; label: string }> = {
  pass: { Icon: CircleCheck, className: "text-success", label: "Passou" },
  fail: { Icon: CircleAlert, className: "text-destructive", label: "Falhou" },
  pending: { Icon: Clock, className: "text-muted-foreground", label: "Pendente" },
};
const stageDot = { ok: "success", attention: "warning", idle: "idle" } as const;
const stageLabel = { ok: "Em ordem", attention: "Pede atenção", idle: "Sem atividade" } as const;

type Tab = "resumo" | "oportunidades" | "conhecimento" | "fontes" | "atividade";

function OpportunityRow({ o }: { o: Opportunity }) {
  return (
    <li>
      <Link href={`/opportunities/${o.id}`} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
        <span className="w-5 shrink-0 pt-0.5 font-mono text-xs text-muted-foreground tabular-nums">{String(o.rank).padStart(2, "0")}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{o.title}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{o.summary}</span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone={levelTone[o.demand]}>Demanda {o.demand}</Badge>
            <Badge tone={levelTone[o.evidence]}>Evidência {o.evidence}</Badge>
            <Badge tone={statusTone[o.status]}>{statusLabel[o.status]}</Badge>
          </span>
        </span>
      </Link>
    </li>
  );
}

export function OverviewView() {
  const { current } = useAppState();
  const [tab, setTab] = useState<Tab>("resumo");
  const { workspace, opportunities, sources, activity, gaps, gates } = current;
  const pipeline = buildPipeline(current, (_id, original) => original);
  const groups = groupEntities(current);
  const ranked = [...opportunities].filter((o) => o.status !== "dismissed").sort((a, b) => a.rank - b.rank);
  const top = ranked[0];
  const deciding = ranked.filter((o) => ["in_review", "blocked"].includes(o.status));

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Overview" }]}
        title={workspace.name}
        description={deciding.length > 0 ? `${deciding.length} ${deciding.length === 1 ? "oportunidade pede" : "oportunidades pedem"} a sua decisão. O resto segue o fluxo.` : "Nada pede a sua decisão agora."}
        actions={
          top ? (
            <Link href={`/opportunities/${top.id}`} className={buttonVariants({ size: "lg" })}>
              Abrir a prioritária
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          ) : null
        }
      />

      <Frame fig="1" caption="do dado à medição" dots>
        <ol className="flex items-stretch overflow-x-auto pb-1">
          {pipeline.map((stage, i) => (
            <li key={stage.id} className="flex items-center">
              <Link href={stage.href} className="block min-w-28 border border-border bg-card p-3 transition-colors hover:border-primary focus-visible:border-primary focus-visible:outline-none">
                <span className={`${labelClass} flex items-center gap-1.5 text-[10px] text-muted-foreground`}>
                  <StatusDot tone={stageDot[stage.state]} label={stageLabel[stage.state]} />
                  {String(i + 1).padStart(2, "0")} {stage.label}
                </span>
                <span className="mt-2 block text-2xl font-semibold tracking-tight tabular-nums">{stage.value}</span>
                <span className="block text-xs text-muted-foreground">{stage.note}</span>
              </Link>
              {i < pipeline.length - 1 ? <ArrowRight className="mx-1.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
            </li>
          ))}
        </ol>
        <p className={`${labelClass} mt-4 border border-border bg-card px-3 py-2 text-center text-[10px] text-muted-foreground`}>O sistema avança onde você decide · nada é publicado sem passar nos gates</p>
      </Frame>

      <Tabs
        label="Seções do overview"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "resumo", label: "Resumo" },
          { id: "oportunidades", label: "Oportunidades", count: ranked.length },
          { id: "conhecimento", label: "Conhecimento" },
          { id: "fontes", label: "Fontes", count: sources.length },
          { id: "atividade", label: "Atividade", count: activity.length },
        ]}
      />

      <div id="tabpanel" role="tabpanel">
        {tab === "resumo" ? (
          <Frame fig="2" caption="o que pede você">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <section aria-labelledby="ov-decide">
                <h2 id="ov-decide" className={`${labelClass} mb-3 text-[10px] text-muted-foreground`}>Pedem decisão</h2>
                {deciding.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma oportunidade pede decisão.</p>
                ) : (
                  <ul className="-mx-4 divide-y divide-border border-y border-border">
                    {deciding.map((o) => <OpportunityRow key={o.id} o={o} />)}
                  </ul>
                )}
              </section>
              <section aria-labelledby="ov-gaps">
                <h2 id="ov-gaps" className={`${labelClass} mb-3 text-[10px] text-muted-foreground`}>O que falta saber</h2>
                {gaps.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma lacuna registrada.</p>
                ) : (
                  <ul className="space-y-3">
                    {gaps.map((g) => (
                      <li key={g.id} className="flex items-start gap-2.5 text-sm">
                        <CircleDashed className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          {g.text}
                          {g.opportunityId ? <Link href={`/opportunities/${g.opportunityId}`} className="mt-0.5 block text-xs text-primary hover:underline">Ver oportunidade</Link> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </Frame>
        ) : null}

        {tab === "oportunidades" ? (
          <Frame fig="2" caption="oportunidades priorizadas" bodyClassName="p-0">
            {ranked.length === 0 ? (
              <EmptyState title="Nenhuma oportunidade ainda" hint="Quando o universo de buscas e o conhecimento estiverem conectados, elas aparecem aqui." />
            ) : (
              <ul className="divide-y divide-border">{ranked.slice(0, 5).map((o) => <OpportunityRow key={o.id} o={o} />)}</ul>
            )}
            <div className="border-t border-border p-3">
              <Link href="/opportunities" className={buttonVariants({ variant: "outline", size: "sm" })}>Ver todas <ArrowUpRight data-icon="inline-end" aria-hidden="true" /></Link>
            </div>
          </Frame>
        ) : null}

        {tab === "conhecimento" ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Frame fig="2" caption="entidades por tipo">
              <ul className="space-y-3">
                {groups.map((g) => (
                  <li key={g.id}>
                    <Link href="/entities" className="flex items-baseline justify-between gap-3 text-sm hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                      <span className="min-w-0"><span className="block">{g.label}</span><span className="block text-xs text-muted-foreground">{g.examples.join(" · ")}</span></span>
                      <span className="font-mono font-medium tabular-nums">{g.count.toLocaleString("pt-BR")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Frame>
            <Frame fig="3" caption="gates de qualidade">
              <ul className="divide-y divide-border">
                {gates.map((g) => {
                  const { Icon, className, label } = gateLook[g.status];
                  return (
                    <li key={g.id} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
                      <Icon className={cn("mt-0.5 size-4 shrink-0", className)} aria-hidden="true" />
                      <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{g.name}</span><span className="block text-xs text-muted-foreground">{g.detail}</span></span>
                      <span className={cn("font-mono text-[11px] uppercase", className)}>{label}</span>
                    </li>
                  );
                })}
              </ul>
              <Link href="/quality-trust" className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-4`}>Detalhes</Link>
            </Frame>
          </div>
        ) : null}

        {tab === "fontes" ? (
          <Frame fig="2" caption="fontes de dados" bodyClassName="p-0">
            <ul className="divide-y divide-border">
              {sources.map((s) => (
                <li key={s.id}>
                  <Link href={`/data-sources/${s.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                    <StatusDot tone={healthLook[s.health].tone} label={healthLook[s.health].label} />
                    <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{s.name}</span><span className="block text-xs text-muted-foreground">{s.type} · {s.records.toLocaleString("pt-BR")} registros</span></span>
                    <span className="text-right text-xs text-muted-foreground"><span className="block">{healthLook[s.health].label}</span><span className="block">{s.freshness}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          </Frame>
        ) : null}

        {tab === "atividade" ? (
          <Frame fig="2" caption="atividade recente">
            <ol className="relative space-y-4 border-l border-border pl-5">
              {activity.map((a) => (
                <li key={a.id} className="relative text-sm">
                  <span aria-hidden="true" className="absolute top-1.5 -left-[25px] size-2 bg-primary ring-4 ring-card" />
                  <p><span className="font-medium">{a.actor}</span> <span className="text-muted-foreground">{a.text}</span></p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Badge tone={a.kind === "agent" ? "brand" : a.kind === "human" ? "info" : "outline"}>{a.kind === "agent" ? "Agente" : a.kind === "human" ? "Pessoa" : "Sistema"}</Badge>
                    {a.when}
                  </p>
                </li>
              ))}
            </ol>
            <Link href="/agents" className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-4`}>Agentes</Link>
          </Frame>
        ) : null}
      </div>
    </div>
  );
}
