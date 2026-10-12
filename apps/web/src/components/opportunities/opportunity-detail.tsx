"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleDashed } from "lucide-react";
import { useAppState } from "@/components/app-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { NotFoundState } from "@/components/ui/not-found-state";
import { OwnerNotice } from "@/components/ui/owner-notice";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { findAcross } from "@/lib/find";
import { levelTone, statusLabel, statusTone, transition } from "@/lib/opportunity";

const factorHelp = {
  demand: "Quanto o universo de buscas pede por este tema.",
  competition: "Quão bem atendido o tema já é por outros resultados.",
  evidence: "Quanto do conteúdo pode se apoiar em fatos com fonte.",
} as const;

export function OpportunityDetail({ id }: { id: string }) {
  const { workspaces, current, setOpportunityStatus, notify } = useAppState();
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const found = findAcross(workspaces, "opportunities", id, current);
  if (!found) return <NotFoundState what="Oportunidade" backHref="/opportunities" backLabel="Voltar para as oportunidades" />;
  const { owner, item: o } = found;
  const next = transition[o.status];
  const entities = owner.entities.filter((e) => o.entityIds.includes(e.id));
  const sources = owner.sources.filter((s) => o.sourceIds.includes(s.id));
  const knowledge = owner.knowledge.filter((k) => o.knowledgeIds.includes(k.id));
  const pages = owner.pages.filter((p) => p.opportunityId === o.id);
  const queries = owner.queries.filter((q) => q.opportunityId === o.id);

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Opportunities", href: "/opportunities" }, { label: o.title }]}
        title={o.title}
        description={o.summary}
        badges={
          <>
            <Badge tone={statusTone[o.status]}>{statusLabel[o.status]}</Badge>
            <Badge tone="outline">{o.kind}</Badge>
            <Badge tone="outline">{o.intent}</Badge>
            <span className="text-xs text-muted-foreground">Atualizada {o.updated}</span>
          </>
        }
        actions={
          <>
            {o.status !== "dismissed" ? <Button variant="outline" size="lg" onClick={() => setConfirmDismiss(true)}>Descartar</Button> : null}
            {next ? (
              <Button size="lg" onClick={() => { setOpportunityStatus(o.id, next.to); notify(next.done); }}>{next.label}</Button>
            ) : null}
          </>
        }
      />
      <OwnerNotice owner={owner} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Por que esta oportunidade">
            <ul className="list-disc space-y-2 pl-4 text-sm marker:text-muted-foreground">
              {o.rationale.map((r) => (<li key={r}>{r}</li>))}
            </ul>
          </Panel>
          <Panel title="Evidências" description="Conhecimento verificável ligado a esta oportunidade.">
            {knowledge.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum fato com fonte ligado ainda: nada pode ser citado.</p>
            ) : (
              <ul className="space-y-2.5">
                {knowledge.map((k) => (
                  <li key={k.id} className="text-sm">
                    <Link href={`/knowledge/${k.id}`} className="font-medium hover:underline">{k.title}</Link>
                    <p className="text-xs text-muted-foreground">{k.statement}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="O que falta saber" description="Lacunas que impedem avançar com segurança.">
            {o.gaps.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma lacuna registrada para esta oportunidade.</p>
            ) : (
              <ul className="space-y-2.5">
                {o.gaps.map((g) => (
                  <li key={g} className="flex items-start gap-2.5 text-sm">
                    <CircleDashed className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                    {g}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Próximo passo recomendado">
            <p className="text-sm">{o.nextAction}</p>
            <p className="mt-1 text-xs text-muted-foreground">Recomendação de demonstração; os botões da página alteram apenas o estado local desta oportunidade, neste navegador.</p>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Fatores" description="Separados, nunca somados.">
            <dl className="space-y-3">
              {(["demand", "competition", "evidence"] as const).map((k) => (
                <div key={k}>
                  <dt className="flex items-center justify-between text-[13px] font-medium">
                    {{ demand: "Demanda", competition: "Concorrência", evidence: "Evidência" }[k]}
                    <Badge tone={levelTone[o[k]]}>{o[k]}</Badge>
                  </dt>
                  <dd className="mt-0.5 text-xs text-muted-foreground">{factorHelp[k]}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel title="Entidades afetadas">
            {entities.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma entidade ligada.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {entities.map((e) => (
                  <li key={e.id}>
                    <Link href={`/entities/${e.id}`} className="inline-flex" aria-label={`Abrir entidade ${e.label}`}>
                      <Badge tone="outline" className="h-6 px-2 text-xs hover:text-foreground">{e.label} · {e.type}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Fontes de referência">
            {sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem fonte cadastrada: nenhum fato pode ser citado ainda.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {sources.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3">
                    <Link href={`/data-sources/${s.id}`} className="truncate hover:underline">{s.name}</Link>
                    <span className="text-xs text-muted-foreground">{s.freshness}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Páginas e buscas">
            <ul className="space-y-2 text-sm">
              {pages.map((p) => (<li key={p.id}><Link href={`/pages/${p.id}`} className="hover:underline">{p.title}</Link> <span className="text-xs text-muted-foreground">página</span></li>))}
              {queries.map((q) => (<li key={q.id}><Link href={`/search-universe?q=${encodeURIComponent(q.text)}`} className="hover:underline">{q.text}</Link> <span className="text-xs text-muted-foreground">busca</span></li>))}
              {pages.length + queries.length === 0 ? <li className="text-muted-foreground">Nada ligado ainda.</li> : null}
            </ul>
          </Panel>
        </div>
      </div>

      <Modal open={confirmDismiss} onOpenChange={setConfirmDismiss} title="Descartar esta oportunidade?" description="Ela sai da lista ativa e pode ser restaurada pelo filtro “Descartada”. A alteração vale só neste navegador.">
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDismiss(false)}>Cancelar</Button>
          <Button onClick={() => { setOpportunityStatus(o.id, "dismissed"); setConfirmDismiss(false); notify("Oportunidade descartada (somente neste navegador)."); }}>Descartar</Button>
        </div>
      </Modal>
    </div>
  );
}
