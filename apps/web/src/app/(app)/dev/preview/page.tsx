import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { GenerationHomeView } from "@/components/generation/generation-home-view";
import { ReplayStarter } from "@/components/flow/replay-starter";
import { PageDetailView } from "@/components/generation/page-detail-view";
import { RunDetailView } from "@/components/generation/run-detail-view";
import { parseHomeParams } from "@/lib/server/generation";
import { buildDevDetail, buildDevRun, devListRows, topCities, type DevCase } from "@/lib/dev-fixture";

export const metadata: Metadata = { title: "Prévia de desenvolvimento" };

const CASES: { id: DevCase; label: string }[] = [{ id: "ok", label: "Página real (gates passam)" }, { id: "blocked", label: "Bloqueada (URL duplicada)" }, { id: "no-population", label: "Sem população (fato ausente)" }];

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound(); // só existe em desenvolvimento
  await connection(); // usa o relógio: só em tempo de requisição
  const sp = await searchParams;
  if (sp.view === "home") {
    const rows = devListRows();
    return (
      <div className="space-y-6">
        <div role="note" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-3 text-sm"><strong>Fixture de desenvolvimento.</strong> As 20 maiores populações de SP, avaliadas pelo motor e pelos gates reais; <strong>nada é persistido</strong>. As execuções aparecem vazias porque nenhuma foi gravada. Os links abrem a prévia de cada página.</div>
        <GenerationHomeView loaded={{ state: "ready", data: { pages: { rows, total: rows.length }, runs: [], drafts: rows.length, blocked: 0, now: new Date() }, origin: undefined }} params={parseHomeParams({})} pageSize={20} rowHref={(p) => `/dev/preview?city=${p.entityId.slice(-7)}`} />
      </div>
    );
  }
  if (sp.view === "run") {
    // REPLAY (fixture): os itens são "gravados" com o passar do tempo a partir de t0, que fica na URL. Não é uma execução real.
    const t0 = typeof sp.t0 === "string" && /^\d{10,15}$/.test(sp.t0) ? Number(sp.t0) : null;
    const now = new Date();
    const registered = t0 === null ? 1 : Math.min(20, 1 + Math.floor((now.getTime() - t0) / 1500));
    return (
      <div className="space-y-6">
        <div role="note" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-3 text-sm"><strong>Replay de fixture.</strong> As 20 maiores populações de SP passam pelo motor e pelos gates reais, um item a cada 1,5 s; três falham de propósito. <strong>Não é uma execução real</strong> e nada é persistido. <Link href="/dev/preview" className="underline underline-offset-2">Voltar para a página</Link> · <Link href="/dev/preview?view=run" className="underline underline-offset-2">Reiniciar o replay</Link></div>
        <ReplayStarter hasStart={t0 !== null} base="/dev/preview?view=run" />
        <RunDetailView loaded={{ state: "ready", data: buildDevRun(registered, new Date(t0 ?? now.getTime()), now), origin: undefined }} flowBanner="REPLAY · fixture, não é uma execução real" />
      </div>
    );
  }
  const code = typeof sp.city === "string" && /^\d{7}$/.test(sp.city) ? sp.city : "3550308";
  const kind: DevCase = sp.case === "blocked" || sp.case === "no-population" ? sp.case : "ok";
  const built = buildDevDetail(code, kind);
  if (!built) notFound();
  const cities = topCities(20);
  return (
    <div className="space-y-6">
      <div role="note" className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-3 text-sm">
        <p><strong>Fixture de desenvolvimento.</strong> Motor e gates reais aplicados ao extrato real do IBGE (SP, 2026-10-12); <strong>nada é persistido</strong> e esta rota não existe em produção. {built.note}</p>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">Caso: {CASES.map((c) => (<Link key={c.id} href={`/dev/preview?city=${code}&case=${c.id}`} className={c.id === kind ? "font-semibold underline" : "underline underline-offset-2"}>{c.label}</Link>))}</p>
        <p className="text-xs"><Link href="/dev/preview?view=run" className="underline underline-offset-2">Ver o replay de uma execução (fluxo vivo)</Link></p>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">Cidade: {cities.slice(0, 8).map((c) => (<Link key={c.code} href={`/dev/preview?city=${c.code}&case=${kind}`} className={c.code === code ? "font-semibold underline" : "underline underline-offset-2"}>{c.name}</Link>))}</p>
      </div>
      <PageDetailView loaded={{ state: "ready", data: { detail: built.detail, now: new Date() }, origin: undefined }} ogSrc={`/dev/preview/og?city=${code}&case=${kind}`} flowBanner="FIXTURE · motor e gates reais" />
    </div>
  );
}

export default function Page(props: PageProps<"/dev/preview">) {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}
