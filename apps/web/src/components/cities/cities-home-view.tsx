import Link from "next/link";
import { UFS, type CityListItem } from "@plataforma/api";
import { Waypoints } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import { PAGE_STATUS, formatInt } from "@/components/generation/format";
import { StatePanel } from "@/components/generation/state-panel";
import type { CityParams } from "@/lib/server/cities";
import type { Loaded } from "@/lib/server/tenant-data";

export interface CitiesData { cities: { rows: CityListItem[]; total: number }; /** Indicadores do workspace inteiro (sem filtros). */ summary: { total: number; withPage: number } }

/** Rótulo de origem: só `real` é dito real. Teste e manual aparecem como tal (nunca se passam por dado de produção). */
export const ORIGIN: Record<CityListItem["sourceOrigin"], { label: string; tone: Tone }> = { real: { label: "Real", tone: "success" }, test: { label: "Teste", tone: "warning" }, manual: { label: "Manual", tone: "outline" } };

/** Mantém os filtros ao trocar de página (a URL é o estado: dá para compartilhar e voltar). */
export function cityHref(p: CityParams, over: Partial<CityParams>): string {
  const n = { ...p, ...over };
  const q = new URLSearchParams();
  if (n.q) q.set("q", n.q);
  if (n.uf) q.set("uf", n.uf);
  if (n.pages) q.set("pages", n.pages);
  if (n.sort !== "name") q.set("sort", n.sort);
  if (n.dir !== "asc") q.set("dir", n.dir);
  if (n.page > 1) q.set("page", String(n.page));
  const s = q.toString();
  return s ? `/cities?${s}` : "/cities";
}

const SORT_LABEL: Record<CityParams["sort"], string> = { name: "Nome", population: "População", ibge: "Código IBGE" };

export function CitiesHomeView({ loaded, params, pageSize }: { loaded: Loaded<CitiesData>; params: CityParams; pageSize: number }) {
  const header = <PageHeader crumbs={[{ label: "Cidades" }]} title="Cidades" description="Entidades reais do seu workspace, importadas de arquivos com origem registrada. Cada cidade mostra de onde veio e o que foi gerado a partir dela." />;
  if (loaded.state !== "ready") return <div className="space-y-6">{header}<StatePanel state={loaded.state} missing={loaded.state === "not_configured" ? loaded.missing : undefined} /></div>;

  const { rows, total } = loaded.data.cities;
  const from = total === 0 ? 0 : (params.page - 1) * pageSize + 1;
  const to = Math.min(params.page * pageSize, total);
  const hasFilter = Boolean(params.q || params.uf || params.pages);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const outOfRange = rows.length === 0 && total > 0;

  return (
    <div className="space-y-6">
      {header}
      <p className="text-xs text-muted-foreground" data-testid="origin">
        Banco: {loaded.origin ? (loaded.origin.kind === "local" ? "local (ambiente de desenvolvimento)" : loaded.origin.host) : "não identificado"} · A origem de cada cidade vem do registro da importação
      </p>
      <dl className="grid gap-3 sm:grid-cols-3" aria-label="Indicadores do workspace">
        {([["Cidades no workspace", loaded.data.summary.total], ["Com página gerada", loaded.data.summary.withPage], ["Sem página gerada", loaded.data.summary.total - loaded.data.summary.withPage]] as const).map(([label, n]) => (
          <div key={label} className="rounded-xl border border-border bg-card px-4 py-3"><dt className="font-mono text-[10.5px] tracking-[0.08em] text-muted-foreground uppercase">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{formatInt(n)}</dd></div>
        ))}
      </dl>
      <Panel title="Cidades" description={`${formatInt(total)} cidade(s)${hasFilter ? " com os filtros atuais" : ""}.`}>
        <form method="get" action="/cities" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,1fr)_9.5rem_12.5rem_12.5rem_auto]" role="search" aria-label="Filtrar cidades">
          <label className="block"><span className="sr-only">Buscar por nome ou código IBGE</span><input type="search" name="q" defaultValue={params.q} placeholder="Buscar por nome ou código IBGE" maxLength={80} className={inputClass} /></label>
          <label className="block"><span className="sr-only">UF</span><select name="uf" defaultValue={params.uf} className={inputClass}><option value="">Todas as UFs</option>{UFS.map((u) => (<option key={u} value={u}>{u}</option>))}</select></label>
          <label className="block"><span className="sr-only">Página gerada</span><select name="pages" defaultValue={params.pages} className={inputClass}><option value="">Com ou sem página</option><option value="with">Com página gerada</option><option value="without">Sem página</option></select></label>
          <label className="block"><span className="sr-only">Ordenar por</span><select name="sort" defaultValue={params.sort} className={inputClass}>{(Object.keys(SORT_LABEL) as CityParams["sort"][]).map((k) => (<option key={k} value={k}>Ordenar: {SORT_LABEL[k]}</option>))}</select></label>
          <div className="flex gap-2"><input type="hidden" name="dir" value={params.dir} /><Button type="submit" variant="outline">Aplicar</Button>{hasFilter ? <Link href="/cities" className="inline-flex h-8 items-center px-2 text-xs underline underline-offset-2">Limpar</Link> : null}</div>
        </form>
        {outOfRange ? (
          <EmptyState title="Esta página de resultados não existe" hint={`Há ${formatInt(total)} cidade(s) com os filtros atuais, em ${lastPage} página(s) de resultados.`}
            action={<span className="flex gap-3 text-xs"><Link href={cityHref(params, { page: 1 })} className="underline underline-offset-2">Ir para a primeira</Link>{lastPage > 1 ? <Link href={cityHref(params, { page: lastPage })} className="underline underline-offset-2">Ir para a última</Link> : null}</span>} />
        ) : rows.length === 0 ? (
          hasFilter ? <EmptyState title="Nenhuma cidade com esses filtros" hint="Ajuste a busca ou limpe os filtros." action={<Link href="/cities" className="text-xs underline underline-offset-2">Limpar filtros</Link>} />
                    : <EmptyState title="Nenhuma cidade importada ainda" hint="A importação de cidades ainda é feita por linha de comando. Quando houver uma, ela aparece aqui e em Fluxo de dados." action={<Link href="/data-flow" className="text-xs underline underline-offset-2">Ver o fluxo de dados</Link>} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Cidades do workspace</caption>
                <thead className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">
                  <tr><th scope="col" className="py-2 pr-4">Cidade</th><th scope="col" className="pr-4">Código IBGE</th><th scope="col" className="pr-4 text-right">População</th><th scope="col" className="pr-4">Página gerada</th><th scope="col" className="pr-4">Origem</th><th scope="col" className="text-right"><span className="sr-only">Grafo</span></th></tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className="border-t border-border transition-colors hover:bg-muted/40">
                      <td className="py-2 pr-4"><Link href={`/cities/${c.id}`} className="font-medium underline-offset-2 hover:underline focus-visible:underline">{c.name}</Link><span className="ml-1.5 text-xs text-muted-foreground">{c.uf}</span></td>
                      <td className="pr-4 font-mono text-xs">{c.ibgeCode}</td>
                      <td className="pr-4 text-right tabular-nums">{c.population === null ? "—" : formatInt(c.population)}</td>
                      <td className="pr-4">{c.pageId && c.pageStatus ? (<span className="inline-flex items-center gap-2"><Link href={`/generation/pages/${c.pageId}`} className="font-mono text-xs underline underline-offset-2">{c.pagePath}</Link><Badge tone={PAGE_STATUS[c.pageStatus].tone}>{PAGE_STATUS[c.pageStatus].label}</Badge></span>) : <span className="text-xs text-muted-foreground">Sem página</span>}</td>
                      <td className="pr-4"><Badge tone={ORIGIN[c.sourceOrigin].tone}>{ORIGIN[c.sourceOrigin].label}</Badge><span className="ml-1.5 text-xs text-muted-foreground">{c.sourceName}</span></td>
                      <td className="text-right"><Link href={`/graph?node=city:${c.id}`} aria-label={`Ver ${c.name} no grafo`} title="Ver no grafo" className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"><Waypoints className="size-4" aria-hidden="true" /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav aria-label="Paginação" className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
              <span>Mostrando {from} a {to} de {formatInt(total)}</span>
              <span className="flex gap-3">
                {params.page > 1 ? <Link href={cityHref(params, { page: params.page - 1 })} rel="prev" className="underline underline-offset-2">Anterior</Link> : <span aria-disabled="true">Anterior</span>}
                {to < total ? <Link href={cityHref(params, { page: params.page + 1 })} rel="next" className="underline underline-offset-2">Próxima</Link> : <span aria-disabled="true">Próxima</span>}
              </span>
            </nav>
          </>
        )}
      </Panel>
    </div>
  );
}
