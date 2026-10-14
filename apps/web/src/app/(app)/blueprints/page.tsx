import { Suspense } from "react";
import { BlueprintLibrary } from "@/components/opportunities/blueprint-library";
import { loadRoadmapData } from "@/lib/server/opportunities";
export const metadata = { title: "Blueprints" };
async function Content() { return <BlueprintLibrary loaded={await loadRoadmapData()} />; }
export default function Page() { return <Suspense fallback={<p role="status">Carregando planos…</p>}><Content /></Suspense>; }
