import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { OpportunityDetailView } from "@/components/opportunities/opportunity-detail-view";
import { devOpportunities } from "@/lib/dev-opportunity-fixture";
import { summarize } from "@/lib/server/opportunities";
import { activeVertical, verticalMeta } from "@/lib/server/vertical";

export const metadata: Metadata = { title: "Prévia de oportunidade (desenvolvimento)" };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  await connection();
  const { id } = await params;
  const { details, blueprints } = await devOpportunities();
  return <OpportunityDetailView loaded={{ state: "ready", data: { detail: details.get(id) ?? null, configs: [{ id: "00000000-0000-4000-8000-000000000600", version: 1, hash: "dev", config: activeVertical.scoring, note: "padrão da vertical", createdAt: new Date() }], blueprints: blueprints.get(id) ?? [], ...summarize(details.get(id) ?? null, blueprints.get(id) ?? []) }, origin: undefined }} intents={activeVertical.intents.map((i) => ({ id: i.id, label: i.label }))} stages={activeVertical.stages.map((s) => ({ id: s.id, label: s.label }))} experiences={activeVertical.experiences.map((x) => ({ id: x.id, label: x.label }))} vertical={verticalMeta} listBase="/dev/opportunities" />;
}

export default function Page(props: PageProps<"/dev/opportunities/[id]">) {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content params={props.params} />
    </Suspense>
  );
}
