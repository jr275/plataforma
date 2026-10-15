import Link from "next/link";
import type { GenerationRunDetail } from "@plataforma/api";
import { AutoRefresh } from "@/components/flow/auto-refresh";
import { FlowWorkspace } from "@/components/flow/flow-workspace";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import type { Loaded } from "@/lib/server/tenant-data";
import { buildRunFlow } from "./flow-model";
import { GATE_LABEL, OUTCOME, RUN_STATUS, formatDateTime, formatInt } from "./format";
import { StatePanel } from "./state-panel";

export function RunDetailView({ loaded, flowBanner }: { loaded: Loaded<GenerationRunDetail | undefined>; flowBanner?: string }) {
  const crumbs = [{ label: "Geração de páginas", href: "/generation" }, { label: "Execução" }];
  if (loaded.state !== "ready") return <div className="space-y-6"><PageHeader crumbs={crumbs} title="Execução de geração" />{<StatePanel state={loaded.state} missing={loaded.state === "not_configured" ? loaded.missing : undefined} />}</div>;
  const d = loaded.data;
  if (!d) return <div className="space-y-6"><PageHeader crumbs={crumbs} title="Execução não encontrada" /><Panel title="Estado"><EmptyState title="Esta execução não existe neste workspace" action={<Link href="/generation" className="text-xs underline underline-offset-2">Voltar à lista</Link>} /></Panel></div>;
  const { run, items } = d;
  return (
    <div className="space-y-6">
      <PageHeader crumbs={crumbs} title={`Execução de ${formatDateTime(run.startedAt)}`} description={`Template ${run.templateKey} v${run.templateVersion}. Criada por ${run.createdBy}.`} badges={<Badge tone={RUN_STATUS[run.status].tone}>{RUN_STATUS[run.status].label}</Badge>} />
      {run.error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{run.error}</p> : null}
      <AutoRefresh active={run.status === "running"} />
      <FlowWorkspace definition={buildRunFlow(d)} banner={flowBanner} />
      <div className="grid gap-4 sm:grid-cols-4">
        <Panel title="Cidades"><p className="text-4xl font-medium tabular-nums">{formatInt(run.totalItems)}</p></Panel>
        <Panel title="Geradas"><p className="text-4xl font-medium tabular-nums">{formatInt(run.generatedItems)}</p></Panel>
        <Panel title="Inalteradas"><p className="text-4xl font-medium tabular-nums">{formatInt(run.unchangedItems)}</p><p className="mt-1 text-xs text-muted-foreground">Mesmo conteúdo: nenhuma versão nova.</p></Panel>
        <Panel title="Bloqueadas"><p className="text-4xl font-medium tabular-nums">{formatInt(run.blockedItems)}</p></Panel>
      </div>
      <Panel title="Resultado por cidade" description="Uma linha por cidade tentada, com os gates que reprovaram (se houver).">
        {items.length === 0 ? <EmptyState title="Esta execução não gravou itens" hint="Execuções que falharam antes de processar não deixam itens." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Resultado por cidade</caption>
              <thead className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase"><tr><th scope="col" className="py-2 pr-4">Cidade</th><th scope="col" className="pr-4">Resultado</th><th scope="col">Motivo</th></tr></thead>
              <tbody>
                {items.map((i) => {
                  const failed = i.gates.filter((g) => g.outcome === "fail");
                  return (
                    <tr key={i.entityId} className="border-t border-border align-top">
                      <td className="py-2 pr-4">{i.pageId ? <Link href={`/generation/pages/${i.pageId}`} className="font-medium underline-offset-2 hover:underline">{i.cityName}</Link> : <span className="font-medium">{i.cityName}</span>}<span className="ml-1.5 text-xs text-muted-foreground">{i.uf} · {i.ibgeCode}</span></td>
                      <td className="pr-4"><Badge tone={OUTCOME[i.outcome].tone}>{OUTCOME[i.outcome].label}</Badge></td>
                      <td className="text-xs text-muted-foreground">
                        {failed.length > 0 ? <ul className="space-y-0.5">{failed.map((g) => (<li key={g.gate}><strong className="text-foreground">{GATE_LABEL[g.gate]}:</strong> {g.detail}</li>))}</ul> : i.error ? i.error : i.outcome === "unchanged" ? "Conteúdo idêntico ao da última versão." : "Todos os gates passaram."}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
