import Link from "next/link";
import type { eligibility, engine as E, runtime } from "@plataforma/api";
import { Badge } from "@/components/ui/badge";
import { PageHead, SubNav } from "./chrome";
import { EmptyState, Panel } from "@/components/ui/panel";
import { Dl } from "@/components/ui/field";
import { formatDateTime } from "@/components/generation/format";
import { StatePanel, type BlockedState } from "@/components/generation/state-panel";
import type { Loaded } from "@/lib/server/tenant-data";
import { ActivatePromptButton, CancelPipelineButton, RegisterPromptForm, RollbackPromptButton, RunPipelineButton, SyncRegistryButton } from "./engine-forms";
import { DECISION_TONE, FAILURE_KIND, MODE, OUTCOME, PIPELINE_STATE, PROMPT_STATE, QA_STATUS, RUN_STATE, STEP_STATE, json, ms } from "./format";

// Control Plane do motor de páginas e dos agentes (ADR-031). Cada tela mostra o que o BANCO registrou: sem execução, zero. Real, simulação de teste, falha, saída inválida e
// bloqueio externo são estados distintos e sempre rotulados. Nenhum botão existe sem uma ação real por trás.
export { ENGINE_SECTIONS } from "./chrome";

export function EngineNav({ current }: { current: string }) { return <SubNav current={current} />; }
export function Shell({ current, title, description, crumbs, children, actions }: { current: string; title: string; description: string; crumbs?: readonly { label: string; href?: string }[]; children: React.ReactNode; actions?: React.ReactNode }) {
  return <div className="space-y-5"><PageHead crumbs={crumbs ?? [{ label: "Motor de páginas", href: "/engine" }, { label: title }]} title={title} context={description} actions={actions} /><SubNav current={current} /><div className="space-y-4">{children}</div></div>;
}
/** Estados em que a tela não tem dados: explica o motivo em vez de simular conteúdo. */
export function Gate<T>({ loaded, current, title, description, crumbs, children }: { loaded: Loaded<T>; current: string; title: string; description: string; crumbs?: readonly { label: string; href?: string }[]; children: (data: T) => React.ReactNode }) {
  if (loaded.state !== "ready") return <Shell current={current} title={title} description={description} {...(crumbs ? { crumbs } : {})}><StatePanel state={loaded.state as BlockedState} {...(loaded.state === "not_configured" ? { missing: loaded.missing } : {})} /></Shell>;
  return <Shell current={current} title={title} description={description} {...(crumbs ? { crumbs } : {})}>{children(loaded.data)}</Shell>;
}
export const Stat = ({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) => <div className="rounded-lg border border-border px-3 py-2"><p className="text-[11px] text-muted-foreground">{label}</p><p className="text-lg font-semibold tabular-nums">{value}</p>{hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}</div>;
export const Pre = ({ v, label }: { v: unknown; label: string }) => <details className="rounded-lg border border-border"><summary className="cursor-pointer px-3 py-2 text-xs font-medium">{label}</summary><pre className="max-h-96 overflow-auto border-t border-border bg-muted/40 p-3 text-[11px] leading-snug">{json(v)}</pre></details>;
export const when = (d: Date | string | null) => (d ? formatDateTime(d) : "—");

// --- Visão geral + registro de andamento (quatro estados distintos) -------------------------------------------------------------------------------------------------------------------
export function EngineOverview({ progress, registry }: { progress: readonly E.ProgressItem[]; registry: Loaded<{ agents: readonly runtime.AgentRegistryRow[]; llmConfigured: boolean }> }) {
  return (
    <Shell current="/engine/progress" title="Andamento do motor" description="O LLM propõe, a aplicação valida, o motor determinístico decide, o Control Plane explica e a auditoria prova. Nada aqui publica uma página.">
      {registry.state === "ready" ? (
        <Panel title="Estado do runtime de agentes">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Agentes registrados" value={registry.data.agents.length} />
            <Stat label="Execuções de agentes registradas" value={registry.data.agents.reduce((s, a) => s + a.runs, 0)} hint="Contadas no banco; zero quando nada rodou." />
            <Stat label="Chave do LLM" value={registry.data.llmConfigured ? "configurada" : "ausente"} hint={registry.data.llmConfigured ? "Execuções reais possíveis." : "Bloqueio externo: nenhum agente roda de verdade; nada é simulado aqui."} />
          </div>
        </Panel>
      ) : <StatePanel state={registry.state as BlockedState} />}
      <Panel title="Andamento do motor" description="Quatro situações DISTINTAS por item: implementado, verificado (com evidência), bloqueado externamente e pendente. Fonte: registro versionado no código.">
        <ul className="divide-y divide-border" data-testid="engine-progress">
          {progress.map((p) => (
            <li key={p.id} className="py-3 first:pt-0 last:pb-0" data-progress={p.id}>
              <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium">Inc {p.increment}: {p.title}</h3><Badge tone={p.implemented ? "success" : "outline"}>{p.implemented ? "implementado" : "não implementado"}</Badge><Badge tone={p.verified ? "success" : "outline"}>{p.verified ? "verificado" : "não verificado"}</Badge>{p.blocked ? <Badge tone="warning">bloqueado externamente</Badge> : null}{p.pending ? <Badge tone="info">pendente</Badge> : null}</div>
              {p.evidence ? <p className="mt-1 text-xs text-muted-foreground"><strong>Evidência:</strong> {p.evidence}</p> : null}
              {p.blocked ? <p className="mt-1 text-xs"><strong>Bloqueio externo:</strong> {p.blocked}</p> : null}
              {p.pending ? <p className="mt-1 text-xs"><strong>Pendente:</strong> {p.pending}</p> : null}
            </li>
          ))}
        </ul>
      </Panel>
    </Shell>
  );
}

// --- Registro de agentes -------------------------------------------------------------------------------------------------------------------------------------------------------------------
export function AgentRegistryView({ loaded }: { loaded: Loaded<{ agents: readonly runtime.AgentRegistryRow[]; filePromptVersion: string; llmConfigured: boolean }> }) {
  return (
    <Gate loaded={loaded} current="/engine/agents" title="Registro de agentes" description="Os 8 agentes de runtime: contrato, tempo-limite, retentativas, lote, prompt ativo e o que o código valida depois deles.">
      {(d) => (
        <>
          {!d.llmConfigured ? <p role="note" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs">Sem ANTHROPIC_API_KEY neste servidor: as execuções de agente ficam como “não configurado” (bloqueio externo). Nenhuma saída de modelo existe nem é simulada.</p> : null}
          <Panel title="Inicialização do registro" description="Espelha as definições do código em agent_definition e ativa os prompts do arquivo do pack onde não há versão ativa. Idempotente.">
            <SyncRegistryButton />
          </Panel>
          <ul className="space-y-3" data-testid="agent-registry">
            {d.agents.map((a) => (
              <li key={a.definition.agent}>
                <Panel title={`${a.definition.agent}. ${a.definition.name}`} description={a.definition.purpose} action={<Badge tone="outline">{a.definition.stage === "topic" ? "estágio de tópicos" : "estágio de página"}</Badge>}>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Dl items={[
                      { label: "Id estável", value: <code className="text-xs">{a.definition.slug}</code> },
                      { label: "Contratos (entrada/saída)", value: `v${a.definition.inputSchemaVersion} / v${a.definition.outputSchemaVersion}` },
                      { label: "Tempo-limite · retentativas transitórias", value: `${ms(a.definition.timeoutMs)} · ${a.definition.maxRetries}` },
                      { label: "Itens por chamada", value: a.definition.batch.max === 1 ? "uma por chamada" : `${a.definition.batch.min}–${a.definition.batch.max}` },
                      { label: "Depende de", value: a.definition.dependsOn.length ? a.definition.dependsOn.map((x) => `agente ${x}`).join(", ") : "nenhum agente" },
                      { label: "Definição versionada", value: a.version === null ? "não espelhada ainda (inicialize o registro)" : `v${a.version} (${a.model})` },
                    ]} />
                    <div className="space-y-2">
                      <p className="text-xs"><strong>O código valida:</strong> {a.definition.codeAuthority}</p>
                      <p className="text-xs"><strong>Prompt ativo:</strong> {a.activePrompt ? <>{a.activePrompt.version} <Badge tone="outline">{a.activePrompt.source === "file" ? "arquivo do pack" : "Control Plane"}</Badge></> : `nenhum no registro (vale o arquivo do pack: ${d.filePromptVersion.slice(0, 12)}…)`}</p>
                      <p className="text-xs"><strong>Execuções:</strong> {a.runs} {a.runs > 0 ? <>— {Object.entries(a.byStatus).map(([k, n]) => `${RUN_STATE[k]?.label ?? k}: ${n}`).join(", ")} (última em {when(a.lastRunAt)})</> : "(nenhuma registrada)"} · <Link className="underline" href={`/engine/executions?agent=${a.definition.agent}`}>ver execuções</Link></p>
                    </div>
                  </div>
                </Panel>
              </li>
            ))}
          </ul>
        </>
      )}
    </Gate>
  );
}

// --- Versões de prompt ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
export function PromptVersionsView({ loaded }: { loaded: Loaded<{ versions: readonly runtime.PromptVersionRecord[]; filePromptVersion: string }> }) {
  return (
    <Gate loaded={loaded} current="/engine/prompts" title="Versões de prompt" description="Cada texto de prompt é uma versão imutável: rascunho, ativa ou descontinuada. Não há sobrescrita silenciosa; ativar exige regressão aprovada para versões editadas aqui.">
      {(d) => {
        const byAgent = new Map<number, runtime.PromptVersionRecord[]>(); for (const v of d.versions) byAgent.set(v.agent, [...(byAgent.get(v.agent) ?? []), v]);
        return (
          <>
            {d.versions.length === 0 ? <Panel title="Registro vazio"><EmptyState title="Nenhuma versão registrada neste workspace" hint={`Hoje os agentes usam o arquivo do pack (${d.filePromptVersion.slice(0, 12)}…). Inicialize o registro em “Agentes” para versionar esses textos.`} /></Panel> : null}
            {[...byAgent.entries()].sort(([a], [b]) => a - b).map(([agent, vs]) => (
              <Panel key={agent} title={`Agente ${agent}`} action={<RollbackPromptButton agent={agent} />}>
                <ul className="divide-y divide-border">
                  {vs.map((v) => (
                    <li key={v.id} className="space-y-1 py-3 first:pt-0 last:pb-0" data-prompt={v.id} data-status={v.status}>
                      <div className="flex flex-wrap items-center gap-2"><code className="text-xs">{v.version}</code><Badge tone={PROMPT_STATE[v.status]!.tone}>{PROMPT_STATE[v.status]!.label}</Badge><Badge tone="outline">{v.source === "file" ? "arquivo do pack" : "Control Plane"}</Badge><span className="text-[11px] text-muted-foreground">criada {when(v.createdAt)} por {v.createdBy}{v.activatedAt ? ` · ativada ${when(v.activatedAt)}` : ""}</span></div>
                      <p className="text-xs"><strong>Mudança:</strong> {v.changeLog}</p>
                      <p className="text-xs"><strong>Regressão:</strong> {v.regression ? `${v.regression.passed ? "aprovada" : "REPROVADA"} (${v.regression.cases} caso(s), ${v.regression.mode === "real" ? "LLM real" : "simulação de teste"}${v.regression.failures.length ? `; falhas: ${v.regression.failures.join(", ")}` : ""})` : "não executada"}</p>
                      <p className="text-[11px] text-muted-foreground">Placeholders: {v.placeholders.join(", ")} · sha256 {v.bodySha256.slice(0, 12)}…</p>
                      <Pre v={v.body} label="Ver o texto do prompt" />
                      {v.status !== "ACTIVE" ? <ActivatePromptButton id={v.id} label={v.status === "DEPRECATED" ? "Reativar esta versão" : "Ativar esta versão"} /> : null}
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}
            <Panel title="Novo rascunho" description="O texto é validado (placeholders conhecidos e a variável de entrada do agente) antes de gravar."><RegisterPromptForm agents={[1, 2, 3, 4, 5, 6, 7, 8].map((a) => ({ agent: a, name: ["Inventory Summarizer", "Topic Proposer", "Intent Modeler", "Combination Reviewer", "Eligibility Explainer", "Blueprint Writer", "Editorial", "QA Verifier"][a - 1]! }))} /></Panel>
          </>
        );
      }}
    </Gate>
  );
}

// --- Monitor de execuções + Inspetor de saída ------------------------------------------------------------------------------------------------------------------------------------
export function ExecutionMonitorView({ loaded, params, pageSize }: { loaded: Loaded<{ total: number; byStatus: Record<string, number>; rows: readonly runtime.AgentRunSummary[] }>; params: { agent: number | null; status: string; page: number }; pageSize: number }) {
  const href = (o: Partial<{ agent: number | null; status: string; page: number }>) => { const n = { ...params, ...o }; const q = new URLSearchParams(); if (n.agent) q.set("agent", String(n.agent)); if (n.status) q.set("status", n.status); if (n.page > 1) q.set("page", String(n.page)); return `/engine/executions${q.size ? `?${q}` : ""}`; };
  return (
    <Gate loaded={loaded} current="/engine/executions" title="Monitor de execuções" description="Cada chamada de agente registrada: estado, tentativas, retentativas transitórias, duração e a versão do prompt. Clique para inspecionar entrada e saída.">
      {(d) => (
        <>
          <Panel title="Filtros">
            <div className="flex flex-wrap gap-2 text-xs" data-testid="exec-filters">
              <Link className="underline" href={href({ agent: null, status: "", page: 1 })}>Limpar</Link>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((a) => <Link key={a} href={href({ agent: a, page: 1 })} className={params.agent === a ? "font-semibold underline" : "underline"}>Agente {a}</Link>)}
              <span aria-hidden="true">·</span>
              {Object.keys(RUN_STATE).map((s) => <Link key={s} href={href({ status: s, page: 1 })} className={params.status === s ? "font-semibold underline" : "underline"}>{RUN_STATE[s]!.label}{d.byStatus[s] ? ` (${d.byStatus[s]})` : ""}</Link>)}
            </div>
          </Panel>
          <Panel title={`Execuções (${d.total})`}>
            {d.rows.length === 0 ? <EmptyState title="Nenhuma execução registrada com esse filtro" hint="O monitor mostra só o que o banco registrou; não há execução simulada aqui." /> : (
              <div className="overflow-x-auto"><table className="w-full text-xs" data-testid="exec-table"><thead><tr className="text-left text-[11px] text-muted-foreground"><th className="py-1 pr-3">Quando</th><th className="pr-3">Agente</th><th className="pr-3">Estado</th><th className="pr-3">Tent.</th><th className="pr-3">Retent.</th><th className="pr-3">Duração</th><th className="pr-3">Prompt</th><th>Assunto</th></tr></thead>
                <tbody>{d.rows.map((r) => (
                  <tr key={r.id} className="border-t border-border align-top" data-run={r.id} data-status={r.status}>
                    <td className="py-1.5 pr-3 whitespace-nowrap"><Link className="underline" href={`/engine/executions/${r.id}`}>{when(r.createdAt)}</Link></td>
                    <td className="pr-3">{r.agent} — {r.agentName}</td>
                    <td className="pr-3"><Badge tone={RUN_STATE[r.status]?.tone ?? "neutral"}>{RUN_STATE[r.status]?.label ?? r.status}</Badge>{r.failureKind ? <span className="ml-1 text-[11px] text-muted-foreground">{FAILURE_KIND[r.failureKind] ?? r.failureKind}</span> : null}</td>
                    <td className="pr-3 tabular-nums">{r.attempts}</td><td className="pr-3 tabular-nums">{r.transientRetries}</td><td className="pr-3 whitespace-nowrap">{ms(r.durationMs)}</td>
                    <td className="pr-3"><code>{r.promptVersion.slice(0, 18)}</code></td><td className="max-w-[26ch] truncate">{r.subjectKind ?? "—"}{r.subjectRef ? `: ${r.subjectRef}` : ""}</td>
                  </tr>))}</tbody></table></div>
            )}
            <div className="mt-3 flex gap-3 text-xs">{params.page > 1 ? <Link className="underline" href={href({ page: params.page - 1 })}>← Anteriores</Link> : null}{params.page * pageSize < d.total ? <Link className="underline" href={href({ page: params.page + 1 })}>Próximas →</Link> : null}</div>
          </Panel>
        </>
      )}
    </Gate>
  );
}

export function OutputInspectorView({ loaded }: { loaded: Loaded<runtime.AgentRunDetail | null> }) {
  return (
    <Gate loaded={loaded} current="/engine/executions" title="Inspetor de saída" description="O que entrou, o que saiu e por que foi aceito ou recusado." crumbs={[{ label: "Execuções", href: "/engine/executions" }, { label: "Inspetor" }]}>
      {(r) => r === null ? <Panel title="Execução"><EmptyState title="Execução não encontrada neste workspace" /></Panel> : (
        <>
          <Panel title={`Agente ${r.agent} — ${r.agentName}`} action={<Badge tone={RUN_STATE[r.status]?.tone ?? "neutral"}>{RUN_STATE[r.status]?.label ?? r.status}</Badge>}>
            <Dl items={[
              { label: "Quando", value: when(r.createdAt) }, { label: "Duração", value: ms(r.durationMs) }, { label: "Tentativas de correção · retentativas transitórias", value: `${r.attempts} · ${r.transientRetries}` },
              { label: "Modelo", value: r.model }, { label: "Prompt", value: <>{r.promptVersion} <span className="text-[11px] text-muted-foreground">sha256 {r.promptSha256.slice(0, 12)}…</span></> },
              { label: "Correlação", value: r.correlationId ?? "—" }, { label: "Pipeline", value: r.pipelineRunId ? <Link className="underline" href={`/engine/pipelines/${r.pipelineRunId}`}>abrir execução do pipeline</Link> : "fora de um pipeline" },
              { label: "Assunto", value: `${r.subjectKind ?? "—"}${r.subjectRef ? `: ${r.subjectRef}` : ""}` }, { label: "Classe da falha", value: r.failureKind ? FAILURE_KIND[r.failureKind] ?? r.failureKind : "—" },
            ]} />
          </Panel>
          {r.status === "not_configured" ? <p role="note" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs">Execução registrada como NÃO CONFIGURADA: a chave do LLM estava ausente, nenhuma chamada foi feita e não há saída de modelo.</p> : null}
          {r.errors.length > 0 ? <Panel title="Erros e correções"><ul className="list-disc space-y-1 pl-5 text-xs">{r.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Panel> : null}
          <div className="grid gap-3 lg:grid-cols-2"><Pre v={r.input} label="Entrada (somente o recorte de dados que o agente recebeu)" /><Pre v={r.output} label={r.output === null ? "Saída (nenhuma saída válida)" : "Saída validada pelo código"} /></div>
          <Pre v={r.usage} label="Uso (tokens, tentativas, cache)" />
        </>
      )}
    </Gate>
  );
}

// --- Pipelines (controle + monitor) ---------------------------------------------------------------------------------------------------------------------------------------------------------
export function PipelineRunsView({ loaded }: { loaded: Loaded<readonly runtime.PipelineRunRecord[]> }) {
  return (
    <Gate loaded={loaded} current="/engine/pipelines" title="Pipelines" description="Execuções do pipeline de página e de tópicos, com o modo (real ou simulação), o estado e a decisão final do Quality Gate. Para executar uma página, abra a oportunidade no motor.">
      {(runs) => (
        <Panel title={`Execuções (${runs.length})`}>
          {runs.length === 0 ? <EmptyState title="Nenhuma execução de pipeline registrada" hint="Abra uma oportunidade em “Elegibilidade” e use “Executar o pipeline desta página”." /> : (
            <ul className="divide-y divide-border" data-testid="pipeline-runs">
              {runs.map((r) => (
                <li key={r.id} className="space-y-1 py-3 first:pt-0 last:pb-0" data-pipeline={r.id} data-status={r.status}>
                  <div className="flex flex-wrap items-center gap-2"><Link className="text-sm font-medium underline" href={`/engine/pipelines/${r.id}`}>{r.pipeline === "page" ? "Página" : "Tópicos"} · {r.correlationId}</Link><Badge tone={PIPELINE_STATE[r.status]!.tone}>{PIPELINE_STATE[r.status]!.label}</Badge>{r.finalOutcome ? <Badge tone={r.finalOutcome === "APPROVED" ? "success" : r.finalOutcome === "BLOCKED" ? "danger" : "warning"}>{OUTCOME[r.finalOutcome]!.label}</Badge> : null}<Badge tone={MODE[r.mode]!.tone}>{MODE[r.mode]!.label}</Badge></div>
                  <p className="text-[11px] text-muted-foreground">{when(r.createdAt)} · {r.createdBy}{r.summary ? ` · ${r.summary}` : ""}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </Gate>
  );
}

export function PipelineRunDetailView({ loaded }: { loaded: Loaded<{ run: runtime.PipelineRunRecord; steps: readonly runtime.PipelineStepRecord[]; audit: readonly runtime.DecisionAuditEntry[]; agentRuns: readonly runtime.AgentRunSummary[] } | null> }) {
  return (
    <Gate loaded={loaded} current="/engine/pipelines" title="Execução do pipeline" description="Cada passo com dependências, estado, resultado e a execução de agente ligada. A decisão final é do Quality Gate Engine (código)." crumbs={[{ label: "Pipelines", href: "/engine/pipelines" }, { label: "Execução" }]}>
      {(d) => d === null ? <Panel title="Execução"><EmptyState title="Execução não encontrada neste workspace" /></Panel> : (
        <>
          <Panel title={`${d.run.pipeline === "page" ? "Pipeline de página" : "Pipeline de tópicos"} · ${d.run.correlationId}`} action={<div className="flex items-center gap-2"><Badge tone={PIPELINE_STATE[d.run.status]!.tone}>{PIPELINE_STATE[d.run.status]!.label}</Badge>{d.run.status === "RUNNING" ? <CancelPipelineButton id={d.run.id} /> : null}</div>}>
            <div className="mb-3 flex flex-wrap gap-2"><Badge tone={MODE[d.run.mode]!.tone}>{MODE[d.run.mode]!.label}</Badge>{d.run.finalOutcome ? <Badge tone={d.run.finalOutcome === "APPROVED" ? "success" : d.run.finalOutcome === "BLOCKED" ? "danger" : "warning"}>Quality Gate: {OUTCOME[d.run.finalOutcome]!.label}</Badge> : null}</div>
            {d.run.mode === "test_simulation" ? <p role="note" className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs">Esta execução usou um LLM ROTEIRIZADO de teste: prova o funcionamento do runtime, não a qualidade de um modelo real.</p> : null}
            <p className="text-xs">{d.run.summary ?? "Em andamento."}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Iniciada {when(d.run.createdAt)} por {d.run.createdBy}{d.run.finishedAt ? ` · encerrada ${when(d.run.finishedAt)}` : ""}{d.run.opportunityId ? <> · <Link className="underline" href={`/engine/opportunities/${d.run.opportunityId}`}>ver a oportunidade no motor</Link></> : null}</p>
          </Panel>
          <Panel title="Passos">
            <ol className="space-y-2" data-testid="pipeline-steps">
              {d.steps.map((s) => (
                <li key={s.id} className="rounded-lg border border-border p-3" data-step={s.stepKey} data-status={s.status}>
                  <div className="flex flex-wrap items-center gap-2"><code className="text-xs font-medium">{s.stepKey}</code><Badge tone={STEP_STATE[s.status]!.tone}>{STEP_STATE[s.status]!.label}</Badge><Badge tone="outline">{s.kind === "agent" ? `agente ${s.agent}` : "motor determinístico"}</Badge>{s.attempts > 0 ? <span className="text-[11px] text-muted-foreground">{s.attempts} execução(ões)</span> : null}</div>
                  {s.error ? <p className="mt-1 text-xs"><strong>{s.status === "BLOCKED" ? "Bloqueio:" : "Erro:"}</strong> {s.error}</p> : null}
                  {s.agentRunId ? <p className="mt-1 text-xs"><Link className="underline" href={`/engine/executions/${s.agentRunId}`}>Inspecionar a execução do agente</Link></p> : null}
                  {s.result ? <div className="mt-2"><Pre v={s.result} label="Resultado do passo" /></div> : null}
                </li>
              ))}
            </ol>
          </Panel>
          <Panel title={`Auditoria de decisão (${d.audit.length})`} description="Quem decidiu o quê. Recomendações de agentes aparecem junto com a decisão do código que as aplicou ou recusou.">
            {d.audit.length === 0 ? <EmptyState title="Nenhuma decisão registrada nesta execução" /> : <ul className="space-y-2">{d.audit.map((a) => <li key={a.id} className="rounded-lg border border-border p-3 text-xs"><div className="flex flex-wrap items-center gap-2"><strong>{a.decision}</strong><Badge tone="outline">decidido por {a.decidedBy === "code" ? "código" : "pessoa"}</Badge>{a.recommendation ? <Badge tone={a.recommendationApplied ? "success" : "warning"}>{a.recommendationApplied ? "recomendação aplicada" : "recomendação recusada"}</Badge> : null}</div><p className="mt-1">{a.reason}</p><p className="text-[11px] text-muted-foreground">{a.subjectKind}: {a.subjectRef} · {when(a.createdAt)}</p></li>)}</ul>}
          </Panel>
          <Panel title={`Execuções de agentes desta execução (${d.agentRuns.length})`}>
            {d.agentRuns.length === 0 ? <EmptyState title="Nenhum agente foi chamado" hint="Passos de agente pulados ou bloqueados antes da chamada não geram execução." /> : <ul className="space-y-1 text-xs">{d.agentRuns.map((r) => <li key={r.id}><Link className="underline" href={`/engine/executions/${r.id}`}>Agente {r.agent}</Link> <Badge tone={RUN_STATE[r.status]?.tone ?? "neutral"}>{RUN_STATE[r.status]?.label ?? r.status}</Badge> {ms(r.durationMs)}</li>)}</ul>}
          </Panel>
        </>
      )}
    </Gate>
  );
}

// --- Tópicos e elegibilidade ----------------------------------------------------------------------------------------------------------------------------------------------------------------
export function TopicDiscoveryView({ loaded, after }: { loaded: Loaded<{ summary: runtime.TopicDiscoverySummary; combination: { total: number; byFilter: Record<string, number> } }>; after?: React.ReactNode }) {
  return (
    <Gate loaded={loaded} current="/engine/topics" title="Descoberta de tópicos" description="O que o motor gerou e podou: tópicos por estado e padrão, intenção modelada (observada ou hipótese) e o que cada filtro do Combination Engine removeu.">
      {(d) => (
        <>
          <Panel title="Tópicos"><div className="grid gap-3 sm:grid-cols-4"><Stat label="Tópicos" value={d.summary.total} /><Stat label="Com intenção modelada (Agente 3)" value={d.summary.intentModeled} hint={`Demanda observada: ${d.summary.byDemand.OBSERVED ?? 0} · hipótese: ${d.summary.byDemand.HYPOTHESIS ?? 0}`} /><Stat label="Combinações (com pai)" value={d.summary.withParent} /><Stat label="Registros do Combination Engine" value={d.combination.total} /></div></Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Por estado do ciclo de vida">{Object.keys(d.summary.byStatus).length === 0 ? <EmptyState title="Nenhum tópico gerado neste workspace" /> : <ul className="space-y-1 text-xs" data-testid="topics-by-status">{Object.entries(d.summary.byStatus).sort().map(([k, n]) => <li key={k} className="flex justify-between"><span>{k}</span><span className="tabular-nums">{n}</span></li>)}</ul>}</Panel>
            <Panel title="Por padrão de consulta">{Object.keys(d.summary.byPattern).length === 0 ? <EmptyState title="Sem padrões" /> : <ul className="space-y-1 text-xs">{Object.entries(d.summary.byPattern).sort().map(([k, n]) => <li key={k} className="flex justify-between"><span>{k}</span><span className="tabular-nums">{n}</span></li>)}</ul>}</Panel>
          </div>
          <Panel title="Podas do Combination Engine" description="Quantas combinações cada filtro removeu na leitura mais recente do log.">{Object.keys(d.combination.byFilter).length === 0 ? <EmptyState title="Nenhuma poda registrada" /> : <ul className="space-y-1 text-xs">{Object.entries(d.combination.byFilter).sort().map(([k, n]) => <li key={k} className="flex justify-between"><span>{k}</span><span className="tabular-nums">{n}</span></li>)}</ul>}</Panel>
          {after}
        </>
      )}
    </Gate>
  );
}

export function EligibilityInspectorView({ loaded, decision }: { loaded: Loaded<{ total: number; byDecision: Record<string, number>; rows: readonly (eligibility.DecisionRow & { primaryQuery: string; status: string; family: string })[] }>; decision: string }) {
  return (
    <Gate loaded={loaded} current="/engine/eligibility" title="Inspetor de elegibilidade" description="A decisão mais recente de cada tópico: gates não compensatórios, pontuação, bloqueios e o próximo passo. Uma nota alta nunca supera um gate reprovado.">
      {(d) => (
        <>
          <Panel title="Decisões">
            <div className="mb-3 flex flex-wrap gap-2 text-xs"><Link className="underline" href="/engine/eligibility">Todas ({Object.values(d.byDecision).reduce((s, n) => s + n, 0)})</Link>{Object.entries(d.byDecision).map(([k, n]) => <Link key={k} className={decision === k ? "font-semibold underline" : "underline"} href={`/engine/eligibility?decision=${k}`}>{k} ({n})</Link>)}</div>
            {d.rows.length === 0 ? <EmptyState title="Nenhuma decisão registrada" hint="Rode a avaliação de elegibilidade (scripts/engine-local.sh ou o pipeline de página) para gerar decisões." /> : (
              <div className="overflow-x-auto"><table className="w-full text-xs" data-testid="eligibility-table"><thead><tr className="text-left text-[11px] text-muted-foreground"><th className="py-1 pr-3">Tópico</th><th className="pr-3">Decisão</th><th className="pr-3">Nota</th><th className="pr-3">Cobertura</th><th className="pr-3">Estado</th><th>Bloqueios / faltas</th></tr></thead>
                <tbody>{d.rows.map((r) => (
                  <tr key={r.id} className="border-t border-border align-top" data-decision={r.decision}>
                    <td className="py-1.5 pr-3"><Link className="underline" href={`/engine/opportunities/${r.opportunityId}`}>{r.primaryQuery}</Link><div className="text-[11px] text-muted-foreground">{r.family}</div></td>
                    <td className="pr-3"><Badge tone={DECISION_TONE[r.decision] ?? "neutral"}>{r.decision}</Badge></td>
                    <td className="pr-3 tabular-nums">{r.totalScore === null ? "—" : r.totalScore.toFixed(1)}</td><td className="pr-3 tabular-nums">{r.weightCoverage === null ? "—" : `${Math.round(r.weightCoverage * 100)}%`}</td><td className="pr-3">{r.status}</td>
                    <td>{[...r.blockingReasons, ...r.missingRequirements].slice(0, 3).join("; ") || "—"}</td>
                  </tr>))}</tbody></table></div>
            )}
          </Panel>
        </>
      )}
    </Gate>
  );
}

// --- Oportunidade no motor: decisão + explicação, blueprint, recipe/QA, pipelines e auditoria ---------------------------------------------------------------------------------------------
export function EngineOpportunityView({ loaded, id }: { loaded: Loaded<{ view: runtime.EngineView | null; detail: E.OpportunityDetail | null }>; id: string }) {
  return (
    <Gate loaded={loaded} current="/engine/eligibility" title="Oportunidade no motor" description="Decisão de elegibilidade com a explicação do Agente 5, blueprint da especificação, recipe e relatório de QA. As explicações descrevem; quem decide é o código." crumbs={[{ label: "Elegibilidade", href: "/engine/eligibility" }, { label: "Oportunidade" }]}>
      {({ view, detail }) => view === null ? <Panel title="Oportunidade"><EmptyState title="Oportunidade não encontrada neste workspace" /></Panel> : (
        <>
          <Panel title={detail?.primaryQuery ?? "Oportunidade"} description={detail ? `Estado do ciclo de vida: ${detail.status}` : undefined} action={<Link className="text-xs underline" href={`/opportunities/${id}`}>Abrir no módulo de oportunidades</Link>}>
            <RunPipelineButton opportunityId={id} />
          </Panel>
          <Panel title={`Decisões de elegibilidade (${view.decisions.length})`} description="Imutáveis, da mais recente para a mais antiga.">
            {view.decisions.length === 0 ? <EmptyState title="Ainda não há decisão" hint="Execute o pipeline para avaliar este tópico." /> : (
              <ol className="space-y-3" data-testid="decisions">{view.decisions.map((d, i) => (
                <li key={d.id} className="rounded-lg border border-border p-3" data-decision={d.decision}>
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={DECISION_TONE[d.decision] ?? "neutral"}>{d.decision}</Badge>{i === 0 ? <Badge tone="outline">vigente</Badge> : null}<span className="text-[11px] text-muted-foreground">{when(d.evaluatedAt)} · política v{d.policyVersion} · nota {d.totalScore === null ? "não calculada (gate reprovado)" : d.totalScore.toFixed(1)}</span></div>
                  <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-3">{Object.entries(d.gateResults).map(([g, r]) => <li key={g} data-gate={g} data-result={r}><Badge tone={r === "PASS" ? "success" : r === "FAIL" ? "danger" : "outline"}>{g}: {r}</Badge> <span className="text-muted-foreground">{d.gateDetails[g]?.detail?.slice(0, 80)}</span></li>)}</ul>
                  {d.blockingReasons.length || d.missingRequirements.length ? <p className="mt-2 text-xs"><strong>Bloqueios e faltas:</strong> {[...d.blockingReasons, ...d.missingRequirements].join("; ")}</p> : null}
                  <p className="mt-2 text-xs"><strong>Ação recomendada pelo motor:</strong> {d.recommendedAction}</p>
                  {d.explanation ? <p className="mt-2 rounded-lg bg-muted/40 px-3 py-2 text-xs" data-testid="explanation"><strong>Explicação (Agente 5):</strong> {d.explanation.explanation} <em>Próximo passo: {d.explanation.nextBestAction}</em> <Link className="underline" href={`/engine/executions/${d.explanation.agentRunId}`}>ver execução</Link></p> : <p className="mt-2 text-[11px] text-muted-foreground">Sem explicação do Agente 5 para esta decisão (agente não executado ou bloqueado).</p>}
                </li>))}</ol>
            )}
          </Panel>
          <Panel title={`Blueprints da especificação (${view.blueprints.length})`}>
            {view.blueprints.length === 0 ? <EmptyState title="Nenhum blueprint" hint="O blueprint só nasce de READY_FOR_BLUEPRINT." /> : <ul className="space-y-3" data-testid="blueprints">{view.blueprints.map((b) => (
              <li key={b.id} className="rounded-lg border border-border p-3" data-blueprint-status={b.status}>
                <div className="flex flex-wrap items-center gap-2"><strong className="text-xs">v{b.version}</strong><Badge tone={b.status === "COMPLETE" ? "success" : "warning"}>{b.status === "COMPLETE" ? "Completo" : "Diferenciação insuficiente: volta ao enriquecimento"}</Badge><Badge tone="outline">campos semânticos: {b.semanticSource === "code" ? "código" : "Agente 6"}</Badge><Badge tone={b.templateGap ? "warning" : "outline"}>{b.templateGap ? `lacuna de template (${b.templateId})` : `template ${b.templateId}`}</Badge></div>
                <p className="mt-1 text-xs">{b.blueprint.url ?? "sem URL definida"} · {b.blueprint.page_family} · indexabilidade: {b.blueprint.indexability_policy}</p>
                <Pre v={b.blueprint} label="Blueprint completo" />
              </li>))}</ul>}
          </Panel>
          <Panel title={`Recipe e QA (${view.recipes.length} recipe(s), ${view.qaReports.length} relatório(s))`} description="O recipe cita fatos reais por fact_id. O QA registra Q1–Q14; um gate que não rodou fica “não rodou”, nunca aprovado por padrão.">
            {view.qaReports.length === 0 ? <EmptyState title="Nenhum QA registrado" hint="O recipe só é compilado depois do blueprint e da SERP (ou exceção humana registrada)." /> : (
              <ul className="space-y-3" data-testid="qa-reports">{view.qaReports.map((q, i) => (
                <li key={q.id} className="rounded-lg border border-border p-3" data-qa-outcome={q.outcome}>
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={q.outcome === "QA_PASSED" ? "success" : q.outcome === "QA_FAILED" ? "danger" : "warning"}>{q.outcome === "QA_PASSED" ? "QA aprovado" : q.outcome === "QA_FAILED" ? "QA reprovado" : "QA incompleto"}</Badge>{i === 0 ? <Badge tone="outline">mais recente</Badge> : null}<span className="text-[11px] text-muted-foreground">{when(q.createdAt)}{q.blockingFailures.length ? ` · bloqueantes: ${q.blockingFailures.join(", ")}` : ""}{q.agentRunId ? " · com o Agente 8" : " · sem o Agente 8"}</span></div>
                  <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2 lg:grid-cols-3">{Object.entries(q.results).map(([k, c]) => <li key={k} data-qa={k} data-status={c.status}><Badge tone={QA_STATUS[c.status]?.tone ?? "neutral"}>{k}: {QA_STATUS[c.status]?.label ?? c.status}</Badge> <span className="text-muted-foreground">{c.by === "none" ? "" : `por ${c.by}`}</span>{c.issues[0] ? <div className="text-[11px]">{c.issues[0].slice(0, 110)}</div> : null}</li>)}</ul>
                </li>))}</ul>
            )}
            {view.recipes[0] ? <div className="mt-3 space-y-2"><p className="text-xs"><strong>Recipe v{view.recipes[0].version}</strong> — narrativa: {view.recipes[0].narrativeSource === "agent7" ? "Agente 7 (validada pelo código)" : "texto determinístico do pack"} · {view.recipes[0].recipe.facts.length} fato(s) referenciado(s)</p><Pre v={view.recipes[0].recipe} label="Recipe compilado (blocos, módulos, JSON-LD)" /></div> : null}
          </Panel>
          <Panel title={`Execuções do pipeline (${view.pipelines.length})`}>{view.pipelines.length === 0 ? <EmptyState title="Nenhuma execução" /> : <ul className="space-y-1 text-xs">{view.pipelines.map((p) => <li key={p.id} className="flex flex-wrap items-center gap-2"><Link className="underline" href={`/engine/pipelines/${p.id}`}>{when(p.createdAt)}</Link><Badge tone={PIPELINE_STATE[p.status]!.tone}>{PIPELINE_STATE[p.status]!.label}</Badge><Badge tone={MODE[p.mode]!.tone}>{MODE[p.mode]!.label}</Badge></li>)}</ul>}</Panel>
          <Panel title={`Auditoria do Quality Gate (${view.audit.length})`}>{view.audit.length === 0 ? <EmptyState title="Nenhuma decisão final registrada" /> : <ul className="space-y-1 text-xs">{view.audit.map((a) => <li key={a.id}><strong>{a.decision}</strong> — {a.reason} <span className="text-[11px] text-muted-foreground">({when(a.createdAt)}, decidido por {a.decidedBy === "code" ? "código" : "pessoa"})</span></li>)}</ul>}</Panel>
        </>
      )}
    </Gate>
  );
}
