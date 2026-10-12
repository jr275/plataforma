import { KnowledgeDetail } from "@/components/screens/knowledge-views";
import { detailRoute } from "@/lib/detail-route";

const route = detailRoute({
  label: "Conhecimento",
  ids: (all) => all.flatMap((w) => w.knowledge.map((x) => x.id)),
  title: (all, id) => all.flatMap((w) => w.knowledge).find((x) => x.id === id)?.title,
  render: (id) => <KnowledgeDetail id={id} />,
});

export const generateStaticParams = route.generateStaticParams;
export const generateMetadata = route.generateMetadata;
export default route.Page;
