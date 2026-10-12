"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAppState } from "@/components/app-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dl } from "@/components/ui/field";
import { ChipGroup, SearchField, norm } from "@/components/ui/filters";
import { NotFoundState } from "@/components/ui/not-found-state";
import { OwnerNotice } from "@/components/ui/owner-notice";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import { ResourceList } from "@/components/ui/resource-list";
import type { KnowledgeStatus, Level } from "@/data/demo/types";
import { findAcross } from "@/lib/find";
import { levelTone } from "@/lib/opportunity";

export const knowledgeLabel: Record<KnowledgeStatus, string> = { verified: "Verificado", needs_review: "Para revisar", expired: "Expirado" };
export const knowledgeTone = { verified: "success", needs_review: "warning", expired: "danger" } as const;

export function KnowledgeList() {
  const { current } = useAppState();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<KnowledgeStatus | "">("");
  const [confidence, setConfidence] = useState<Level | "">("");
  const sourceName = useMemo(() => new Map(current.sources.map((s) => [s.id, s.name])), [current]);
  const rows = useMemo(() => {
    const q = norm(text.trim());
    return current.knowledge.filter((k) => (!status || k.status === status) && (!confidence || k.confidence === confidence) && (!q || norm(`${k.title} ${k.statement}`).includes(q)));
  }, [current, text, status, confidence]);
  const filtered = Boolean(text.trim() || status || confidence);
  const clear = () => { setText(""); setStatus(""); setConfidence(""); };
  return (
    <div className="space-y-6">
      <PageHeader crumbs={[{ label: "Knowledge" }]} title="Conhecimento" description={`Fatos com fonte, confiança e validade em ${current.workspace.name}. Nenhum número em texto existe sem um fato aqui (regra 1).`} />
      <div className="space-y-3">
        <SearchField className="sm:w-96" value={text} onChange={setText} label="Filtrar conhecimento" placeholder="Buscar por título ou afirmação…" />
        <ChipGroup label="Filtrar por estado" value={status} onChange={setStatus} allLabel="Todos os estados" options={(Object.keys(knowledgeLabel) as KnowledgeStatus[]).map((s) => ({ value: s, label: knowledgeLabel[s] }))} />
        <ChipGroup label="Filtrar por confiança" value={confidence} onChange={setConfidence} allLabel="Qualquer confiança" options={[{ value: "alta", label: "Confiança alta" }, { value: "média", label: "Confiança média" }, { value: "baixa", label: "Confiança baixa" }]} />
        {filtered ? <Button variant="ghost" size="sm" onClick={clear}>Limpar filtros</Button> : null}
      </div>
      <ResourceList
        rows={rows.map((k) => ({
          id: k.id, href: `/knowledge/${k.id}`, title: k.title, subtitle: `Fonte: ${sourceName.get(k.sourceId) ?? k.sourceId}`,
          badges: (<><Badge tone={levelTone[k.confidence]}>Confiança {k.confidence}</Badge><Badge tone={knowledgeTone[k.status]}>{knowledgeLabel[k.status]}</Badge></>),
          meta: `até ${k.validUntil}`,
        }))}
        empty={<EmptyState title="Nenhum registro com esses filtros" action={<Button variant="outline" size="sm" onClick={clear}>Limpar filtros</Button>} />}
        count={`${rows.length} de ${current.knowledge.length} registros`}
      />
    </div>
  );
}

export function KnowledgeDetail({ id }: { id: string }) {
  const { workspaces, current, setKnowledgeStatus, notify } = useAppState();
  const found = findAcross(workspaces, "knowledge", id, current);
  if (!found) return <NotFoundState what="Registro de conhecimento" backHref="/knowledge" backLabel="Voltar para Knowledge" />;
  const { owner, item: k } = found;
  const source = owner.sources.find((s) => s.id === k.sourceId);
  const entities = owner.entities.filter((e) => k.entityIds.includes(e.id));
  const opportunities = owner.opportunities.filter((o) => o.knowledgeIds.includes(k.id));
  const pages = owner.pages.filter((p) => p.knowledgeIds.includes(k.id));
  const toggleTo: KnowledgeStatus = k.status === "verified" ? "needs_review" : "verified";
  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Knowledge", href: "/knowledge" }, { label: k.title }]}
        title={k.title}
        badges={<><Badge tone={knowledgeTone[k.status]}>{knowledgeLabel[k.status]}</Badge><Badge tone={levelTone[k.confidence]}>Confiança {k.confidence}</Badge></>}
        actions={<Button size="lg" onClick={() => { setKnowledgeStatus(k.id, toggleTo); notify(toggleTo === "verified" ? "Registro marcado como verificado (somente neste navegador)." : "Registro devolvido para revisão (somente neste navegador)."); }}>{toggleTo === "verified" ? "Marcar como verificado" : "Devolver para revisão"}</Button>}
      />
      <OwnerNotice owner={owner} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Afirmação"><p className="text-sm">{k.statement}</p><p className="mt-2 text-xs text-muted-foreground">Texto de demonstração; não é um fato real.</p></Panel>
          <Panel title="Onde é usado">
            <ul className="space-y-2 text-sm">
              {opportunities.map((o) => (<li key={o.id}><Link href={`/opportunities/${o.id}`} className="hover:underline">{o.title}</Link> <span className="text-xs text-muted-foreground">oportunidade</span></li>))}
              {pages.map((p) => (<li key={p.id}><Link href={`/pages/${p.id}`} className="hover:underline">{p.title}</Link> <span className="text-xs text-muted-foreground">página</span></li>))}
              {opportunities.length + pages.length === 0 ? <li className="text-muted-foreground">Ainda não é usado em nenhuma oportunidade ou página.</li> : null}
            </ul>
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Procedência">
            <Dl items={[{ label: "Fonte", value: source ? <Link href={`/data-sources/${source.id}`} className="hover:underline">{source.name}</Link> : k.sourceId }, { label: "Válido até", value: k.validUntil }, { label: "Atualizado", value: k.updated }]} />
          </Panel>
          <Panel title="Entidades">
            <ul className="flex flex-wrap gap-1.5">{entities.map((e) => (<li key={e.id}><Link href={`/entities/${e.id}`}><Badge tone="outline" className="h-6 px-2 text-xs hover:text-foreground">{e.label}</Badge></Link></li>))}</ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
