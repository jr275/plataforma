import Link from "next/link";
import { Waypoints } from "lucide-react";
import type { CityDetail } from "@plataforma/api";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import { PAGE_STATUS, formatDateTime, formatInt } from "@/components/generation/format";
import { StatePanel } from "@/components/generation/state-panel";
import type { Loaded } from "@/lib/server/tenant-data";
import { ORIGIN } from "./cities-home-view";

export interface CityDetailData { detail: CityDetail | undefined }
const OUTCOME = { accepted: { label: "Aceita", tone: "success" }, rejected: { label: "Rejeitada", tone: "danger" }, duplicate: { label: "Duplicada", tone: "warning" } } as const;
const NA = "não informado";

export function CityDetailView({ loaded }: { loaded: Loaded<CityDetailData> }) {
  const crumbs = [{ label: "Cidades", href: "/cities" }, { label: "Cidade" }];
  if (loaded.state !== "ready") return <div className="space-y-6"><PageHeader crumbs={crumbs} title="Cidade" /><StatePanel state={loaded.state} missing={loaded.state === "not_configured" ? loaded.missing : undefined} /></div>;
  const { detail } = loaded.data;
  if (!detail) return <div className="space-y-6"><PageHeader crumbs={crumbs} title="Cidade não encontrada" /><Panel title="Estado"><EmptyState title="Esta cidade não existe neste workspace" action={<Link href="/cities" className="text-xs underline underline-offset-2">Voltar à lista</Link>} /></Panel></div>;

  const { city, source, record, page, relations } = detail;
  const origin = ORIGIN[source.origin];
  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Cidades", href: "/cities" }, { label: city.name }]}
        title={`${city.name}, ${city.uf}`}
        description={`Código IBGE ${city.ibgeCode} · importada de ${source.sourceName}`}
        badges={<Badge tone={origin.tone}>{origin.label}</Badge>}
        actions={<Link href={`/graph?node=city:${city.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"><Waypoints className="size-4" aria-hidden="true" />Explorar no grafo</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Atributos" description="Valores como foram recebidos e validados na importação.">
          <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Nome</dt><dd>{city.name}</dd>
            <dt className="text-muted-foreground">Código IBGE</dt><dd className="font-mono text-xs">{city.ibgeCode}</dd>
            <dt className="text-muted-foreground">UF</dt><dd>{city.uf}</dd>
            <dt className="text-muted-foreground">Região</dt><dd>{city.region ?? NA}</dd>
            <dt className="text-muted-foreground">População</dt><dd className="tabular-nums">{city.population === null ? NA : formatInt(city.population)}</dd>
            <dt className="text-muted-foreground">Ano da estimativa</dt><dd>{city.populationYear ?? NA}</dd>
          </dl>
        </Panel>
        <Panel title="Origem dos dados" description="A execução de importação que gravou esta cidade.">
          <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Fonte</dt><dd>{source.sourceName} <Badge tone={origin.tone} className="ml-1">{origin.label}</Badge></dd>
            <dt className="text-muted-foreground">Arquivo</dt><dd className="font-mono text-xs break-all">{source.fileName}</dd>
            <dt className="text-muted-foreground">SHA-256</dt><dd className="font-mono text-[11px] break-all">{source.fileSha256}</dd>
            <dt className="text-muted-foreground">Importada em</dt><dd>{formatDateTime(source.startedAt)}{source.finishedAt ? ` a ${formatDateTime(source.finishedAt)}` : ""}</dd>
            <dt className="text-muted-foreground">Linhas</dt><dd className="tabular-nums">{formatInt(source.acceptedRows)} aceitas de {formatInt(source.totalRows)}</dd>
          </dl>
          <p className="mt-3 text-xs"><Link href={`/data-flow?run=${source.runId}`} className="underline underline-offset-2">Ver a execução completa em Fluxo de dados</Link></p>
        </Panel>
      </div>

      <Panel title="Registro original" description="A linha como veio no arquivo e o resultado da validação.">
        {record ? (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2"><span>linha {record.rowNumber}</span><Badge tone={OUTCOME[record.outcome].tone}>{OUTCOME[record.outcome].label}</Badge></p>
            <dl className="grid grid-cols-[9rem_1fr] gap-y-1.5 font-mono text-xs">
              {Object.entries(record.raw).map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="break-all">{v === "" ? "(vazio)" : v}</dd></div>))}
            </dl>
            {record.issues.length > 0 ? (<ul className="list-disc pl-5 text-xs">{record.issues.map((i, n) => (<li key={`${i.field}-${n}`}><strong>{i.field}:</strong> {i.message} <span className="text-muted-foreground">({i.severity === "error" ? "bloqueia" : "aviso"})</span></li>))}</ul>) : <p className="text-xs text-muted-foreground">Sem problemas registrados.</p>}
          </div>
        ) : <EmptyState title="A linha original desta cidade não foi encontrada" hint="O registro da importação não tem uma linha ligada a esta cidade. Nada foi inferido no lugar." />}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Página gerada" description="O rascunho criado a partir desta cidade (nada aqui está publicado).">
          {page ? (
            <div className="space-y-2 text-sm">
              <p className="flex items-center gap-2"><Link href={`/generation/pages/${page.id}`} className="font-mono text-xs underline underline-offset-2">{page.path}</Link><Badge tone={PAGE_STATUS[page.status].tone}>{PAGE_STATUS[page.status].label}</Badge></p>
              <p className="text-xs text-muted-foreground">versão {page.latestVersion} · atualizada em {formatDateTime(page.updatedAt)}</p>
            </div>
          ) : <EmptyState title="Nenhuma página gerada para esta cidade" hint="Use Geração de páginas para criar o rascunho." action={<Link href="/generation" className="text-xs underline underline-offset-2">Ir para Geração de páginas</Link>} />}
        </Panel>
        <Panel title="Relações" description="Relações derivadas só das colunas da fonte; nenhuma foi inferida.">
          <ul className="space-y-2 text-sm">
            <li>Pertence à UF <Link href={`/cities?uf=${relations.uf.code}`} className="underline underline-offset-2">{relations.uf.code}</Link> <span className="text-xs text-muted-foreground">({formatInt(relations.uf.cityCount)} cidades neste workspace)</span> <Link href={`/graph?node=uf:${relations.uf.code}`} className="text-xs underline underline-offset-2">no grafo</Link></li>
            {relations.region ? <li>Pertence à região {relations.region.name} <span className="text-xs text-muted-foreground">({formatInt(relations.region.cityCount)} cidades neste workspace)</span> <Link href={`/graph?node=region:${relations.region.name}`} className="text-xs underline underline-offset-2">no grafo</Link></li> : <li className="text-muted-foreground">Região: {NA}</li>}
            {page ? <li>Tem a página <Link href={`/generation/pages/${page.id}`} className="font-mono text-xs underline underline-offset-2">{page.path}</Link></li> : null}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
