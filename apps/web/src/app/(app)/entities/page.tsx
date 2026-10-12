import type { Metadata } from "next";
import { EntitiesList } from "@/components/screens/entities-views";

export const metadata: Metadata = { title: "Entities" };

export default function Page() {
  return <EntitiesList />;
}
