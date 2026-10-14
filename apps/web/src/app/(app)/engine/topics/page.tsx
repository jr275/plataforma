import type { Metadata } from "next";
import { Suspense } from "react";
import { ClustersPanel } from "@/components/engine/architecture-views";
import { TopicDiscoveryView } from "@/components/engine/engine-views";
import { Panel, EmptyState } from "@/components/ui/panel";
import { loadTopicDiscovery } from "@/lib/server/engine-runtime";
import { loadClusters } from "@/lib/server/factory";

export const metadata: Metadata = { title: "Descoberta de tópicos" };
async function Content() {
  const [topics, cl] = await Promise.all([loadTopicDiscovery(), loadClusters()]);
  const after = cl.state === "ready" ? <ClustersPanel clusters={cl.data.clusters} minInlinks={cl.data.linkPolicy.minInlinks} archetypes={cl.data.archetypes} /> : <Panel title="Clusters e archetypes"><EmptyState title="Clusters indisponíveis agora" hint="A arquitetura de conteúdo não pôde ser lida (banco indisponível ou migration 0021 não aplicada)." /></Panel>;
  return <TopicDiscoveryView loaded={topics} after={after} />;
}
export default function Page() { return <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}><Content /></Suspense>; }
