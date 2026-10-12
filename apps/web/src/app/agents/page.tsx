import type { Metadata } from "next";
import { AgentsList } from "@/components/screens/agents-views";

export const metadata: Metadata = { title: "Agents" };

export default function Page() {
  return <AgentsList />;
}
