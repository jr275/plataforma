import Link from "next/link";
import { engine } from "@plataforma/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import { RUN_STATUS, formatDateTime, formatInt } from "@/components/generation/format";
import { StatePanel } from "@/components/generation/state-panel";
import type { TrendsData } from "@/lib/server/opportunities";
import type { Loaded } from "@/lib/server/tenant-data";
import { TruthChip, TruthLegend, truthOfBasis } from "@/components/ui/truth-chip";
import { ADAPTER_LABEL, formatDate } from "./format";
import type { VerticalMeta } from "./opportunities-home-view";
import { VerticalContext } from "./vertical-context";

const DAY = 86_400_000;
/** Frescor pela data de PUBLICAÇÃO (ou, sem ela, a de coleta): até 7 dias recente, até 30 atual, acima disso antigo. */
export function freshness(publishedAt: Date | null, collectedAt: Date, now: Date): { label: string; tone: "success" | "info" | "warning"; days: number; basis: "publicação" | "coleta" } {
  const ref = publishedAt ?? collectedAt;
  const days = Math.max(0, Math.floor((now.getTime() - ref.getTime()) / DAY));
  return { label: days <= 7 ? "recente" : days <= 30 ? "atual" : "antigo", tone: days <= 7 ? "success" : days <= 30 ? "info" : "warning", days, basis: publishedAt ? "publicação" : "coleta" };
}

export function TrendsView({ loaded, filters, vertical, now = new Date() }: { loaded: Loaded<TrendsData>; filters: { kind: string; adapter: string }; vertical: VerticalMeta; now?: Date }) {
  const header = <PageHeader crumbs={[{ label: "Inteligência" }, { label: "Tendências e notícias" }]} title="Tendências e notícias" description="Sinais reais coletados das fontes públicas, com fonte, datas, frescor e vínculo com oportunidades. São contexto: não são volume de busca." badges={<VerticalContext {...vertical} />} />;
  if (loaded.state !== "ready") return <div className="space-y-6">{header}<StatePanel state={loaded.state} missing={loaded.state === "not_configured" ? loaded.missing : undefined} /></div>;
  const { evidence, runs } = loaded.data;
  const hasFilter = Boolean(filters.kind || filters.adapter);
  return (
    <div className="space-y-6">
      {header}
      <p className="text-xs text-muted-foreground" data-testid="origin">Banco: {loaded.origin ? (loaded.origin.kind === "local" ? "local (ambiente de desenvolvimento)" : loaded.origin.host) : "não identificado"} · Para atualizar, inicie uma pesquisa em <Link href="/opportunities" className="underline underline-offset-2">Oportunidades</Link></p>
      <Panel title="Fontes" description="O que cada fonte entregou na coleta mais recente que a tocou.">
        <div className="overflow-x-auto"><table className="w-full min-w-[34rem] text-left text-xs"><caption className="sr-only">Resumo por fonte</caption>
          <thead className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase"><tr><th scope="col" className="py-1.5 pr-3">Fonte</th><th scope="col" className="pr-3 text-right">Registros</th><th scope="col" className="pr-3">Última coleta</th><th scope="col" className="pr-3">Mais recente publicado</th><th scope="col">Vinculados a oportunidades</th></tr></thead>
          <tbody>{Object.keys(ADAPTER_LABEL).map((id) => {
            const rows = evidence.filter((e) => e.adapter === id);
            const last = rows.reduce<Date | null>((m, e) => (m === null || e.collectedAt > m ? e.collectedAt : m), null);
            const pub = rows.reduce<Date | null>((m, e) => (e.publishedAt && (m === null || e.publishedAt > m) ? e.publishedAt : m), null);
            return (<tr key={id} className="border-t border-border"><td className="py-1.5 pr-3 font-medium">{ADAPTER_LABEL[id]}</td><td className="pr-3 text-right tabular-nums">{rows.length}</td><td className="pr-3">{last ? formatDate(last) : <TruthChip state="unavailable">nunca consultada</TruthChip>}</td><td className="pr-3">{pub ? <>{formatDate(pub)} <span className="text-muted-foreground">(há {freshness(pub, pub, now).days} dia(s))</span></> : "—"}</td><td className="tabular-nums">{rows.filter((e) => e.linked > 0).length} de {rows.length}</td></tr>);
          })}</tbody></table></div>
      </Panel>
      <Panel title="Registros coletados" description={`${formatInt(evidence.length)} registro(s)${hasFilter ? " com os filtros atuais" : ""} (até 100, os mais recentes primeiro).`}>
        <form method="get" action="/trends" className="mb-4 grid gap-3 sm:grid-cols-[12rem_14rem_auto]" role="search" aria-label="Filtrar registros">
          <label className="block"><span className="sr-only">Tipo</span><select name="kind" defaultValue={filters.kind} className={inputClass}><option value="">Indicadores e notícias</option><option value="indicator">Indicadores</option><option value="news_item">Notícias</option></select></label>
          <label className="block"><span className="sr-only">Fonte</span><select name="adapter" defaultValue={filters.adapter} className={inputClass}><option value="">Todas as fontes</option>{Object.entries(ADAPTER_LABEL).map(([id, l]) => (<option key={id} value={id}>{l}</option>))}</select></label>
          <div className="flex gap-2"><Button type="submit" variant="outline">Aplicar</Button>{hasFilter ? <Link href="/trends" className="inline-flex h-8 items-center px-2 text-xs underline underline-offset-2">Limpar</Link> : null}</div>
        </form>
        {evidence.length === 0 ? (
          <EmptyState title={hasFilter ? "Nenhum registro com esses filtros" : "Nenhum registro coletado ainda"} hint={hasFilter ? "Ajuste ou limpe os filtros." : "Ainda não houve pesquisa neste workspace, ou nenhuma fonte devolveu algo relevante."} action={<Link href="/opportunities" className="text-xs underline underline-offset-2">Ir para Oportunidades e iniciar uma pesquisa</Link>} />
        ) : (
          <ul className="space-y-3">{evidence.map((e) => (
            <li key={e.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><TruthChip state={truthOfBasis(e.basis)} /><Badge tone="outline">{e.kind === "indicator" ? "indicador" : "notícia"}</Badge>{(() => { const f = freshness(e.publishedAt, e.collectedAt, now); return <span title={`Calculado pela data de ${f.basis}`}><Badge tone={f.tone}>{f.label} · há {f.days} dia(s)</Badge></span>; })()}<span className="text-xs text-muted-foreground">{ADAPTER_LABEL[e.adapter] ?? e.adapter} · coletado em {formatDate(e.collectedAt)}{e.publishedAt ? ` · publicado em ${formatDate(e.publishedAt)}` : ""}</span></div>
              <p className="mt-1 font-medium">{e.title}</p>
              {e.summary ? <p className="text-xs text-muted-foreground">{e.summary}</p> : null}
              <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground"><span>Temas: {e.topics.length ? e.topics.join(", ") : "nenhum"}</span><span>Oportunidades ligadas: {e.linked > 0 ? <strong className="text-foreground">{e.linked}</strong> : "nenhuma (não é evidência negativa)"}</span></p>
              <a href={e.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block break-all text-xs underline underline-offset-2">{e.url}</a>
            </li>))}</ul>
        )}
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Execuções recentes" description="Cada pesquisa registra o resultado de cada fonte.">
          {runs.length === 0 ? <EmptyState title="Nenhuma execução" hint="Inicie uma pesquisa em Oportunidades." /> : (
            <ul className="space-y-3 text-xs">{runs.map((r) => (
              <li key={r.id} className="border-l-2 border-border pl-3"><span className="font-mono text-[10.5px] text-muted-foreground">{formatDateTime(r.startedAt)}</span> <Badge tone={RUN_STATUS[r.status as keyof typeof RUN_STATUS]?.tone ?? "neutral"}>{RUN_STATUS[r.status as keyof typeof RUN_STATUS]?.label ?? r.status}</Badge>
                {r.error ? <p className="text-destructive">{r.error}</p> : null}
                <ul className="mt-1 space-y-0.5 text-muted-foreground">{(r.adapters as unknown as { adapter: string; status: string; kept: number; inserted: number; errors: { target: string; code: string }[] }[]).map((a) => (<li key={a.adapter}>{ADAPTER_LABEL[a.adapter] ?? a.adapter}: {a.status} · {a.kept} guardado(s), {a.inserted} novo(s){a.errors.length ? ` · ${a.errors.map((x) => `${x.target} (${x.code})`).join(", ")}` : ""}</li>))}</ul></li>))}</ul>
          )}
        </Panel>
        <Panel title="Capacidades e fontes pendentes" description="Estado verificável de cada fonte que ainda não existe. Nada aqui é simulado.">
          <ul className="space-y-3 text-sm">{engine.PENDING_CAPABILITIES.map((b) => (<li key={b.id}><TruthChip state="blocked" /> <strong className="ml-1">{b.label}</strong> <span className="text-xs text-muted-foreground">· {engine.CAPABILITY_STATE_LABEL[b.state]}</span><p className="text-xs text-muted-foreground">{b.detail}</p>{b.unlocks.length ? <p className="text-xs text-muted-foreground">Passaria a medir: {b.unlocks.map((d) => engine.DIMENSION_INFO[d].label).join(", ")}.</p> : null}</li>))}</ul>
        </Panel>
      </div>
      <TruthLegend />
    </div>
  );
}
