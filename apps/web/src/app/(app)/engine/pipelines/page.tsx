import type { Metadata } from "next";
import { Suspense } from "react";
import { PipelineRunsView } from "@/components/engine/engine-views";
import { loadPipelineRuns } from "@/lib/server/engine-runtime";

export const metadata: Metadata = { title: "Pipelines" };
async function Content() { return <PipelineRunsView loaded={await loadPipelineRuns()} />; }
export default function Page() { return <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}><Content /></Suspense>; }
