"use client";

import { CONTRACTS, type Change, type Issue, type PageDraft } from "@plataforma/api/src/draft";
import type { ExecState } from "@plataforma/api/src/draft";
import type { DraftPreview } from "@plataforma/api";
import { Badge } from "@/components/ui/badge";
import { TruthChip } from "@/components/ui/truth-chip";
import { PagePreview } from "@/components/generation/page-preview";
import { EXEC_LABEL, VALIDITY_LABEL } from "./status";

export function IssuesPanel({ issues, stale, evaluatedAt, onFocus, errors, warnings }: { issues: readonly Issue[]; stale: boolean; evaluatedAt: "server" | "never"; onFocus: (nodeId: string) => void; errors: number; warnings: number }) {
  return (
    <div className="space-y-3 text-sm" data-testid="issues">
      <p className="text-xs text-muted-foreground"><strong className="text-foreground">{errors}</strong> erro(s) · <strong className="text-foreground">{warnings}</strong> aviso(s). A validação de estrutura e configuração roda a cada edição; os <strong>gates</strong> só valem depois de “Validar” no servidor.{stale ? <> <TruthChip state="not_evaluated">gates invalidados pela edição: valide de novo</TruthChip></> : evaluatedAt === "server" ? <> <TruthChip state="derived">gates avaliados para este conteúdo</TruthChip></> : null}</p>
      {issues.length === 0 ? <p className="text-xs">Nenhum problema encontrado no rascunho.</p> : (
        <ul className="space-y-1.5 text-xs">{issues.map((i, n) => (
          <li key={n} className="flex items-start gap-2"><Badge tone={i.severity === "error" ? "danger" : i.severity === "warning" ? "warning" : "outline"}>{i.severity === "error" ? "erro" : i.severity === "warning" ? "aviso" : "nota"}</Badge>
            <span>{i.message}{i.nodeId ? <> <button type="button" onClick={() => onFocus(i.nodeId!)} className="font-mono text-[10.5px] underline underline-offset-2">{i.nodeId}</button></> : null}</span></li>))}</ul>
      )}
    </div>
  );
}

/** Alternativa em lista (teclado e leitores de tela) com o MESMO conteúdo do canvas: nós, estados e conexões. */
export function NodeList({ draft, exec, validity, selected, onSelect, onRemoveEdge }: { draft: PageDraft; exec: Record<string, ExecState>; validity: Record<string, "ok" | "warning" | "error">; selected: string | null; onSelect: (id: string) => void; onRemoveEdge: (id: string) => void }) {
  const label = (id: string) => CONTRACTS[draft.nodes.find((n) => n.id === id)!.type].label;
  return (
    <div className="space-y-4 text-xs" data-testid="node-list">
      <div className="overflow-x-auto"><table className="w-full min-w-[34rem] text-left"><caption className="sr-only">Nós do rascunho</caption>
        <thead className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase"><tr><th scope="col" className="py-1.5 pr-3">Nó</th><th scope="col" className="pr-3">Execução</th><th scope="col" className="pr-3">Configuração</th><th scope="col"><span className="sr-only">Ação</span></th></tr></thead>
        <tbody>{draft.nodes.map((n) => (<tr key={n.id} className={`border-t border-border ${selected === n.id ? "bg-accent" : ""}`}><td className="py-1.5 pr-3"><span className="font-medium">{CONTRACTS[n.type].label}</span> <span className="font-mono text-[10.5px] text-muted-foreground">{n.id}</span></td><td className="pr-3">{EXEC_LABEL[exec[n.id]!.status]}</td><td className="pr-3">{VALIDITY_LABEL[validity[n.id] ?? "ok"]}</td><td><button type="button" className="underline underline-offset-2" aria-pressed={selected === n.id} onClick={() => onSelect(n.id)}>Inspecionar<span className="sr-only"> {label(n.id)} {n.id}</span></button></td></tr>))}</tbody></table></div>
      <div><h4 className="mb-1 font-mono text-[10.5px] font-semibold tracking-wide uppercase">Conexões ({draft.edges.length})</h4>
        <ul className="space-y-0.5">{draft.edges.map((e) => (<li key={e.id} className="flex items-center justify-between gap-2"><span>{label(e.from)} <span className="font-mono text-[10.5px] text-muted-foreground">{e.from}</span> → {label(e.to)} <span className="font-mono text-[10.5px] text-muted-foreground">{e.to}</span></span><button type="button" className="underline underline-offset-2" onClick={() => onRemoveEdge(e.id)}>remover<span className="sr-only"> conexão {e.id}</span></button></li>))}</ul></div>
    </div>
  );
}

export function HistoryPanel({ versions }: { versions: readonly { version: number; createdAt: Date | string; createdBy: string; valid: boolean; errors: number; warnings: number; changes: readonly Change[]; note: string | null }[] }) {
  if (versions.length === 0) return <p className="text-xs text-muted-foreground" data-testid="history">Nenhuma versão salva ainda. O primeiro salvamento cria a versão 1 (o rascunho inicial é derivado do blueprint).</p>;
  const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
  return (
    <ol className="space-y-2 text-xs" data-testid="history">{versions.map((v) => (
      <li key={v.version} className="border-l-2 border-border pl-3"><span className="font-mono text-[10.5px] text-muted-foreground">v{v.version} · {fmt.format(new Date(v.createdAt))} · {v.createdBy.slice(0, 8)}</span> <Badge tone={v.valid ? "success" : "danger"}>{v.valid ? "válido" : `${v.errors} erro(s)`}</Badge>{v.note ? <span className="text-muted-foreground"> — {v.note}</span> : null}
        <p className="text-muted-foreground">{v.changes.length === 0 ? "Só posições (nenhuma mudança relevante)." : v.changes.slice(0, 8).map((c) => `${c.kind === "node_added" ? "+" : c.kind === "node_removed" ? "−" : c.kind === "edge_added" ? "+ liga" : c.kind === "edge_removed" ? "− liga" : "~"} ${c.id}${c.field ? `.${c.field}` : ""}`).join(" · ")}{v.changes.length > 8 ? ` · +${v.changes.length - 8}` : ""}</p></li>))}</ol>
  );
}

export function PreviewPane({ preview, stale, pending, error, onRefresh }: { preview: DraftPreview | null | undefined; stale: boolean; pending: boolean; error: string | null; onRefresh: () => void }) {
  return (
    <div className="space-y-3 text-xs" data-testid="draft-preview">
      <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={onRefresh} disabled={pending} aria-busy={pending} className="inline-flex h-8 items-center border border-border bg-card px-3 hover:bg-accent disabled:opacity-60">{pending ? "Renderizando…" : "Atualizar prévia"}</button>
        <TruthChip state="estimated">rascunho · não indexável</TruthChip>{preview && stale ? <TruthChip state="not_evaluated">prévia desatualizada: atualize</TruthChip> : null}</div>
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      {preview === undefined ? <p className="text-muted-foreground">A prévia usa o motor real de páginas com os fatos reais da entidade e a composição que está no canvas (seções, ordem, títulos, links). Clique em “Atualizar prévia”.</p> : preview === null ? <p className="text-muted-foreground">Esta oportunidade não tem uma entidade com template renderizável: nada a pré-visualizar. Nada foi simulado.</p> : (
        <>
          <p className="text-muted-foreground">{preview.note}</p>
          {preview.status === "no_template" ? <p>Sem template válido no rascunho: nada foi renderizado.</p> : preview.status === "blocked" || !preview.page ? <div><p className="text-destructive">O motor não renderizou a página:</p><ul>{preview.gates.map((g) => (<li key={g.gate}>{g.gate}: {g.outcome}{g.outcome === "fail" ? ` — ${g.detail}` : ""}</li>))}</ul></div> : (
            <>
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <div><dt className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">Título SEO ({preview.seo!.title.length}/60)</dt><dd>{preview.seo!.title}</dd></div>
                <div><dt className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">Descrição ({preview.seo!.metaDescription.length}; 70–155)</dt><dd>{preview.seo!.metaDescription}</dd></div>
                <div><dt className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">Canonical · robots</dt><dd className="font-mono">{preview.seo!.canonical} · {preview.seo!.robots}</dd></div>
                <div><dt className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">Links internos</dt><dd>{preview.links.configured} configurado(s), {preview.links.emitted} emitido(s){preview.links.missing.length ? <span className="text-muted-foreground"> — sem destino existente: {preview.links.missing.join(", ")}</span> : null}</dd></div>
              </dl>
              {preview.structuredData.length ? <div><h4 className="font-mono text-[10.5px] font-semibold tracking-wide uppercase">Dados estruturados propostos (nada é emitido)</h4>{preview.structuredData.map((s, i) => (<pre key={i} className="mt-1 overflow-x-auto border border-border bg-muted/40 p-2 font-mono text-[11px]">{JSON.stringify(s.json, null, 2)}</pre>))}<p className="text-muted-foreground">Proveniência: {preview.structuredData[0]!.provenance.join(", ")} (cada propriedade vem de um fato com fonte).</p></div> : null}
              <PagePreview page={preview.page} />
            </>
          )}
        </>
      )}
    </div>
  );
}
