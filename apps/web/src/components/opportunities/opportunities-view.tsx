"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { useAppState } from "@/components/app-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chip, ChipGroup, SearchField, norm } from "@/components/ui/filters";
import { EmptyState } from "@/components/ui/panel";
import { PageHeader } from "@/components/ui/page-header";
import { ResourceList } from "@/components/ui/resource-list";
import type { Opportunity, OpportunityStatus } from "@/data/demo/types";
import { statusLabel, statusTone } from "@/lib/opportunity";

const STATUSES: readonly OpportunityStatus[] = ["candidate", "in_review", "ready", "blocked", "dismissed"];
const KINDS: readonly Opportunity["kind"][] = ["página", "cluster", "FAQ", "comparativo"];

export function OpportunitiesView() {
  const { current } = useAppState();
  const router = useRouter();
  const ref = useSearchParams().get("ref");
  const [text, setText] = useState("");
  const [statuses, setStatuses] = useState<ReadonlySet<OpportunityStatus>>(new Set());
  const [kind, setKind] = useState<Opportunity["kind"] | "">("");

  const entityLabels = useMemo(() => new Map(current.entities.map((e) => [e.id, e.label])), [current]);
  const refLabel = useMemo(() => {
    if (!ref) return undefined;
    return entityLabels.get(ref) ?? current.sources.find((s) => s.id === ref)?.name;
  }, [ref, current, entityLabels]);

  const rows = useMemo(() => {
    const q = norm(text.trim());
    return [...current.opportunities]
      .sort((a, b) => a.rank - b.rank)
      .filter((o) => {
        // Descartadas só aparecem quando o filtro "Descartada" está ativo.
        if (statuses.size === 0 ? o.status === "dismissed" : !statuses.has(o.status)) return false;
        if (kind && o.kind !== kind) return false;
        if (ref && !o.entityIds.includes(ref) && !o.sourceIds.includes(ref)) return false;
        const entities = o.entityIds.map((id) => entityLabels.get(id) ?? "").join(" ");
        return !q || norm(`${o.title} ${o.summary} ${o.intent} ${entities}`).includes(q);
      });
  }, [current, statuses, text, kind, ref, entityLabels]);

  const toggle = (s: OpportunityStatus) =>
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  const filtered = text.trim() !== "" || statuses.size > 0 || kind !== "" || Boolean(ref);
  const clear = () => {
    setText("");
    setStatuses(new Set());
    setKind("");
    if (ref) router.replace("/opportunities");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Opportunities" }]}
        title="Oportunidades"
        description={`Onde o que o sistema sabe encontra uma demanda real de busca em ${current.workspace.name}. Fatores separados, sem nota única.`}
      />
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchField className="sm:w-80" value={text} onChange={setText} label="Filtrar oportunidades" placeholder="Buscar por título ou entidade…" />
          <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-1.5">
            {STATUSES.map((s) => (
              <Chip key={s} pressed={statuses.has(s)} onClick={() => toggle(s)}>{statusLabel[s]}</Chip>
            ))}
          </div>
        </div>
        <ChipGroup label="Filtrar por categoria" value={kind} onChange={setKind} allLabel="Todas as categorias" options={KINDS.map((k) => ({ value: k, label: k }))} />
        {refLabel ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            Relacionadas a
            <Badge tone="brand">
              {refLabel}
              <button type="button" onClick={() => router.replace("/opportunities")} aria-label={`Remover filtro ${refLabel}`} className="rounded focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                <X className="size-3" aria-hidden="true" />
              </button>
            </Badge>
          </p>
        ) : null}
        {filtered ? <Button variant="ghost" size="sm" onClick={clear}>Limpar filtros</Button> : null}
      </div>
      <ResourceList
        rows={rows.map((o) => ({
          id: o.id,
          href: `/opportunities/${o.id}`,
          title: `${o.rank}. ${o.title}`,
          subtitle: `${o.kind} · ${o.intent} · demanda ${o.demand} · concorrência ${o.competition} · evidência ${o.evidence}`,
          badges: <Badge tone={statusTone[o.status]}>{statusLabel[o.status]}</Badge>,
        }))}
        empty={
          <EmptyState
            title={filtered ? "Nenhuma oportunidade com esses filtros" : "Nenhuma oportunidade ativa neste workspace"}
            hint={filtered ? "Ajuste ou limpe os filtros para ver as demais." : "As oportunidades descartadas ficam sob o filtro “Descartada”."}
            action={filtered ? <Button variant="outline" size="sm" onClick={clear}>Limpar filtros</Button> : undefined}
          />
        }
        count={`${rows.length} ${rows.length === 1 ? "oportunidade" : "oportunidades"}`}
      />
    </div>
  );
}
