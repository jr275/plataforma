import type { Metadata } from "next";
import { Suspense } from "react";
import { BatchesView } from "@/components/engine/factory-views2";
import { loadBatches } from "@/lib/server/factory";

export const metadata: Metadata = { title: "Geração em lote" };
async function Content() { return <BatchesView loaded={await loadBatches()} />; }
export default function Page() { return <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}><Content /></Suspense>; }
