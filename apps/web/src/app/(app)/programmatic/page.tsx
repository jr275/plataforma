import type { Metadata } from "next";
import { ProgrammaticView } from "@/components/screens/programmatic-view";

export const metadata: Metadata = { title: "Programmatic" };

export default function Page() {
  return <ProgrammaticView />;
}
