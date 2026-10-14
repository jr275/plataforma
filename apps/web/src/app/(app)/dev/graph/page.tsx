import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { GraphWorkspace } from "@/components/graph/graph-workspace";
import { devGraphReader } from "@/lib/dev-graph-fixture";
import { loadGraphWorkspace, parseGraphParams } from "@/lib/server/graph";

export const metadata: Metadata = { title: "Prévia do grafo (desenvolvimento)" };

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound(); // só existe em desenvolvimento
  await connection();
  const raw = await searchParams;
  const params = parseGraphParams({ ...raw, kinds: Array.isArray(raw.kinds) ? raw.kinds.join(",") : raw.kinds });
  const data = await loadGraphWorkspace(devGraphReader(), params);
  return <GraphWorkspace loaded={{ state: "ready", data, origin: undefined }} params={params} devNote basePath="/dev/graph" />;
}

export default function Page(props: PageProps<"/dev/graph">) {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}
