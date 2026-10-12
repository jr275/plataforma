import { AgentDetail } from "@/components/screens/agents-views";
import { detailRoute } from "@/lib/detail-route";

const route = detailRoute({
  label: "Agente",
  ids: (all) => all.flatMap((w) => w.agents.map((x) => x.id)),
  title: (all, id) => all.flatMap((w) => w.agents).find((x) => x.id === id)?.name,
  render: (id) => <AgentDetail id={id} />,
});

export const generateStaticParams = route.generateStaticParams;
export const generateMetadata = route.generateMetadata;
export default route.Page;
