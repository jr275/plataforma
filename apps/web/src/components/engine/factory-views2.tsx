import Link from "next/link";
import type { factory } from "@plataforma/api";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Panel } from "@/components/ui/panel";
import { Dl } from "@/components/ui/field";
import type { Loaded } from "@/lib/server/tenant-data";
import type { templateInspector } from "@/lib/server/factory";
import { Gate, Pre, Stat, when } from "./engine-views";
import { AutoRefresh, BatchControls, BatchPlanForm, DeployForm, DeploymentControls } from "./factory-client";
import { BATCH_STATE, DEPLOY_STATE, dur } from "./format";

const fmt = (n: number) => n.toLocaleString("pt-BR");

// --- Lotes ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export function BatchesView({ loaded }: { loaded: Loaded<{ batches: (factory.BatchRecord & { items: number })[]; facets: { families: string[]; templates: string[] }; llmConfigured: boolean }> }) {
  return (
    <Gate loaded={loaded} current="/engine/batches" title="Geração em lote" description="Select → Validate → Estimate → Confirm → Generate → QA → Preview → Approve → Deploy → Verify. O lote classifica antes de executar e nada roda sem confirmação.">
      {(d) => (
        <>
          {!d.llmConfigured ? <p role="note" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs">Sem ANTHROPIC_API_KEY: os agentes ficam bloqueados externamente; nenhuma página chega a QA aprovado (Q14 não roda). Dá para planejar e acompanhar, mas a geração completa depende da chave.</p> : null}
          <Panel title="Novo lote" description="Combinações possíveis não são páginas aprovadas: o lote parte dos tópicos reais e conta só o que está elegível."><BatchPlanForm families={d.facets.families} templates={d.facets.templates} llmConfigured={d.llmConfigured} /></Panel>
          <Panel title={`Histórico de lotes (${d.batches.length})`}>
            {d.batches.length === 0 ? <EmptyState title="Nenhum lote planejado" hint="Planeje o primeiro lote acima." /> : <ul className="divide-y divide-border" data-testid="batches">{d.batches.map((b) => (
              <li key={b.id} className="space-y-1 py-3 first:pt-0 last:pb-0" data-batch={b.id} data-status={b.status}>
                <div className="flex flex-wrap items-center gap-2"><Link className="text-sm font-medium underline" href={`/engine/batches/${b.id}`}>{b.name}</Link><Badge tone={BATCH_STATE[b.status]!.tone}>{BATCH_STATE[b.status]!.label}</Badge><Badge tone={b.mode === "real" ? "success" : "warning"}>{b.mode === "real" ? "execução real" : "SIMULAÇÃO DE TESTE"}</Badge><Badge tone="outline">destino {b.config.target}</Badge></div>
                <p className="text-[11px] text-muted-foreground">{when(b.createdAt)} por {b.createdBy} · {b.items} candidata(s), {b.estimate.eligible} elegível(is), concorrência {b.config.concurrency}</p>
              </li>))}</ul>}
          </Panel>
        </>
      )}
    </Gate>
  );
}
function Counter({ label, value, tone, hint }: { label: string; value: number; tone?: string; hint?: string }) {
  return <div className="rounded-lg border border-border px-3 py-2" data-counter={label}><p className="text-[11px] text-muted-foreground">{label}</p><p className={`text-xl font-semibold tabular-nums ${tone ?? ""}`}>{fmt(value)}</p>{hint ? <p className="text-[10.5px] text-muted-foreground">{hint}</p> : null}</div>;
}
export function BatchDetailView({ loaded }: { loaded: Loaded<factory.BatchView | null> }) {
  return (
    <Gate loaded={loaded} current="/engine/batches" title="Lote" description="Estado persistido do lote: contadores mutuamente exclusivos, ritmo e eventos. A tela só lê o banco." crumbs={[{ label: "Lotes", href: "/engine/batches" }, { label: "Lote" }]}>
      {(v) => v === null ? <Panel title="Lote"><EmptyState title="Lote não encontrado neste workspace" /></Panel> : (() => {
        const { batch: b, counters: c } = v; const active = b.status === "RUNNING" || c.running > 0;
        const done = c.approved + c.awaitingHuman + c.blocked + c.failed; const progress = c.eligible > 0 ? done / c.eligible : null;
        return (
          <>
            <Panel title={b.name} action={<div className="flex gap-2"><Badge tone={BATCH_STATE[b.status]!.tone}>{BATCH_STATE[b.status]!.label}</Badge><Badge tone={b.mode === "real" ? "success" : "warning"}>{b.mode === "real" ? "execução real" : "SIMULAÇÃO DE TESTE"}</Badge></div>}>
              <p className="text-xs text-muted-foreground">Criado {when(b.createdAt)} por {b.createdBy}{b.confirmedAt ? ` · confirmado ${when(b.confirmedAt)} por ${b.confirmedBy}` : " · ainda não confirmado"}{b.startedAt ? ` · iniciado ${when(b.startedAt)}` : ""}{b.finishedAt ? ` · encerrado ${when(b.finishedAt)}` : ""}</p>
              <Dl items={[{ label: "Destino", value: b.config.target === "none" ? "nenhum (só gerar)" : b.config.target === "preview" ? "preview" : "PRODUÇÃO (exigiu autorização)" }, { label: "Limites", value: `concorrência ${b.config.concurrency} · lote de ${b.config.batchSize} · até ${b.config.maxModelCallsPerPage} chamadas ao modelo por página` }, { label: "Escopo", value: `${b.config.families.join(", ") || "todas as famílias"} · ${b.config.templates.join(", ") || "todos os templates"} · ${b.config.geo?.uf ?? "todas as UFs"}` }, { label: "Aprovação", value: "manual (aprovar não publica)" }]} />
            </Panel>
            <Panel title="Contadores" description="Cada item aparece em UMA caixa. Elegíveis = pendentes + em geração + aprovadas + aguardando humano + bloqueadas + falhas + canceladas.">
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5" data-testid="counters">
                <Counter label="Candidatos selecionados" value={c.selected} /><Counter label="Elegíveis para geração" value={c.eligible} />
                <Counter label="Fora do lote: bloqueadas" value={c.notEligible.blocked} hint="decisão impeditiva" /><Counter label="Fora do lote: dados pendentes" value={c.notEligible.dataPending} hint="DATA/RESEARCH_REQUIRED" /><Counter label="Fora do lote: já feitas" value={c.notEligible.alreadyDone} />
                <Counter label="Aguardando geração" value={c.pending} /><Counter label="Em geração" value={c.running} tone={c.running ? "text-info" : ""} /><Counter label="QA aprovado" value={c.approved} tone="text-success" hint="apto à revisão humana" /><Counter label="Aguardando intervenção humana" value={c.awaitingHuman} tone={c.awaitingHuman ? "text-warning" : ""} />
                <Counter label="Bloqueadas" value={c.blocked} tone={c.blocked ? "text-warning" : ""} /><Counter label="Falhas" value={c.failed} tone={c.failed ? "text-destructive" : ""} /><Counter label="Canceladas" value={c.cancelled} />
              </div>
              <div className="mt-3 space-y-1"><div role="progressbar" aria-label="Progresso do lote" aria-valuemin={0} aria-valuemax={c.eligible} aria-valuenow={done} className="h-2 w-full overflow-hidden rounded-sm bg-muted"><div className="h-full bg-success" style={{ width: `${progress === null ? 0 : progress * 100}%` }} /></div><p className="text-xs text-muted-foreground">{done} de {c.eligible} elegíveis com desfecho{progress === null ? "" : ` (${Math.round(progress * 100)}%)`} — contado do banco, não animado.</p></div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3"><Stat label="Tempo decorrido" value={dur(v.elapsedMs)} /><Stat label="Ritmo" value={v.ratePerMinute === null ? "—" : `${v.ratePerMinute.toFixed(1)} /min`} hint={v.ratePerMinute === null ? "Base insuficiente (menos de 3 itens com desfecho)." : undefined} /><Stat label="Conclusão estimada" value={v.etaMs === null ? "—" : dur(v.etaMs)} hint={v.etaMs === null ? "Só com 5+ desfechos e lote em execução." : undefined} /></div>
            </Panel>
            <Panel title="Estimativa feita antes de executar"><Dl items={[{ label: "Candidatos / elegíveis", value: `${b.estimate.candidates} / ${b.estimate.eligible}` }, { label: "Bloqueadas · dados pendentes · já feitas", value: `${b.estimate.blocked} · ${b.estimate.dataPending} · ${b.estimate.alreadyDone}` }, { label: "Lotes estimados", value: `${b.estimate.estimatedBatches} de ${b.config.batchSize}` }, { label: "Custo estimado", value: b.estimate.cost.reason }]} />{b.estimate.externalDependencies.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{b.estimate.externalDependencies.map((x) => <li key={x}>{x}</li>)}</ul> : null}</Panel>
            <Panel title="Controle"><BatchControls id={b.id} status={b.status} target={b.config.target} awaiting={c.awaitingHuman} /><AutoRefresh active={active} /></Panel>
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Motivos de bloqueio ou espera">{v.blockReasons.length === 0 ? <EmptyState title="Nenhum" /> : <ul className="space-y-1 text-xs">{v.blockReasons.map((r) => <li key={r.reason} className="flex justify-between gap-3"><span>{r.reason}</span><span className="tabular-nums">{r.count}</span></li>)}</ul>}</Panel>
              <Panel title={`Aguardando intervenção humana (${v.awaiting.length})`}>{v.awaiting.length === 0 ? <EmptyState title="Nenhuma página" /> : <ul className="space-y-1 text-xs">{v.awaiting.map((a) => <li key={a.opportunityId}><Link className="underline" href={`/engine/pages/${a.opportunityId}`}>{a.opportunityId.slice(0, 8)}…</Link> — {a.reason}</li>)}</ul>}</Panel>
            </div>
            <Panel title="Erros recentes">{v.errors.length === 0 ? <EmptyState title="Nenhum erro" /> : <ul className="space-y-1 text-xs" data-testid="batch-errors">{v.errors.map((e) => <li key={e.opportunityId}><Link className="underline" href={`/engine/pages/${e.opportunityId}`}>{e.opportunityId.slice(0, 8)}…</Link> (tentativa {e.attempts}): {e.error}</li>)}</ul>}</Panel>
            <Panel title="Últimos eventos">{v.recent.length === 0 ? <EmptyState title="Nenhum item processado ainda" /> : <ul className="space-y-1 text-xs">{v.recent.map((r) => <li key={r.opportunityId + String(r.at)} className="flex flex-wrap items-center gap-2"><span className="tabular-nums text-muted-foreground">{when(r.at)}</span><Link className="underline" href={`/engine/pages/${r.opportunityId}`}>{r.opportunityId.slice(0, 8)}…</Link><Badge tone={r.status === "SUCCEEDED" ? "success" : r.status === "FAILED" ? "danger" : r.status === "BLOCKED" ? "warning" : "info"}>{r.status}{r.outcome ? ` / ${r.outcome}` : ""}</Badge>{r.stage ? <span className="text-muted-foreground">{r.stage}</span> : null}</li>)}</ul>}</Panel>
          </>
        );
      })()}
    </Gate>
  );
}

// --- Deployments ----------------------------------------------------------------------------------------------------------------------------------------------------------------------
export function DeploymentsView({ loaded, status }: { loaded: Loaded<{ list: { total: number; byStatus: Record<string, number>; rows: factory.DeploymentRecord[] }; approved: { rows: factory.PageRow[]; total: number }; config: factory.VercelConfig }>; status: string }) {
  return (
    <Gate loaded={loaded} current="/engine/deployments" title="Deployment Center" description="Publicações na Vercel. O estado vem do provedor e da verificação das URLs: pedido aceito não é build pronto, e build pronto não é página verificada.">
      {({ list, approved, config }) => (
        <>
          <Panel title="Integração" description="Adaptador desacoplado da interface (consulta por polling; verificação própria das URLs).">
            {config.configured ? <p className="text-xs" data-testid="vercel-config"><Badge tone="success">credenciais presentes</Badge> “Presente” não prova que o projeto exista ou aceite deployments: só uma consulta real prova.</p> : (
              <div className="space-y-2 text-xs" data-testid="vercel-config"><Badge tone="danger">bloqueado: integração não configurada</Badge><p>Faltam: <strong>{config.missing.join(", ")}</strong>. Na inspeção feita ao construir esta tela (14/10/2026) a conta Vercel acessível não tinha nenhum projeto. Para destravar: criar o projeto (somente arquivos estáticos), gerar um token com escopo mínimo e definir <code>VERCEL_TOKEN</code>, <code>VERCEL_PROJECT</code> e, se houver time, <code>VERCEL_TEAM_ID</code>. Nenhum deployment foi criado e nenhuma validação real foi feita.</p></div>
            )}
          </Panel>
          <Panel title="Estados"><div className="flex flex-wrap gap-2 text-xs" data-testid="deploy-chips"><Link className={!status ? "font-semibold underline" : "underline"} href="/engine/deployments">Todos ({list.total})</Link>{Object.keys(DEPLOY_STATE).map((s) => <Link key={s} className={status === s ? "font-semibold underline" : "underline"} href={`/engine/deployments?status=${s}`}>{DEPLOY_STATE[s]!.label} ({list.byStatus[s] ?? 0})</Link>)}</div></Panel>
          <Panel title={`Histórico (${list.rows.length})`}>
            {list.rows.length === 0 ? <EmptyState title="Nenhum deployment registrado" hint="Aprove páginas e envie-as abaixo (preview por padrão)." /> : (
              <div className="overflow-x-auto"><table className="w-full text-xs" data-testid="deployments"><thead><tr className="text-left text-[11px] text-muted-foreground"><th className="py-1 pr-3">Criado</th><th className="pr-3">Destino</th><th className="pr-3">Estado</th><th className="pr-3">Páginas</th><th className="pr-3">URL</th><th className="pr-3">Origem</th><th>Lote</th></tr></thead><tbody>{list.rows.map((d) => (
                <tr key={d.id} className="border-t border-border align-top" data-deployment={d.id} data-status={d.status}><td className="py-1.5 pr-3 whitespace-nowrap"><Link className="underline" href={`/engine/deployments/${d.id}`}>{when(d.createdAt)}</Link></td><td className="pr-3">{d.target === "production" ? "produção" : "preview"}</td><td className="pr-3"><Badge tone={DEPLOY_STATE[d.status]!.tone}>{DEPLOY_STATE[d.status]!.label}</Badge></td><td className="pr-3 tabular-nums">{d.pages}</td><td className="max-w-[28ch] truncate pr-3">{d.url ?? "—"}</td><td className="pr-3">{d.gitBranch ?? "—"}{d.gitCommit ? ` @ ${d.gitCommit.slice(0, 7)}` : ""}</td><td>{d.batchId ? <Link className="underline" href={`/engine/batches/${d.batchId}`}>lote</Link> : "—"}</td></tr>))}</tbody></table></div>
            )}
          </Panel>
          <Panel title="Enviar páginas aprovadas" description={`Só entram páginas com aprovação humana vigente e QA aprovado da versão atual (${approved.total} disponível(is)).`}>
            {approved.rows.length === 0 ? <EmptyState title="Nenhuma página aprovada" hint="Aprove páginas em Páginas > ação em lote." /> : (
              <DeployForm><ul className="max-h-64 space-y-1 overflow-auto text-xs" data-testid="deploy-candidates">{approved.rows.map((r) => <li key={r.opportunityId}><label className="flex items-center gap-2"><input type="checkbox" name="id" value={r.opportunityId} className="size-4" /> <span>{r.title ?? r.primaryQuery}</span><span className="text-muted-foreground">{r.url} · v{r.recipeVersion}</span></label></li>)}</ul></DeployForm>
            )}
          </Panel>
        </>
      )}
    </Gate>
  );
}
export function DeploymentDetailView({ loaded }: { loaded: Loaded<Awaited<ReturnType<typeof import("@plataforma/api").factory.getDeployment>>> }) {
  return (
    <Gate loaded={loaded} current="/engine/deployments" title="Deployment" description="Linha do tempo de estados com a origem de cada informação (pedido, consulta, webhook ou verificação)." crumbs={[{ label: "Deployments", href: "/engine/deployments" }, { label: "Deployment" }]}>
      {(g) => g === null ? <Panel title="Deployment"><EmptyState title="Deployment não encontrado neste workspace" /></Panel> : (
        <>
          <Panel title={`${g.deployment.target === "production" ? "Produção" : "Preview"} · ${g.deployment.projectRef}`} action={<Badge tone={DEPLOY_STATE[g.deployment.status]!.tone}>{DEPLOY_STATE[g.deployment.status]!.label}</Badge>}>
            <Dl items={[{ label: "URL", value: g.deployment.url ?? "—" }, { label: "Id no provedor", value: g.deployment.providerDeploymentId ?? "— (não aceito pelo provedor)" }, { label: "Origem", value: `${g.deployment.gitBranch ?? "—"}${g.deployment.gitCommit ? ` @ ${g.deployment.gitCommit.slice(0, 7)}` : ""}` }, { label: "Lote", value: g.deployment.batchId ? <Link className="underline" href={`/engine/batches/${g.deployment.batchId}`}>abrir lote</Link> : "—" }, { label: "Autorização de produção", value: g.deployment.authorizedBy ?? "não se aplica (preview)" }, { label: "Erro", value: g.deployment.error ?? "—" }, { label: "Criado / atualizado", value: `${when(g.deployment.createdAt)} / ${when(g.deployment.updatedAt)}` }]} />
            <div className="mt-3"><DeploymentControls id={g.deployment.id} status={g.deployment.status} /></div>
            <AutoRefresh active={["QUEUED", "BUILDING"].includes(g.deployment.status)} everyMs={5000} />
          </Panel>
          <Panel title="Linha do tempo"><ol className="space-y-2 text-xs" data-testid="timeline">{g.events.map((e, i) => <li key={i} className="flex flex-wrap items-center gap-2"><span className="tabular-nums text-muted-foreground">{when(e.at)}</span><Badge tone={DEPLOY_STATE[e.status]!.tone}>{DEPLOY_STATE[e.status]!.label}</Badge><Badge tone="outline">{({ request: "pedido", poll: "consulta ao provedor", webhook: "webhook", verification: "verificação" } as Record<string, string>)[e.source] ?? e.source}</Badge>{e.providerState ? <span className="text-muted-foreground">estado do provedor: {e.providerState}</span> : null}</li>)}</ol></Panel>
          <Panel title={`Páginas incluídas (${g.pages.length})`}>{g.pages.length === 0 ? <EmptyState title="Nenhuma" /> : <ul className="space-y-1 text-xs" data-testid="deployment-pages">{g.pages.map((p) => <li key={p.recipeId} className="flex flex-wrap items-center gap-2"><Link className="underline" href={`/engine/pages/${p.opportunityId}`}>{p.path}</Link>{p.httpStatus ? <Badge tone={p.verifiedAt ? "success" : "danger"}>HTTP {p.httpStatus}{p.verifiedAt ? " · verificada" : " · não verificada"}</Badge> : <Badge tone="outline">não verificada</Badge>}</li>)}</ul>}</Panel>
        </>
      )}
    </Gate>
  );
}

// --- Inspetor de templates e módulos -------------------------------------------------------------------------------------------------------------------------------------------------
export function TemplateInspectorView({ items }: { items: ReturnType<typeof templateInspector> }) {
  return (
    <Gate loaded={{ state: "ready", data: items, origin: undefined }} current="/engine/templates" title="Templates e módulos" description="O contrato de renderização do Domain Pack. Template visual, page type e page family são conceitos distintos; a família não é a URL. O LLM só preenche slots do contrato, nunca cria módulos.">
      {(rows) => (
        <ul className="space-y-4" data-testid="templates">{rows.map((r) => (
          <li key={r.family} data-family={r.family}>
            <Panel title={`${r.family} — ${r.pageType}`} description={`arquétipo ${r.archetype} · template ${r.templateId}`} action={<div className="flex gap-2"><Badge tone={r.templateAvailable ? "success" : "warning"}>{r.templateAvailable ? "template disponível" : "lacuna de template"}</Badge><Badge tone={r.hasRenderer ? "success" : "warning"}>{r.hasRenderer ? "renderizador no pack" : "sem renderizador"}</Badge><Badge tone="outline">{r.hasUrlRule ? "URL definida" : "URL ainda não definida"}</Badge></div>}>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2"><p className="text-xs font-medium">Módulos ({r.modules.length})</p><ul className="space-y-2 text-xs">{r.modules.map((m) => <li key={m.moduleId} className="rounded-lg border border-border p-2"><div className="flex flex-wrap items-center gap-2"><code className="font-medium">{m.moduleId}</code><Badge tone="outline">mín. {m.minItems}</Badge><Badge tone="outline">{m.onMissing === "remove" ? "remove se faltar" : "mostra insuficiência"}</Badge></div><p className="mt-1 text-muted-foreground">Visibilidade: {m.visibility}.</p><p className="mt-1">Dados: {m.fields.map((f) => (f.attribute ? `${f.field} ← ${f.attribute}` : `${f.field} ← entidade`)).join("; ")}</p></li>)}</ul></div>
                <div className="space-y-2 text-xs"><Dl items={[{ label: "Schema.org", value: r.schemaTypes.join(", ") }, { label: "Requisitos de evidência", value: r.claims.map((c) => `${c.claimType} (${c.sourceClass}: ${c.attribute})`).join("; ") }, { label: "Módulos visuais exigidos", value: r.moduleRequirements.join(", ") }, { label: "Padrões de SEO", value: <>{r.patterns.title}<br />{r.patterns.h1}</> }, { label: "Atualização", value: `${r.refreshTrigger} (validade ${r.maxAgeDays} dias)` }, { label: "KPIs", value: r.kpis.join(", ") }, { label: "Slots editoriais", value: r.editorialSlots }]} /><Pre v={r} label="Contrato completo" /></div>
              </div>
            </Panel>
          </li>))}</ul>
      )}
    </Gate>
  );
}
