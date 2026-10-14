import type { Metadata } from "next";
import { Suspense } from "react";
import { PipelineView } from "@/components/engine/factory-views";
import { loadStages } from "@/lib/server/factory";

export const metadata: Metadata = { title: "Pipeline de produção" };
async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { const s = (await searchParams).stage; return <PipelineView loaded={await loadStages()} selected={typeof s === "string" ? s : ""} />; }
export default function Page(props: PageProps<"/engine/pipeline">) { return <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}><Content searchParams={props.searchParams} /></Suspense>; }
