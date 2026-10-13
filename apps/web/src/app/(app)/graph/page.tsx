import type { Metadata } from "next";
import { GraphExplorer } from "@/components/graph/graph-explorer";

export const metadata: Metadata = {
  title: "Knowledge Graph",
  description: "Explore entidades, relações, fatos e fontes do espaço de trabalho, com um agente que explica o que está selecionado.",
};

export default function GraphPage() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="sr-only">Knowledge Graph</h1>
      <GraphExplorer />
    </div>
  );
}
