import Link from "next/link";
import { engine, type engine as E } from "@plataforma/api";
import { Badge, type Tone } from "@/components/ui/badge";
import { Frame } from "@/components/ui/frame";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import { formatInt } from "@/components/generation/format";
import { StatePanel } from "@/components/generation/state-panel";
import type { Loaded } from "@/lib/server/tenant-data";
import { LifecycleBoard } from "./lifecycle-board";
import type { VerticalMeta } from "./opportunities-home-view";
import { VerticalContext } from "./vertical-context";
import { TruthChip } from "@/components/ui/truth-chip";

const LANE_TONE: Record<E.Lane, Tone> = { ready: "success", blocked: "danger", awaiting_blueprint: "info", needs_work: "warning" };


/** Roadmap: derivado do que foi gravado. Agrupa por prontidão e SOMA os bloqueios (o que destrava mais oportunidades vem primeiro). Nada é prometido. */
export function RoadmapView({ loaded, vertical, detailBase = "/opportunities", listBase = "/opportunities" }: { loaded: Loaded<E.Roadmap>; intents: readonly { id: string; label: string }[]; vertical: VerticalMeta; /** A prévia de desenvolvimento usa outra base de rotas. */ detailBase?: string; listBase?: string }) {
  const header = <PageHeader crumbs={[{ label: "Oportunidades", href: listBase }, { label: "Roadmap" }]} badges={<VerticalContext {...vertical} />} title="Roadmap" description="O que está pronto para construir, o que está bloqueado e por quê. Os bloqueios são somados: resolver um deles destrava todas as oportunidades que dependem dele." />;
  if (loaded.state !== "ready") return <div className="space-y-6">{header}<StatePanel state={loaded.state} missing={loaded.state === "not_configured" ? loaded.missing : undefined} /></div>;
  const rm = loaded.data;
  if (rm.total === 0) return <div className="space-y-6">{header}<Panel title="Roadmap"><EmptyState title="Nenhuma oportunidade pontuada ainda" hint="O roadmap só considera oportunidades já pontuadas. Inicie uma pesquisa em Oportunidades." action={<Link href="/opportunities" className="text-xs underline underline-offset-2">Ir para Oportunidades</Link>} /></Panel></div>;
  return (
    <div className="space-y-6">
      {header}
      <p className="text-xs text-muted-foreground" data-testid="origin">Banco: {loaded.origin ? (loaded.origin.kind === "local" ? "local (ambiente de desenvolvimento)" : loaded.origin.host) : "não identificado"} · Prioridade é parcial: demanda, SERP e concorrência não são medidas</p>
      <Frame fig="1" caption="do dado à publicação: etapas do ciclo de vida" dots className="overflow-x-auto">
        <ol className="flex min-w-max items-stretch gap-1 text-xs">
          {engine.STATES.filter((st) => !["rejected", "retired"].includes(st)).map((st) => {
            const n = rm.byStatus[st] ?? 0; const impl = engine.IMPLEMENTED_STATES.includes(st);
            return (<li key={st} className={`flex w-28 flex-col gap-1 rounded-md border px-2 py-1.5 ${impl ? "border-border" : "border-dashed border-border opacity-70"}`} data-stage={st} data-implemented={impl}><span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">{engine.STATE_LABEL[st]}</span><span className="text-lg font-semibold tabular-nums">{n}</span>{impl ? null : <span className="text-[10px] text-muted-foreground">sem fluxo</span>}</li>);
          })}
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">Etapas tracejadas existem no ciclo de vida, mas nenhum fluxo as executa ainda (dados, QA, publicação…): nenhuma oportunidade chega lá por este sistema. {rm.byStatus.serp_analyzed ? "" : <TruthChip state="not_evaluated">SERP analisada: 0 (sem provedor)</TruthChip>}</p>
      </Frame>
      <dl className="grid gap-3 sm:grid-cols-4" aria-label="Oportunidades por prontidão">
        {engine.LANES.map((l) => (<div key={l} className="rounded-xl border border-border bg-card px-4 py-3"><dt className="font-mono text-[10.5px] tracking-[0.08em] text-muted-foreground uppercase">{engine.LANE_LABEL[l]}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{formatInt(rm.counts[l])}</dd></div>))}
      </dl>
      <Panel title="O que mais bloqueia" description="Cada linha é um bloqueio e quantas oportunidades dependem dele.">
        {rm.blockers.length === 0 ? <EmptyState title="Nenhum bloqueio registrado" hint="Não há oportunidades bloqueadas nem fora da elegibilidade." /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[32rem] text-left text-sm"><caption className="sr-only">Bloqueios somados</caption>
            <thead className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase"><tr><th scope="col" className="py-2 pr-4 text-right">Oportunidades</th><th scope="col" className="pr-4">Bloqueio</th><th scope="col">Faixa</th></tr></thead>
            <tbody>{rm.blockers.slice(0, 15).map((b) => (<tr key={`${b.lane}-${b.key}`} className="border-t border-border"><td className="py-2 pr-4 text-right font-medium tabular-nums">{formatInt(b.count)}</td><td className="pr-4">{b.label}</td><td><Badge tone={LANE_TONE[b.lane]}>{engine.LANE_LABEL[b.lane]}</Badge></td></tr>))}</tbody></table></div>
        )}
      </Panel>
      <LifecycleBoard items={Object.values(rm.items).flat()} stages={engine.STATES.map((st) => ({ id: st, label: engine.STATE_LABEL[st], count: rm.byStatus[st] ?? 0, implemented: engine.IMPLEMENTED_STATES.includes(st) }))} total={rm.total} detailBase={detailBase} />
    </div>
  );
}
