import type { Metadata } from "next";
import { Suspense } from "react";
import { BatchDetailView } from "@/components/engine/factory-views2";
import { loadBatch } from "@/lib/server/factory";

export const metadata: Metadata = { title: "Lote" };
async function Content({ params }: { params: Promise<{ id: string }> }) { return <BatchDetailView loaded={await loadBatch((await params).id)} />; }
export default function Page(props: PageProps<"/engine/batches/[id]">) { return <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}><Content params={props.params} /></Suspense>; }
