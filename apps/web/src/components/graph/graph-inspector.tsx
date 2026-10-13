"use client";

import { useState } from "react";
import { ArrowRight, Crosshair, Expand, Route, Sparkles } from "lucide-react";
import { KIND_META, PROVENANCE_META, RELATION_META, type GraphEdge, type GraphNode, type HistoryEntry } from "@/lib/graph/model";
import { otherEnd, type GraphIndex } from "@/lib/graph/query";
import { cn } from "@/lib/utils";
import { GlyphIcon } from "./node-glyph";
import { Eyebrow, Pill, ToolButton, VerificationPill } from "./primitives";

export type Selection = { type: "node"; id: string } | { type: "edge"; id: string } | null;
type Tab = "overview" | "evidence" | "relations" | "history";

type Props = {
  index: GraphIndex;
  selection: Selection;
  sessionNotes: Record<string, HistoryEntry[]>;
  path: { nodeIds: string[]; edgeIds: string[] } | null;
  pathMode: boolean;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onExpand: (id: string) => void;
  onCenter: (id: string) => void;
  onTracePath: () => void;
  onAsk: () => void;
};

function NodeLink({ node, onClick, trailing }: { node: GraphNode; onClick: () => void; trailing?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <GlyphIcon kind={node.kind} verification={node.verification} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/90 group-hover:text-foreground">{node.label}</span>
      {trailing}
    </button>
  );
}

function Meta({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono text-[11.5px] text-foreground/90">{value ?? "—"}</dd>
    </div>
  );
}

function EvidenceCard({ fact, source, onSelect }: { fact: GraphNode; source?: GraphNode; onSelect: (id: string) => void }) {
  return (
    <article className="rounded-md bg-muted/40 p-3 ring-1 ring-inset ring-border">
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={() => onSelect(fact.id)} className="text-left text-[13px] font-medium text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          {fact.label}
        </button>
        <VerificationPill value={fact.verification} />
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-pretty text-muted-foreground">{fact.summary}</p>
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10.5px] text-muted-foreground">
        <div className="flex gap-1"><dt>verificado</dt><dd className="text-foreground/80">{fact.verifiedAt ?? "—"}</dd></div>
        <div className="flex gap-1"><dt>válido até</dt><dd className="text-foreground/80">{fact.validUntil ?? "—"}</dd></div>
      </dl>
      {source ? (
        <button type="button" onClick={() => onSelect(source.id)} className="mt-2 flex w-full items-center gap-2 border-t border-border pt-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <GlyphIcon kind="source" verification={source.verification} size={12} />
          <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/85">{source.label}</span>
          <span className="font-mono text-[10px] text-muted-foreground">{source.freshness}</span>
        </button>
      ) : null}
    </article>
  );
}

export function evidenceFor(index: GraphIndex, factIds: readonly string[]) {
  return factIds
    .map((id) => index.byId.get(id))
    .filter((n): n is GraphNode => !!n && n.kind === "fact")
    .map((fact) => {
      const srcEdge = (index.incident.get(fact.id) ?? []).find((e) => e.type === "evidenced_by" && e.source === fact.id);
      return { fact, source: srcEdge ? index.byId.get(srcEdge.target) : undefined };
    });
}

export function GraphInspector(p: Props) {
  const [tab, setTab] = useState<Tab>("overview");

  if (!p.selection) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <svg width="56" height="56" viewBox="-28 -28 56 56" aria-hidden="true" className="opacity-80">
          <line x1="-14" y1="8" x2="12" y2="-10" className="stroke-muted-foreground/40" strokeDasharray="3 3" />
          <line x1="-14" y1="8" x2="14" y2="14" className="stroke-muted-foreground/40" />
          <circle cx="-14" cy="8" r="7" className="fill-brand/15 stroke-brand" />
          <path d="M5,-17 h14 v14 h-14 Z" className="fill-brand/10 stroke-brand/70" />
          <path d="M14,7 L21,14 L14,21 L7,14 Z" className="fill-info/10 stroke-info/70" />
        </svg>
        <p className="text-[14px] font-medium text-foreground">Nada selecionado</p>
        <p className="max-w-60 text-[12.5px] leading-relaxed text-pretty text-muted-foreground">
          Clique em um nó ou relação para ver fatos, fontes e histórico. Clique duas vezes para expandir a vizinhança; Shift + clique traça um caminho.
        </p>
      </div>
    );
  }

  if (p.selection.type === "edge") {
    const edge = p.index.edgeById.get(p.selection.id);
    if (!edge) return null;
    return <EdgeInspector edge={edge} {...p} />;
  }

  const node = p.index.byId.get(p.selection.id);
  if (!node) return null;
  const incident = p.index.incident.get(node.id) ?? [];
  const factIds = [...new Set([...(node.kind === "fact" ? [node.id] : []), ...incident.flatMap((e) => e.evidenceIds), ...incident.map((e) => otherEnd(e, node.id)).filter((id) => p.index.byId.get(id)?.kind === "fact")])];
  const evidence = evidenceFor(p.index, factIds);
  const history = [...(p.sessionNotes[node.id] ?? []), ...node.history];
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "overview", label: "Visão geral" },
    { id: "evidence", label: "Evidências", count: evidence.length },
    { id: "relations", label: "Relações", count: incident.length },
    { id: "history", label: "Histórico", count: history.length },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-3 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <GlyphIcon kind={node.kind} verification={node.verification} size={16} />
          <Eyebrow>{KIND_META[node.kind].label}</Eyebrow>
          {node.synthetic ? <Pill tone="warning">sintético</Pill> : null}
        </div>
        <h2 className="text-[19px] leading-tight font-semibold tracking-tight text-balance text-foreground">{node.label}</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <VerificationPill value={node.verification} />
          <Pill>{PROVENANCE_META[node.provenance].label}</Pill>
          {node.freshness ? <Pill>atualizado {node.freshness}</Pill> : null}
        </div>
        <div className="flex flex-wrap gap-1">
          <ToolButton onClick={p.onAsk} className="bg-brand text-brand-foreground hover:bg-brand/90 hover:text-brand-foreground">
            <Sparkles className="size-3.5" aria-hidden="true" /> Explicar relações
          </ToolButton>
          <ToolButton onClick={() => p.onExpand(node.id)} title="Expandir vizinhança"><Expand className="size-3.5" aria-hidden="true" /> Expandir</ToolButton>
          <ToolButton onClick={() => p.onCenter(node.id)} title="Centralizar no grafo"><Crosshair className="size-3.5" aria-hidden="true" /> Centralizar</ToolButton>
          <ToolButton onClick={p.onTracePath} active={p.pathMode} title="Traçar caminho até outro nó"><Route className="size-3.5" aria-hidden="true" /> Caminho</ToolButton>
        </div>
        {p.pathMode ? <p role="status" className="rounded-md bg-info/10 px-2.5 py-1.5 text-[12px] text-info ring-1 ring-inset ring-info/30">Clique no nó de destino para traçar o caminho.</p> : null}
      </header>

      <div role="tablist" aria-label="Seções do inspetor" className="flex shrink-0 gap-1 border-b border-border px-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn("relative flex h-9 items-center gap-1.5 px-1.5 text-[12.5px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring", tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {t.label}
            {t.count !== undefined ? <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{t.count}</span> : null}
            {tab === t.id ? <span aria-hidden="true" className="absolute inset-x-1 -bottom-px h-0.5 bg-brand" /> : null}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "overview" ? (
          <div className="flex flex-col gap-4">
            <p className="text-[13.5px] leading-relaxed text-pretty text-foreground/90">{node.summary}</p>
            {p.path && p.path.nodeIds.includes(node.id) ? <PathSummary path={p.path} index={p.index} onSelectNode={p.onSelectNode} /> : null}
            <section>
              <Eyebrow className="mb-1">Atributos</Eyebrow>
              <dl>
                {node.attributes.map((a) => <Meta key={a.label} label={a.label} value={a.value} />)}
                <Meta label="Verificação" value={node.verifiedAt} />
                {node.validUntil ? <Meta label="Válido até" value={node.validUntil} /> : null}
              </dl>
            </section>
          </div>
        ) : null}
        {tab === "evidence" ? (
          evidence.length ? (
            <div className="flex flex-col gap-2">{evidence.map(({ fact, source }) => <EvidenceCard key={fact.id} fact={fact} source={source} onSelect={p.onSelectNode} />)}</div>
          ) : (
            <p className="rounded-md bg-warning/10 p-3 text-[12.5px] leading-relaxed text-warning ring-1 ring-inset ring-warning/30">Nenhum fato com fonte sustenta este nó. Tudo o que se sabe dele vem da modelagem do domínio.</p>
          )
        ) : null}
        {tab === "relations" ? <RelationList node={node} incident={incident} index={p.index} onSelectEdge={p.onSelectEdge} /> : null}
        {tab === "history" ? (
          <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
            {history.map((h, i) => (
              <li key={i} className="relative">
                <span aria-hidden="true" className={cn("absolute top-1.5 -left-[19.5px] size-2 rounded-full ring-2 ring-card", i < (p.sessionNotes[node.id]?.length ?? 0) ? "bg-brand" : "bg-muted-foreground/60")} />
                <p className="font-mono text-[10.5px] text-muted-foreground">{h.when} · {h.actor}</p>
                <p className="text-[12.5px] leading-relaxed text-foreground/90">{h.text}</p>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}

function RelationList({ node, incident, index, onSelectEdge }: { node: GraphNode; incident: GraphEdge[]; index: GraphIndex; onSelectEdge: (id: string) => void }) {
  const groups = [
    { label: "Saídas", items: incident.filter((e) => e.source === node.id) },
    { label: "Entradas", items: incident.filter((e) => e.target === node.id) },
  ];
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) =>
        g.items.length ? (
          <section key={g.label}>
            <Eyebrow className="mb-1">{g.label}</Eyebrow>
            <ul className="flex flex-col">
              {g.items.map((e) => {
                const other = index.byId.get(otherEnd(e, node.id))!;
                return (
                  <li key={e.id}>
                    <button type="button" onClick={() => onSelectEdge(e.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                      <span className="w-24 shrink-0 truncate font-mono text-[11px] text-muted-foreground">{RELATION_META[e.type].label}</span>
                      <GlyphIcon kind={other.kind} verification={other.verification} size={12} />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground/90">{other.label}</span>
                      <VerificationPill value={e.verification} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null,
      )}
    </div>
  );
}

function PathSummary({ path, index, onSelectNode }: { path: { nodeIds: string[]; edgeIds: string[] }; index: GraphIndex; onSelectNode: (id: string) => void }) {
  return (
    <section className="rounded-md bg-info/8 p-3 ring-1 ring-inset ring-info/30">
      <Eyebrow className="mb-2 text-info">Caminho traçado · {path.edgeIds.length} passos</Eyebrow>
      <ol className="flex flex-wrap items-center gap-1">
        {path.nodeIds.map((id, i) => {
          const n = index.byId.get(id)!;
          const e = path.edgeIds[i] ? index.edgeById.get(path.edgeIds[i]) : undefined;
          return (
            <li key={id} className="flex items-center gap-1">
              <button type="button" onClick={() => onSelectNode(id)} className="inline-flex items-center gap-1 rounded px-1 text-[12px] text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                <GlyphIcon kind={n.kind} size={11} />
                {n.label}
              </button>
              {e ? <span className="flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground">{RELATION_META[e.type].label}<ArrowRight className="size-3" aria-hidden="true" /></span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function EdgeInspector({ edge, index, onSelectNode }: { edge: GraphEdge } & Props) {
  const s = index.byId.get(edge.source)!;
  const t = index.byId.get(edge.target)!;
  const evidence = evidenceFor(index, edge.evidenceIds);
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <header className="flex flex-col gap-3 border-b border-border p-4">
        <Eyebrow>Relação</Eyebrow>
        <div className="flex flex-col gap-1">
          <NodeLink node={s} onClick={() => onSelectNode(s.id)} />
          <div className="flex items-center gap-2 pl-2">
            <span aria-hidden="true" className="h-4 w-px bg-brand" />
            <span className="font-mono text-[12px] text-brand">{RELATION_META[edge.type].label}</span>
            <ArrowRight className="size-3 text-brand" aria-hidden="true" />
          </div>
          <NodeLink node={t} onClick={() => onSelectNode(t.id)} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <VerificationPill value={edge.verification} />
          <Pill>{PROVENANCE_META[edge.provenance].label}</Pill>
        </div>
      </header>
      <div className="flex flex-col gap-2 p-4">
        <Eyebrow>Evidências · {evidence.length}</Eyebrow>
        {evidence.length ? (
          evidence.map(({ fact, source }) => <EvidenceCard key={fact.id} fact={fact} source={source} onSelect={onSelectNode} />)
        ) : (
          <p className="rounded-md bg-info/10 p-3 text-[12.5px] leading-relaxed text-info ring-1 ring-inset ring-info/30">
            Relação inferida pelo modelo de domínio. Nenhum fato a sustenta ainda: trate-a como hipótese, não como fato.
          </p>
        )}
      </div>
    </div>
  );
}
