import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoFallbackNotice } from "@/components/opportunities/demo-notice";
import { OpportunitiesView } from "@/components/opportunities/opportunities-view";
import { RealOpportunitiesView } from "@/components/opportunities/real-opportunities-view";
import { loadOpportunityList } from "@/lib/server/opportunities";

export const metadata: Metadata = { title: "Opportunities" };

// ADR-024: com login e banco configurados a tela lê as oportunidades REAIS e nunca cai para a demonstração (cada falha é um estado
// explícito). A demonstração só aparece quando o ambiente não tem nenhum dos dois, com um aviso visível.
async function Content() {
  const loaded = await loadOpportunityList();
  if (loaded.state === "not_configured") {
    return (
      <div className="space-y-6">
        <DemoFallbackNotice missing={loaded.missing} />
        <OpportunitiesView />
      </div>
    );
  }
  return <RealOpportunitiesView loaded={loaded} />;
}

export default function OpportunitiesPage() {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground">Carregando oportunidades…</p>}>
      <Content />
    </Suspense>
  );
}
