import Link from "next/link";
import { CircleAlert, Lock } from "lucide-react";
import { FACT_LABELS, describeOmissions, reviewFacts, type PageDetail } from "@plataforma/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import type { Loaded } from "@/lib/server/tenant-data";
import { GatesPanel } from "./gates-panel";
import { PAGE_STATUS, formatDateTime, formatInt } from "./format";
import { PagePreview } from "./page-preview";
import { ReprocessForm } from "./reprocess-form";
import { SerpSnippet } from "./serp-snippet";
import { StatePanel } from "./state-panel";

export interface PageDetailData { detail: PageDetail | undefined; now: Date }

export function PageDetailView({ loaded, version, invalidVersion = false }: { loaded: Loaded<PageDetailData>; version?: number; /** O `?v=` da URL está presente e não é um inteiro positivo válido (ver parseVersionParam). */ invalidVersion?: boolean }) {
  const crumbs = [{ label: "Geração de páginas", href: "/generation" }, { label: "Página" }];
  if (loaded.state !== "ready") return <div className="space-y-6"><PageHeader crumbs={crumbs} title="Página" /><StatePanel state={loaded.state} missing={loaded.state === "not_configured" ? loaded.missing : undefined} /></div>;
  const { detail, now } = loaded.data;
  if (!detail) return <div className="space-y-6"><PageHeader crumbs={crumbs} title="Página não encontrada" /><Panel title="Estado"><EmptyState title="Esta página não existe neste workspace" action={<Link href="/generation" className="text-xs underline underline-offset-2">Voltar à lista</Link>} /></Panel></div>;

  const { page, versions, latestAttempt } = detail;
  const latest = versions[0];
  const shown = versions.find((v) => v.version === version) ?? latest;
  const missingVersion = version !== undefined && !versions.some((v) => v.version === version) && latest !== undefined;
  const isOld = shown !== undefined && latest !== undefined && shown.version !== latest.version;
  const failed = latestAttempt?.gates.filter((g) => g.outcome === "fail") ?? [];
  const omissions = shown ? describeOmissions(shown.content) : [];
  const review = shown ? reviewFacts(shown.content, now) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Geração de páginas", href: "/generation" }, { label: page.cityName }]}
        title={`${page.cityName}, ${page.uf}`}
        description={`${page.path} · versão ${page.latestVersion} · atualizada em ${formatDateTime(page.updatedAt)}`}
        badges={<><Badge tone={PAGE_STATUS[page.status].tone}>{PAGE_STATUS[page.status].label}</Badge><Badge tone="outline">Não publicada</Badge></>}
        actions={
          <div className="flex flex-col items-start gap-3 sm:flex-row">
            <ReprocessForm pageId={page.id} />
            <div className="flex max-w-xs flex-col items-start gap-1.5">
              <Button type="button" disabled aria-disabled="true" aria-describedby="approve-why"><Lock data-icon="inline-start" aria-hidden="true" />Aprovar e publicar</Button>
              <p id="approve-why" className="text-xs text-muted-foreground">Indisponível: a publicação (etapa 5) ainda não existe. A página permanece em rascunho.</p>
            </div>
          </div>
        }
      />

      {page.status === "blocked" ? (
        <div role="alert" className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <div><p className="font-medium text-destructive">Esta página está bloqueada na última tentativa.</p>
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{failed.map((g) => (<li key={g.gate}><strong className="text-foreground">{g.gate}:</strong> {g.detail}</li>))}</ul>
            <p className="mt-1 text-xs text-muted-foreground">A última versão aprovada continua abaixo. Corrija o dado de origem e reprocesse.</p></div>
        </div>
      ) : null}

      {invalidVersion && latest ? (
        <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm">{`O parâmetro de versão da URL é inválido (use um número inteiro positivo); mostrando a mais recente (versão ${latest.version}).`}</p>
      ) : null}

      {missingVersion && latest ? (
        <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm">{`A versão ${version} não existe para esta página; mostrando a mais recente (versão ${latest.version}).`}</p>
      ) : null}

      {isOld && shown ? (
        <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm">Você está vendo a <strong>versão {shown.version}</strong>, que não é a mais recente. <Link href={`/generation/pages/${page.id}`} className="underline underline-offset-2">Ver a versão {latest?.version}</Link></p>
      ) : null}

      {!shown ? (
        <Panel title="Pré-visualização"><EmptyState title="Esta página ainda não tem versão aprovada" hint="Ela nasceu bloqueada e nenhum conteúdo passou pelos gates." /></Panel>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <PagePreview page={shown.content} />
          <div className="space-y-6">
            <SerpSnippet page={shown.content} />
            {latestAttempt ? <GatesPanel gates={latestAttempt.gates} description={`Tentativa de ${formatDateTime(latestAttempt.startedAt)}. ${latestAttempt.outcome === "unchanged" ? "Conteúdo idêntico ao anterior." : ""}`.trim()} /> : null}
            <Panel title="Fatos e fontes" description="Todo número do texto vem de um destes fatos.">
              <ul className="divide-y divide-border text-sm">
                {shown.content.factsUsed.map((f) => {
                  const r = review.find((x) => x.factId === f.id);
                  return (
                    <li key={f.id} className="py-2 first:pt-0 last:pb-0">
                      <div className="flex items-baseline justify-between gap-3"><span className="text-muted-foreground">{FACT_LABELS[f.key]}</span><span className="font-medium">{f.key === "population" ? formatInt(f.value as number) : String(f.value)}</span></div>
                      <p className="text-xs text-muted-foreground">{f.source.name} · coletado em {f.source.collectedAt}{f.asOf !== undefined && f.key !== "population_year" ? ` · referência ${f.asOf}` : ""}{r?.review ? <Badge tone="warning" className="ml-2">Revisar: {r.ageDays} dias</Badge> : null}</p>
                    </li>
                  );
                })}
              </ul>
            </Panel>
            <Panel title="Fatos ausentes" description="O que o template prevê e a página não tem, por falta de dado.">
              {omissions.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum: todos os fatos previstos estão presentes.</p> : (
                <ul className="space-y-2 text-sm">{omissions.map((o) => (<li key={o.sectionId}><Badge tone="warning">{o.wholeSection ? "Seção omitida" : "Parágrafo omitido"}</Badge> <strong>{o.heading}</strong><span className="text-muted-foreground"> — faltam: {o.missing.map((k) => FACT_LABELS[k]).join(", ")}</span></li>))}</ul>
              )}
            </Panel>
            <Panel title="Dados estruturados"><p className="text-sm text-muted-foreground">Não gerados. JSON-LD e sitemap fazem parte da publicação (etapa 5), que ainda não existe.</p></Panel>
            <Panel title="Campos editáveis"><p className="text-sm text-muted-foreground">Nenhum. O template <strong>city-overview</strong> monta o texto só a partir de fatos; para mudar o conteúdo, corrija o dado na fonte e reprocesse.</p></Panel>
            <Panel title="Versões" description="O histórico nunca é apagado.">
              <ol className="divide-y divide-border text-sm">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <div className="min-w-0"><p className="font-medium">Versão {v.version}{v.version === latest?.version ? <Badge tone="outline" className="ml-2">mais recente</Badge> : null}</p><p className="font-mono text-[11px] text-muted-foreground">{v.contentHash.slice(0, 12)} · {formatDateTime(v.createdAt)}</p></div>
                    {shown.version === v.version ? <span className="text-xs text-muted-foreground" aria-current="true">em exibição</span> : <Link href={`/generation/pages/${page.id}?v=${v.version}`} className="text-xs underline underline-offset-2">Ver</Link>}
                  </li>
                ))}
              </ol>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
