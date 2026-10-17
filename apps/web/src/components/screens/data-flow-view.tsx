import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import type { DataFlow } from "@/lib/server/data-flow";

const STATUS = { running: ["Em andamento", "info"], succeeded: ["Concluída", "success"], partial: ["Parcial", "warning"], failed: ["Falhou", "danger"] } as const;
const ORIGIN = { real: ["Real", "success"], test: ["Teste", "warning"], manual: ["Manual", "outline"] } as const;
const OUTCOME = { accepted: ["Aceita", "success"], rejected: ["Rejeitada", "danger"], duplicate: ["Duplicada", "warning"] } as const;
const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

const MESSAGES: Record<Exclude<DataFlow["state"], "ready">, { title: string; hint: string }> = {
  not_configured: { title: "Fluxo de dados não configurado neste ambiente", hint: "Esta tela só mostra dado real. Faltam as variáveis de ambiente do servidor; nenhum dado de demonstração é exibido no lugar." },
  unauthenticated: { title: "Sessão não encontrada ou expirada", hint: "Entre novamente para ver os dados do seu workspace." },
  no_tenant: { title: "Seu usuário ainda não está associado a um workspace", hint: "O administrador precisa gravar a lista de tenants na claim assinada do seu usuário (ADR-015)." },
  tenant_selection_required: { title: "Seleção de workspace necessária", hint: "Seu usuário tem acesso a mais de um workspace e a escolha explícita do workspace ainda não está disponível nesta versão. Nada é consultado em nome de um workspace escolhido por conveniência. Peça ao administrador para deixar um único workspace na sua claim assinada (ADR-015) ou aguarde a seleção." },
  error: { title: "Não foi possível ler os dados agora", hint: "Houve uma falha ao consultar o banco. Tente novamente; se persistir, avise o administrador." },
};

export function DataFlowView({ flow }: { flow: DataFlow }) {
  const header = <PageHeader crumbs={[{ label: "Fluxo de dados" }]} title="Fluxo de dados" description="Importações reais do seu workspace: o que entrou, o que foi rejeitado e por quê, com origem e horário por registro." />;
  if (flow.state !== "ready") {
    const m = flow.state === "not_configured" ? { ...MESSAGES.not_configured, hint: `${MESSAGES.not_configured.hint} (faltando: ${flow.missing})` } : MESSAGES[flow.state];
    return <div className="space-y-6">{header}<Panel title="Estado"><EmptyState title={m.title} hint={m.hint} /></Panel></div>;
  }
  const real = flow.runs.filter((r) => r.origin === "real");
  return (
    <div className="space-y-6">
      {header}
      <div className="grid gap-4 sm:grid-cols-3">
        <Panel title="Cidades no workspace"><p className="text-3xl font-semibold tabular-nums">{flow.cityCount.toLocaleString("pt-BR")}</p></Panel>
        <Panel title="Importações reais"><p className="text-3xl font-semibold tabular-nums">{real.length}</p></Panel>
        <Panel title="Importações de teste"><p className="text-3xl font-semibold tabular-nums">{flow.runs.length - real.length}</p><p className="mt-1 text-xs text-muted-foreground">Não entram na contagem de dado real.</p></Panel>
      </div>
      <Panel title="Execuções" description="Da mais recente para a mais antiga.">
        {flow.runs.length === 0 ? (
          <EmptyState title="Nenhuma importação ainda" hint="Quando um arquivo for importado, a execução aparece aqui com o resultado linha a linha." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Execuções de importação</caption>
              <thead className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground"><tr><th className="py-2 pr-4">Quando</th><th className="pr-4">Fonte</th><th className="pr-4">Origem</th><th className="pr-4">Status</th><th className="pr-4 text-right">Linhas</th><th className="pr-4 text-right">Aceitas</th><th className="pr-4 text-right">Rejeitadas</th><th className="text-right">Duplicadas</th></tr></thead>
              <tbody>
                {flow.runs.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-2 pr-4 whitespace-nowrap"><Link className="underline underline-offset-2" href={`/data-flow?run=${r.id}`}>{fmt.format(r.startedAt)}</Link></td>
                    <td className="pr-4">{r.sourceName}<span className="block font-mono text-[11px] text-muted-foreground">{r.fileName}</span></td>
                    <td className="pr-4"><Badge tone={ORIGIN[r.origin][1]}>{ORIGIN[r.origin][0]}</Badge></td>
                    <td className="pr-4"><Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge></td>
                    <td className="pr-4 text-right tabular-nums">{r.totalRows.toLocaleString("pt-BR")}</td>
                    <td className="pr-4 text-right tabular-nums">{r.acceptedRows.toLocaleString("pt-BR")}</td>
                    <td className="pr-4 text-right tabular-nums">{r.rejectedRows.toLocaleString("pt-BR")}</td>
                    <td className="text-right tabular-nums">{r.duplicateRows.toLocaleString("pt-BR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {flow.selected ? <RunDetail selected={flow.selected} /> : null}
    </div>
  );
}

function RunDetail({ selected }: { selected: NonNullable<Extract<DataFlow, { state: "ready" }>["selected"]> }) {
  const { run, records, truncated } = selected;
  const withIssues = records.filter((r) => r.issues.length > 0);
  return (
    <Panel title={`Execução de ${fmt.format(run.startedAt)}`} description={`${run.sourceName} · ${run.fileName}`} action={<Link href="/data-flow" className="text-xs underline underline-offset-2">Fechar</Link>}>
      <dl className="mb-4 grid gap-x-6 gap-y-1 font-mono text-[12px] sm:grid-cols-2">
        <div><dt className="inline text-muted-foreground">sha256: </dt><dd className="inline break-all">{run.fileSha256}</dd></div>
        <div><dt className="inline text-muted-foreground">Término: </dt><dd className="inline">{run.finishedAt ? fmt.format(run.finishedAt) : "em andamento"}</dd></div>
        {run.error ? <div className="sm:col-span-2"><dt className="inline text-muted-foreground">Erro: </dt><dd className="inline text-destructive">{run.error}</dd></div> : null}
      </dl>
      {records.length === 0 ? (
        <EmptyState title="Sem registros nesta execução" hint="Execuções que falharam antes de ler o arquivo não gravam linhas." />
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground">{withIssues.length === 0 ? "Nenhuma linha com aviso ou erro." : `Linhas com aviso ou erro (${withIssues.length}${truncated ? ", entre as primeiras" : ""}):`}</p>
          <ul className="divide-y divide-border border border-border text-sm">
            {withIssues.slice(0, 100).map((r) => (
              <li key={r.rowNumber} className="flex flex-col gap-1 px-3 py-2">
                <div className="flex items-center gap-2"><span className="font-mono text-xs text-muted-foreground">linha {r.rowNumber}</span><Badge tone={OUTCOME[r.outcome][1]}>{OUTCOME[r.outcome][0]}</Badge><span className="truncate font-mono text-xs">{Object.values(r.raw).slice(0, 3).join(" · ")}</span></div>
                <ul className="list-disc pl-5 text-xs text-muted-foreground">{r.issues.map((i, k) => <li key={k}>{i.severity === "warning" ? "Aviso" : "Erro"} em {i.field}: {i.message}</li>)}</ul>
              </li>
            ))}
          </ul>
          {truncated ? <p className="mt-2 text-xs text-muted-foreground">Mostrando só as primeiras {records.length} linhas da execução.</p> : null}
        </>
      )}
    </Panel>
  );
}
