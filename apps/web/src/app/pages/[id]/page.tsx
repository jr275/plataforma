import { PageDetail } from "@/components/screens/pages-views";
import { detailRoute } from "@/lib/detail-route";

const route = detailRoute({
  label: "Página",
  ids: (all) => all.flatMap((w) => w.pages.map((x) => x.id)),
  title: (all, id) => all.flatMap((w) => w.pages).find((x) => x.id === id)?.title,
  render: (id) => <PageDetail id={id} />,
});

export const generateStaticParams = route.generateStaticParams;
export const generateMetadata = route.generateMetadata;
export default route.Page;
