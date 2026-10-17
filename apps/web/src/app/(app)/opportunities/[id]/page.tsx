import { DemoFallbackNotice } from "@/components/opportunities/demo-notice";
import { OpportunityDetail } from "@/components/opportunities/opportunity-detail";
import { RealOpportunityDetail } from "@/components/opportunities/real-opportunity-detail";
import { detailRoute } from "@/lib/detail-route";
import { loadOpportunityDetail } from "@/lib/server/opportunities";

// Mesmo critério da lista (ADR-036): real quando há login e banco; demonstração, com aviso, só quando o ambiente não tem nenhum dos dois.
async function Detail({ id }: { id: string }) {
  const loaded = await loadOpportunityDetail(id);
  if (loaded.state === "not_configured") {
    return (
      <div className="space-y-6">
        <DemoFallbackNotice missing={loaded.missing} />
        <OpportunityDetail id={id} />
      </div>
    );
  }
  return <RealOpportunityDetail loaded={loaded} />;
}

const route = detailRoute({
  label: "Oportunidade",
  ids: (all) => all.flatMap((w) => w.opportunities.map((x) => x.id)),
  title: (all, id) => all.flatMap((w) => w.opportunities).find((x) => x.id === id)?.title,
  render: (id) => <Detail id={id} />,
});

export const generateStaticParams = route.generateStaticParams;
export const generateMetadata = route.generateMetadata;
export default route.Page;
