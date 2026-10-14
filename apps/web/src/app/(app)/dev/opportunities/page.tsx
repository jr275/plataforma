import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { OpportunitiesHomeView } from "@/components/opportunities/opportunities-home-view";
import { devOpportunities } from "@/lib/dev-opportunity-fixture";
import { OPPORTUNITY_PAGE_SIZE, parseOpportunityParams } from "@/lib/server/opportunities";
import { activeVertical, verticalMeta } from "@/lib/server/vertical";

export const metadata: Metadata = { title: "Prévia de oportunidades (desenvolvimento)" };

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound(); // só existe em desenvolvimento
  await connection();
  const params = parseOpportunityParams(await searchParams);
  const { rows, runs, evidence } = await devOpportunities();
  const q = params.q.toLowerCase();
  const filtered = rows
    .filter((r) => (!q || r.primaryQuery.toLowerCase().includes(q)) && (!params.status || r.status === params.status) && (!params.intent || r.intent === params.intent) && (!params.eligible || r.eligible === (params.eligible === "yes")) && (!params.priorityKind || r.priorityKind === params.priorityKind))
    .sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1) || (a.id < b.id ? -1 : 1));
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const list = { total: filtered.length, rows: filtered.slice((params.page - 1) * OPPORTUNITY_PAGE_SIZE, params.page * OPPORTUNITY_PAGE_SIZE), byStatus };
  return <OpportunitiesHomeView loaded={{ state: "ready", data: { list, runs, evidenceCount: evidence.length }, origin: undefined }} params={params} pageSize={OPPORTUNITY_PAGE_SIZE} intents={activeVertical.intents.map((i) => ({ id: i.id, label: i.label }))} vertical={verticalMeta} detailBase="/dev/opportunities" basePath="/dev/opportunities" />;
}

export default function Page(props: PageProps<"/dev/opportunities">) {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}
