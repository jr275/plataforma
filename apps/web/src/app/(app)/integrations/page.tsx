import type { Metadata } from "next";
import { Suspense } from "react";
import { IntegrationsView } from "@/components/integrations/integrations-view";
import { loadIntegrations } from "@/lib/server/integrations";

export const metadata: Metadata = { title: "Integrations" };

async function Content() {
  return <IntegrationsView entries={await loadIntegrations()} />;
}

export default function Page() {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content />
    </Suspense>
  );
}
