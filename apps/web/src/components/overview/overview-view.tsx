"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, CircleAlert, CircleCheck, CircleDashed, Clock } from "lucide-react";
import { useAppState } from "@/components/app-state";
import { PageHeader } from "@/components/ui/page-header";
import { buildPipeline, entityGroups as groupEntities } from "@/data/derive";
import { Badge, StatusDot } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, Panel } from "@/components/ui/panel";
import type { Gate, GateStatus, SourceHealth } from "@/data/demo/types";
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

function GateRow({ gate }: { gate: Gate }) {
  const { Icon, className, label } = gateLook[gate.status];
  return (
    <li className="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0">
      <Icon className={cn("mt-0.5 size-4 shrink-0", className)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{gate.name}</p>
        <p className="text-xs text-muted-foreground">{gate.detail}</p>
      </div>
      <span className={cn("text-xs font-medium", className)}>{label}</span>
    </li>
  );
}

export function OverviewView() {
  const { current } = useAppState();
  const { workspace, opportunities, sources, activity, gaps, gates } = current;
  const pipeline = buildPipeline(current, (_id, original) => original);
  const entityGroups = groupEntities(current);
  const ranked = [...opportunities].filter((o) => o.status !== "dismissed").sort((a, b) => a.rank - b.rank);
  const top = ranked[0];
  const needDecision = ranked.filter((o) => ["in_review", "blocked"].includes(o.status)).length;
  const topFour = ranked.slice(0, 4);

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Overview" }]}
        title={workspace.name}
        description={
          needDecision > 0
            ? `${needDecision} ${needDecision === 1 ? "oportunidade pede" : "oportunidades pedem"} uma decisão. As demais seguem o fluxo normal. Dados demonstrativos.`
            : "Nenhuma oportunidade pede decisão agora. Dados demonstrativos."
        }
        actions={
          top ? (
            <Link href={`/opportunities/${top.id}`} className={buttonVariants({ size: "lg" })}>
              Abrir a oportunidade prioritária
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          ) : (
            <Link href="/opportunities" className={buttonVariants({ size: "lg", variant: "outline" })}>Ver oportunidades</Link>
          )
        }
      />

      <section aria-label="Do dado à medição" className="rounded-xl border border-border bg-card">
        <ol className="flex divide-x divide-border overflow-x-auto rounded-xl">
          {pipeline.map((stage) => (
            <li key={stage.id} className="min-w-36 flex-1">
              <Link href={stage.href} className="block px-4 py-3 transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <StatusDot tone={stageDot[stage.state]} label={stageLabel[stage.state]} />
                  <span className="truncate">{stage.label}</span>
                </span>
                <span className="mt-1.5 block text-xl font-semibold tracking-tight tabular-nums">{stage.value}</span>
                <span className="block truncate text-xs text-muted-foreground">{stage.note}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel
            title="Oportunidades priorizadas"
            description="Ordem editorial; fatores separados, sem nota única."
            action={
              <Link href="/opportunities" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Ver todas
                <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            }
            bodyClassName="p-0"
          >
            {topFour.length === 0 ? (
              <EmptyState title="Nenhuma oportunidade ainda" hint="Quando o universo de buscas e o conhecimento estiverem conectados, as oportunidades aparecem aqui." />
            ) : (
              <ul className="divide-y divide-border">
                {topFour.map((o) => {
                  const status = o.status;
                  return (
                    <li key={o.id}>
                      <Link href={`/opportunities/${o.id}`} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none">
                        <span className="w-4 shrink-0 pt-0.5 font-mono text-xs text-muted-foreground tabular-nums">{o.rank}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{o.title}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{o.summary}</span>
                          <span className="mt-2 flex flex-wrap items-center gap-1.5">
                            <Badge tone={levelTone[o.demand]}>Demanda {o.demand}</Badge>
                            <Badge tone={levelTone[o.evidence]}>Evidência {o.evidence}</Badge>
                            <Badge tone={statusTone[status]}>{statusLabel[status]}</Badge>
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Atividade recente" description="Agentes, pessoas e o sistema (demonstração)." action={<Link href="/agents" className={buttonVariants({ variant: "ghost", size: "sm" })}>Agentes</Link>}>
            <ol className="relative space-y-4 border-l border-border pl-5">
              {activity.map((a) => (
                <li key={a.id} className="relative text-sm">
                  <span aria-hidden="true" className="absolute top-1.5 -left-[25px] size-2 rounded-full bg-muted-foreground/60 ring-4 ring-card" />
                  <p>
                    <span className="font-medium">{a.actor}</span> <span className="text-muted-foreground">{a.text}</span>
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Badge tone={a.kind === "agent" ? "brand" : a.kind === "human" ? "info" : "outline"}>{a.kind === "agent" ? "Agente" : a.kind === "human" ? "Pessoa" : "Sistema"}</Badge>
                    {a.when}
                  </p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="O que falta saber" description="Lacunas ligadas a oportunidades.">
            {gaps.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma lacuna de conhecimento registrada.</p>
            ) : (
              <ul className="space-y-3">
                {gaps.map((g) => (
                  <li key={g.id} className="flex items-start gap-2.5 text-sm">
                    <CircleDashed className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      {g.text}
                      {g.opportunityId ? (
                        <Link href={`/opportunities/${g.opportunityId}`} className="mt-0.5 block text-xs text-brand hover:underline">
                          Ver oportunidade
                        </Link>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Fontes de dados" description={`${sources.length} cadastradas (demonstração).`} bodyClassName="p-0">
            <ul className="divide-y divide-border">
              {sources.map((s) => (
                <li key={s.id}>
                  <Link href={`/data-sources/${s.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none">
                  <StatusDot tone={healthLook[s.health].tone} label={healthLook[s.health].label} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{s.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {s.type} · {s.records.toLocaleString("pt-BR")} registros
                    </span>
                  </span>
                  <span className="text-right text-xs text-muted-foreground">
                    <span className="block">{healthLook[s.health].label}</span>
                    <span className="block">{s.freshness}</span>
                  </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Entidades" description="Agrupadas por tipo.">
            <ul className="space-y-2.5">
              {entityGroups.map((g) => (
                <li key={g.id}>
                  <Link href="/entities" className="flex items-baseline justify-between gap-3 rounded text-sm hover:text-brand focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                  <span className="min-w-0">
                    <span className="block truncate">{g.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{g.examples.join(" · ")}</span>
                  </span>
                  <span className="font-medium tabular-nums">{g.count.toLocaleString("pt-BR")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Quality gates" description="Cada gate grava o próprio resultado." action={<Link href="/quality-trust" className={buttonVariants({ variant: "ghost", size: "sm" })}>Detalhes</Link>}>
            <ul className="divide-y divide-border">
              {gates.map((g) => (
                <GateRow key={g.id} gate={g} />
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
