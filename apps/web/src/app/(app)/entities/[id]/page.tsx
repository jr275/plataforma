import { EntityDetail } from "@/components/screens/entities-views";
import { detailRoute } from "@/lib/detail-route";

const route = detailRoute({
  label: "Entidade",
  ids: (all) => all.flatMap((w) => w.entities.map((x) => x.id)),
  title: (all, id) => all.flatMap((w) => w.entities).find((x) => x.id === id)?.label,
  render: (id) => <EntityDetail id={id} />,
});

export const generateStaticParams = route.generateStaticParams;
export const generateMetadata = route.generateMetadata;
export default route.Page;
