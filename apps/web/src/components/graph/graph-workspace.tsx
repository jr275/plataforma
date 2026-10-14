import Link from "next/link";
import { Search } from "lucide-react";
import { graph } from "@plataforma/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import { StatePanel } from "@/components/generation/state-panel";
import { LIMIT_STEP, graphHref, type GraphParams, type GraphWorkspaceData } from "@/lib/server/graph";
import type { Loaded } from "@/lib/server/tenant-data";
import { AgentPanel } from "./agent-panel";
import { GraphCanvas } from "./graph-canvas";
import { GraphInspector } from "./inspector";
import { EDGE_BASIS_LABEL, KIND_LABEL, KIND_PLURAL, KIND_TONE } from "./kinds";

const ALL = graph.NODE_KINDS;

function NodeLink({ n, params, base }: { n: graph.GraphNodeSummary; params: GraphParams; base: string }) {
  return (
    <Link href={graphHref(params, { node: n.ref }, base)} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <Badge tone={KIND_TONE[n.kind]}>{KIND_LABEL[n.kind]}</Badge>
      <span className="min-w-0 flex-1 truncate">{n.label}</span>
      {n.detail ? <span className="shrink-0 text-xs text-muted-foreground">{n.detail}</span> : null}
    </Link>
  );
}

/** Espaço de trabalho do grafo: busca e filtros à esquerda; vizinhança no centro; inspetor e investigação contextual à direita. Um só espaço, não painéis soltos. */
export function GraphWorkspace({ loaded, params, devNote, basePath = "/graph" }: { loaded: Loaded<GraphWorkspaceData>; params: GraphParams; /** Prévia de desenvolvimento (fixture em memória, sem sessão): as ferramentas ficam indisponíveis. */ devNote?: boolean; basePath?: string }) {
  const header = <PageHeader crumbs={[{ label: "Knowledge Graph" }]} title="Knowledge Graph" description="Entidades e relações reais do seu workspace, derivadas dos dados importados. Nenhuma entidade ou relação é inferida ou inventada." />;
  if (loaded.state !== "ready") return <div className="space-y-6">{header}<StatePanel state={loaded.state} missing={loaded.state === "not_configured" ? loaded.missing : undefined} /></div>;

  const { detail, expansion, nodeMissing, search, starters, now } = loaded.data;
  const active = params.kinds.length > 0 ? params.kinds : [...ALL];
  const hrefFor = (ref: string) => graphHref(params, { node: ref, limit: graph.DEFAULT_EXPAND_LIMIT }, basePath);
  const canMore = expansion && expansion.truncated && params.limit < graph.MAX_EXPAND_LIMIT;
  const tools = detail ? graph.toolsFor(detail.node.kind).map((id) => ({ id, label: graph.TOOL_LABEL[id] })) : [];

  return (
    <div className="space-y-6">
      {header}
      <p className="text-xs text-muted-foreground" data-testid="origin">
        Banco: {devNote ? "memória (fixture de desenvolvimento)" : loaded.origin ? (loaded.origin.kind === "local" ? "local (ambiente de desenvolvimento)" : loaded.origin.host) : "não identificado"} · Relações: coluna da fonte ou vínculo gravado
      </p>
      <form method="get" action={basePath} role="search" aria-label="Buscar entidades" className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-border bg-card p-3">
        {params.node ? <input type="hidden" name="node" value={params.node} /> : null}
        <label className="block min-w-[14rem] flex-1"><span className="sr-only">Buscar entidades</span><span className="relative block"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><input type="search" name="q" defaultValue={params.q} placeholder="Buscar cidade, UF, região ou URL" maxLength={80} className={`${inputClass} pl-8`} /></span></label>
        <fieldset>
          <legend className="mb-1 font-mono text-[10.5px] tracking-[0.08em] text-muted-foreground uppercase">Tipos de entidade</legend>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {ALL.map((k) => (<label key={k} className="flex items-center gap-1.5"><input type="checkbox" name="kinds" value={k} defaultChecked={active.includes(k)} className="size-3.5 accent-[var(--brand)]" />{KIND_PLURAL[k]}</label>))}
          </div>
        </fieldset>
        <Button type="submit" variant="outline" size="sm">Aplicar</Button>
        <p className="basis-full text-[11px] leading-snug text-muted-foreground">Cada tipo de vizinho corresponde a um tipo de relação.</p>
      </form>

      {search ? (
        <Panel title="Resultados" description={`${(search.totals.city ?? 0).toLocaleString("pt-BR")} cidade(s), ${search.totals.uf ?? 0} UF(s), ${search.totals.region ?? 0} região(ões), ${search.totals.page ?? 0} página(s).`}>
          {search.nodes.length === 0 ? <EmptyState title="Nada encontrado" hint="Tente outro termo ou marque mais tipos." /> : <ul className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">{search.nodes.map((n) => (<li key={n.ref}><NodeLink n={n} params={params} base={basePath} /></li>))}</ul>}
          {(search.totals.city ?? 0) > search.nodes.filter((n) => n.kind === "city").length ? <p className="mt-2 text-[11px] text-muted-foreground">Mostrando as primeiras cidades. <Link href={`/cities?q=${encodeURIComponent(params.q)}`} className="underline underline-offset-2">Ver todas na lista</Link>.</p> : null}
        </Panel>
      ) : null}

      {!params.node ? (
        <Panel title="Pontos de partida" description="Regiões que existem nos dados importados.">
          {starters.length === 0 ? <EmptyState title="Nenhuma entidade importada ainda" hint="Importe cidades para formar o grafo." action={<Link href="/data-flow" className="text-xs underline underline-offset-2">Ver o fluxo de dados</Link>} /> : <ul className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">{starters.map((n) => (<li key={n.ref}><NodeLink n={n} params={params} base={basePath} /></li>))}</ul>}
        </Panel>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          {nodeMissing ? (
            <Panel title="Entidade"><EmptyState title="Esta entidade não existe neste workspace" hint="A referência pode ser de outro workspace ou ter deixado de existir." action={<Link href={basePath} className="text-xs underline underline-offset-2">Voltar ao início</Link>} /></Panel>
          ) : expansion ? (
            <>
              <GraphCanvas expansion={expansion} hrefFor={hrefFor} />
              {expansion.truncated ? (
                <p className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs" role="status">
                  <span>Mostrando {(expansion.shown.city ?? 0).toLocaleString("pt-BR")} de {(expansion.totals.city ?? 0).toLocaleString("pt-BR")} cidades (as de maior população primeiro).</span>
                  {canMore ? <Link href={graphHref(params, { limit: Math.min(params.limit + LIMIT_STEP, graph.MAX_EXPAND_LIMIT) }, basePath)} className="underline underline-offset-2">Mostrar mais {LIMIT_STEP}</Link> : <span className="text-muted-foreground">Limite de {graph.MAX_EXPAND_LIMIT} atingido; refine pela busca ou abra a lista.</span>}
                  {expansion.center.kind === "uf" ? <Link href={`/cities?uf=${expansion.center.label}`} className="underline underline-offset-2">Abrir a lista de cidades da UF</Link> : null}
                </p>
              ) : null}
              <Panel title="Relações" description="A mesma vizinhança em forma de lista, com a direção e a base de cada relação.">
                {expansion.edges.length === 0 ? <EmptyState title="Nenhuma relação com os filtros atuais" hint="Marque mais tipos de entidade para ver outras relações." /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <caption className="sr-only">Relações da entidade selecionada</caption>
                      <thead className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase"><tr><th scope="col" className="py-2 pr-4">De</th><th scope="col" className="pr-4">Relação</th><th scope="col" className="pr-4">Para</th><th scope="col">Base</th></tr></thead>
                      <tbody>
                        {expansion.edges.map((e, i) => {
                          const label = new Map([[expansion.center.ref, expansion.center.label], ...expansion.neighbors.map((n) => [n.ref, n.label] as const)]);
                          return (
                            <tr key={`${e.from}-${e.to}-${i}`} className="border-t border-border">
                              <td className="py-1.5 pr-4"><Link href={hrefFor(e.from)} className="underline-offset-2 hover:underline">{label.get(e.from)}</Link></td>
                              <td className="pr-4 text-muted-foreground">{e.label}</td>
                              <td className="pr-4"><Link href={hrefFor(e.to)} className="underline-offset-2 hover:underline">{label.get(e.to)}</Link></td>
                              <td className="text-xs text-muted-foreground">{EDGE_BASIS_LABEL[e.basis]}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </>
          ) : (
            <Panel title="Explorar"><EmptyState title="Escolha uma entidade para começar" hint="Busque uma cidade, UF, região ou URL, ou parta de uma região. O grafo mostra só relações que existem nos dados importados." /></Panel>
          )}
        </div>

        <div className="space-y-4">
          {detail ? (
            <>
              <GraphInspector detail={detail} now={now} />
              {tools.length > 0 ? <AgentPanel key={detail.node.ref} nodeRef={detail.node.ref} nodeLabel={detail.node.label} tools={tools} unavailable={devNote ? "Prévia de desenvolvimento: as ferramentas rodam só com sessão e banco reais." : undefined} /> : null}
            </>
          ) : (
            <Panel title="Inspetor"><EmptyState title="Nenhuma entidade selecionada" hint="Selecione uma entidade no grafo ou na busca para ver atributos, origem, relações e iniciar uma investigação." /></Panel>
          )}
        </div>
      </div>
    </div>
  );
}
