import type { Metadata } from "next";
import { Suspense } from "react";
import { EngineOverview } from "@/components/engine/engine-views";
import { loadAgentRegistry, progressItems } from "@/lib/server/engine-runtime";

export const metadata: Metadata = { title: "Andamento do motor" };
async function Content() { return <EngineOverview progress={progressItems()} registry={await loadAgentRegistry()} />; }
export default function Page() { return <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}><Content /></Suspense>; }
