import Link from "next/link";
import { engine, type engine as E } from "@plataforma/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Frame } from "@/components/ui/frame";
import { EmptyState } from "@/components/ui/panel";
import { TruthLegend } from "@/components/ui/truth-chip";
import { RUN_STATUS, formatDateTime, formatInt } from "@/components/generation/format";
import { StatePanel } from "@/components/generation/state-panel";
import type { OpportunitiesData, OpportunityParams } from "@/lib/server/opportunities";
import type { Loaded } from "@/lib/server/tenant-data";
import { PRIORITY_KIND, num1 } from "./format";
import { ObjectivePills } from "./objective-pills";
import { ResearchForm } from "./research-form";
import { statusLabel, statusTone } from "./status";
import { VerticalContext } from "./vertical-context";

export function opportunityHref(p: OpportunityParams, over: Partial<OpportunityParams>): string {
  const n = { ...p, ...over };
  const q = new URLSearchParams();
  if (n.q) q.set("q", n.q);
  if (n.status) q.set("status", n.status);
  if (n.intent) q.set("intent", n.intent);
  if (n.eligible) q.set("eligible", n.eligible);
  if (n.priorityKind) q.set("priority", n.priorityKind);
  if (n.sort !== "priority") q.set("sort", n.sort);
  if (n.page > 1) q.set("page", String(n.page));
  const s = q.toString();
  return s ? `/opportunities?${s}` : "/opportunities";
}
const SORT_LABEL: Record<E.OpportunitySort, string> = { priority: "Prioridade (exploratória)", commercial: "Valor comercial", feasibility: "Viabilidade", discovery: "Descoberta", recent: "Mais recentes", query: "Query (A–Z)" };
export interface VerticalMeta { readonly name: string; readonly language: string; readonly country: string }

export function OpportunitiesHomeView({ loaded, params, pageSize, intents, vertical, detailBase = "/opportunities", basePath = "/opportunities" }: { loaded: Loaded<OpportunitiesData>; params: OpportunityParams; pageSize: number; intents: readonly { id: string; label: string }[]; vertical: VerticalMeta; /** Prévia de desenvolvimento usa outra base de rotas. */ detailBase?: string; basePath?: string }) {
  const header = (
    <PageHeader crumbs={[{ label: "Inteligência" }, { label: "Oportunidades" }]} title="Oportunidades"
      description="Hipóteses de crescimento com evidência, geradas pela vertical a partir das entidades reais do workspace."
      badges={<VerticalContext {...vertical} />}
      actions={<span className="flex gap-2"><Link href="/roadmap" className="inline-flex h-8 items-center bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">Abrir roadmap →</Link><Link href="/opportunities/score" className="inline-flex h-8 items-center border border-border bg-card px-3 text-xs hover:bg-accent">Configurar o score</Link></span>} />
  );
  if (loaded.state !== "ready") return <div className="space-y-6">{header}<StatePanel state={loaded.state} missing={loaded.state === "not_configured" ? loaded.missing : undefined} /></div>;
  const { list, runs } = loaded.data;
  const { rows, total } = list;
  const from = total === 0 ? 0 : (params.page - 1) * pageSize + 1;
  const to = Math.min(params.page * pageSize, total);
  const hasFilter = Boolean(params.q || params.status || params.intent || params.eligible || params.priorityKind);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const all = Object.values(list.byStatus).reduce((s, n) => s + n, 0);
  const intentLabel = new Map(intents.map((i) => [i.id, i.label]));
  const last = runs[0];
  const coverages = new Set(rows.map((r) => `${r.commercial !== null}${r.feasibility !== null}${r.discovery !== null}`));

  return (
    <div className="space-y-5">
      {header}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground" data-testid="origin">
        <span>Banco: {loaded.origin ? (loaded.origin.kind === "local" ? "local (desenvolvimento)" : loaded.origin.host) : "não identificado"}</span>
        <span aria-hidden="true">·</span><span><strong className="text-foreground">{formatInt(all)}</strong> oportunidades</span>
        <span aria-hidden="true">·</span><span><strong className="text-foreground">{formatInt(list.byStatus.eligible ?? 0)}</strong> elegíveis</span>
        <span aria-hidden="true">·</span><span>{formatInt(list.byStatus.scored ?? 0)} pontuadas</span>
        <span aria-hidden="true">·</span><span>{formatInt(list.byStatus.blueprinted ?? 0)} com blueprint</span>
        <span aria-hidden="true">·</span><span>{formatInt(list.byStatus.rejected ?? 0)} rejeitadas</span>
      </p>
      <details open={all === 0} className="rounded-xl border border-border bg-card">
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm select-none">
          <span className="font-mono text-[11px] font-semibold tracking-[0.08em] uppercase">Pesquisar fontes</span>
          <span className="text-xs text-muted-foreground">{last ? <>Última: {formatDateTime(last.startedAt)} <Badge tone={RUN_STATUS[last.status as keyof typeof RUN_STATUS]?.tone ?? "neutral"}>{RUN_STATUS[last.status as keyof typeof RUN_STATUS]?.label ?? last.status}</Badge></> : "Nenhuma pesquisa executada neste workspace."}</span>
        </summary>
        <div className="border-t border-border p-4"><ResearchForm /></div>
      </details>

      <Frame fig="1" caption={`tabela operacional · ${formatInt(total)} oportunidade(s)${hasFilter ? " com os filtros" : ""}`} bodyClassName="p-0">
        <form method="get" action={basePath} className="grid gap-2 border-b border-border p-3 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,1fr)_9.5rem_9.5rem_8.5rem_10.5rem_auto]" role="search" aria-label="Filtrar oportunidades">
          <label className="block"><span className="sr-only">Buscar na query</span><input type="search" name="q" defaultValue={params.q} placeholder="Buscar na query" maxLength={80} className={inputClass} /></label>
          <label className="block"><span className="sr-only">Estado</span><select name="status" defaultValue={params.status} className={inputClass}><option value="">Todos os estados</option>{engine.STATES.filter((s) => engine.IMPLEMENTED_STATES.includes(s)).map((s) => (<option key={s} value={s}>{statusLabel(s)}</option>))}</select></label>
          <label className="block"><span className="sr-only">Intenção</span><select name="intent" defaultValue={params.intent} className={inputClass}><option value="">Todas as intenções</option>{intents.map((i) => (<option key={i.id} value={i.id}>{i.label}</option>))}</select></label>
          <label className="block"><span className="sr-only">Elegibilidade</span><select name="eligible" defaultValue={params.eligible} className={inputClass}><option value="">Elegível ou não</option><option value="yes">Elegíveis</option><option value="no">Não elegíveis</option></select></label>
          <label className="block"><span className="sr-only">Ordenar por</span><select name="sort" defaultValue={params.sort} className={inputClass}>{(engine.SORTS as readonly E.OpportunitySort[]).map((k) => (<option key={k} value={k}>Ordenar: {SORT_LABEL[k]}</option>))}</select></label>
          <div className="flex gap-2"><Button type="submit" variant="outline">Aplicar</Button>{hasFilter ? <Link href={basePath} className="inline-flex h-8 items-center px-2 text-xs underline underline-offset-2">Limpar</Link> : null}</div>
        </form>
        <div role="note" className="border-b border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <strong className="text-foreground">Ordenação exploratória.</strong> A prioridade é <em>parcial</em> (demanda, SERP e concorrência não são medidas) e só ordena a leitura: não substitui os seis gates nem a elegibilidade.
          {coverages.size > 1 ? " Esta página mistura scores de cobertura diferente (veja C V D): eles não são equivalentes." : ""} Dimensão desconhecida não é evidência negativa.
        </div>
        {rows.length === 0 && total > 0 ? (
          <EmptyState title="Esta página de resultados não existe" hint={`Há ${formatInt(total)} oportunidade(s), em ${lastPage} página(s).`} action={<Link href={opportunityHref(params, { page: 1 })} className="text-xs underline underline-offset-2">Ir para a primeira</Link>} />
        ) : rows.length === 0 ? (
          hasFilter ? <EmptyState title="Nenhuma oportunidade com esses filtros" hint="Ajuste a busca ou limpe os filtros." action={<Link href={basePath} className="text-xs underline underline-offset-2">Limpar filtros</Link>} />
                    : <EmptyState title="Nenhuma oportunidade ainda" hint={all === 0 ? "Abra “Pesquisar fontes” acima: o motor consulta as fontes públicas e gera as hipóteses a partir das cidades do workspace. Sem cidades importadas, não há o que gerar." : "Nada neste filtro."} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <caption className="sr-only">Oportunidades do workspace</caption>
                <thead className="sticky top-0 bg-card font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">
                  <tr className="border-b border-border"><th scope="col" className="px-3 py-2">Query (hipótese)</th><th scope="col" className="px-2">Intenção</th><th scope="col" className="px-2">Estado</th><th scope="col" className="px-2 text-right">Prioridade</th><th scope="col" className="px-2">Objetivos</th><th scope="col" className="px-2 text-right" title="Dimensões desconhecidas e confiança do score">Cobertura</th><th scope="col" className="px-3 text-right" title="Evidências ligadas">Evid.</th></tr>
                </thead>
                <tbody>
                  {rows.map((o) => {
                    const pk = PRIORITY_KIND[o.priorityKind ?? "none"] ?? PRIORITY_KIND.none!;
                    return (
                      <tr key={o.id} className="border-t border-border transition-colors hover:bg-muted/40">
                        <td className="px-3 py-2"><Link href={`${detailBase}/${o.id}`} className="font-medium underline-offset-2 hover:underline focus-visible:underline">{o.primaryQuery}</Link>{o.variants.length > 1 ? <span className="ml-1.5 text-xs text-muted-foreground">+{o.variants.length - 1}</span> : null}<span className="block font-mono text-[10.5px] text-muted-foreground">{o.experience}</span></td>
                        <td className="px-2 text-xs">{intentLabel.get(o.intent) ?? o.intent}</td>
                        <td className="px-2 whitespace-nowrap"><Badge tone={statusTone(o.status)}>{statusLabel(o.status)}</Badge>{o.eligible === false ? <span className="ml-1 text-[10.5px] text-muted-foreground">não elegível</span> : null}</td>
                        <td className="px-2 text-right whitespace-nowrap tabular-nums"><span className="font-medium">{num1(o.priority)}</span> <Badge tone={pk.tone} className="ml-1">{pk.label}</Badge></td>
                        <td className="px-2"><ObjectivePills values={[o.commercial, o.feasibility, o.discovery]} /></td>
                        <td className="px-2 text-right font-mono text-[11px] whitespace-nowrap tabular-nums text-muted-foreground">{o.unknownDimensions === null ? "—" : <>{15 - o.unknownDimensions}/15 · {Math.round((o.confidence ?? 0) * 100)}%</>}</td>
                        <td className="px-3 text-right tabular-nums">{o.evidenceCount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <nav aria-label="Paginação" className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
              <span>Mostrando {from} a {to} de {formatInt(total)}</span>
              <span className="flex gap-3">
                {params.page > 1 ? <Link href={opportunityHref(params, { page: params.page - 1 })} rel="prev" className="underline underline-offset-2">Anterior</Link> : <span aria-disabled="true">Anterior</span>}
                {to < total ? <Link href={opportunityHref(params, { page: params.page + 1 })} rel="next" className="underline underline-offset-2">Próxima</Link> : <span aria-disabled="true">Próxima</span>}
              </span>
            </nav>
          </>
        )}
      </Frame>
      <TruthLegend />
    </div>
  );
}
