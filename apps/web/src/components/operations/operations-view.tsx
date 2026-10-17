import { OPERATIONAL_STATUSES, STAGES, type OperationalStatus, type Ratio } from "@plataforma/api";
import { AutoRefresh } from "@/components/flow/auto-refresh";
import { FlowWorkspace } from "@/components/flow/flow-workspace";
import { Badge, type Tone } from "@/components/ui/badge";
import { labelClass } from "@/components/ui/frame";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import { OP_LABEL, type ToolRow } from "@/lib/ops/operations-flow";
import type { OperationsData } from "@/lib/server/operations";

const TONE: Record<OperationalStatus, Tone> = { WORKING: "success", DEGRADED: "warning", NOT_WORKING: "danger", NOT_CONFIGURED: "neutral", NOT_TESTED: "outline", BLOCKED: "danger", MOCK: "warning", DISABLED: "neutral", STALE: "warning" };

/** O que fazer em seguida, por status. Texto fixo: não promete nada que o sistema não faça. */
export const NEXT_ACTION: Record<OperationalStatus, string> = {
  WORKING: "nada; reverificar antes de a janela vencer",
  DEGRADED: "investigar o resultado parcial e reexecutar",
  NOT_WORKING: "ver a falha, corrigir a causa e reexecutar (só se a operação for idempotente)",
  NOT_CONFIGURED: "definir as variáveis de ambiente indicadas (nunca no código)",
  NOT_TESTED: "executar uma verificação funcional real",
  BLOCKED: "resolver a causa raiz indicada; esta ferramenta não é a culpada",
  MOCK: "executar contra o serviço real para contar como funcionamento",
  DISABLED: "decisão de produto: habilitar ou manter fora",
  STALE: "reverificar: a última evidência venceu",
};

const pct = (r: Ratio) => (r.rate === null ? "sem base" : `${(r.rate * 100).toFixed(0)}%`);
const frac = (r: Ratio) => `${r.numerator} de ${r.denominator}`;
const dt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)} UTC`;

function Metric({ label, value, sub, hint }: { label: string; value: string; sub: string; hint: string }) {
  return (
    <div className="card-cut flex flex-col gap-1 p-5">
      <p className={`${labelClass} text-[10px] text-muted-foreground`}>{label}</p>
      <p className="text-4xl font-medium tracking-[-0.02em] tabular-nums">{value}</p>
      <p className="font-mono text-xs">{sub}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

const DENIED: Record<string, { title: string; hint: string }> = {
  unauthenticated: { title: "Entre para ver as operações", hint: "O estado das ferramentas só aparece para uma sessão verificada." },
  no_tenant: { title: "Usuário sem workspace", hint: "Peça a um administrador para associar seu usuário a um workspace." },
  login_not_configured: { title: "Login não configurado", hint: "Em produção, esta área exige login." },
};

export function OperationsView({ data }: { data: OperationsData }) {
  const header = <PageHeader crumbs={[{ label: "Performance" }, { label: "Operações" }]} title="Operações" description="Estado real de cada ferramenta e etapa, derivado de evidência. Nada é marcado à mão." />;
  if (data.state === "denied") {
    const c = DENIED[data.reason]!;
    return <div className="flex flex-col gap-6">{header}<Panel title="Acesso"><EmptyState title={c.title} hint={c.hint} /></Panel></div>;
  }
  const { metrics: m, rows, flow, running } = data;
  const critical = rows.filter((r) => r.criticality === "critical" && ["NOT_WORKING", "BLOCKED", "NOT_CONFIGURED"].includes(r.status));
  const absent = STAGES.filter((s) => s.implementation === "absent").length;
  return (
    <div className="flex flex-col gap-6">
      {header}
      <AutoRefresh active={running} />
      <p className="card-cut p-4 text-sm" role="note" data-testid="evidence-note">
        Gerado em {dt(data.generatedAt)}. Evidência usada: {data.evidenceSources.join("; ")}. <strong>Não há</strong> registro persistido de verificações de provedores externos:
        o que não deixou evidência aparece como <strong>NOT_TESTED</strong>, nunca como funcionando.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Ferramentas funcionando" value={pct(m.toolVerificationCoverage)} sub={`${frac(m.toolVerificationCoverage)} registradas`} hint="Só conta WORKING com verificação recente; desabilitadas ficam no denominador." />
        <Metric label="Etapas verificadas" value={pct(m.stageCoverage)} sub={`${frac(m.stageCoverage)} etapas`} hint={`${absent} etapas não existem nesta linha de código e contam como não verificadas.`} />
        <Metric label="Sucesso das checagens reais" value={pct(m.integrationSuccessRate)} sub={m.integrationSuccessRate.denominator === 0 ? "nenhuma checagem real elegível" : `${frac(m.integrationSuccessRate)} checagens`} hint="Só live e sandbox entram; mock, simulação, replay e importação não contam." />
        <Metric label="Problemas críticos" value={String(critical.length)} sub={critical.length === 0 ? "nenhum nas ferramentas críticas" : critical.map((r) => `${r.id} (${r.status})`).join(", ")} hint="Ferramentas críticas com falha, bloqueio ou configuração faltando." />
      </div>

      <Panel title="Status das ferramentas" description={`${m.totalTools} registradas. Cada uma conta uma vez.`}>
        <ul className="flex flex-wrap gap-2" aria-label="Contagem por status">
          {OPERATIONAL_STATUSES.map((s) => (
            <li key={s}><Badge tone={TONE[s]}>{s} · {OP_LABEL[s]}: {m.byStatus[s]}</Badge></li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">Cobertura só das habilitadas: {frac(m.enabledToolCoverage)} ({pct(m.enabledToolCoverage)}). Fórmulas: ferramentas funcionando ÷ registradas; etapas com todas as ferramentas habilitadas funcionando ÷ etapas declaradas; checagens reais com sucesso ÷ checagens reais elegíveis.</p>
      </Panel>

      <FlowWorkspace definition={flow} height={900} />

      <Panel title="Ferramentas" description="Uma linha por ferramenta, com a evidência, o que ela bloqueia e a próxima ação.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[60rem] text-sm">
            <thead>
              <tr className={`${labelClass} border-b border-border text-left text-[10px] text-muted-foreground`}>
                <th scope="col" className="py-2 pr-3 font-medium">Ferramenta</th><th scope="col" className="py-2 pr-3 font-medium">Status</th><th scope="col" className="py-2 pr-3 font-medium">Modo</th>
                <th scope="col" className="py-2 pr-3 font-medium">Motivo e evidência</th><th scope="col" className="py-2 pr-3 font-medium">Bloqueia</th><th scope="col" className="py-2 font-medium">Próxima ação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: ToolRow) => (
                <tr key={r.id} className="border-b border-border/60 align-top last:border-0">
                  <th scope="row" className="py-3 pr-3 text-left font-normal"><span className="block font-medium">{r.name}</span><span className="font-mono text-[11px] text-muted-foreground">{r.id} · {r.stage} · {r.provider} · {r.criticality}</span></th>
                  <td className="py-3 pr-3"><Badge tone={TONE[r.status]}>{r.status}</Badge></td>
                  <td className="py-3 pr-3 font-mono text-xs">{r.mode}</td>
                  <td className="max-w-[26rem] py-3 pr-3 text-xs"><span className="block">{r.reason}</span><span className="text-muted-foreground">{r.evidence}</span>{r.rootCause && r.rootCause !== r.id ? <span className="block text-destructive">causa raiz: {r.rootCause}</span> : null}</td>
                  <td className="py-3 pr-3 font-mono text-[11px]">{r.impacts.length > 0 ? r.impacts.join(", ") : "—"}</td>
                  <td className="py-3 text-xs">{NEXT_ACTION[r.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
