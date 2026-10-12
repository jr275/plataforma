"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAppState } from "@/components/app-state";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChipGroup, SearchField, norm } from "@/components/ui/filters";
import { Dl } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/panel";
import type { Level, SearchQuery } from "@/data/demo/types";
import { levelTone } from "@/lib/opportunity";
import { cn } from "@/lib/utils";

const trendTone = { subindo: "success", estável: "neutral", caindo: "warning" } as const;

export function SearchUniverseView() {
  const { current } = useAppState();
  const initial = useSearchParams().get("q") ?? "";
  // Quando o parâmetro ?q muda (por exemplo, vindo da paleta), o campo acompanha; depois, o que o usuário digita prevalece.
  const [textState, setTextState] = useState({ param: initial, text: initial });
  let text = textState.text;
  if (textState.param !== initial) {
    setTextState({ param: initial, text: initial });
    text = initial;
  }
  const setText = (v: string) => setTextState({ param: initial, text: v });
  const [intent, setIntent] = useState<SearchQuery["intent"] | "">("");
  const [demand, setDemand] = useState<Level | "">("");
  const [cluster, setCluster] = useState("");
  const [selected, setSelected] = useState<SearchQuery | null>(null);

  const clusters = useMemo(() => [...new Set(current.queries.map((q) => q.cluster))], [current]);
  const rows = useMemo(() => {
    const q = norm(text.trim());
    return current.queries.filter((x) => (!intent || x.intent === intent) && (!demand || x.demand === demand) && (!cluster || x.cluster === cluster) && (!q || norm(`${x.text} ${x.cluster}`).includes(q)));
  }, [current, text, intent, demand, cluster]);
  const filtered = Boolean(text.trim() || intent || demand || cluster);
  const clear = () => { setText(""); setIntent(""); setDemand(""); setCluster(""); };
  const opportunity = selected?.opportunityId ? current.opportunities.find((o) => o.id === selected.opportunityId) : undefined;

  return (
    <div className="space-y-6">
      <PageHeader crumbs={[{ label: "Search Universe" }]} title="Universo de buscas" description={`Consultas e temas rastreados em ${current.workspace.name}, agrupados por tema. Dados demonstrativos, sem volumes reais.`} />
      <div className="space-y-3">
        <SearchField className="sm:w-96" value={text} onChange={setText} label="Filtrar consultas" placeholder="Buscar consulta ou tema…" />
        <ChipGroup label="Filtrar por intenção" value={intent} onChange={setIntent} allLabel="Todas as intenções" options={[{ value: "informacional", label: "Informacional" }, { value: "comparação", label: "Comparação" }, { value: "transacional", label: "Transacional" }]} />
        <ChipGroup label="Filtrar por demanda" value={demand} onChange={setDemand} allLabel="Qualquer demanda" options={[{ value: "alta", label: "Demanda alta" }, { value: "média", label: "Demanda média" }, { value: "baixa", label: "Demanda baixa" }]} />
        <ChipGroup label="Filtrar por tema" value={cluster} onChange={setCluster} allLabel="Todos os temas" options={clusters.map((c) => ({ value: c, label: c }))} />
        {filtered ? <Button variant="ghost" size="sm" onClick={clear}>Limpar filtros</Button> : null}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {rows.length === 0 ? (
          <EmptyState title="Nenhuma consulta com esses filtros" hint="Ajuste ou limpe os filtros." action={<Button variant="outline" size="sm" onClick={clear}>Limpar filtros</Button>} />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((q) => (
              <li key={q.id}>
                <button type="button" onClick={() => setSelected(q)} style={{ paddingBlock: "var(--row-y)" }} className={cn("flex w-full flex-col gap-2 px-4 text-left transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none sm:flex-row sm:items-center sm:gap-4")}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{q.text}</span>
                    <span className="block truncate text-xs text-muted-foreground">{q.cluster} · {q.intent}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={levelTone[q.demand]}>Demanda {q.demand}</Badge>
                    <Badge tone={trendTone[q.trend]}>{q.trend}</Badge>
                    {q.opportunityId ? <Badge tone="brand">com oportunidade</Badge> : <Badge tone="outline">sem oportunidade</Badge>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">{rows.length} de {current.queries.length} consultas · dados demonstrativos</p>

      <Modal open={selected !== null} onOpenChange={(o) => { if (!o) setSelected(null); }} title={selected?.text ?? ""} description="Detalhe da consulta (dados demonstrativos).">
        {selected ? (
          <div className="space-y-4">
            <Dl items={[{ label: "Tema", value: selected.cluster }, { label: "Intenção", value: selected.intent }, { label: "Demanda", value: <Badge tone={levelTone[selected.demand]}>{selected.demand}</Badge> }, { label: "Tendência", value: selected.trend }]} />
            <div className="flex flex-wrap justify-end gap-2">
              <Link href={`/ask?q=${encodeURIComponent(`O que sabemos sobre ${selected.text}?`)}`} className={buttonVariants({ variant: "outline" })}>Perguntar no Ask AI</Link>
              {opportunity ? <Link href={`/opportunities/${opportunity.id}`} className={buttonVariants()}>Abrir oportunidade</Link> : <span className="self-center text-xs text-muted-foreground">Nenhuma oportunidade ligada a esta consulta.</span>}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
