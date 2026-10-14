import type { Metadata } from "next";
import { Suspense } from "react";
import { DeploymentsView } from "@/components/engine/factory-views2";
import { loadDeployments } from "@/lib/server/factory";

export const metadata: Metadata = { title: "Deployment Center" };
async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { const s = (await searchParams).status; const status = typeof s === "string" && /^[A-Z_]{4,24}$/.test(s) ? s : ""; return <DeploymentsView loaded={await loadDeployments(status)} status={status} />; }
export default function Page(props: PageProps<"/engine/deployments">) { return <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}><Content searchParams={props.searchParams} /></Suspense>; }
