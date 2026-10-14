import type { Metadata } from "next";
import { Suspense } from "react";
import { OpportunitiesHomeView } from "@/components/opportunities/opportunities-home-view";
import { OPPORTUNITY_PAGE_SIZE, loadOpportunities, parseOpportunityParams } from "@/lib/server/opportunities";
import { activeVertical, verticalMeta } from "@/lib/server/vertical";

export const metadata: Metadata = { title: "Oportunidades" };

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = parseOpportunityParams(await searchParams);
  return <OpportunitiesHomeView loaded={await loadOpportunities(params)} params={params} pageSize={OPPORTUNITY_PAGE_SIZE} intents={activeVertical.intents.map((i) => ({ id: i.id, label: i.label }))} vertical={verticalMeta} />;
}

export default function Page(props: PageProps<"/opportunities">) {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}
