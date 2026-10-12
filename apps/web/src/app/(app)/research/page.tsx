import type { Metadata } from "next";
import { ResearchView } from "@/components/screens/research-view";

export const metadata: Metadata = { title: "Research" };

export default function Page() {
  return <ResearchView />;
}
