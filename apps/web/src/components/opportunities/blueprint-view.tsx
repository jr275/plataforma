import Link from "next/link";
import { engine, type CityPreview } from "@plataforma/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Frame } from "@/components/ui/frame";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTabs } from "@/components/ui/section-tabs";
import { EmptyState, Panel } from "@/components/ui/panel";
import { TruthChip, truthOfBasis } from "@/components/ui/truth-chip";
import { PagePreview } from "@/components/generation/page-preview";
import { formatDateTime } from "@/components/generation/format";
import { StatePanel } from "@/components/generation/state-panel";
import type { BlueprintPageData } from "@/lib/server/opportunities";
import type { Loaded } from "@/lib/server/tenant-data";
import { BlueprintForm } from "./blueprint-form";
import { GATE_LABEL, OUTCOME } from "./blueprint-panel";
import { PageEditor, type EditorActions } from "./editor/page-editor";
import { GeneratePanel, type GenerateAction } from "./generate-panel";
import { SerpWaiverForm } from "./serp-waiver-form";
import { VerticalContext } from "./vertical-context";
import type { VerticalMeta } from "./opportunities-home-view";

/** Qual capacidade destrava cada verificação "não avaliada" (para a pessoa saber exatamente o que falta e de quem depende). */
const UNLOCK: Record<string, string> = { serp_analysis: "serp-provider", intent_format: "serp-provider", search_demand: "search-demand", ai_citation_monitoring: "ai-citations", indexability: "publication" };
const cap = (id: string) => engine.CAPABILITIES.find((c) => c.id === id);

export function BlueprintView({ loaded, vertical, editorActions, generate, harness, listBase = "/opportunities" }: { loaded: Loaded<BlueprintPageData>; vertical: VerticalMeta; editorActions: EditorActions; generate?: GenerateAction; harness?: "dev"; listBase?: string }) {
  if (loaded.state !== "ready") return <div className="space-y-6"><PageHeader crumbs={[{ label: "Oportunidades", href: listBase }, { label: "Blueprint" }]} title="Blueprint" /><StatePanel state={loaded.state} missing={loaded.state === "not_configured" ? loaded.missing : undefined} /></div>;
  const { detail: o, blueprints, preview, serpWaiver, editor } = loaded.data;
  const pages = loaded.data.pages ?? { rows: [] };
  if (!o) return <div className="space-y-6"><PageHeader crumbs={[{ label: "Oportunidades", href: listBase }, { label: "Não encontrada" }]} title="Oportunidade não encontrada" /><Panel title="Estado"><EmptyState title="Não existe neste workspace" hint="O identificador pode estar errado ou pertencer a outro workspace." action={<Link href={listBase} className="text-xs underline underline-offset-2">Voltar para as oportunidades</Link>} /></Panel></div>;
  const back = `${listBase}/${o.id}`;
  const latest = blueprints[0];
  const header = <PageHeader crumbs={[{ label: "Oportunidades", href: listBase }, { label: o.primaryQuery, href: back }, { label: "Blueprint" }]} title="Blueprint da experiência" description={`Plano de página para “${o.primaryQuery}”, montado só com dados já gravados. Nada é publicado.`} badges={<VerticalContext {...vertical} />} />;
  const canCreate = ["eligible", "serp_analyzed", "blueprinted"].includes(o.status);
  if (!latest) return <div className="space-y-6">{header}<Panel title="Sem blueprint"><BlueprintForm opportunityId={o.id} enabled={canCreate} hasBlueprint={false} /><EmptyState title="Ainda não há blueprint" hint="Gere o blueprint para ver os requisitos, o template, as seções, os links e os seis gates." /></Panel></div>;
  const b = latest.blueprint;
  const allChecks = latest.report.gates.flatMap((g) => g.checks);
  const sectionsOk = b.sections.filter((s) => s.data === "available").length;
  const waiverNeeded = o.status === "eligible" && latest.ready;

  return (
    <div className="space-y-6">
      {header}
      <SectionTabs label="Seções do blueprint" items={[["fluxo", "Editor"], ["resumo", "Resumo"], ["serp", "Etapa SERP"], ["dados", "Dados"], ["template", "Template"], ["gates", "Seis gates"], ["previa", "Prévia"], ["pagina", "Rascunho gerado"], ["publicacao", "Publicação"]]} />

      <section id="fluxo">
        {"state" in editor ? (
          <PageEditor opportunityId={o.id} ctx={editor.state.ctx} base={editor.state.baseBlueprint} actions={editorActions} harness={harness}
            initial={{ draft: editor.state.draft, version: editor.state.saved?.version ?? 0, evaluation: { validation: editor.state.evaluation.validation, gates: editor.state.evaluation.gates }, versions: editor.state.versions }} />
        ) : (
          <Frame fig="3" caption="editor visual da experiência da página"><p role="note" className="text-sm text-muted-foreground">{editor.unavailable}</p></Frame>
        )}
      </section>

      <Panel title="Resumo" description={`Versão ${latest.version} de ${blueprints.length} · criada em ${formatDateTime(latest.createdAt)}`} action={<Badge tone={latest.ready ? "success" : "danger"}>{latest.ready ? "nenhum gate reprovou" : `${latest.report.blockers.length} bloqueio(s)`}</Badge>}>
        <div id="resumo" className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div><p className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">O que sei</p><ul className="mt-1 space-y-0.5 text-xs"><li>{b.experience.label} ({b.experience.status === "supported" ? "suportada" : "planejada"})</li><li>{sectionsOk} de {b.sections.length} seção(ões) com dados completos</li><li>{b.requirements.filter((r) => r.satisfied).length} de {b.requirements.length} requisito(s) de evidência atendido(s)</li></ul></div>
          <div><p className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">O que falta</p><ul className="mt-1 space-y-0.5 text-xs">{latest.report.blockers.length === 0 && allChecks.every((c) => c.outcome !== "not_evaluated") ? <li>Nada.</li> : null}{latest.report.blockers.map((x, i) => (<li key={i} className="text-destructive">{x.detail}</li>))}{waiverNeeded ? <li>Etapa SERP pendente: analisar com um provedor ou registrar a exceção escrita.</li> : null}<li className="text-muted-foreground">{allChecks.filter((c) => c.outcome === "not_evaluated").length} verificação(ões) sem fonte (não avaliadas)</li></ul></div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3"><BlueprintForm opportunityId={o.id} enabled={canCreate} hasBlueprint /></div>
      </Panel>

      <section id="serp"><Panel title="Etapa SERP" description="A SERP não pode ser analisada hoje: não há provedor contratado. Nada foi fabricado.">
        <div className="space-y-3 text-sm">
          <p className="flex items-center gap-2"><TruthChip state="not_evaluated" /> <span>Análise de SERP, concorrência e demanda: {cap("serp-provider")?.state === "awaiting_decision" ? engine.CAPABILITY_STATE_LABEL["awaiting_decision"].toLowerCase() : "pendente"}.</span></p>
          {serpWaiver ? (
            <div role="note" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
              <p><strong>Exceção registrada</strong> em {formatDateTime(serpWaiver.at)} por {serpWaiver.actor.slice(0, 8)} (blueprint v{serpWaiver.blueprintVersion ?? "?"}): {serpWaiver.reason}</p>
              <p className="mt-1">{serpWaiver.reviewed ? "Revisada: a oportunidade passou depois por “SERP analisada”." : "Pendente de revisão. Não autoriza publicação. Quando houver um provedor de SERP, a oportunidade deve voltar a “SERP analisada” e a exceção ser encerrada."}</p>
            </div>
          ) : waiverNeeded ? (
            <>
              <p className="text-xs text-muted-foreground">O blueprint está pronto, mas a oportunidade só avança sem a SERP por uma <strong>exceção escrita</strong>. Ela é revisável e não autoriza publicação.</p>
              <SerpWaiverForm opportunityId={o.id} enabled />
            </>
          ) : (
            <SerpWaiverForm opportunityId={o.id} enabled={false} why={o.status !== "eligible" ? "A exceção só vale para oportunidades no estado “Elegível”." : "O blueprint mais recente tem gates reprovados: a exceção de SERP não resolve bloqueios."} />
          )}
        </div>
      </Panel></section>

      <section id="dados"><Panel title="Dados, entidade e evidência" description="Requisitos que a vertical exige para este padrão e o que existe para cumpri-los.">
        <div className="space-y-4">
          <div className="text-sm">{b.entity ? <p>Entidade: <Link href={`/cities/${b.entity.id}`} className="underline underline-offset-2">{b.entity.name}{b.entity.qualifier ? ` (${b.entity.qualifier})` : ""}</Link> <TruthChip state={b.factsProvenance ? "live" : "unavailable"} /> <span className="text-xs text-muted-foreground">{b.factsProvenance ? "fatos de uma importação registrada" : "sem fatos com origem registrada"}</span></p> : <p className="text-muted-foreground">Tema geral: a oportunidade não tem entidade.</p>}</div>
          <table className="w-full text-left text-xs"><caption className="sr-only">Requisitos de evidência</caption>
            <thead className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase"><tr><th scope="col" className="py-1.5 pr-3">Requisito</th><th scope="col" className="pr-3">Peso</th><th scope="col" className="pr-3">Situação</th><th scope="col">Detalhe</th></tr></thead>
            <tbody>{b.requirements.map((r) => (<tr key={r.id} className="border-t border-border"><td className="py-1.5 pr-3 font-medium">{r.label}</td><td className="pr-3">{r.weight === "critical" ? "crítico" : r.weight === "important" ? "importante" : "opcional"}</td><td className="pr-3">{r.satisfied ? <TruthChip state="live">atendido</TruthChip> : <TruthChip state="blocked">ausente</TruthChip>}</td><td className="text-muted-foreground">{r.satisfied ? `por ${r.by}` : r.note}</td></tr>))}</tbody></table>
          <div><h3 className="mb-1 text-[13px] font-medium">Evidências ligadas à oportunidade ({o.evidence.length})</h3>
            {o.evidence.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma evidência coletada tocou este tema. Isso não é evidência negativa.</p> : <ul className="space-y-1 text-xs">{o.evidence.slice(0, 8).map((e) => (<li key={`${e.evidenceId}-${e.role}`}><TruthChip state={truthOfBasis(e.evidence.basis)} /> <a href={e.evidence.url} target="_blank" rel="noopener noreferrer" className="ml-1 underline underline-offset-2">{e.evidence.title}</a> <span className="text-muted-foreground">· {e.evidence.adapter} · coletado em {formatDateTime(e.evidence.collectedAt)}</span></li>))}</ul>}
          </div>
        </div>
      </Panel></section>

      <section id="template"><Panel title="Template, seções, links internos e indexação">
        <div className="space-y-4 text-sm">
          <p><TruthChip state={b.template.status === "selected" ? "live" : "blocked"}>{b.template.status === "selected" ? `${b.template.key} v${b.template.version}` : "sem template"}</TruthChip> <span className="ml-1 text-xs text-muted-foreground">{b.template.reason}</span></p>
          {b.sections.length > 0 ? <table className="w-full text-left text-xs"><caption className="sr-only">Seções planejadas</caption><thead className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase"><tr><th scope="col" className="py-1.5 pr-3">Seção</th><th scope="col" className="pr-3">Dados</th><th scope="col">Fatos exigidos</th></tr></thead><tbody>{b.sections.map((s) => (<tr key={s.id} className="border-t border-border"><td className="py-1.5 pr-3 font-medium">{s.label}</td><td className="pr-3">{s.data === "available" ? <TruthChip state="derived">completos</TruthChip> : s.data === "partial" ? <TruthChip state="estimated">parciais</TruthChip> : <TruthChip state="unavailable">sem dados</TruthChip>}</td><td className="font-mono text-[10.5px] text-muted-foreground">{s.requires.join(", ")}{s.missingFacts.length ? ` — faltam: ${s.missingFacts.join(", ")}` : ""}</td></tr>))}</tbody></table> : <p className="text-xs text-muted-foreground">Sem template, não há seções a planejar. Nenhuma foi inventada.</p>}
          <dl className="grid gap-x-8 gap-y-2 text-xs sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Caminho proposto</dt><dd className="font-mono">{b.path.proposed ?? "—"}{b.path.conflict ? " (já usado por outra entidade)" : ""}</dd></div>
            <div><dt className="text-muted-foreground">Indexação</dt><dd>noindex até a publicação autorizada (regra 5)</dd></div>
            <div><dt className="text-muted-foreground">Dados estruturados (proposta; nada é emitido)</dt><dd>{b.structuredData.join(", ") || "—"}</dd></div>
            <div><dt className="text-muted-foreground">Resposta direta (GEO)</dt><dd>{b.answerFirst.reason}</dd></div>
          </dl>
          <div><h3 className="mb-1 text-[13px] font-medium">Links internos propostos</h3>{b.internalLinks.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum.</p> : <ul className="space-y-0.5 text-xs">{b.internalLinks.map((l) => (<li key={l.path}><span className="font-mono">{l.path}</span> — {l.text} {l.resolves ? <TruthChip state="live">existe</TruthChip> : <TruthChip state="unavailable">destino ainda não existe</TruthChip>}</li>))}</ul>}</div>
        </div>
      </Panel></section>

      <section id="gates"><Frame fig="2" caption="seis gates independentes, sem nota composta">
        <p className="mb-3 text-xs text-muted-foreground">Cada gate grava o próprio resultado. Não avaliado não é aprovação.</p>
        <div className="space-y-4">
          {latest.report.gates.map((g) => (
            <div key={g.gate} className="rounded-lg border border-border" data-gate={g.gate} data-outcome={g.outcome}>
              <div className="flex items-center justify-between border-b border-border px-3 py-2"><h3 className="text-sm font-medium">{GATE_LABEL[g.gate]}</h3><Badge tone={OUTCOME[g.outcome].tone}>{OUTCOME[g.outcome].label}</Badge></div>
              <table className="w-full text-left text-xs"><caption className="sr-only">Verificações do gate {GATE_LABEL[g.gate]}</caption>
                <tbody>{g.checks.map((c) => {
                  const unlock = c.outcome === "not_evaluated" ? cap(UNLOCK[c.code] ?? "") : undefined;
                  return (<tr key={c.code} className="border-t border-border first:border-t-0 align-top"><td className="w-24 px-3 py-2"><Badge tone={OUTCOME[c.outcome].tone}>{OUTCOME[c.outcome].label}</Badge></td><td className="py-2 pr-3">{c.detail}{unlock ? <span className="mt-0.5 block text-muted-foreground">Depende de: {unlock.label} — {engine.CAPABILITY_STATE_LABEL[unlock.state].toLowerCase()}.</span> : null}</td></tr>);
                })}</tbody></table>
            </div>
          ))}
        </div>
      </Frame></section>

      <section id="previa"><Panel title="Prévia da experiência" description="Renderizada agora pelo motor real de páginas, com os fatos reais da entidade. Não é gravada nem publicada.">
        {preview?.page ? <PreviewBlock preview={preview} /> : <EmptyState title="Sem prévia" hint={b.template.status === "selected" ? "O motor de páginas não renderizou a página (veja os gates da geração abaixo)." : "Não há template para esta experiência: nenhuma página pode ser pré-visualizada. Nada foi simulado."} />}
        {preview && !preview.page ? <ul className="mt-3 text-xs">{preview.gates.map((g) => (<li key={g.gate}>{g.gate}: {g.outcome}{g.outcome === "fail" ? ` — ${g.detail}` : ""}</li>))}</ul> : null}
      </Panel></section>

      <section id="pagina"><Panel title="Rascunho da página" description="O blueprint (e o rascunho salvo no editor) alimentam o pipeline de geração existente. O resultado são os seis gates da página; o ciclo de vida avança no máximo até QA.">
        <GeneratePanel opportunityId={o.id} enabled={latest.ready && ["blueprinted", "data_assembled", "evidence_validated", "experience_built", "qa"].includes(o.status)} why={!latest.ready ? "O blueprint mais recente tem gates reprovados." : "A oportunidade precisa estar em “Com blueprint” ou além. Em “Elegível”, registre a exceção de SERP (ou analise a SERP) antes."} pages={pages} generate={generate} linkBase={harness === "dev" ? undefined : "/generation/pages"} />
      </Panel></section>

      <section id="publicacao"><Panel title="Decisão de publicação" description="Esta tela não publica. Aqui está o que decidiria a publicação e em que estado cada condição está.">
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2">{latest.ready ? <TruthChip state="derived">ok</TruthChip> : <TruthChip state="blocked">pendente</TruthChip>} Blueprint pronto: nenhum gate reprovou</li>
          <li className="flex items-center gap-2">{preview?.page ? <TruthChip state="derived">ok</TruthChip> : <TruthChip state="blocked">pendente</TruthChip>} Prévia renderizada sem erro</li>
          <li className="flex items-center gap-2">{serpWaiver ? (serpWaiver.reviewed ? <TruthChip state="live">revisada</TruthChip> : <TruthChip state="estimated">exceção vigente</TruthChip>) : o.status === "serp_analyzed" ? <TruthChip state="live">analisada</TruthChip> : <TruthChip state="not_evaluated" />} Etapa SERP {serpWaiver && !serpWaiver.reviewed ? "(exceção pendente de revisão)" : ""}</li>
          <li className="flex items-center gap-2"><TruthChip state="blocked">blocked</TruthChip> Mecanismo de publicação: {cap("publication")?.detail}</li>
          <li className="flex items-center gap-2"><TruthChip state="unavailable" /> Saúde do índice do domínio ≥ 95% (regra 9): sem Search Console, não há como medir</li>
        </ul>
        <div className="mt-4"><Button type="button" disabled title="Não existe mecanismo de publicação (decisão do dono)">Publicar (indisponível)</Button></div>
        <p className="mt-2 text-xs text-muted-foreground">O botão está desabilitado de propósito: nenhuma condição acima autoriza publicar. A exceção de SERP, mesmo registrada, nunca equivale a autorização.</p>
      </Panel></section>
    </div>
  );
}

function PreviewBlock({ preview }: { preview: CityPreview }) {
  return <PagePreview page={preview.page!} />;
}
