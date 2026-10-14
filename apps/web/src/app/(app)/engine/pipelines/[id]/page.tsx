import type { Metadata } from "next";
import { Suspense } from "react";
import { PipelineRunDetailView } from "@/components/engine/engine-views";
import { loadPipelineRun } from "@/lib/server/engine-runtime";

export const metadata: Metadata = { title: "Execução do pipeline" };
async function Content({ params }: { params: Promise<{ id: string }> }) { return <PipelineRunDetailView loaded={await loadPipelineRun((await params).id)} />; }
export default function Page(props: PageProps<"/engine/pipelines/[id]">) { return <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}><Content params={props.params} /></Suspense>; }
