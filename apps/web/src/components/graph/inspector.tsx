import Link from "next/link";
import type { graph } from "@plataforma/api";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/components/generation/format";
import { BASIS_LABEL, KIND_LABEL, KIND_PLURAL, KIND_TONE, ageDays, verificationOf } from "./kinds";

export function BasisChip({ basis }: { basis: graph.Basis | "suggestion" }) {
  const b = BASIS_LABEL[basis];
  return <span title={b.help}><Badge tone={b.tone}>{b.label}</Badge></span>;
}

/** Inspetor da entidade selecionada: identidade, atributos (com a natureza de cada valor), origem e atualidade, relações, navegação e sugestões. */
export function GraphInspector({ detail, now }: { detail: graph.GraphNodeDetail; now: Date }) {
  const { node, attributes, provenance, counts, links, suggestions } = detail;
  return (
    <section aria-label="Inspetor da entidade" className="space-y-5 rounded-xl border border-border bg-card p-4" data-testid="inspector">
      <header>
        <div className="flex items-center gap-2"><Badge tone={KIND_TONE[node.kind]}>{KIND_LABEL[node.kind]}</Badge></div>
        <h2 className="mt-2 text-base leading-tight font-semibold break-words">{node.label}</h2>
        <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground" title="Identidade canônica do nó neste workspace">{node.ref}</p>
      </header>

      <section aria-label="Atributos">
        <h3 className="mb-2 font-mono text-[10.5px] tracking-[0.08em] text-muted-foreground uppercase">Atributos</h3>
        <dl className="divide-y divide-border text-sm">
          {attributes.map((a) => (
            <div key={a.label} className="flex items-start justify-between gap-3 py-1.5 first:pt-0 last:pb-0">
              <dt className="text-muted-foreground">{a.label}</dt>
              <dd className="flex min-w-0 flex-col items-end gap-1 text-right"><span className="break-words tabular-nums">{a.value}</span><BasisChip basis={a.basis} /></dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-label="Origem e atualidade">
        <h3 className="mb-2 font-mono text-[10.5px] tracking-[0.08em] text-muted-foreground uppercase">Origem e atualidade</h3>
        {provenance.sources.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma execução de importação encontrada para esta entidade.</p> : (
          <ul className="space-y-3">
            {provenance.sources.map((s) => {
              const v = verificationOf(s);
              return (
                <li key={s.runId} className="rounded-lg border border-border bg-muted/40 p-2.5 text-xs">
                  <p className="flex flex-wrap items-center gap-2"><strong>{s.sourceName}</strong><Badge tone={v.tone}>{v.label}</Badge></p>
                  <p className="mt-1.5 font-mono break-all text-muted-foreground">{s.fileName}</p>
                  <p className="mt-1 font-mono text-[10.5px] break-all text-muted-foreground" title={s.fileSha256}>sha256 {s.fileSha256.slice(0, 16)}…</p>
                  <p className="mt-1.5">Importado em {formatDateTime(s.importedAt)} <span className="text-muted-foreground">(há {ageDays(s.importedAt, now)} dia(s))</span></p>
                  <p className="text-muted-foreground">{s.acceptedRows.toLocaleString("pt-BR")} de {s.totalRows.toLocaleString("pt-BR")} linhas aceitas</p>
                  <p className="mt-1"><Link href={`/data-flow?run=${s.runId}`} className="underline underline-offset-2">Ver a execução</Link></p>
                </li>
              );
            })}
          </ul>
        )}
        {provenance.sources.length > 1 && provenance.oldestImportAt && provenance.newestImportAt ? <p className="mt-2 text-xs text-muted-foreground">Dados de {provenance.sources.length} execuções, de {formatDateTime(provenance.oldestImportAt)} a {formatDateTime(provenance.newestImportAt)}.</p> : null}
        {provenance.record ? (
          <div className="mt-3 text-xs">
            <p className="mb-1 text-muted-foreground">Linha original (linha {provenance.record.rowNumber}, {provenance.record.outcome === "accepted" ? "aceita" : provenance.record.outcome})</p>
            <dl className="grid grid-cols-[7rem_1fr] gap-y-1 font-mono text-[11px]">{Object.entries(provenance.record.raw).map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="break-all">{v === "" ? "(vazio)" : v}</dd></div>))}</dl>
          </div>
        ) : null}
      </section>

      <section aria-label="Relações">
        <h3 className="mb-2 font-mono text-[10.5px] tracking-[0.08em] text-muted-foreground uppercase">Relações existentes</h3>
        <ul className="flex flex-wrap gap-2 text-xs">{(Object.entries(counts) as [graph.GraphNodeKind, number][]).map(([k, n]) => (<li key={k}><Badge tone="outline">{n.toLocaleString("pt-BR")} {KIND_PLURAL[k].toLowerCase()}</Badge></li>))}</ul>
      </section>

      {links.length > 0 ? (
        <nav aria-label="Navegar para a evidência">
          <h3 className="mb-2 font-mono text-[10.5px] tracking-[0.08em] text-muted-foreground uppercase">Abrir</h3>
          <ul className="space-y-1 text-sm">{links.map((l) => (<li key={l.href}><Link href={l.href} className="underline underline-offset-2">{l.label}</Link></li>))}</ul>
        </nav>
      ) : null}

      {suggestions.length > 0 ? (
        <section aria-label="Sugestões" className="rounded-lg border border-warning/40 bg-warning/10 p-2.5">
          <h3 className="mb-1.5 flex items-center gap-2 font-mono text-[10.5px] tracking-[0.08em] uppercase"><BasisChip basis="suggestion" /></h3>
          <ul className="space-y-1.5 text-xs">{suggestions.map((s) => (<li key={s.text}>{s.text}{s.href ? <> <Link href={s.href} className="underline underline-offset-2">Abrir</Link></> : null}</li>))}</ul>
        </section>
      ) : null}

      <p className="border-t border-border pt-3 text-[11px] leading-snug text-muted-foreground">
        <strong>Fato</strong>: valor literal da fonte. <strong>Derivado</strong>: calculado ou gravado pelo sistema. <strong>Sugestão</strong>: ação possível, nunca um fato. Este painel não exibe inferências.
      </p>
    </section>
  );
}
