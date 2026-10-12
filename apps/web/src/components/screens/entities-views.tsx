"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAppState } from "@/components/app-state";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dl } from "@/components/ui/field";
import { ChipGroup, SearchField, norm } from "@/components/ui/filters";
import { NotFoundState } from "@/components/ui/not-found-state";
import { OwnerNotice } from "@/components/ui/owner-notice";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import { ResourceList } from "@/components/ui/resource-list";
import { findAcross } from "@/lib/find";
import { knowledgeLabel, knowledgeTone } from "./knowledge-views";

export function EntitiesList() {
  const { current } = useAppState();
  const [text, setText] = useState("");
  const [type, setType] = useState("");
  const types = useMemo(() => [...new Set(current.entities.map((e) => e.type))], [current]);
  const rows = useMemo(() => {
    const q = norm(text.trim());
    return current.entities.filter((e) => (!type || e.type === type) && (!q || norm(`${e.label} ${e.type} ${e.summary}`).includes(q)));
  }, [current, text, type]);
  const clear = () => { setText(""); setType(""); };
  return (
    <div className="space-y-6">
      <PageHeader crumbs={[{ label: "Entities" }]} title="Entidades" description={`O diretório do que existe no domínio de ${current.workspace.name}: pessoas, produtos, lugares e conceitos, com suas relações.`} />
      <div className="space-y-3">
        <SearchField className="sm:w-96" value={text} onChange={setText} label="Filtrar entidades" placeholder="Buscar entidade…" />
        <ChipGroup label="Filtrar por tipo" value={type} onChange={setType} allLabel="Todos os tipos" options={types.map((t) => ({ value: t, label: t }))} />
        {text.trim() || type ? <Button variant="ghost" size="sm" onClick={clear}>Limpar filtros</Button> : null}
      </div>
      <ResourceList
        rows={rows.map((e) => ({ id: e.id, href: `/entities/${e.id}`, title: e.label, subtitle: e.summary, badges: <Badge tone="outline">{e.type}</Badge>, meta: `${e.relatedIds.length} relações` }))}
        empty={<EmptyState title="Nenhuma entidade com esses filtros" action={<Button variant="outline" size="sm" onClick={clear}>Limpar filtros</Button>} />}
        count={`${rows.length} de ${current.entities.length} entidades`}
      />
    </div>
  );
}

export function EntityDetail({ id }: { id: string }) {
  const { workspaces, current } = useAppState();
  const found = findAcross(workspaces, "entities", id, current);
  if (!found) return <NotFoundState what="Entidade" backHref="/entities" backLabel="Voltar para Entities" />;
  const { owner, item: e } = found;
  const related = owner.entities.filter((x) => e.relatedIds.includes(x.id));
  const knowledge = owner.knowledge.filter((k) => k.entityIds.includes(e.id));
  const opportunities = owner.opportunities.filter((o) => o.entityIds.includes(e.id));
  const pages = owner.pages.filter((p) => p.entityIds.includes(e.id));
  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Entities", href: "/entities" }, { label: e.label }]}
        title={e.label}
        description={e.summary}
        badges={<Badge tone="outline">{e.type}</Badge>}
        actions={<Link href={`/opportunities?ref=${e.id}`} className={buttonVariants({ size: "lg" })}>Ver oportunidades afetadas</Link>}
      />
      <OwnerNotice owner={owner} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Conhecimento sobre esta entidade">
            {knowledge.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum fato registrado: lacuna de conhecimento.</p> : (
              <ul className="space-y-2.5">{knowledge.map((k) => (
                <li key={k.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className="min-w-0"><Link href={`/knowledge/${k.id}`} className="font-medium hover:underline">{k.title}</Link><span className="block text-xs text-muted-foreground">{k.statement}</span></span>
                  <Badge tone={knowledgeTone[k.status]}>{knowledgeLabel[k.status]}</Badge>
                </li>))}</ul>
            )}
          </Panel>
          <Panel title="Oportunidades e páginas">
            <ul className="space-y-2 text-sm">
              {opportunities.map((o) => (<li key={o.id}><Link href={`/opportunities/${o.id}`} className="hover:underline">{o.title}</Link> <span className="text-xs text-muted-foreground">oportunidade</span></li>))}
              {pages.map((p) => (<li key={p.id}><Link href={`/pages/${p.id}`} className="hover:underline">{p.title}</Link> <span className="text-xs text-muted-foreground">página</span></li>))}
              {opportunities.length + pages.length === 0 ? <li className="text-muted-foreground">Nada ligado ainda.</li> : null}
            </ul>
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Atributos"><Dl items={e.attributes.map((a) => ({ label: a.label, value: a.value }))} /></Panel>
          <Panel title="Entidades relacionadas">
            {related.length === 0 ? <p className="text-sm text-muted-foreground">Sem relações registradas.</p> : (
              <ul className="flex flex-wrap gap-1.5">{related.map((r) => (<li key={r.id}><Link href={`/entities/${r.id}`}><Badge tone="outline" className="h-6 px-2 text-xs hover:text-foreground">{r.label}</Badge></Link></li>))}</ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
