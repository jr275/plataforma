import type { Metadata } from "next";
import { SourcesList } from "@/components/screens/sources-views";

export const metadata: Metadata = { title: "Data Sources" };

export default function Page() {
  return <SourcesList />;
}
