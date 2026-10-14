import type { Metadata } from "next";
import { Suspense } from "react";
import { EngineOpportunityView } from "@/components/engine/engine-views";
import { loadEngineOpportunity } from "@/lib/server/engine-runtime";

export const metadata: Metadata = { title: "Oportunidade no motor" };
async function Content({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <EngineOpportunityView loaded={await loadEngineOpportunity(id)} id={id} />; }
export default function Page(props: PageProps<"/engine/opportunities/[id]">) { return <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}><Content params={props.params} /></Suspense>; }
