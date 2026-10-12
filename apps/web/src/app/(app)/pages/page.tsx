import type { Metadata } from "next";
import { PagesList } from "@/components/screens/pages-views";

export const metadata: Metadata = { title: "Pages" };

export default function Page() {
  return <PagesList />;
}
