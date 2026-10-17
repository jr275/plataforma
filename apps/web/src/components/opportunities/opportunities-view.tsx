"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { useAppState } from "@/components/app-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { SearchField, norm } from "@/components/ui/filters";
import { EmptyState } from "@/components/ui/panel";
import { PageHeader } from "@/components/ui/page-header";
import { DataStateBadge, Fact, Inspector, ScoreBar, Section, SortHeader, StateNotice } from "@/components/intel/primitives";
import { ScoreBreakdown } from "@/components/intel/score-breakdown";
import { useOpportunityIntel, type OpportunityIntel } from "@/components/intel/use-intel";
import { stageLabel } from "@/lib/intel/lifecycle";
import { buyerStageOf, defaultWeights, type Weights } from "@/lib/intel/score";
import { levelTone, statusLabel, statusTone } from "@/lib/opportunity";
import { cn } from "@/lib/utils";

type SortKey = "score" | "demand" | "evidence" | "risk" | "stage";
const levelRank = { alta: 3, média: 2, baixa: 1 } as const;

export function OpportunitiesView() {
  const { current } = useAppState();
  const router = useRouter();
  const ref = useSearchParams().get("ref");
  const [weights, setWeights] = useState<Weights>(defaultWeights);
  const intel = useOpportunityIntel(current, weights);
  const [text, setText] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "score", dir: "desc" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editWeights, setEditWeights] = useState(false);

  const entityLabels = useMemo(() => new Map(current.entities.map((e) => [e.id, e.label])), [current]);
  const refLabel = ref ? (entityLabels.get(ref) ?? current.sources.find((s) => s.id === ref)?.name) : undefined;

  const rows = useMemo(() => {
    const q = norm(text.trim());
    const risk = (x: OpportunityIntel) => x.score.dimensions.find((d) => d.id === "evidenceRisk")?.value ?? 0;
    const value: Record<SortKey, (x: OpportunityIntel) => number> = {
      score: (x) => x.score.score,
      demand: (x) => levelRank[x.o.demand],
      evidence: (x) => levelRank[x.o.evidence],
      risk,
      stage: (x) => x.life.reached.size,
    };
    return intel
      .filter(({ o, clusters: cs }) => {
        if (o.status === "dismissed") return false; // o produto mostra só as ativas; descartadas não pedem decisão
        if (ref && !o.entityIds.includes(ref) && !o.sourceIds.includes(ref)) return false;
        const entities = o.entityIds.map((id) => entityLabels.get(id) ?? "").join(" ");
        return !q || norm(`${o.title} ${o.summary} ${o.intent} ${entities} ${cs.join(" ")}`).includes(q);
      })
      .sort((a, b) => (sort.dir === "desc" ? -1 : 1) * (value[sort.key](a) - value[sort.key](b)) || a.o.rank - b.o.rank);
  }, [intel, ref, text, sort, entityLabels]);

  const selected = rows.find((r) => r.o.id === selectedId) ?? null;
  const onSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));
  const customWeights = Object.entries(weights).some(([k, v]) => defaultWeights()[k as keyof Weights] !== v);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        crumbs={[{ label: "Intelligence" }, { label: "Opportunity Discovery" }]}
        title="Opportunity Discovery"
        description="Oportunidades ranqueadas por um score explicável. Cada dimensão mostra de onde vem; o que não tem dado fica de fora e reduz a confiança."
        badges={<><DataStateBadge state="demo" /><DataStateBadge state="derived" /><span className="text-xs text-muted-foreground">Dataset Exemplo Labs</span></>}
        actions={<Button variant="outline" onClick={() => setEditWeights((v) => !v)} aria-pressed={editWeights}>{editWeights ? "Fechar pesos" : "Ajustar pesos"}</Button>}
      />

      <div className="flex flex-col gap-3 card-cut p-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchField value={text} onChange={setText} placeholder="Buscar por tema, entidade ou cluster" label="Buscar oportunidades" className="w-full sm:w-80" />
        </div>
        <div role="group" aria-label="Status" className="flex flex-wrap items-center gap-1.5">
          {refLabel ? (
            <button type="button" onClick={() => router.replace("/opportunities")} className="ml-auto inline-flex h-7 items-center gap-1.5 border border-brand/40 bg-brand/10 px-2.5 text-xs text-brand">
              Ligadas a {refLabel} <X className="size-3" aria-hidden="true" /><span className="sr-only">Remover filtro</span>
            </button>
          ) : null}
          {customWeights ? <span className="ml-auto text-xs text-warning">Pesos personalizados (só nesta sessão, não salvos)</span> : null}
        </div>
      </div>

      <div className={cn("grid grid-cols-1 gap-4", selected || editWeights ? "lg:grid-cols-[minmax(0,1fr)_380px]" : "")}>
        <div className="min-w-0 overflow-x-auto card-cut">
          {rows.length === 0 ? (
            <div className="p-6"><EmptyState title="Nenhuma oportunidade com esses filtros." hint="Limpe a busca ou ative outros status." /></div>
          ) : (
            <table className="w-full min-w-[860px] text-[13px]">
              <caption className="sr-only">Oportunidades ranqueadas. Selecione uma linha para ver a decomposição do score.</caption>
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-mono text-[10px] font-normal tracking-[0.08em] text-muted-foreground uppercase">Oportunidade</th>
                  <th scope="col" className="px-3 py-2 text-left font-mono text-[10px] font-normal tracking-[0.08em] text-muted-foreground uppercase">Intenção · estágio</th>
                  <SortHeader id="demand" label="Demanda" sort={sort} onSort={onSort} />
                  <SortHeader id="evidence" label="Evidência" sort={sort} onSort={onSort} />
                  <SortHeader id="risk" label="Risco" sort={sort} onSort={onSort} />
                  <SortHeader id="score" label="Score" sort={sort} onSort={onSort} className="w-36" />
                  <SortHeader id="stage" label="Ciclo" sort={sort} onSort={onSort} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const risk = Math.round((r.score.dimensions.find((d) => d.id === "evidenceRisk")?.value ?? 0) * 100);
                  const isSel = r.o.id === selectedId;
                  return (
                    <tr
                      key={r.o.id}
                      aria-selected={isSel}
                      onClick={() => setSelectedId(isSel ? null : r.o.id)}
                      className={cn("cursor-pointer border-b border-border last:border-b-0 hover:bg-accent/50", isSel && "bg-brand/10 hover:bg-brand/10")}
                    >
                      <td className="max-w-80 px-3 py-2.5 align-top">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSelectedId(isSel ? null : r.o.id); }}
                          className="text-left font-medium text-pretty hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          {r.o.title}
                        </button>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge tone={statusTone[r.o.status]}>{statusLabel[r.o.status]}</Badge>
                          {r.clusters.map((c) => <span key={c} className="font-mono text-[10.5px] text-muted-foreground">{c}</span>)}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-top text-muted-foreground">
                        <span className="text-foreground">{r.o.intent}</span>
                        <br />
                        <span className="text-xs">{buyerStageOf(r.o)}</span>
                      </td>
                      <td className="px-3 py-2.5 align-top"><Badge tone={levelTone[r.o.demand]}>{r.o.demand}</Badge></td>
                      <td className="px-3 py-2.5 align-top"><Badge tone={levelTone[r.o.evidence]}>{r.o.evidence}</Badge></td>
                      <td className="px-3 py-2.5 align-top"><span className={cn("font-mono text-xs tabular-nums", risk >= 60 ? "text-destructive" : risk >= 30 ? "text-warning" : "text-muted-foreground")}>{risk}</span></td>
                      <td className="px-3 py-2.5 align-top">
                        <ScoreBar value={r.score.score} label={`Score de ${r.o.title}`} />
                        <span className="font-mono text-[10.5px] text-muted-foreground">conf. {r.score.confidence}</span>
                      </td>
                      <td className="px-3 py-2.5 align-top text-xs">
                        <span>{stageLabel(r.life.stage)}</span>
                        {r.life.blocked ? <><br /><span className="text-destructive">bloqueada</span></> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {editWeights ? (
          <Inspector title="Pesos do score" subtitle={<span className="text-xs text-muted-foreground">Local, não persistido. Valem só nesta sessão.</span>} onClose={() => setEditWeights(false)} footer={<Button variant="outline" onClick={() => setWeights(defaultWeights())}>Restaurar padrão</Button>}>
            {selected ? <ScoreBreakdown result={selected.score} weights={weights} onWeight={(id, w) => setWeights((p) => ({ ...p, [id]: w }))} compact /> : <StateNotice state="empty" title="Selecione uma oportunidade">Os pesos se aplicam à lista inteira; selecione uma linha para ver o efeito na decomposição.</StateNotice>}
          </Inspector>
        ) : selected ? (
          <OpportunityInspector r={selected} weights={weights} onClose={() => setSelectedId(null)} />
        ) : null}
      </div>
    </div>
  );
}

function OpportunityInspector({ r, weights, onClose }: { r: OpportunityIntel; weights: Weights; onClose: () => void }) {
  const { o, life, archetype } = r;
  return (
    <Inspector
      title={o.title}
      subtitle={<><Badge tone={statusTone[o.status]}>{statusLabel[o.status]}</Badge><Badge tone="outline">{o.kind}</Badge></>}
      onClose={onClose}
      footer={
        <>
          <LinkButton href={`/opportunities/${o.id}`}>Abrir oportunidade</LinkButton>
          <LinkButton variant="outline" href={`/blueprints?o=${o.id}`}>Montar blueprint</LinkButton>
        </>
      }
    >
      <Section title="Score"><ScoreBreakdown result={r.score} weights={weights} compact /></Section>
      <Section title="Ciclo de vida">
        <dl>
          <Fact label="Etapa atual" value={stageLabel(life.stage)} state="derived" />
          <Fact label="Etapas puladas" value={life.skipped.length ? life.skipped.map(stageLabel).join(", ") : "nenhuma"} />
        </dl>
        {life.blocked ? (
          <ul className="mt-2 flex flex-col gap-1 text-xs text-destructive">{life.blockedReasons.map((b) => <li key={b}>{b}</li>)}</ul>
        ) : null}
      </Section>
      <Section title="Arquétipo recomendado">
        <p className="text-[13px] font-medium">{archetype.archetype.name}</p>
        <ul className="mt-1.5 flex flex-col gap-1 text-xs text-muted-foreground">{archetype.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
        {archetype.missing.length ? <p className="mt-2 text-xs text-warning">Faltam {archetype.missing.length} requisito(s) de dados.</p> : null}
      </Section>
      <Section title="Próxima ação"><p className="text-[13px]">{o.nextAction}</p></Section>
    </Inspector>
  );
}
