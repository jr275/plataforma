import type { Metadata } from "next";
import { Suspense } from "react";
import { GscIntegrationView } from "@/components/integrations/gsc-integration-view";
import { IntegrationAccessDenied } from "@/components/integrations/access-denied";
import { gscConfigurationReport, integrationAccess, otherProviders } from "@/lib/server/gsc";

export const metadata: Metadata = { title: "Integrações", description: "Estado, diagnóstico e correção das conexões com provedores de dados de busca." };

async function Content() {
  const access = await integrationAccess();
  if (!access.ok) return <IntegrationAccessDenied reason={access.reason} />;
  return <GscIntegrationView initial={gscConfigurationReport()} providers={otherProviders()} accessMode={access.mode} />;
}

export default function Page() {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando integrações…</p>}>
      <Content />
    </Suspense>
  );
}
