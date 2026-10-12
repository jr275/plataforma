import { OpportunityDetail } from "@/components/opportunities/opportunity-detail";
import { detailRoute } from "@/lib/detail-route";

const route = detailRoute({
  label: "Oportunidade",
  ids: (all) => all.flatMap((w) => w.opportunities.map((x) => x.id)),
  title: (all, id) => all.flatMap((w) => w.opportunities).find((x) => x.id === id)?.title,
  render: (id) => <OpportunityDetail id={id} />,
});

export const generateStaticParams = route.generateStaticParams;
export const generateMetadata = route.generateMetadata;
export default route.Page;
