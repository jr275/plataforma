import type { Metadata } from "next";
import { Suspense } from "react";
import { GraphWorkspace } from "@/components/graph/graph-workspace";
import { loadGraph, parseGraphParams } from "@/lib/server/graph";

export const metadata: Metadata = { title: "Knowledge Graph" };

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  // `kinds` pode vir repetido (caixas de seleção do formulário); junta antes de validar.
  const kinds = Array.isArray(raw.kinds) ? raw.kinds.join(",") : raw.kinds;
  const params = parseGraphParams({ ...raw, kinds });
  return <GraphWorkspace loaded={await loadGraph(params)} params={params} />;
}

export default function Page(props: PageProps<"/graph">) {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}
