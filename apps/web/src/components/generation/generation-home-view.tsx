import Link from "next/link";
import { UFS, type GenerationRunSummary, type PageListItem } from "@plataforma/api";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import { inputClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import type { HomeParams } from "@/lib/server/generation";
import { GenerateForm } from "./generate-form";
import { PAGE_STATUS, RUN_STATUS, formatDateTime, formatInt } from "./format";
import { StatePanel } from "./state-panel";
import type { Loaded } from "@/lib/server/tenant-data";

export interface HomeData { pages: { rows: PageListItem[]; total: number }; runs: GenerationRunSummary[]; drafts: number; blocked: number; now: Date }

/** Mantém os filtros ao trocar de página ou de ordenação (a URL é o estado: dá para compartilhar e voltar). */
export function homeHref(p: HomeParams, over: Partial<HomeParams>): string {
  const n = { ...p, ...over };
  const q = new URLSearchParams();
  if (n.q) q.set("q", n.q);
  if (n.status) q.set("status", n.status);
  if (n.uf) q.set("uf", n.uf);
  if (n.sort !== "path") q.set("sort", n.sort);
  if (n.dir !== "asc") q.set("dir", n.dir);
  if (n.page > 1) q.set("page", String(n.page));
  const s = q.toString();
  return s ? `/generation?${s}` : "/generation";
}

const SORT_LABEL: Record<HomeParams["sort"], string> = { path: "URL", updated: "Atualização", population: "População" };

export function GenerationHomeView({ loaded, params, pageSize, rowHref = (p) => `/generation/pages/${p.id}` }: { loaded: Loaded<HomeData>; params: HomeParams; pageSize: number; /** Destino do link de cada linha (padrão: o detalhe da página). */ rowHref?: (p: PageListItem) => string }) {
  const header = <PageHeader crumbs={[{ label: "Geração de páginas" }]} title="Geração de páginas" description="Rascunhos de páginas de cidade gerados a partir de dados reais do IBGE e conferidos por gates de qualidade. Nada aqui é publicado." />;
  if (loaded.state !== "ready") return <div className="space-y-6">{header}<StatePanel state={loaded.state} missing={loaded.state === "not_configured" ? loaded.missing : undefined} /></div>;

  const { pages, runs, drafts, blocked } = loaded.data;
  const last = runs[0];
  const from = pages.total === 0 ? 0 : (params.page - 1) * pageSize + 1;
  const to = Math.min(params.page * pageSize, pages.total);
  const hasFilter = Boolean(params.q || params.status || params.uf);

  return (
    <div className="space-y-6">
      {header}
      <p className="text-xs text-muted-foreground" data-testid="origin">
        Banco: {loaded.origin ? (loaded.origin.kind === "local" ? "local (ambiente de desenvolvimento)" : loaded.origin.host) : "não identificado"} · Fonte dos fatos: IBGE (origem real)
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Panel title="Rascunhos"><p className="text-3xl font-semibold tabular-nums">{formatInt(drafts)}</p></Panel>
        <Panel title="Bloqueadas"><p className="text-3xl font-semibold tabular-nums">{formatInt(blocked)}</p><p className="mt-1 text-xs text-muted-foreground">Reprovaram em algum gate na última tentativa.</p></Panel>
        <Panel title="Última execução">
          {last ? (<><Badge tone={RUN_STATUS[last.status].tone}>{RUN_STATUS[last.status].label}</Badge><p className="mt-2 text-sm">{formatDateTime(last.startedAt)}</p></>) : <p className="text-sm text-muted-foreground">Nenhuma ainda</p>}
        </Panel>
      </div>

      <Panel title="Gerar rascunhos" description="Cria ou atualiza rascunhos para as cidades de maior população de uma UF. Reexecutar sem mudança de dados não cria versões novas.">
        <GenerateForm ufs={UFS} />
      </Panel>

      <Panel title="Páginas" description={`${formatInt(pages.total)} página(s)${hasFilter ? " com os filtros atuais" : ""}.`}>
        <form method="get" action="/generation" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_9rem_7rem_9rem_auto]" role="search" aria-label="Filtrar páginas">
          <label className="block"><span className="sr-only">Buscar por cidade ou URL</span><input type="search" name="q" defaultValue={params.q} placeholder="Buscar cidade ou URL" maxLength={80} className={inputClass} /></label>
          <label className="block"><span className="sr-only">Status</span><select name="status" defaultValue={params.status} className={inputClass}><option value="">Todos os status</option><option value="draft">Rascunho</option><option value="blocked">Bloqueada</option></select></label>
          <label className="block"><span className="sr-only">UF</span><select name="uf" defaultValue={params.uf} className={inputClass}><option value="">Todas as UFs</option>{UFS.map((u) => (<option key={u} value={u}>{u}</option>))}</select></label>
          <label className="block"><span className="sr-only">Ordenar por</span><select name="sort" defaultValue={params.sort} className={inputClass}>{(Object.keys(SORT_LABEL) as HomeParams["sort"][]).map((k) => (<option key={k} value={k}>Ordenar: {SORT_LABEL[k]}</option>))}</select></label>
          <div className="flex gap-2"><input type="hidden" name="dir" value={params.dir} /><Button type="submit" variant="outline">Aplicar</Button>{hasFilter ? <Link href="/generation" className="inline-flex h-8 items-center px-2 text-xs underline underline-offset-2">Limpar</Link> : null}</div>
        </form>
        {pages.rows.length === 0 ? (
          hasFilter ? <EmptyState title="Nenhuma página com esses filtros" hint="Ajuste a busca ou limpe os filtros." action={<Link href="/generation" className="text-xs underline underline-offset-2">Limpar filtros</Link>} />
                    : <EmptyState title="Nenhuma página gerada ainda" hint="Use “Gerar rascunhos” acima para criar as primeiras a partir dos dados do IBGE." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Páginas geradas</caption>
                <thead className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th scope="col" className="py-2 pr-4">Cidade</th><th scope="col" className="pr-4">URL</th><th scope="col" className="pr-4 text-right">População</th><th scope="col" className="pr-4">Status</th><th scope="col" className="pr-4 text-right">Versão</th><th scope="col">Atualizada</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.rows.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="py-2 pr-4"><Link href={rowHref(p)} className="font-medium underline-offset-2 hover:underline focus-visible:underline">{p.cityName}</Link><span className="ml-1.5 text-xs text-muted-foreground">{p.uf}</span></td>
                      <td className="pr-4 font-mono text-xs">{p.path}</td>
                      <td className="pr-4 text-right tabular-nums">{p.population === null ? "—" : formatInt(p.population)}</td>
                      <td className="pr-4"><Badge tone={PAGE_STATUS[p.status].tone}>{PAGE_STATUS[p.status].label}</Badge></td>
                      <td className="pr-4 text-right tabular-nums">v{p.latestVersion}</td>
                      <td className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(p.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav aria-label="Paginação" className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
              <span>Mostrando {from} a {to} de {formatInt(pages.total)}</span>
              <span className="flex gap-3">
                {params.page > 1 ? <Link href={homeHref(params, { page: params.page - 1 })} rel="prev" className="underline underline-offset-2">Anterior</Link> : <span aria-disabled="true">Anterior</span>}
                {to < pages.total ? <Link href={homeHref(params, { page: params.page + 1 })} rel="next" className="underline underline-offset-2">Próxima</Link> : <span aria-disabled="true">Próxima</span>}
              </span>
            </nav>
          </>
        )}
      </Panel>

      <Panel title="Execuções recentes" description="Cada execução fica registrada, com o resultado de cada cidade.">
        {runs.length === 0 ? <EmptyState title="Nenhuma execução ainda" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Execuções de geração</caption>
              <thead className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">
                <tr><th scope="col" className="py-2 pr-4">Quando</th><th scope="col" className="pr-4">Status</th><th scope="col" className="pr-4 text-right">Cidades</th><th scope="col" className="pr-4 text-right">Geradas</th><th scope="col" className="pr-4 text-right">Inalteradas</th><th scope="col" className="text-right">Bloqueadas</th></tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-2 pr-4 whitespace-nowrap"><Link href={`/generation/runs/${r.id}`} className="underline underline-offset-2">{formatDateTime(r.startedAt)}</Link></td>
                    <td className="pr-4"><Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge></td>
                    <td className="pr-4 text-right tabular-nums">{formatInt(r.totalItems)}</td><td className="pr-4 text-right tabular-nums">{formatInt(r.generatedItems)}</td><td className="pr-4 text-right tabular-nums">{formatInt(r.unchangedItems)}</td><td className="text-right tabular-nums">{formatInt(r.blockedItems)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
