import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentRegistryView } from "@/components/engine/engine-views";
import { loadAgentRegistry } from "@/lib/server/engine-runtime";

export const metadata: Metadata = { title: "Registro de agentes" };
async function Content() { return <AgentRegistryView loaded={await loadAgentRegistry()} />; }
export default function Page() { return <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}><Content /></Suspense>; }
