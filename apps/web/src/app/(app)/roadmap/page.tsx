import type { Metadata } from "next";
import { Suspense } from "react";
import { RoadmapView } from "@/components/opportunities/roadmap-view";
import { loadRoadmapData } from "@/lib/server/opportunities";
import { activeVertical, verticalMeta } from "@/lib/server/vertical";

export const metadata: Metadata = { title: "Roadmap de oportunidades" };

async function Content() {
  return <RoadmapView loaded={await loadRoadmapData()} intents={activeVertical.intents.map((i) => ({ id: i.id, label: i.label }))} vertical={verticalMeta} />;
}

export default function Page() {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content />
    </Suspense>
  );
}
