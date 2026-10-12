import type { Metadata } from "next";
import { KnowledgeList } from "@/components/screens/knowledge-views";

export const metadata: Metadata = { title: "Knowledge" };

export default function Page() {
  return <KnowledgeList />;
}
