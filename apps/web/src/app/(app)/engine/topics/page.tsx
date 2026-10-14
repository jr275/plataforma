import type { Metadata } from "next";
import { Suspense } from "react";
import { TopicDiscoveryView } from "@/components/engine/engine-views";
import { loadTopicDiscovery } from "@/lib/server/engine-runtime";

export const metadata: Metadata = { title: "Descoberta de tópicos" };
async function Content() { return <TopicDiscoveryView loaded={await loadTopicDiscovery()} />; }
export default function Page() { return <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}><Content /></Suspense>; }
