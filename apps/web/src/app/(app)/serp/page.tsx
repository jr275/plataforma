import type { Metadata } from "next";
import { SerpExplorer } from "@/components/serp/serp-explorer";

export const metadata: Metadata = { title: "SERP Explorer" };

export default function SerpPage() {
  return <SerpExplorer />;
}
