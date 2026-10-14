import type { Metadata } from "next";
import { Suspense } from "react";
import { IntelligenceOverview } from "@/components/overview/intelligence-overview";
import { loadRoadmapData, loadTrends } from "@/lib/server/opportunities";
import { verticalMeta } from "@/lib/server/vertical";
export const metadata: Metadata = { title: "Intelligence workspace" };
async function Content() { const [roadmap, trends] = await Promise.all([loadRoadmapData(), loadTrends({})]); return <IntelligenceOverview roadmap={roadmap} trends={trends} vertical={verticalMeta} />; }
export default function Home() { return <Suspense fallback={<p role="status" className="py-10 text-sm text-muted-foreground">Carregando o workspace…</p>}><Content /></Suspense>; }
