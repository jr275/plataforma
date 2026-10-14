import type { Metadata } from "next";
import { Suspense } from "react";
import { OutputInspectorView } from "@/components/engine/engine-views";
import { loadAgentRun } from "@/lib/server/engine-runtime";

export const metadata: Metadata = { title: "Inspetor de saída" };
async function Content({ params }: { params: Promise<{ id: string }> }) { return <OutputInspectorView loaded={await loadAgentRun((await params).id)} />; }
export default function Page(props: PageProps<"/engine/executions/[id]">) { return <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}><Content params={props.params} /></Suspense>; }
