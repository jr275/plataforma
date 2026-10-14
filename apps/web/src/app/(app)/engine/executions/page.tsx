import type { Metadata } from "next";
import { Suspense } from "react";
import { ExecutionMonitorView } from "@/components/engine/engine-views";
import { EXEC_PAGE, loadAgentRuns, parseExecParams } from "@/lib/server/engine-runtime";

export const metadata: Metadata = { title: "Monitor de execuções" };
async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = parseExecParams(await searchParams);
  return <ExecutionMonitorView loaded={await loadAgentRuns(params)} params={params} pageSize={EXEC_PAGE} />;
}
export default function Page(props: PageProps<"/engine/executions">) { return <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}><Content searchParams={props.searchParams} /></Suspense>; }
