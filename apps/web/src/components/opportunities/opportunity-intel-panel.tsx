"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { ScoreBreakdown } from "@/components/intel/score-breakdown";
import { DataStateBadge } from "@/components/intel/primitives";
import type { Opportunity, WorkspaceData } from "@/data/demo/types";
import { STAGES, UNVERIFIABLE_FROM, lifecycleOf, stageIndex } from "@/lib/intel/lifecycle";
import { rankArchetypes, requirementLabel } from "@/lib/intel/archetypes";
import { defaultWeights, scoreOpportunity } from "@/lib/intel/score";
import { cn } from "@/lib/utils";

/** Score explicável, ciclo de vida e arquétipo recomendado de uma oportunidade (tudo derivado do dataset). */
export function OpportunityIntelPanel({ owner, o }: { owner: WorkspaceData; o: Opportunity }) {
  const weights = defaultWeights();
  const score = scoreOpportunity(owner, o, weights);
  const life = lifecycleOf(owner, o);
  const [best, ...rest] = rankArchetypes(owner, o);
  const current = stageIndex(life.stage);
  const unverifiable = stageIndex(UNVERIFIABLE_FROM);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Panel title="Score explicável" description="Por que esta oportunidade está nesta posição.">
        <ScoreBreakdown result={score} weights={weights} />
      </Panel>

      <Panel title="Ciclo de vida" description="Da descoberta ao aprendizado. Etapas após a geração exigem registro verificado." className="lg:col-span-1">
        <ol className="flex flex-col">
          {STAGES.map((s, i) => {
            const reached = life.reached.has(s.id);
            const isCurrent = i === current;
            const locked = i >= unverifiable;
            return (
              <li key={s.id} className="flex items-start gap-2.5 py-1.5" aria-current={isCurrent ? "step" : undefined}>
                <span aria-hidden="true" className={cn("mt-1 size-2.5 shrink-0 border", reached ? "border-brand bg-brand" : locked ? "border-dashed border-muted-foreground/50" : "border-muted-foreground/50", isCurrent && "outline-2 outline-offset-2 outline-brand")} />
                <div className="min-w-0 text-[13px]">
                  <span className={cn(reached ? "text-foreground" : "text-muted-foreground", isCurrent && "font-medium")}>{s.label}</span>
                  {locked && !reached ? <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">sem registro</span> : null}
                  {isCurrent && life.blocked ? <p className="mt-0.5 text-xs text-destructive">{life.blockedReasons.join(" ")}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
        {life.skipped.length ? <p className="mt-2 text-xs text-warning">Pulou: {life.skipped.map((id) => STAGES.find((s) => s.id === id)!.label).join(", ")}.</p> : null}
      </Panel>

      <Panel title="Arquétipo recomendado" description="Formato de página derivado da intenção e dos dados disponíveis.">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{best.archetype.name}</p>
          <DataStateBadge state="derived" />
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{best.archetype.description}</p>
        <ul className="mt-3 flex flex-col gap-1 text-xs">{best.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        {best.missing.length ? (
          <div className="mt-3 border border-dashed border-warning/50 px-3 py-2 text-xs">
            <p className="font-medium text-warning">Dados exigidos ausentes</p>
            <ul className="mt-1 text-muted-foreground">{best.missing.map((m) => <li key={m}>{requirementLabel[m]}</li>)}</ul>
          </div>
        ) : null}
        <p className="mt-3 text-xs text-muted-foreground">Alternativas: {rest.slice(0, 2).map((r) => r.archetype.name).join(", ")}</p>
        <Button className="mt-4" render={<Link href={`/blueprints?o=${o.id}`} />}>Montar blueprint</Button>
      </Panel>
    </div>
  );
}
