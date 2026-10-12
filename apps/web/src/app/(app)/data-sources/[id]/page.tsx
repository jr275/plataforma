import { SourceDetail } from "@/components/screens/sources-views";
import { detailRoute } from "@/lib/detail-route";

const route = detailRoute({
  label: "Fonte",
  ids: (all) => all.flatMap((w) => w.sources.map((x) => x.id)),
  title: (all, id) => all.flatMap((w) => w.sources).find((x) => x.id === id)?.name,
  render: (id) => <SourceDetail id={id} />,
});

export const generateStaticParams = route.generateStaticParams;
export const generateMetadata = route.generateMetadata;
export default route.Page;
