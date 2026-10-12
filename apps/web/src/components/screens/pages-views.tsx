"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, Clock } from "lucide-react";
import { useAppState } from "@/components/app-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChipGroup, SearchField, norm } from "@/components/ui/filters";
import { NotFoundState } from "@/components/ui/not-found-state";
import { OwnerNotice } from "@/components/ui/owner-notice";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import { ResourceList } from "@/components/ui/resource-list";
import type { PageItem, PageStatus } from "@/data/demo/types";
import { findAcross } from "@/lib/find";
import { cn } from "@/lib/utils";

export const pageStatusLabel: Record<PageStatus, string> = { draft: "Rascunho", in_review: "Em revisão", blocked: "Bloqueada", ready: "Pronta para gates" };
export const pageStatusTone = { draft: "neutral", in_review: "info", blocked: "danger", ready: "success" } as const;
const KINDS: readonly PageItem["kind"][] = ["guia", "glossário", "comparativo", "FAQ", "cluster"];

export function PagesList() {
  const { current } = useAppState();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<PageStatus | "">("");
  const [kind, setKind] = useState<PageItem["kind"] | "">("");
  const rows = useMemo(() => {
    const q = norm(text.trim());
    return current.pages.filter((p) => (!status || p.status === status) && (!kind || p.kind === kind) && (!q || norm(`${p.title} ${p.path} ${p.summary}`).includes(q)));
  }, [current, text, status, kind]);
  const clear = () => { setText(""); setStatus(""); setKind(""); };
  return (
    <div className="space-y-6">
      <PageHeader crumbs={[{ label: "Pages" }]} title="Páginas" description={`Inventário de páginas de ${current.workspace.name}. Nenhuma está publicada: nada sai indexável sem passar em todos os gates (regra 5).`} />
      <div className="space-y-3">
        <SearchField className="sm:w-96" value={text} onChange={setText} label="Filtrar páginas" placeholder="Buscar por título ou caminho…" />
        <ChipGroup label="Filtrar por estado" value={status} onChange={setStatus} allLabel="Todos os estados" options={(Object.keys(pageStatusLabel) as PageStatus[]).map((s) => ({ value: s, label: pageStatusLabel[s] }))} />
        <ChipGroup label="Filtrar por tipo" value={kind} onChange={setKind} allLabel="Todos os tipos" options={KINDS.map((k) => ({ value: k, label: k }))} />
        {text.trim() || status || kind ? <Button variant="ghost" size="sm" onClick={clear}>Limpar filtros</Button> : null}
      </div>
      <ResourceList
        rows={rows.map((p) => ({ id: p.id, href: `/pages/${p.id}`, title: p.title, subtitle: p.path, badges: (<><Badge tone="outline">{p.kind}</Badge><Badge tone={pageStatusTone[p.status]}>{pageStatusLabel[p.status]}</Badge></>), meta: `${p.gates.filter((g) => g.status === "pass").length}/${p.gates.length} gates` }))}
        empty={<EmptyState title="Nenhuma página com esses filtros" action={<Button variant="outline" size="sm" onClick={clear}>Limpar filtros</Button>} />}
        count={`${rows.length} de ${current.pages.length} páginas`}
      />
    </div>
  );
}

const gateIcon = { pass: { I: CircleCheck, c: "text-success", l: "Passou" }, fail: { I: CircleAlert, c: "text-destructive", l: "Falhou" }, pending: { I: Clock, c: "text-muted-foreground", l: "Pendente" } } as const;

export function PageDetail({ id }: { id: string }) {
  const { workspaces, current, setPageStatus, notify } = useAppState();
  const [view, setView] = useState<"preview" | "details">("preview");
  const found = findAcross(workspaces, "pages", id, current);
  if (!found) return <NotFoundState what="Página" backHref="/pages" backLabel="Voltar para Pages" />;
  const { owner, item: p } = found;
  const knowledge = owner.knowledge.filter((k) => p.knowledgeIds.includes(k.id));
  const entities = owner.entities.filter((e) => p.entityIds.includes(e.id));
  const opportunity = p.opportunityId ? owner.opportunities.find((o) => o.id === p.opportunityId) : undefined;
  const failing = p.gates.some((g) => g.status === "fail");
  const action: { label: string; to: PageStatus; disabled?: string } | null =
    p.status === "draft" ? { label: "Enviar para revisão", to: "in_review" }
    : p.status === "in_review" ? { label: "Marcar como pronta para gates", to: "ready", disabled: failing ? "Há gates que falharam" : undefined }
    : p.status === "blocked" ? { label: "Voltar para rascunho", to: "draft" }
    : { label: "Voltar para revisão", to: "in_review" };
  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Pages", href: "/pages" }, { label: p.title }]}
        title={p.title}
        description={p.summary}
        badges={<><Badge tone="outline">{p.kind}</Badge><Badge tone={pageStatusTone[p.status]}>{pageStatusLabel[p.status]}</Badge><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{p.path}</code></>}
        actions={action ? (
          <div className="flex flex-col items-end gap-1">
            <Button size="lg" disabled={Boolean(action.disabled)} onClick={() => { setPageStatus(p.id, action.to); notify(`Página: ${pageStatusLabel[action.to]} (somente neste navegador).`); }}>{action.label}</Button>
            {action.disabled ? <span className="text-xs text-muted-foreground">{action.disabled}</span> : null}
          </div>
        ) : undefined}
      />
      <OwnerNotice owner={owner} />
      <div className="flex gap-1.5" role="group" aria-label="Visualização">
        {(["preview", "details"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn("h-8 rounded-md border px-3 text-[13px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", view === v ? "border-brand/40 bg-brand/15 text-brand" : "border-border text-muted-foreground hover:bg-accent")}>{v === "preview" ? "Pré-visualização" : "Detalhes e gates"}</button>
        ))}
      </div>
      {view === "preview" ? (
        <article className="mx-auto max-w-2xl rounded-xl border border-border bg-card p-6">
          <p className="text-xs text-warning">Pré-visualização de demonstração · não publicada · noindex</p>
          <h2 className="mt-3 text-xl font-semibold tracking-tight">{p.title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{p.summary}</p>
          <h3 className="mt-5 text-sm font-semibold">Fatos usados</h3>
          {knowledge.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">Nenhum fato verificado ligado: esta página ainda não pode citar números.</p> : (
            <ul className="mt-2 space-y-3">{knowledge.map((k) => (<li key={k.id} className="text-sm"><p>{k.statement}</p><p className="text-xs text-muted-foreground">{`{{fact:${k.id}}}`} · <Link href={`/knowledge/${k.id}`} className="text-brand hover:underline">ver registro</Link></p></li>))}</ul>
          )}
        </article>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel title="Gates" description="Cada gate grava o próprio resultado." className="lg:col-span-2">
            <ul className="divide-y divide-border">
              {p.gates.map((g) => { const { I, c, l } = gateIcon[g.status]; return (<li key={g.name} className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0"><I className={cn("size-4", c)} aria-hidden="true" /><span className="flex-1 text-sm">{g.name}</span><span className={cn("text-xs font-medium", c)}>{l}</span></li>); })}
            </ul>
          </Panel>
          <div className="space-y-4">
            <Panel title="Ligações">
              <ul className="space-y-2 text-sm">
                {opportunity ? <li><Link href={`/opportunities/${opportunity.id}`} className="hover:underline">{opportunity.title}</Link> <span className="text-xs text-muted-foreground">oportunidade</span></li> : null}
                {entities.map((e) => (<li key={e.id}><Link href={`/entities/${e.id}`} className="hover:underline">{e.label}</Link> <span className="text-xs text-muted-foreground">entidade</span></li>))}
              </ul>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
