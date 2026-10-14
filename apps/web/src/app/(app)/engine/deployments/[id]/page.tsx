import type { Metadata } from "next";
import { Suspense } from "react";
import { DeploymentDetailView } from "@/components/engine/factory-views2";
import { loadDeployment } from "@/lib/server/factory";

export const metadata: Metadata = { title: "Deployment" };
async function Content({ params }: { params: Promise<{ id: string }> }) { return <DeploymentDetailView loaded={await loadDeployment((await params).id)} />; }
export default function Page(props: PageProps<"/engine/deployments/[id]">) { return <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}><Content params={props.params} /></Suspense>; }
