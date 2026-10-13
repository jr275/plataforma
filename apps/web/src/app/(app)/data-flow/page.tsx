import type { Metadata } from "next";
import { Suspense } from "react";
import { DataFlowView } from "@/components/screens/data-flow-view";
import { loadDataFlow } from "@/lib/server/data-flow";

export const metadata: Metadata = { title: "Fluxo de dados" };

async function Content({ searchParams }: { searchParams: Promise<{ run?: string | string[] }> }) {
  const { run } = await searchParams;
  return <DataFlowView flow={await loadDataFlow(typeof run === "string" ? run : undefined)} />;
}

export default function Page(props: PageProps<"/data-flow">) {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}
