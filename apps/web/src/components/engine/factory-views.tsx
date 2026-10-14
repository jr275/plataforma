import Link from "next/link";
import { factory as F } from "@plataforma/api";
import type { factory } from "@plataforma/api";
import { Badge, type Tone } from "@/components/ui/badge";
import { EmptyState, Panel } from "@/components/ui/panel";
import { Dl, inputClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import type { Loaded } from "@/lib/server/tenant-data";
import type { PageDetail, PageParams } from "@/lib/server/factory";
import { Gate, Pre, when } from "./engine-views";
import { AutoRefresh, DevicePreview, PageBatchForm } from "./factory-client";
import { DEPLOY_STATE, PIPELINE_STATE, QA_OUTCOME, STAGE_TONE, dur, pct } from "./format";

// Fábrica de páginas: visão geral, pipeline de 16 etapas, lista e detalhe de páginas. Cada número vem de uma consulta ao banco com definição explícita; "não instrumentado" nunca aparece como zero.
const fmt = (n: number) => n.toLocaleString("pt-BR");
const STAGE_COPY: Record<string, string> = { candidate: "Candidata", blueprint: "Blueprint", generated: "Gerada", awaiting_qa: "Aguardando QA", awaiting_approval: "Aguardando aprovação", approved: "Aprovada (não publicada)", preview: "Em preview", published: "Publicada" };

function MetricCard({ m, v }: { m: factory.MetricDef; v: factory.MetricValue | undefined }) {
  const delta = v && v.state === "available" && v.previous !== null ? v.value - v.previous : null;
  return (
    <li className="rounded-lg border border-border p-3" data-metric={m.id} data-state={v?.state ?? "missing"}>
      <div className="flex items-start justify-between gap-2"><p className="text-xs text-muted-foreground">{m.label}</p><Badge tone="outline">{KIND[m.kind]}</Badge></div>
      {!v || v.state === "not_instrumented" ? <p className="mt-1 text-sm font-medium text-muted-foreground" data-value="not_instrumented">Não instrumentado</p> : <p className="mt-1 text-2xl font-semibold tabular-nums" data-value={v.value}>{m.href ? <Link href={m.href} className="underline-offset-2 hover:underline">{fmt(v.value)}</Link> : fmt(v.value)}</p>}
      {delta !== null ? <p className="text-[11px] text-muted-foreground">{delta === 0 ? "sem variação" : `${delta > 0 ? "+" : ""}${fmt(delta)}`} vs período anterior ({fmt((v as { previous: number }).previous)})</p> : null}
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{v && v.state === "not_instrumented" ? v.reason : m.meaning}</p>
      <p className="mt-1 text-[10.5px] text-muted-foreground/80">Fonte: {m.source} · Escopo: {m.scope}</p>
    </li>
  );
}
const KIND: Record<factory.MetricKind, string> = { current_state: "estado atual", accumulated: "acumulado", period_events: "eventos no período", unique_pages: "únicas", versions: "versões", attempts: "tentativas", deployments: "deployments" };

export function stageState(s: factory.StageView): { label: string; tone: Tone } {
  if (!s.instrumented) return { label: "não instrumentada", tone: "outline" };
  if (s.total === 0) return { label: "sem itens", tone: "outline" };
  if (s.failed > 0) return { label: "com falhas", tone: "danger" };
  if (s.running > 0) return { label: "em execução", tone: "info" };
  if (s.blocked > 0) return { label: "com bloqueios", tone: "warning" };
  if (s.waiting > 0) return { label: "aguardando", tone: "outline" };
  return { label: "concluída", tone: "success" };
}
function StageBar({ s }: { s: factory.StageView }) {
  const seg: [string, number, string][] = [["concluídos", s.completed, "bg-success"], ["em execução", s.running, "bg-info"], ["aguardando", s.waiting, "bg-muted-foreground/40"], ["bloqueados", s.blocked, "bg-warning"], ["falhas", s.failed, "bg-destructive"], ["pulados", s.skipped, "bg-border"]];
  return (
    <div role="img" aria-label={seg.filter(([, n]) => n > 0).map(([l, n]) => `${l}: ${n}`).join(", ") || "sem itens"} className="flex h-2 w-full overflow-hidden rounded-sm bg-muted">
      {s.total > 0 ? seg.filter(([, n]) => n > 0).map(([l, n, c]) => <span key={l} className={c} style={{ width: `${(n / s.total) * 100}%` }} title={`${l}: ${n}`} />) : null}
    </div>
  );
}

export function FactoryOverview({ loaded, days }: { loaded: Loaded<{ metrics: factory.FactoryMetrics; stages: factory.StageView[] }>; days: number }) {
  return (
    <Gate loaded={loaded} current="/engine" title="Programmatic SEO Factory" description="Escala, processo e resultado, calculados dos registros reais. Oportunidade, blueprint, página gerada, aprovada, publicada e indexada são estados diferentes e nunca somam entre si.">
      {({ metrics, stages }) => {
        const by = (ids: string[]) => ids.map((id) => ({ m: F.METRICS.find((x) => x.id === id)!, v: metrics.values[id] }));
        const funnel = by(["opportunities_eligible", "blueprints_created", "pages_generated", "pages_approved", "pages_published", "pages_indexed"]);
        return (
          <>
            <div className="flex flex-wrap items-center gap-3 text-xs"><span>Período dos eventos:</span>{[7, 30, 90].map((d) => <Link key={d} href={d === 7 ? "/engine" : `/engine?days=${d}`} className={days === d ? "font-semibold underline" : "underline"}>{d} dias</Link>)}<span className="text-muted-foreground">Atualizado {when(metrics.asOf)}. Estados atuais não têm série histórica (não há snapshots); só eventos têm variação.</span></div>
            <Panel title="Do dado à página: seis estados distintos" description="Cada degrau é uma contagem própria. Um número maior à direita não é erro: indexada ≠ publicada ≠ aprovada ≠ gerada ≠ blueprint ≠ oportunidade.">
              <ol className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="funnel">{funnel.map(({ m, v }, i) => <li key={m.id} className="rounded-lg border border-border p-3" data-step={m.id}><p className="font-mono text-[10px] text-muted-foreground">{i + 1}</p><p className="text-xs">{m.label}</p><p className="text-xl font-semibold tabular-nums">{v && v.state === "available" ? (m.href ? <Link className="hover:underline" href={m.href}>{fmt(v.value)}</Link> : fmt(v.value)) : <span className="text-sm text-muted-foreground">não instrumentado</span>}</p></li>)}</ol>
            </Panel>
            <Panel title="Escala" description="O que o sistema sabe e o que ele já explorou."><ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{by(["entities_available", "attributes_discovered", "topics_discovered", "combinations_evaluated"]).map(({ m, v }) => <MetricCard key={m.id} m={m} v={v} />)}</ul></Panel>
            <Panel title="Produção" description="Estados atuais das páginas ao longo da fábrica."><ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{by(["blueprints_created", "pages_generating", "pages_generated", "pages_awaiting_qa", "pages_qa_passed", "pages_awaiting_approval", "pages_approved", "pages_deployed_preview", "pages_published", "deployments_total", "deployments_verified"]).map(({ m, v }) => <MetricCard key={m.id} m={m} v={v} />)}</ul></Panel>
            <Panel title="Problemas e versões" description={`Eventos dos últimos ${metrics.periodDays} dias e contagens que NÃO são páginas únicas.`}><ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{by(["pages_blocked", "generation_failures", "pipeline_runs", "blueprint_versions", "recipe_versions", "pages_indexed"]).map(({ m, v }) => <MetricCard key={m.id} m={m} v={v} />)}</ul></Panel>
            <Panel title="Pipeline em 16 etapas" description="Resumo; abra o Pipeline para ver entradas, saídas, motivos de bloqueio e execuções." action={<Link className="text-xs underline" href="/engine/pipeline">Abrir pipeline</Link>}>
              <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{stages.map((s) => { const st = stageState(s); return <li key={s.id} className="rounded-lg border border-border p-2"><div className="flex items-center justify-between gap-2"><Link href={`/engine/pipeline?stage=${s.id}`} className="text-xs font-medium hover:underline">{s.n}. {s.label}</Link><Badge tone={st.tone}>{st.label}</Badge></div><div className="mt-2"><StageBar s={s} /></div><p className="mt-1 text-[11px] text-muted-foreground">{fmt(s.completed)} de {fmt(s.total)} {s.unit}</p></li>; })}</ol>
            </Panel>
          </>
        );
      }}
    </Gate>
  );
}

export function PipelineView({ loaded, selected }: { loaded: Loaded<{ stages: factory.StageView[]; metrics: factory.FactoryMetrics }>; selected: string }) {
  return (
    <Gate loaded={loaded} current="/engine/pipeline" title="Pipeline de produção" description="As 16 etapas calculadas dos registros de execução. Em cada etapa: total = concluídos + em execução + aguardando + bloqueados + falhas + pulados (nenhum item em dois estados).">
      {({ stages }) => {
        const sel = stages.find((s) => s.id === selected) ?? null;
        return (
          <>
            <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="pipeline-flow">
              {stages.map((s, i) => { const st = stageState(s); return (
                <li key={s.id} className={`relative rounded-lg border p-3 ${sel?.id === s.id ? "border-foreground" : "border-border"}`} data-stage={s.id} data-state={st.label}>
                  <div className="flex items-start justify-between gap-2"><Link href={`/engine/pipeline?stage=${s.id}#detalhe`} className="text-sm font-medium hover:underline">{s.n}. {s.label}</Link><Badge tone={st.tone}>{st.label}</Badge></div>
                  <div className="mt-2"><StageBar s={s} /></div>
                  <p className="mt-2 text-xs tabular-nums">{fmt(s.completed)} / {fmt(s.total)} <span className="text-muted-foreground">{s.unit}</span></p>
                  <p className="text-[11px] text-muted-foreground">{s.running ? `${fmt(s.running)} em execução · ` : ""}{s.waiting ? `${fmt(s.waiting)} aguardando · ` : ""}{s.blocked ? `${fmt(s.blocked)} bloqueados · ` : ""}{s.failed ? `${fmt(s.failed)} falhas · ` : ""}{s.skipped ? `${fmt(s.skipped)} pulados · ` : ""}{s.successRate !== null ? `sucesso ${pct(s.successRate)}` : "taxa n/d"}</p>
                  {i < stages.length - 1 ? <span aria-hidden="true" className="absolute -right-1.5 top-1/2 hidden text-muted-foreground lg:block">›</span> : null}
                </li>); })}
            </ol>
            <Panel title="Legenda das barras" description="Largura proporcional ao total da etapa."><p className="flex flex-wrap gap-3 text-xs">{[["bg-success", "concluídos"], ["bg-info", "em execução"], ["bg-muted-foreground/40", "aguardando"], ["bg-warning", "bloqueados"], ["bg-destructive", "falhas"], ["bg-border", "pulados"]].map(([c, l]) => <span key={l} className="inline-flex items-center gap-1.5"><span className={`size-2.5 rounded-sm ${c}`} />{l}</span>)}</p></Panel>
            <section id="detalhe">
              {sel ? <StageDetail s={sel} prev={stages[sel.n - 2] ?? null} next={stages[sel.n] ?? null} /> : <Panel title="Detalhe da etapa"><EmptyState title="Escolha uma etapa" hint="Abra uma etapa para ver a definição, as entradas, as saídas, os motivos de bloqueio e os links para os registros." /></Panel>}
            </section>
          </>
        );
      }}
    </Gate>
  );
}
function StageDetail({ s, prev, next }: { s: factory.StageView; prev: factory.StageView | null; next: factory.StageView | null }) {
  const st = stageState(s);
  return (
    <Panel title={`${s.n}. ${s.label}`} description={s.definition} action={<Badge tone={st.tone}>{st.label}</Badge>}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3"><StageBar s={s} />
          <table className="w-full text-xs" data-testid="stage-counts"><tbody>{([["Total processado", s.total], ["Concluídos", s.completed], ["Em execução", s.running], ["Aguardando", s.waiting], ["Bloqueados", s.blocked], ["Falhas", s.failed], ["Pulados", s.skipped]] as const).map(([l, n]) => <tr key={l} className="border-t border-border first:border-0"><td className="py-1">{l}</td><td className="py-1 text-right tabular-nums">{fmt(n)}</td></tr>)}</tbody></table>
          <Dl items={[{ label: "Unidade", value: s.unit }, { label: "Fonte dos registros", value: <code className="text-xs">{s.source}</code> }, { label: "Duração média", value: dur(s.avgDurationMs) }, { label: "Taxa de sucesso", value: s.successRate === null ? "— (sem itens decididos)" : `${pct(s.successRate)} (concluídos ÷ concluídos + bloqueados + falhas)` }, { label: "Última atualização", value: s.lastUpdate ? when(s.lastUpdate) : "—" }]} />
          {s.note ? <p role="note" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">{s.note}</p> : null}
        </div>
        <div className="space-y-3">
          <div><p className="text-xs font-medium">Motivos mais frequentes de bloqueio ou espera</p>{s.reasons.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">Nenhum motivo registrado.</p> : <ul className="mt-1 space-y-1 text-xs" data-testid="stage-reasons">{s.reasons.map((r) => <li key={r.reason} className="flex justify-between gap-3"><span>{r.reason}</span><span className="tabular-nums">{fmt(r.count)}</span></li>)}</ul>}</div>
          <div><p className="text-xs font-medium">Dependências e fluxo</p><p className="mt-1 text-xs"><strong>Entrada:</strong> {prev ? `${fmt(prev.completed)} ${prev.unit} concluídos em “${prev.label}”` : "dados de origem"}.</p><p className="text-xs"><strong>Saída:</strong> {fmt(s.completed)} {s.unit}{next ? ` → alimentam “${next.label}”` : ""}.</p></div>
          <div><p className="text-xs font-medium">Registros</p><ul className="mt-1 space-y-1 text-xs">{LINKS[s.id]?.map(([h, l]) => <li key={h}><Link className="underline" href={h}>{l}</Link></li>)}</ul></div>
        </div>
      </div>
    </Panel>
  );
}
const LINKS: Record<string, [string, string][]> = {
  data_ingestion: [["/cities", "Importações e cidades"]], topic_discovery: [["/engine/topics", "Descoberta de tópicos"]], intent_modeling: [["/engine/topics", "Tópicos e intenção"], ["/engine/executions?agent=3", "Execuções do Agente 3"]], combination_engine: [["/engine/topics", "Podas por filtro"]],
  eligibility: [["/engine/eligibility", "Inspetor de elegibilidade"], ["/engine/eligibility?decision=DATA_REQUIRED", "Bloqueadas por dados"]], blueprint_generation: [["/engine/pages?stage=blueprint", "Páginas com blueprint"]], recipe_compilation: [["/engine/pages?stage=generated", "Páginas geradas"]],
  editorial_generation: [["/engine/executions?agent=7", "Execuções do Agente 7"]], quality_assurance: [["/engine/pages?qa=QA_FAILED", "QA reprovado"], ["/engine/pages?qa=QA_PASSED", "QA aprovado"], ["/engine/executions?agent=8", "Execuções do Agente 8"]],
  preview: [["/engine/pages?stage=preview", "Páginas em preview"]], approval: [["/engine/pages?stage=awaiting_approval", "Aguardando aprovação"], ["/engine/pages?stage=approved", "Aprovadas"]], vercel_deployment: [["/engine/deployments", "Deployment Center"]], deployment_verification: [["/engine/deployments?status=VERIFICATION_PENDING", "Verificações pendentes"], ["/engine/deployments?status=VERIFIED", "Verificados"]],
};

// --- Lista de páginas ----------------------------------------------------------------------------------------------------------------------------------------------------------------------
export function PagesView({ loaded, params, pageSize }: { loaded: Loaded<{ list: { total: number; byStage: Record<string, number>; rows: factory.PageRow[] }; facets: { families: string[]; templates: string[] } }>; params: PageParams; pageSize: number }) {
  const href = (o: Partial<PageParams>) => { const n = { ...params, ...o }; const q = new URLSearchParams(); for (const [k, v] of Object.entries(n)) if (v && !(k === "page" && v === 1)) q.set(k, String(v)); return `/engine/pages${q.size ? `?${q}` : ""}`; };
  return (
    <Gate loaded={loaded} current="/engine/pages" title="Página Factory" description="Candidatas, blueprints, páginas geradas, aprovadas e publicadas: cada estágio é derivado dos registros. Filtros e paginação rodam no banco.">
      {({ list, facets }) => (
        <>
          <Panel title="Estágios" description="Contagem de todos os tópicos por estágio (respeita a busca e a família).">
            <div className="flex flex-wrap gap-2 text-xs" data-testid="stage-chips"><Link href={href({ stage: "", page: 1 })} className={!params.stage ? "font-semibold underline" : "underline"}>Todos</Link>{(["candidate", "blueprint", "generated", "awaiting_qa", "awaiting_approval", "approved", "preview", "published"] as const).map((s) => <Link key={s} href={href({ stage: s, page: 1 })} className={params.stage === s ? "font-semibold underline" : "underline"}>{STAGE_COPY[s]} ({fmt(list.byStage[s] ?? 0)})</Link>)}</div>
          </Panel>
          <form method="get" className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-4" role="search" aria-label="Filtros de páginas">
            <input name="q" defaultValue={params.q} placeholder="Buscar URL, entidade, tema ou título" className={`${inputClass} lg:col-span-2`} aria-label="Busca" />
            <select name="stage" defaultValue={params.stage} className={inputClass} aria-label="Estágio"><option value="">Qualquer estágio</option>{Object.entries(STAGE_COPY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <select name="family" defaultValue={params.family} className={inputClass} aria-label="Page family"><option value="">Qualquer família</option>{facets.families.map((f) => <option key={f} value={f}>{f}</option>)}</select>
            <select name="template" defaultValue={params.template} className={inputClass} aria-label="Template"><option value="">Qualquer template</option>{facets.templates.map((f) => <option key={f} value={f}>{f}</option>)}</select>
            <select name="qa" defaultValue={params.qa} className={inputClass} aria-label="QA"><option value="">Qualquer QA</option>{Object.entries(QA_OUTCOME).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
            <select name="deployment" defaultValue={params.deployment} className={inputClass} aria-label="Deployment"><option value="">Qualquer deployment</option>{Object.keys(DEPLOY_STATE).map((k) => <option key={k} value={k}>{DEPLOY_STATE[k]!.label}</option>)}</select>
            <select name="editorial" defaultValue={params.editorial} className={inputClass} aria-label="Editorial"><option value="">Qualquer editorial</option><option value="agent7">Narrativa do Agente 7</option><option value="template">Texto determinístico</option></select>
            <Button type="submit" size="sm">Filtrar</Button>
          </form>
          <Panel title={`Páginas (${fmt(list.total)})`}>
            {list.rows.length === 0 ? <EmptyState title="Nenhuma página com esses filtros" hint="Ajuste os filtros. A lista só mostra o que o banco registrou." /> : (
              <div className="overflow-x-auto"><table className="w-full text-xs" data-testid="pages-table"><thead><tr className="text-left text-[11px] text-muted-foreground"><th className="py-1 pr-2"><span className="sr-only">Selecionar</span></th><th className="pr-3">Página</th><th className="pr-3">Estágio</th><th className="pr-3">Template</th><th className="pr-3">Blocos</th><th className="pr-3">Editorial</th><th className="pr-3">QA</th><th className="pr-3">Aprovação</th><th className="pr-3">Deployment</th><th className="pr-3">Versão</th><th>Atualizada</th></tr></thead>
                <tbody>{list.rows.map((r) => (
                  <tr key={r.opportunityId} className="border-t border-border align-top" data-page={r.opportunityId} data-stage={r.stage}>
                    <td className="py-1.5 pr-2"><input type="checkbox" name="id" value={r.opportunityId} form="decide-form" aria-label={`Selecionar ${r.title ?? r.primaryQuery}`} className="size-4" /></td>
                    <td className="max-w-[34ch] pr-3"><Link className="font-medium underline" href={`/engine/pages/${r.opportunityId}`}>{r.title ?? r.primaryQuery}</Link><div className="truncate text-[11px] text-muted-foreground">{r.url ?? "URL ainda não definida"} · {r.entity ?? "—"} · {r.family ?? "—"} · {r.intent ?? "—"}</div></td>
                    <td className="pr-3"><Badge tone={STAGE_TONE[r.stage] ?? "neutral"}>{STAGE_COPY[r.stage]}</Badge></td>
                    <td className="pr-3">{r.templateId ?? "—"}{r.blueprintStatus === "SEMANTIC_INSUFFICIENT" ? <div className="text-warning">blueprint insuficiente</div> : null}</td>
                    <td className="pr-3 tabular-nums">{r.blocksFilled === null ? "—" : <>{r.blocksFilled} preenchidos{r.blocksInsufficient ? <div className="text-muted-foreground">{r.blocksInsufficient} sem dado</div> : null}</>}</td>
                    <td className="pr-3">{r.editorial === "agent7" ? "Agente 7" : r.editorial === "template" ? "determinístico" : "—"}</td>
                    <td className="pr-3">{r.qaOutcome ? <Badge tone={QA_OUTCOME[r.qaOutcome]?.tone ?? "neutral"}>{QA_OUTCOME[r.qaOutcome]?.label ?? r.qaOutcome}</Badge> : "—"}</td>
                    <td className="pr-3">{r.approval ?? (r.recipeVersion ? "sem decisão" : "—")}</td>
                    <td className="pr-3">{r.deploymentStatus ? <><Badge tone={DEPLOY_STATE[r.deploymentStatus]?.tone ?? "neutral"}>{DEPLOY_STATE[r.deploymentStatus]?.label}</Badge><div className="text-muted-foreground">{r.deploymentTarget === "production" ? "produção" : "preview"}</div></> : "—"}</td>
                    <td className="pr-3 tabular-nums">{r.recipeVersion ? `v${r.recipeVersion}` : "—"}{r.publishedVersion ? <div className="text-muted-foreground">publicada v{r.publishedVersion}</div> : null}</td>
                    <td className="whitespace-nowrap">{when(r.updatedAt)}</td>
                  </tr>))}</tbody></table></div>
            )}
            <div className="mt-3 flex items-center gap-4 text-xs"><span className="text-muted-foreground">Página {params.page} de {Math.max(1, Math.ceil(list.total / pageSize))}</span>{params.page > 1 ? <Link className="underline" href={href({ page: params.page - 1 })}>← Anterior</Link> : null}{params.page * pageSize < list.total ? <Link className="underline" href={href({ page: params.page + 1 })}>Próxima →</Link> : null}</div>
          </Panel>
          <PageBatchForm />
        </>
      )}
    </Gate>
  );
}

// --- Detalhe de uma página -------------------------------------------------------------------------------------------------------------------------------------------------------------
export interface PreviewDocs { readonly clean: string; readonly annotated: string; readonly doc: factory.RenderedDocument }
export function PageDetailView({ loaded, preview, diff, versions }: { loaded: Loaded<PageDetail | null>; preview: PreviewDocs | null; diff: ReturnType<typeof F.diffRecipes> | null; versions: { a: number | null; b: number | null } }) {
  return (
    <Gate loaded={loaded} current="/engine/pages" title="Página" description="Preview real, dados usados, módulos, versões, QA, aprovação e publicação de uma página." crumbs={[{ label: "Páginas", href: "/engine/pages" }, { label: "Página" }]}>
      {(d) => d === null ? <Panel title="Página"><EmptyState title="Página não encontrada neste workspace" /></Panel> : <Detail d={d} preview={preview} diff={diff} versions={versions} />}
    </Gate>
  );
}
function Detail({ d, preview, diff, versions }: { d: PageDetail; preview: PreviewDocs | null; diff: ReturnType<typeof F.diffRecipes> | null; versions: { a: number | null; b: number | null } }) {
  const r = d.row; const rec = d.recipes[0] ?? null; const bp = d.view.blueprints[0] ?? null; const qa = d.view.qaReports[0] ?? null; const dec = d.view.decisions[0] ?? null;
  const journey: [string, string, boolean | null][] = [["Candidata", dec ? `decisão ${dec.decision}` : "sem decisão", true], ["Blueprint", bp ? `v${bp.version} ${bp.status}` : "—", bp ? bp.status === "COMPLETE" : null], ["Gerada", rec ? `recipe v${rec.version} (${rec.narrativeSource === "agent7" ? "Agente 7" : "determinístico"})` : "—", rec ? true : null], ["QA", qa ? qa.outcome : "—", qa ? qa.outcome === "QA_PASSED" : null], ["Aprovação", d.approvals[0]?.decision ?? "sem decisão", d.approvals[0] ? d.approvals[0].decision === "APPROVED" : null], ["Deployment", d.deployments[0] ? `${d.deployments[0].target}: ${d.deployments[0].status}` : "—", d.deployments[0] ? ["READY", "VERIFICATION_PENDING", "VERIFIED"].includes(d.deployments[0].status) : null], ["Verificação", d.deployments.find((x) => x.status === "VERIFIED") ? "VERIFIED" : "—", d.deployments.some((x) => x.status === "VERIFIED") ? true : null]];
  return (
    <>
      <Panel title={r.title ?? r.primaryQuery} description={`${r.url ?? "URL não definida"} · ${r.entity ?? "—"} · ${r.family ?? "—"} · intenção ${r.intent ?? "—"}`} action={<Badge tone={STAGE_TONE[r.stage] ?? "neutral"}>{STAGE_COPY[r.stage]}</Badge>}>
        <ol className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7" data-testid="journey">{journey.map(([l, v, ok]) => <li key={l} className="rounded-lg border border-border p-2" data-ok={ok === null ? "pending" : ok ? "yes" : "no"}><p className="text-[11px] text-muted-foreground">{l}</p><p className={`text-xs font-medium ${ok === true ? "text-success" : ok === false ? "text-destructive" : "text-muted-foreground"}`}>{v}</p></li>)}</ol>
        <p className="mt-2 text-[11px] text-muted-foreground">Estados distintos: aprovar não publica; deployment pronto não é verificado; publicada não é indexada (indexação não é instrumentada). Para rodar o pipeline desta página use <Link className="underline" href={`/engine/opportunities/${r.opportunityId}`}>a visão da oportunidade</Link>.</p>
      </Panel>
      {preview ? (
        <Panel title="Preview" description="HTML gerado pelo renderer único a partir do recipe compilado (o mesmo que o deployment envia). O iframe não executa scripts."><DevicePreview clean={preview.clean} annotated={preview.annotated} title={r.title ?? r.primaryQuery} /></Panel>
      ) : <Panel title="Preview"><EmptyState title="Sem recipe compilado" hint="O preview só existe depois do blueprint, da SERP (ou exceção humana) e da compilação do recipe." /></Panel>}
      {preview ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="SEO e metadados"><Dl items={[{ label: "Title", value: preview.doc.seo.title }, { label: "H1", value: preview.doc.seo.h1 }, { label: "Meta description", value: preview.doc.seo.metaDescription }, { label: "URL prevista", value: preview.doc.seo.url ?? "—" }, { label: "Canonical", value: preview.doc.seo.canonical ?? "—" }, { label: "Robots", value: preview.doc.seo.robots }, { label: "Blocos (preenchidos / sem dado)", value: `${preview.doc.stats.paragraphs} / ${preview.doc.stats.insufficiencies}` }, { label: "Texto do Agente 7", value: `${preview.doc.stats.textFromAgent7} bloco(s)` }]} /></Panel>
          <Panel title="Dados estruturados e links internos"><Pre v={preview.doc.jsonLd} label={`JSON-LD (${preview.doc.jsonLd.length} objeto(s))`} /><ul className="mt-2 space-y-1 text-xs">{preview.doc.links.length === 0 ? <li className="text-muted-foreground">Sem links internos (nenhum destino conhecido).</li> : preview.doc.links.map((l) => <li key={l.path}><code>{l.path}</code> — {l.text}</li>)}</ul></Panel>
        </div>
      ) : null}
      {preview ? (
        <Panel title="Módulos: por que entraram ou foram omitidos" description="O contrato do blueprint manda: o LLM não adiciona módulos fora dele.">
          <ul className="divide-y divide-border text-xs" data-testid="modules">{preview.doc.modules.map((m) => { const c = bp?.blueprint.data_contract.find((x) => x.module_id === m.moduleId); return <li key={m.moduleId} className="py-2 first:pt-0 last:pb-0" data-module={m.moduleId} data-render={m.render}><div className="flex flex-wrap items-center gap-2"><code className="font-medium">{m.moduleId}</code><Badge tone={m.render === "RENDERED" ? "success" : "warning"}>{m.render}</Badge><Badge tone="outline">dados {m.status}</Badge><span className="text-muted-foreground">{m.blocks} bloco(s)</span></div><p className="mt-1 text-muted-foreground">{m.why}.{c ? ` Exige: ${c.fields.join(", ")}.` : ""}</p></li>; })}</ul>
        </Panel>
      ) : null}
      {rec ? (
        <Panel title={`Dados utilizados (${rec.recipe.facts.length} fatos com origem)`} description="Cada fato citado no texto aponta para um fact_id gravado, com fonte e data de observação.">
          {rec.recipe.facts.length === 0 ? <EmptyState title="Sem fatos" /> : <div className="overflow-x-auto"><table className="w-full text-xs" data-testid="facts"><thead><tr className="text-left text-[11px] text-muted-foreground"><th className="py-1 pr-3">Atributo</th><th className="pr-3">Valor</th><th className="pr-3">Fonte</th><th className="pr-3">Observado em</th><th>fact_id</th></tr></thead><tbody>{rec.recipe.facts.map((f) => <tr key={f.factId} className="border-t border-border"><td className="py-1 pr-3">{f.attributeId}</td><td className="pr-3 tabular-nums">{String(f.value)}{f.unit ? ` ${f.unit}` : ""}</td><td className="pr-3">{f.sourceName}</td><td className="pr-3">{f.observedAt.slice(0, 10)}</td><td><code className="text-[10px]">{f.factId.slice(0, 8)}…</code></td></tr>)}</tbody></table></div>}
        </Panel>
      ) : null}
      {bp && rec ? (
        <Panel title="Blueprint × recipe × HTML" description="Os três níveis do mesmo artefato: o que a página deve ser, o que foi compilado e o que sai no navegador.">
          <div className="grid gap-3 lg:grid-cols-3"><Pre v={bp.blueprint} label={`Blueprint v${bp.version} (${bp.status})`} /><Pre v={rec.recipe} label={`Recipe v${rec.version}`} /><Pre v={preview?.clean ?? ""} label="HTML renderizado" /></div>
        </Panel>
      ) : null}
      <Panel title={`Versões (${d.recipes.length}) e comparação`} description="Cada versão é imutável. Compare duas versões do recipe: SEO e blocos.">
        {d.recipes.length < 2 ? <EmptyState title="Só há uma versão" hint="A comparação aparece quando houver duas versões do recipe." /> : (
          <div className="space-y-3">
            <p className="flex flex-wrap gap-2 text-xs">Versões: {d.recipes.map((x) => <span key={x.id} className="rounded border border-border px-1.5 py-0.5">v{x.version} · {x.narrativeSource === "agent7" ? "Agente 7" : "determinístico"} · {when(x.createdAt)}</span>)}</p>
            <p className="text-xs">Comparar: {d.recipes.slice(1).map((x) => <Link key={x.id} className="mr-3 underline" href={`/engine/pages/${r.opportunityId}?a=${x.version}&b=${d.recipes[0]!.version}#versoes`}>v{x.version} → v{d.recipes[0]!.version}</Link>)}</p>
            {diff && versions.a && versions.b ? <div data-testid="diff" id="versoes"><p className="text-xs font-medium">v{versions.a} → v{versions.b}</p>{diff.seo.length === 0 && diff.blocks.length === 0 ? <p className="text-xs text-muted-foreground">Sem diferenças de SEO ou de blocos.</p> : <ul className="space-y-2 text-xs">{diff.seo.map((x) => <li key={x.field}><strong>{x.field}:</strong> <del className="text-destructive">{x.before}</del> → <ins className="text-success no-underline">{x.after}</ins></li>)}{diff.blocks.map((x) => <li key={x.blockId} data-change={x.change}><strong>{x.blockId}</strong> <Badge tone={x.change === "added" ? "success" : x.change === "removed" ? "danger" : "warning"}>{x.change === "added" ? "adicionado" : x.change === "removed" ? "removido" : "alterado"}</Badge>{x.before !== null ? <div><del className="text-destructive">{x.before}</del>{x.sourceBefore ? <span className="text-muted-foreground"> ({x.sourceBefore})</span> : null}</div> : null}{x.after !== null ? <div><ins className="text-success no-underline">{x.after}</ins>{x.sourceAfter ? <span className="text-muted-foreground"> ({x.sourceAfter})</span> : null}</div> : null}</li>)}</ul>}</div> : null}
          </div>
        )}
      </Panel>
      <Panel title="QA e geração" description="Resultado de Q1–Q14 do relatório mais recente e o histórico de execuções do pipeline desta página.">
        {qa ? <ul className="grid gap-1 text-xs sm:grid-cols-2 lg:grid-cols-4" data-testid="qa">{Object.entries(qa.results).map(([k, c]) => <li key={k} data-qa={k} data-status={c.status}><Badge tone={c.status === "PASS" ? "success" : c.status === "FAIL" ? "danger" : "outline"}>{k}: {c.status === "PASS" ? "passou" : c.status === "FAIL" ? "reprovou" : "não rodou"}</Badge>{c.issues[0] ? <div className="text-[11px] text-muted-foreground">{c.issues[0].slice(0, 100)}</div> : null}</li>)}</ul> : <p className="text-xs text-muted-foreground">Sem relatório de QA.</p>}
        <ul className="mt-3 space-y-1 text-xs">{d.view.pipelines.map((p) => <li key={p.id} className="flex flex-wrap items-center gap-2"><Link className="underline" href={`/engine/pipelines/${p.id}`}>{when(p.createdAt)}</Link><Badge tone={PIPELINE_STATE[p.status]?.tone ?? "neutral"}>{PIPELINE_STATE[p.status]?.label ?? p.status}</Badge><span className="text-muted-foreground">{p.mode === "real" ? "real" : "simulação de teste"}</span></li>)}</ul>
      </Panel>
      <Panel title="Aprovação" description="Decisão humana sobre a versão mais recente do recipe. Aprovar NÃO publica.">
        <input type="hidden" name="id" value={r.opportunityId} form="decide-form" />
        <ul className="mb-3 space-y-1 text-xs">{d.approvals.length === 0 ? <li className="text-muted-foreground">Nenhuma decisão registrada.</li> : d.approvals.map((a) => <li key={a.id}><Badge tone={a.decision === "APPROVED" ? "success" : "warning"}>{a.decision}</Badge> {a.reason} <span className="text-muted-foreground">({a.actor}, {when(a.createdAt)})</span></li>)}</ul>
        <PageBatchForm />
      </Panel>
      <Panel title={`Deployments (${d.deployments.length})`}>{d.deployments.length === 0 ? <EmptyState title="Nunca foi enviada a um deployment" hint="Só páginas aprovadas entram no Deployment Center." /> : <ul className="space-y-1 text-xs">{d.deployments.map((x) => <li key={`${x.deploymentId}`} className="flex flex-wrap items-center gap-2"><Link className="underline" href={`/engine/deployments/${x.deploymentId}`}>{when(x.createdAt)}</Link><Badge tone={DEPLOY_STATE[x.status]?.tone ?? "neutral"}>{DEPLOY_STATE[x.status]?.label}</Badge><span>{x.target === "production" ? "produção" : "preview"} · recipe v{x.recipeVersion} · {x.path}{x.httpStatus ? ` · HTTP ${x.httpStatus}` : ""}</span></li>)}</ul>}</Panel>
      <AutoRefresh active={d.view.pipelines.some((p) => p.status === "RUNNING")} />
    </>
  );
}
