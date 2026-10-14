import type { Metadata } from "next";
import { Suspense } from "react";
import { OpportunityDetailView } from "@/components/opportunities/opportunity-detail-view";
import { loadOpportunityDetail } from "@/lib/server/opportunities";
import { activeVertical, verticalMeta } from "@/lib/server/vertical";

export const metadata: Metadata = { title: "Oportunidade" };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OpportunityDetailView loaded={await loadOpportunityDetail(id)} intents={activeVertical.intents.map((i) => ({ id: i.id, label: i.label }))} stages={activeVertical.stages.map((s) => ({ id: s.id, label: s.label }))} experiences={activeVertical.experiences.map((x) => ({ id: x.id, label: x.label }))} vertical={verticalMeta} />;
}

export default function Page(props: PageProps<"/opportunities/[id]">) {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content params={props.params} />
    </Suspense>
  );
}
