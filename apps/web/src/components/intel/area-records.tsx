"use client";

import Link from "next/link";
import { useAppState } from "@/components/app-state";
import { Panel } from "@/components/ui/panel";
import type { PlannedAreaId } from "@/config/planned-areas";
import { stageLabel } from "@/lib/intel/lifecycle";
import { DataStateBadge, ScoreBar } from "./primitives";
import { useOpportunityIntel } from "./use-intel";

/** Registros que já existem no dataset para áreas ainda planejadas. Nada aqui é medição. */
export function AreaRecords({ id }: { id: PlannedAreaId }) {
  const { current } = useAppState();
  const intel = useOpportunityIntel(current);

  if (id === "templates") {
    return (
      <Panel title="Templates existentes" description="Somente leitura." action={<DataStateBadge state="demo" />}>
        <ul className="flex flex-col divide-y divide-border">
          {current.templates.map((t) => (
            <li key={t.id} className="py-2.5 text-[13px]">
              <p className="font-medium">{t.name} <span className="ml-1 font-mono text-[11px] text-muted-foreground">{t.pattern}</span></p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
              <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">{t.entityType} · {t.fields.join(", ")}</p>
            </li>
          ))}
        </ul>
      </Panel>
    );
  }

  if (id === "search-gaps") {
    const gaps = current.findings.filter((f) => f.section === "Lacunas");
    const orphan = current.queries.filter((q) => !q.opportunityId);
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Lacunas registradas" action={<DataStateBadge state="demo" />}>
          <ul className="flex flex-col gap-2.5 text-[13px]">{gaps.length ? gaps.map((g) => <li key={g.id}><p className="font-medium">{g.title}</p><p className="text-xs text-muted-foreground">{g.summary}</p></li>) : <li className="text-muted-foreground">Nenhuma.</li>}</ul>
        </Panel>
        <Panel title="Consultas sem oportunidade" action={<DataStateBadge state="derived" />}>
          <ul className="flex flex-col gap-1.5 text-[13px]">{orphan.length ? orphan.map((q) => <li key={q.id}>{q.text} <span className="text-xs text-muted-foreground">· {q.cluster}</span></li>) : <li className="text-muted-foreground">Todas as consultas têm oportunidade.</li>}</ul>
        </Panel>
      </div>
    );
  }

  if (id === "roadmap") {
    const rows = intel.filter((r) => r.o.status !== "dismissed").sort((a, b) => b.score.score - a.score.score);
    return (
      <Panel title="Ordem sugerida pelo score" description="Sem esforço estimado, a ordem considera só o score ilustrativo." action={<DataStateBadge state="derived" />}>
        <ol className="flex flex-col divide-y divide-border">
          {rows.map((r) => (
            <li key={r.o.id} className="flex flex-wrap items-center gap-3 py-2.5 text-[13px]">
              <Link href={`/opportunities/${r.o.id}`} className="min-w-0 flex-1 font-medium hover:underline">{r.o.title}</Link>
              <span className="text-xs text-muted-foreground">{stageLabel(r.life.stage)}{r.life.blocked ? " · bloqueada" : ""}</span>
              <ScoreBar value={r.score.score} label={`Score de ${r.o.title}`} className="w-32" />
            </li>
          ))}
        </ol>
      </Panel>
    );
  }

  return null;
}
