import type { Metadata } from "next";
import { QualityView } from "@/components/screens/quality-view";

export const metadata: Metadata = { title: "Quality & Trust" };

export default function Page() {
  return <QualityView />;
}
