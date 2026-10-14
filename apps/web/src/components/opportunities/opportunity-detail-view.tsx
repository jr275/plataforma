import Link from "next/link";
import { engine, type engine as E } from "@plataforma/api";
import { Badge } from "@/components/ui/badge";
import { Dl } from "@/components/ui/field";
import { Frame } from "@/components/ui/frame";
import { SectionTabs } from "@/components/ui/section-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import { TruthChip, TruthLegend, truthOfBasis } from "@/components/ui/truth-chip";
import { formatDateTime } from "@/components/generation/format";
import { StatePanel } from "@/components/generation/state-panel";
import type { OpportunityDetailData } from "@/lib/server/opportunities";
import type { Loaded } from "@/lib/server/tenant-data";
import { BlueprintPanel } from "./blueprint-panel";
import { ADAPTER_LABEL, OBJECTIVE_LABEL, PRIORITY_KIND, formatDate, num1 } from "./format";
import { RescoreForm, TransitionForm } from "./lifecycle-forms";
import type { VerticalMeta } from "./opportunities-home-view";
import { statusLabel, statusTone } from "./status";
import { VerticalContext } from "./vertical-context";

interface DimRow { id: E.DimensionId; value: number | null; basis: string; source: string | null; note: string }
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const NEXT_TONE = { action: "brand", decision: "warning", blocked: "danger", wait: "outline" } as const;
const NEXT_KIND = { action: "ação possível", decision: "decisão", blocked: "bloqueado", wait: "aguardando" } as const;

export interface DetailLabels { readonly intents: readonly { id: string; label: string }[]; readonly stages: readonly { id: string; label: string }[]; readonly experiences: readonly { id: string; label: string }[]; readonly vertical: VerticalMeta }

export function OpportunityDetailView({ loaded, intents, stages, experiences, vertical, listBase = "/opportunities" }: DetailLabels & { loaded: Loaded<OpportunityDetailData>; listBase?: string }) {
  if (loaded.state !== "ready") return <div className="space-y-6"><PageHeader crumbs={[{ label: "Oportunidades", href: listBase }, { label: "Detalhe" }]} title="Oportunidade" /><StatePanel state={loaded.state} missing={loaded.state === "not_configured" ? loaded.missing : undefined} /></div>;
  const { detail: o, configs, blueprints, investigation: inv, serpWaiver } = loaded.data;
  if (!o) return <div className="space-y-6"><PageHeader crumbs={[{ label: "Oportunidades", href: listBase }, { label: "Não encontrada" }]} title="Oportunidade não encontrada" /><Panel title="Estado"><EmptyState title="Não existe neste workspace" hint="O identificador pode estar errado ou pertencer a outro workspace." action={<Link href={listBase} className="text-xs underline underline-offset-2">Voltar para as oportunidades</Link>} /></Panel></div>;
  const latest = o.scores[0];
  const result = latest?.result;
  const pk = PRIORITY_KIND[o.priorityKind ?? "none"] ?? PRIORITY_KIND.none!;
  const intentLabel = intents.find((i) => i.id === o.intent)?.label ?? o.intent;
  const next = engine.manualNext(o.status).map((s) => ({ value: s, label: statusLabel(s) }));
  const dims = latest ? (Object.values(latest.dimensions) as DimRow[]) : [];
  const demand = o.demand as { basis?: string; note?: string };
  const validation = o.validation as { ok?: boolean; reasons?: string[] };
  const bpHref = `${listBase}/${o.id}/blueprint`;

  return (
    <div className="space-y-6">
      <PageHeader crumbs={[{ label: "Oportunidades", href: listBase }, { label: o.primaryQuery }]} title={o.primaryQuery}
        description="Hipótese de crescimento gerada pela vertical: não é volume de busca medido."
        badges={<span className="flex flex-wrap items-center gap-2"><Badge tone={statusTone(o.status)}>{statusLabel(o.status)}</Badge><Badge tone={pk.tone}>{pk.label}{o.priority !== null ? `: ${num1(o.priority)}` : ""}</Badge>{o.hypothesis ? <TruthChip state="estimated">hipótese</TruthChip> : null}<VerticalContext {...vertical} /></span>} />

      {inv ? (
        <Frame fig="1" caption="do dado à decisão" bodyClassName="p-0">
          <dl className="grid divide-y divide-border text-sm lg:grid-cols-5 lg:divide-x lg:divide-y-0">
            <div className="p-3"><dt className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">O que sei</dt><dd className="mt-1.5 space-y-1 text-xs">{inv.known.length ? inv.known.map((k) => (<p key={k}>{k}</p>)) : <p className="text-muted-foreground">Ainda sem score.</p>}</dd></div>
            <div className="p-3"><dt className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">De onde sei</dt><dd className="mt-1.5 space-y-1 text-xs">{inv.sources.length ? inv.sources.map((s) => (<p key={s.adapter}>{ADAPTER_LABEL[s.adapter] ?? s.adapter}: {s.count}</p>)) : <p className="text-muted-foreground">Nenhuma evidência coletada tocou este tema (não é evidência negativa).</p>}<p className="text-muted-foreground">Dados do tenant e regras da vertical sustentam as demais dimensões.</p></dd></div>
            <div className="p-3"><dt className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">O que falta ({inv.missing.length})</dt><dd className="mt-1.5 space-y-1 text-xs">{inv.missing.length ? inv.missing.slice(0, 4).map((m) => (<p key={m}>{m}</p>)) : <p className="text-muted-foreground">Nenhuma dimensão desconhecida.</p>}{inv.missing.length > 4 ? <p><a href="#dimensoes" className="underline underline-offset-2">+{inv.missing.length - 4} em “Dimensões”</a></p> : null}</dd></div>
            <div className="p-3"><dt className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">O que bloqueia</dt><dd className="mt-1.5 space-y-1 text-xs">{inv.blockers.length ? inv.blockers.map((b) => (<p key={b.key} className="text-destructive">{b.label}</p>)) : <p className="text-muted-foreground">Nenhum bloqueio registrado.</p>}</dd></div>
            <div className="p-3"><dt className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">Próximo passo</dt><dd className="mt-1.5 space-y-1.5 text-xs"><p><Badge tone={NEXT_TONE[inv.next.kind]}>{NEXT_KIND[inv.next.kind]}</Badge></p><p className="font-medium">{inv.next.label}</p><p className="text-muted-foreground">{inv.next.detail}</p>{inv.next.label === "Registrar a exceção de SERP" ? <p><Link href={`${bpHref}#serp`} className="underline underline-offset-2">Abrir a etapa SERP</Link></p> : null}</dd></div>
          </dl>
        </Frame>
      ) : null}

      <SectionTabs label="Seções" items={[["hipotese", "Hipótese"], ["score", "Score"], ["dimensoes", "Dimensões"], ["evidencia", "Evidência"], ["blueprint", "Blueprint"], ["historico", "Histórico"]]} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section id="hipotese"><Panel title="Hipótese" description="De onde vem esta oportunidade.">
          <Dl items={[
            { label: "Intenção", value: intentLabel }, { label: "Estágio", value: stages.find((s) => s.id === o.stage)?.label ?? o.stage }, { label: "Padrão da vertical", value: <span className="font-mono text-xs">{o.pattern}</span> },
            { label: "Tarefa do usuário (JTBD)", value: o.jtbd }, { label: "Experiência recomendada", value: experiences.find((x) => x.id === o.experience)?.label ?? o.experience }, { label: "Resultado esperado", value: o.expectedOutcome },
            { label: "Idioma e país", value: `${o.language} · ${o.country}` },
            { label: "Entidade de origem", value: o.entity ? <Link href={`/cities/${o.entity.id}`} className="underline underline-offset-2">{o.entity.name} ({o.entity.uf})</Link> : "Nenhuma (tema geral)" },
            { label: "Demanda de busca", value: <TruthChip state={truthOfBasis(demand.basis ?? "unknown")} /> },
          ]} />
          {demand.note ? <p className="mt-3 text-xs text-muted-foreground">{demand.note}</p> : null}
          <p className="mt-3 text-xs text-muted-foreground">Variações agrupadas (mesma intenção e entidade): {o.variants.join(" · ") || "nenhuma"}</p>
          <p className="mt-2 text-xs text-muted-foreground">Validação da vertical: {validation.ok ? "aderente" : `reprovada (${(validation.reasons ?? []).join("; ")})`}</p>
        </Panel></section>

        <section id="historico"><Panel title="Histórico e decisões" description="Cada passo, com autor e horário; eventos na ordem em que aconteceram.">
          <ol className="mb-4 max-h-64 space-y-2 overflow-y-auto text-xs" aria-label="Histórico">
            {o.events.map((e) => (
              <li key={e.id} className="border-l-2 border-border pl-3"><span className="font-mono text-[10.5px] text-muted-foreground">{formatDateTime(e.at)}</span> · {e.type === "transition" ? <>{e.from ? statusLabel(e.from as E.LifecycleState) : "—"} → <strong>{e.to ? statusLabel(e.to as E.LifecycleState) : "—"}</strong></> : e.type === "score" ? "Score calculado" : e.type === "blueprint" ? "Blueprint" : "Descoberta"}{e.reason ? <span className="text-muted-foreground"> — {e.reason}</span> : null}<span className="text-muted-foreground"> ({e.actor === "system" ? "sistema" : e.actor.slice(0, 8)})</span></li>
            ))}
          </ol>
          <TransitionForm key={o.status} opportunityId={o.id} from={o.status} options={next} />
        </Panel></section>
      </div>

      <section id="score"><Panel title="Score parcial" description={latest ? `Modelo ${latest.modelVersion} · configuração v${latest.configVersion} · ${formatDateTime(latest.createdAt)} · confiança ${pct(latest.confidence)}` : "Esta oportunidade ainda não tem score."}>
        {!result ? <EmptyState title="Sem score" hint="Uma nova pesquisa calcula o score das oportunidades validadas." /> : (
          <div className="space-y-5">
            <p role="note" className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs"><strong>{result.priority.note}</strong> Serve para ordenar a leitura; <strong>não substitui os seis gates</strong>. Dimensão desconhecida fica fora da conta e <strong>não é evidência negativa</strong>. Scores de cobertura diferente não são equivalentes.</p>
            <div className="grid gap-4 lg:grid-cols-3">
              {engine.OBJECTIVES.map((id) => {
                const ob = result.objectives[id];
                return (
                  <div key={id} className="rounded-lg border border-border p-3">
                    <h3 className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">{OBJECTIVE_LABEL[id]}</h3>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{ob.adjusted === null ? "—" : num1(ob.adjusted)}</p>
                    <p className="text-xs text-muted-foreground">Cobertura {pct(ob.coverage)} (mínimo {pct(ob.minCoverage)}){ob.confidence !== null ? ` · confiança ${pct(ob.confidence)}` : ""}</p>
                    {ob.reason ? <p className="mt-1 text-xs text-warning">Sem nota: {ob.reason}.</p> : null}
                    {ob.contributions.length > 0 ? (
                      <table className="mt-2 w-full text-xs"><caption className="sr-only">Contribuições de {OBJECTIVE_LABEL[id]}</caption><thead className="text-muted-foreground"><tr><th scope="col" className="text-left font-normal">Dimensão</th><th scope="col" className="pl-3 text-right font-normal">Peso</th><th scope="col" className="pl-3 text-right font-normal">Pontos</th></tr></thead>
                        <tbody>{ob.contributions.map((c) => (<tr key={c.dimension} className="border-t border-border"><td className="py-1">{engine.DIMENSION_INFO[c.dimension].label}</td><td className="text-right tabular-nums">{num1(c.weight)}</td><td className="text-right tabular-nums">{num1(c.points)}</td></tr>))}</tbody></table>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {result.penalties.length > 0 ? <ul className="space-y-1 text-xs"><li className="font-medium">Penalidades</li>{result.penalties.map((p, i) => (<li key={i} className="text-muted-foreground">{p.detail}</li>))}</ul> : null}
            <div>
              <h3 className="mb-1 text-[13px] font-medium">Elegibilidade: {result.eligibility.eligible ? "elegível" : "não elegível"}</h3>
              <ul className="space-y-1 text-xs">{result.eligibility.checks.map((c) => (<li key={c.code}><Badge tone={c.ok ? "success" : "danger"}>{c.ok ? "ok" : "falhou"}</Badge> <span className="ml-1">{c.detail}</span></li>))}</ul>
            </div>
            <p className="text-sm"><strong>Recomendação:</strong> {result.recommendation.action}</p>
            {result.explanations.length > 0 ? <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{result.explanations.map((x, i) => (<li key={i}>{x}</li>))}</ul> : null}
          </div>
        )}
      </Panel></section>

      {dims.length > 0 ? (
        <section id="dimensoes"><Panel title="Dimensões e a verdade de cada uma" description={`${15 - (result?.missing.length ?? 0)} de 15 com dado. Desconhecido nunca vira zero.`}>
          <div className="overflow-x-auto"><table className="w-full min-w-[40rem] text-left text-xs"><caption className="sr-only">Dimensões do score</caption>
            <thead className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase"><tr><th scope="col" className="py-2 pr-3">Dimensão</th><th scope="col" className="pr-3 text-right">Valor</th><th scope="col" className="pr-3">Verdade</th><th scope="col" className="pr-3">Fonte</th><th scope="col">Nota / o que falta</th></tr></thead>
            <tbody>{dims.map((d) => (<tr key={d.id} className="border-t border-border align-top"><td className="py-1.5 pr-3 font-medium">{engine.DIMENSION_INFO[d.id].label}</td><td className="pr-3 text-right tabular-nums">{d.value === null ? "—" : num1(d.value * 100)}</td><td className="pr-3"><TruthChip state={truthOfBasis(d.basis)} /></td><td className="pr-3 font-mono text-[10.5px]">{d.source ?? "—"}</td><td className="text-muted-foreground">{d.note}</td></tr>))}</tbody></table></div>
        </Panel></section>
      ) : null}

      <section id="evidencia"><Panel title="Evidência" description="Registros reais ligados a esta oportunidade, com fonte, data de coleta e a razão do vínculo.">
        {o.evidence.length === 0 ? <EmptyState title="Nenhuma evidência ligada" hint="Nenhum registro coletado nas fontes tocou o tema desta oportunidade. Isso não prova ausência de demanda." /> : (
          <ul className="space-y-3">{o.evidence.map((e) => (
            <li key={`${e.evidenceId}-${e.role}`} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><TruthChip state={truthOfBasis(e.evidence.basis)} /><Badge tone="outline">{e.evidence.kind === "indicator" ? "indicador" : "notícia"}</Badge><Badge tone="info">{e.role === "signal" ? "sinal de tema" : "sustenta um requisito"}</Badge><span className="text-xs text-muted-foreground">{ADAPTER_LABEL[e.evidence.adapter] ?? e.evidence.adapter} · coletado em {formatDate(e.evidence.collectedAt)}{e.evidence.publishedAt ? ` · publicado em ${formatDate(e.evidence.publishedAt)}` : ""}</span></div>
              <p className="mt-1 font-medium">{e.evidence.title}</p>
              {e.evidence.summary ? <p className="text-xs text-muted-foreground">{e.evidence.summary}</p> : null}
              <p className="mt-1 text-xs"><strong>Por que está aqui:</strong> {e.reason}</p>
              {e.evidence.limitations.length > 0 ? <p className="mt-1 text-xs text-muted-foreground">Limitações: {e.evidence.limitations.join(" ")}</p> : null}
              <a href={e.evidence.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block break-all text-xs underline underline-offset-2">{e.evidence.url}</a>
            </li>))}</ul>
        )}
      </Panel></section>

      <section id="blueprint"><BlueprintPanel opportunityId={o.id} blueprints={blueprints} canCreate={["eligible", "serp_analyzed", "blueprinted"].includes(o.status)} serpWaiver={serpWaiver} detailHref={bpHref} /></section>

      <Panel title="Ajustar o score" description="Reavalie com outra versão da configuração (pesos e limites). Veja e edite as versões em “Configurar o score”.">
        <RescoreForm opportunityId={o.id} versions={configs.map((c) => ({ version: c.version, note: c.note }))} />
        {o.scores.length > 1 ? (
          <table className="mt-4 w-full text-xs"><caption className="mb-1 text-left text-muted-foreground">Histórico de scores (compare só scores de mesma cobertura)</caption><thead className="font-mono text-[10.5px] text-muted-foreground uppercase"><tr><th scope="col" className="text-left font-normal">Quando</th><th scope="col" className="text-left font-normal">Config.</th><th scope="col" className="text-right font-normal">Prioridade</th><th scope="col" className="pl-3 text-left font-normal">Tipo</th><th scope="col" className="text-right font-normal">Dim. conhecidas</th><th scope="col" className="text-right font-normal">Elegível</th></tr></thead>
            <tbody>{o.scores.map((s) => (<tr key={s.id} className="border-t border-border"><td className="py-1">{formatDateTime(s.createdAt)}</td><td>v{s.configVersion}</td><td className="text-right tabular-nums">{num1(s.priority)}</td><td className="pl-3">{PRIORITY_KIND[s.priorityKind]?.label ?? s.priorityKind}</td><td className="text-right tabular-nums">{15 - (s.result.missing?.length ?? 0)}/15</td><td className="text-right">{s.eligible ? "sim" : "não"}</td></tr>))}</tbody></table>
        ) : null}
      </Panel>
      <TruthLegend />
    </div>
  );
}
